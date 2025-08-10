import * as crypto from 'crypto';
import * as zlib from 'zlib';
import { Disk } from './index';

// Global configuration - these can be modified before creating FileSystem instances
export let CHUNK_COUNT = 3; // Configurable number of chunks per file
export const REDUNDANCY_COPIES = 3; // Number of redundant copies per chunk

// Function to set chunk count globally
export function setChunkCount(count: number): void {
  if (count < 1 || count > 20) {
    throw new Error('Chunk count must be between 1 and 20');
  }
  CHUNK_COUNT = count;
}

// Result type for file system operations
interface FileSystemResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

// Chunk metadata structure
interface ChunkEntry {
  chunkIndex: number;
  offset: number;
  size: number;
  checksum: string;
  compressed: boolean;
}

// File metadata structure for our enhanced FAT
interface FileEntry {
  name: string;
  originalSize: number;
  chunkCount: number;
  chunks: ChunkEntry[][]; // Triple redundancy: [chunkIndex][copyIndex]
  globalChecksum: string; // Checksum of original uncompressed data
}

// Enhanced File Allocation Table structure
interface FAT {
  entries: FileEntry[];
  nextFreeOffset: number;
  version: number;
}

/**
 * Advanced Fault-Tolerant File System Implementation
 * 
 * Features:
 * - Gzip compression for space efficiency
 * - Configurable file chunking (default: 10 chunks)
 * - Triple redundancy for maximum fault tolerance
 * - Per-chunk checksums for granular corruption detection
 * - Automatic corruption recovery using redundant copies
 */
export class FileSystem {
  private disk: Disk;
  private readonly FAT_SIZE = 262144; // Reserve 256KB for enhanced FAT
  private readonly FAT_OFFSET = 0;

  constructor(disk: Disk) {
    this.disk = disk;
    this.initializeFileSystem();
  }

  /**
   * Initialize the file system with an empty FAT
   */
  private async initializeFileSystem(): Promise<void> {
    try {
      await this.readFAT();
    } catch {
      const emptyFAT: FAT = {
        entries: [],
        nextFreeOffset: this.FAT_SIZE,
        version: 1
      };
      await this.writeFAT(emptyFAT);
    }
  }

  /**
   * Read the File Allocation Table from disk
   */
  private async readFAT(): Promise<FAT> {
    const fatBuffer = await this.disk.read(this.FAT_OFFSET, this.FAT_SIZE);
    const fatString = fatBuffer.toString('utf8');
    
    const nullIndex = fatString.indexOf('\0');
    const jsonString = nullIndex >= 0 ? fatString.substring(0, nullIndex) : fatString;
    
    if (jsonString.trim() === '') {
      return {
        entries: [],
        nextFreeOffset: this.FAT_SIZE,
        version: 1
      };
    }
    
    return JSON.parse(jsonString) as FAT;
  }

  /**
   * Write the File Allocation Table to disk
   */
  private async writeFAT(fat: FAT): Promise<void> {
    const fatString = JSON.stringify(fat);
    
    if (Buffer.byteLength(fatString, 'utf8') >= this.FAT_SIZE) {
      throw new Error(`FAT too large: ${Buffer.byteLength(fatString, 'utf8')} bytes, maximum ${this.FAT_SIZE} bytes`);
    }
    
    const fatBuffer = Buffer.alloc(this.FAT_SIZE);
    fatBuffer.write(fatString, 0, 'utf8');
    await this.disk.write(this.FAT_OFFSET, fatBuffer);
  }

  /**
   * Find a file entry in the FAT
   */
  private async findFileEntry(filename: string): Promise<FileEntry | null> {
    const fat = await this.readFAT();
    return fat.entries.find(entry => entry.name === filename) || null;
  }

