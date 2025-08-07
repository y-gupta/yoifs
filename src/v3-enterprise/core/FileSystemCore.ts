import * as crypto from 'crypto';
import * as zlib from 'zlib';
import { promisify } from 'util';
import { Disk } from '../../v1-basic/index';
import { 
  FileSystemResult, 
  FileMeta, 
  FileChunk 
} from '../types';
import { CacheService } from '../performance/CacheService';
import { Logger } from '../../v1-basic/index';

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

export class FileSystemCore {
  private disk: Disk;
  private cacheService: CacheService;
  private blockSize = 512;
  private chunkSize = 4096;
  private compressionThreshold = 100;
  
  // File System State
  private files = new Map<string, FileMeta>();
  private chunks = new Map<string, FileChunk>();
  private freeSpace: Array<{ offset: number; size: number }> = [];

  constructor(disk: Disk, cacheService: CacheService) {
    this.disk = disk;
    this.cacheService = cacheService;
  }

  async writeFile(fileName: string, content: Buffer, owner: string): Promise<FileSystemResult<string>> {
    try {
      // Check if file exists and delete it
      const existingFile = Array.from(this.files.values()).find(f => f.name === fileName && f.owner === owner);
      if (existingFile) {
        await this.deleteFileInternal(existingFile.id);
      }

      // Split into chunks
      const chunks = this.splitIntoChunks(content);
      const chunkRefs: string[] = [];
      const fileId = crypto.randomUUID();

      // Process each chunk
      for (const chunk of chunks) {
        const hash = this.calculateChecksum(chunk);
        
        // Check if chunk already exists
        if (this.chunks.has(hash)) {
          const existingChunk = this.chunks.get(hash)!;
          existingChunk.references++;
          chunkRefs.push(hash);
          continue;
        }

        // Compress chunk
        const compressedData = await this.compress(chunk);
        
        // Find space for chunk and replica
        const offset = this.findFreeSpace(compressedData.length);
        const replicaOffset = offset + Math.ceil(compressedData.length / this.blockSize) * this.blockSize;
        
        // Write chunk and replica
        await this.disk.write(offset, compressedData);
        await this.disk.write(replicaOffset, compressedData);

        // Store chunk metadata
        const chunkMeta: FileChunk = {
          hash,
          compressedData,
          originalSize: chunk.length,
          references: 1,
          offset,
          replicaOffset,
          checksum: this.calculateChecksum(compressedData),
          backupLocations: []
        };

        this.chunks.set(hash, chunkMeta);
        chunkRefs.push(hash);
      }

      // Create file metadata
      const fileMeta: FileMeta = {
        id: fileId,
        name: fileName,
        size: content.length,
        checksum: this.calculateChecksum(content),
        chunkRefs,
        createdAt: new Date(),
        modifiedAt: new Date(),
        owner,
        permissions: [],
        compressionRatio: content.length > 0 ? (chunkRefs.reduce((sum, ref) => sum + this.chunks.get(ref)!.compressedData.length, 0) / content.length) * 100 : 0,
        accessCount: 0,
        lastAccessed: new Date(),
        tier: 'HOT'
      };

      this.files.set(fileId, fileMeta);
      
      // Cache the file
      await this.cacheService.set(`file_${fileId}`, content);
      
      Logger.info(`[CORE] File '${fileName}' written successfully (${chunks.length} chunks)`);
      return { success: true, data: fileId };

    } catch (error: any) {
      Logger.error(`[CORE] Failed to write file '${fileName}': ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  async readFile(fileId: string): Promise<FileSystemResult<Buffer>> {
    try {
      const fileMeta = this.files.get(fileId);
      if (!fileMeta) {
        return { success: false, error: 'File not found' };
      }

      // Check cache first
      const cachedData = await this.cacheService.get(`file_${fileId}`);
      if (cachedData) {
        // Update file access stats
        fileMeta.accessCount++;
        fileMeta.lastAccessed = new Date();
        return { success: true, data: cachedData };
      }

      // Reconstruct file from chunks
      const recoveredChunks: Buffer[] = [];
      
      for (const chunkRef of fileMeta.chunkRefs) {
        const chunkMeta = this.chunks.get(chunkRef);
        if (!chunkMeta) {
          throw new Error(`Chunk ${chunkRef} not found`);
        }

        const chunkResult = await this.readChunk(chunkMeta);
        if (!chunkResult.success) {
          throw new Error(`Failed to read chunk ${chunkRef}: ${chunkResult.error}`);
        }
        
        recoveredChunks.push(chunkResult.data!);
      }

      const fullContent = Buffer.concat(recoveredChunks);
      
      // Verify file checksum
      if (this.calculateChecksum(fullContent) !== fileMeta.checksum) {
        throw new Error('File checksum verification failed');
      }

      // Cache the file
      await this.cacheService.set(`file_${fileId}`, fullContent);
      
      // Update file access stats
      fileMeta.accessCount++;
      fileMeta.lastAccessed = new Date();
      
      return { success: true, data: fullContent };

    } catch (error: any) {
      Logger.error(`[CORE] Failed to read file ${fileId}: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  async deleteFile(fileId: string): Promise<FileSystemResult<void>> {
    return this.deleteFileInternal(fileId);
  }

  private async deleteFileInternal(fileId: string): Promise<FileSystemResult<void>> {
    const fileMeta = this.files.get(fileId);
    if (!fileMeta) {
      return { success: false, error: 'File not found' };
    }

    // Decrement reference counts for chunks
    for (const chunkRef of fileMeta.chunkRefs) {
      const chunk = this.chunks.get(chunkRef);
      if (chunk) {
        chunk.references--;
        if (chunk.references === 0) {
          // Mark space as free
          this.markFreeSpace(chunk.offset, chunk.compressedData.length);
          this.markFreeSpace(chunk.replicaOffset, chunk.compressedData.length);
          this.chunks.delete(chunkRef);
        }
      }
    }

    // Remove file from metadata
    this.files.delete(fileId);
    
    // Remove from cache
    await this.cacheService.invalidate(`file_${fileId}`);
    
    Logger.info(`[CORE] File '${fileMeta.name}' deleted successfully`);
    return { success: true };
  }

  // ============================================================================
  // UTILITY METHODS
  // ============================================================================

  private calculateChecksum(data: Buffer): string {
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  private async compress(data: Buffer): Promise<Buffer> {
    if (data.length < this.compressionThreshold) {
      return data; // Don't compress small data
    }
    try {
      return await gzip(data);
    } catch (error) {
      Logger.warning(`[CORE] Compression failed, using original data: ${error}`);
      return data;
    }
  }

  private splitIntoChunks(data: Buffer): Buffer[] {
    const chunks: Buffer[] = [];
    for (let offset = 0; offset < data.length; offset += this.chunkSize) {
      const chunk = data.subarray(offset, offset + this.chunkSize);
      chunks.push(chunk);
    }
    return chunks;
  }

  private async readChunk(chunkMeta: FileChunk): Promise<FileSystemResult<Buffer>> {
    let primary: Buffer | undefined, replica: Buffer | undefined;
    let primaryOk = false, replicaOk = false;

    // Try to read primary
    try {
      primary = await this.disk.read(chunkMeta.offset, chunkMeta.compressedData.length);
      if (primary && this.calculateChecksum(primary) === chunkMeta.checksum) {
        primaryOk = true;
      }
    } catch (error) {
      Logger.warning(`[CORE] Failed to read primary chunk at offset ${chunkMeta.offset}`);
    }

    // Try to read replica
    try {
      replica = await this.disk.read(chunkMeta.replicaOffset, chunkMeta.compressedData.length);
      if (replica && this.calculateChecksum(replica) === chunkMeta.checksum) {
        replicaOk = true;
      }
    } catch (error) {
      Logger.warning(`[CORE] Failed to read replica chunk at offset ${chunkMeta.replicaOffset}`);
    }

    // Return best available data
    if (primaryOk && replicaOk && primary) {
      const decompressed = await this.decompress(primary, chunkMeta.originalSize);
      return { success: true, data: decompressed };
    } else if (primaryOk && primary) {
      // Primary is good, repair replica
      await this.disk.write(chunkMeta.replicaOffset, primary);
      const decompressed = await this.decompress(primary, chunkMeta.originalSize);
      return { success: true, data: decompressed };
    } else if (replicaOk && replica) {
      // Replica is good, repair primary
      await this.disk.write(chunkMeta.offset, replica);
      const decompressed = await this.decompress(replica, chunkMeta.originalSize);
      return { success: true, data: decompressed };
    } else {
      return { success: false, error: 'Both primary and replica corrupted' };
    }
  }

  private async decompress(data: Buffer, originalSize: number): Promise<Buffer> {
    if (data.length === originalSize) {
      return data; // Not compressed
    }
    try {
      return await gunzip(data);
    } catch (error) {
      Logger.error(`[CORE] Decompression failed: ${error}`);
      throw new Error('Decompression failed');
    }
  }

  private findFreeSpace(size: number): number {
    // Simple first-fit algorithm
    for (let i = 0; i < this.freeSpace.length; i++) {
      if (this.freeSpace[i].size >= size) {
        const offset = this.freeSpace[i].offset;
        this.freeSpace[i].offset += size;
        this.freeSpace[i].size -= size;
        
        if (this.freeSpace[i].size === 0) {
          this.freeSpace.splice(i, 1);
        }
        
        return offset;
      }
    }
    
    // No free space found, allocate at end
    const offset = this.freeSpace.length > 0 ? 
      Math.max(...this.freeSpace.map(fs => fs.offset + fs.size)) : 0;
    return offset;
  }

  private markFreeSpace(offset: number, size: number): void {
    // Merge adjacent free spaces
    const newFreeSpace = { offset, size };
    
    // Find adjacent free spaces and merge
    const adjacent = this.freeSpace.filter(fs => 
      fs.offset + fs.size === offset || offset + size === fs.offset
    );
    
    for (const adj of adjacent) {
      if (adj.offset + adj.size === offset) {
        // Adjacent before
        adj.size += size;
        return;
      } else if (offset + size === adj.offset) {
        // Adjacent after
        newFreeSpace.size += adj.size;
        this.freeSpace = this.freeSpace.filter(fs => fs !== adj);
      }
    }
    
    this.freeSpace.push(newFreeSpace);
  }

  // ============================================================================
  // ANALYTICS METHODS
  // ============================================================================

  getFileCount(): number {
    return this.files.size;
  }

  getChunkCount(): number {
    return this.chunks.size;
  }

  getTotalFileSize(): number {
    let totalSize = 0;
    for (const file of this.files.values()) {
      totalSize += file.size;
    }
    return totalSize;
  }

  getCompressionRatio(): number {
    let totalOriginal = 0;
    let totalCompressed = 0;
    
    for (const chunk of this.chunks.values()) {
      totalOriginal += chunk.originalSize * chunk.references;
      totalCompressed += chunk.compressedData.length * chunk.references;
    }
    
    return totalOriginal > 0 ? (totalCompressed / totalOriginal) * 100 : 0;
  }
}