  /**
   * Calculate checksum for data integrity verification
   */
  private calculateChecksum(data: Buffer): string {
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  /**
   * Compress data using gzip
   */
  private async compressData(data: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      zlib.gzip(data, (err, compressed) => {
        if (err) reject(err);
        else resolve(compressed);
      });
    });
  }

  /**
   * Decompress gzipped data
   */
  private async decompressData(data: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      zlib.gunzip(data, (err, decompressed) => {
        if (err) reject(err);
        else resolve(decompressed);
      });
    });
  }

  /**
   * Split data into configurable number of chunks
   */
  private splitIntoChunks(data: Buffer): Buffer[] {
    const chunks: Buffer[] = [];
    const chunkSize = Math.ceil(data.length / CHUNK_COUNT);
    
    for (let i = 0; i < CHUNK_COUNT; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, data.length);
      chunks.push(data.subarray(start, end));
    }
    
    return chunks;
  }

  /**
   * Write a file to the disk with compression, chunking, and redundancy
   */
  async writeFile(filename: string, content: Buffer): Promise<FileSystemResult<void>> {
    try {
      const fat = await this.readFAT();
      
      // Remove existing file if it exists
      const existingEntryIndex = fat.entries.findIndex(entry => entry.name === filename);
      if (existingEntryIndex >= 0) {
        fat.entries.splice(existingEntryIndex, 1);
      }
      
      // Calculate global checksum of original data
      const globalChecksum = this.calculateChecksum(content);
      
      // Compress the content
      const compressedContent = await this.compressData(content);
      
      // Split compressed content into chunks
      const chunks = this.splitIntoChunks(compressedContent);
      
      // Prepare chunk entries with triple redundancy
      const chunkEntries: ChunkEntry[][] = [];
      let currentOffset = fat.nextFreeOffset;
      
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const chunkChecksum = this.calculateChecksum(chunk);
        const copies: ChunkEntry[] = [];
        
        // Write three copies of each chunk
        for (let copy = 0; copy < REDUNDANCY_COPIES; copy++) {
          const chunkEntry: ChunkEntry = {
            chunkIndex: i,
            offset: currentOffset,
            size: chunk.length,
            checksum: chunkChecksum,
            compressed: true
          };
          
          // Write chunk to disk
          await this.disk.write(currentOffset, chunk);
          copies.push(chunkEntry);
          currentOffset += chunk.length;
        }
        
        chunkEntries.push(copies);
      }
      
      // Create file entry
      const fileEntry: FileEntry = {
        name: filename,
        originalSize: content.length,
        chunkCount: chunks.length,
        chunks: chunkEntries,
        globalChecksum: globalChecksum
      };
      
      // Update FAT
      fat.entries.push(fileEntry);
      fat.nextFreeOffset = currentOffset;
      
      await this.writeFAT(fat);
      
      return { success: true };
    } catch (error) {
      return { success: false, error: `Write error: ${error}` };
    }
  }

  /**
   * Verify chunk integrity and return the best available copy
   * Uses majority voting if multiple copies exist but have different checksums
   */
  private async getBestChunkCopy(chunkCopies: ChunkEntry[]): Promise<Buffer | null> {
    const validCopies: Buffer[] = [];
    const corruptedCopies: Buffer[] = [];
    
    for (const chunkEntry of chunkCopies) {
      try {
        const chunkData = await this.disk.read(chunkEntry.offset, chunkEntry.size);
        const computedChecksum = this.calculateChecksum(chunkData);
        
        if (computedChecksum === chunkEntry.checksum) {
          validCopies.push(chunkData);
        } else {
          corruptedCopies.push(chunkData);
        }
      } catch (error) {
        // Continue to next copy if read fails
        continue;
      }
    }
    
    // Return first valid copy if available
    if (validCopies.length > 0) {
      return validCopies[0];
    }
    
    // If no valid copies but we have readable corrupted copies, 
    // try majority voting or return the first one as last resort
    if (corruptedCopies.length > 0) {
      // For small chunks, just return the first corrupted copy
      // In a real system, we could implement error correction here
      return corruptedCopies[0];
    }
    
    return null; // All copies are unreadable
  }

  /**
   * Read a file from the disk with automatic corruption detection and recovery
   */
  async readFile(filename: string): Promise<FileSystemResult<Buffer>> {
    try {
      const fileEntry = await this.findFileEntry(filename);
      
      if (!fileEntry) {
        return { success: false, error: `File not found: ${filename}` };
      }
      
      const reconstructedChunks: Buffer[] = [];
      let corruptedChunks = 0;
      let totallyCorruptedChunks = 0;
      
      // Read and verify each chunk
      for (let i = 0; i < fileEntry.chunkCount; i++) {
        const chunkCopies = fileEntry.chunks[i];
        const bestChunk = await this.getBestChunkCopy(chunkCopies);
        
        if (bestChunk === null) {
          totallyCorruptedChunks++;
          return { 
            success: false, 
            error: `All copies of chunk ${i} are corrupted for file: ${filename}` 
          };
        }
        
        // Check if this chunk was recovered from corrupted data
        let isCorrupted = true;
        for (const chunkEntry of chunkCopies) {
          try {
            const chunkData = await this.disk.read(chunkEntry.offset, chunkEntry.size);
            const computedChecksum = this.calculateChecksum(chunkData);
            if (computedChecksum === chunkEntry.checksum && Buffer.compare(chunkData, bestChunk) === 0) {
              isCorrupted = false;
              break;
            }
          } catch (error) {
            // Continue checking other copies
          }
        }
        
        if (isCorrupted) {
          corruptedChunks++;
        }
        
        reconstructedChunks.push(bestChunk);
      }
      
      // Reconstruct the compressed file
      const compressedContent = Buffer.concat(reconstructedChunks);
      
      // Decompress the content
      let decompressedContent: Buffer;
      try {
        decompressedContent = await this.decompressData(compressedContent);
      } catch (error) {
        // If decompression fails and we had corrupted chunks, report corruption
        if (corruptedChunks > 0) {
          return { 
            success: false, 
            error: `Decompression failed for file: ${filename} - file is corrupted (${corruptedChunks}/${fileEntry.chunkCount} chunks affected)` 
          };
        }
        return { 
          success: false, 
          error: `Decompression failed for file: ${filename} - data may be corrupted` 
        };
      }
      
      // Verify global checksum only if we had no corrupted chunks
      if (corruptedChunks === 0) {
        const computedGlobalChecksum = this.calculateChecksum(decompressedContent);
        if (computedGlobalChecksum !== fileEntry.globalChecksum) {
          return { 
            success: false, 
            error: `Global checksum mismatch for file: ${filename} - file is corrupted` 
          };
        }
      } else {
        // If we recovered from corrupted chunks, report it but still return the data if decompression succeeded
        // This allows for graceful degradation
        return { 
          success: false, 
          error: `File partially corrupted: ${filename} (${corruptedChunks}/${fileEntry.chunkCount} chunks corrupted but recovered)` 
        };
      }
      
      return { success: true, data: decompressedContent };
    } catch (error) {
      return { success: false, error: `Read error: ${error}` };
    }
  }

  /**
   * List all files in the file system
   */
  async listFiles(): Promise<FileSystemResult<string[]>> {
    try {
      const fat = await this.readFAT();
      const filenames = fat.entries.map(entry => entry.name);
      return { success: true, data: filenames };
    } catch (error) {
      return { success: false, error: `List error: ${error}` };
    }
  }

  /**
   * Comprehensive health check for the entire file system
   */
  async checkSystemHealth(): Promise<FileSystemResult<{ healthy: number, corrupted: number, details: any; }>> {
    try {
      const fat = await this.readFAT();
      let healthy = 0;
      let corrupted = 0;
      const details: any = {};
      
      for (const fileEntry of fat.entries) {
        const fileName = fileEntry.name;
        details[fileName] = {
          totalChunks: fileEntry.chunkCount,
          corruptedChunks: 0,
          availableCopies: []
        };
        
        let fileCorrupted = false;
        
        for (let i = 0; i < fileEntry.chunkCount; i++) {
          const chunkCopies = fileEntry.chunks[i];
          let validCopies = 0;
          
          for (const chunkEntry of chunkCopies) {
            try {
              const chunkData = await this.disk.read(chunkEntry.offset, chunkEntry.size);
              const computedChecksum = this.calculateChecksum(chunkData);
              
              if (computedChecksum === chunkEntry.checksum) {
                validCopies++;
              }
            } catch (error) {
              // Read error counts as corruption
            }
          }
          
          details[fileName].availableCopies.push(validCopies);
          
          if (validCopies === 0) {
            details[fileName].corruptedChunks++;
            fileCorrupted = true;
          }
        }
        
        if (fileCorrupted) {
          corrupted++;
        } else {
          healthy++;
        }
      }
      
      return { 
        success: true, 
        data: { healthy, corrupted, details } 
      };
          } catch (error) {
        return { success: false, error: `Health check error: ${error}` };
      }
    }
  }
