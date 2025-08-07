import { Logger } from './index';
import * as crypto from 'crypto';
import { Disk } from './index';
import * as zlib from 'zlib';
import { promisify } from 'util';

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

interface FileSystemResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

interface FileMeta {
  name: string;
  size: number;
  checksum: string;
  chunkRefs: string[];
  createdAt: number;
  modifiedAt: number;
}

interface FileChunk {
  hash: string;
  compressedData: Buffer;
  originalSize: number;
  references: number;
  offset: number;
  replicaOffset: number;
  checksum: string;
}

interface MetadataSection {
  version: number;
  files: FileMeta[];
  chunks: Map<string, FileChunk>;
  freeSpace: FreeSpaceEntry[];
  checksum: string;
  modifiedAt?: number;
}

interface FreeSpaceEntry {
  offset: number;
  size: number;
}

interface DistributedMetadata {
  primary: MetadataSection;
  backups: MetadataSection[];
  lastCheckpoint: number;
}

export class EnhancedFileSystem {
  private disk: Disk;
  private blockSize = 512;
  private chunkSize = 4096; // 4KB chunks
  private metadataOffset = 0;
  private metadataSize = 65536; // 64KB for metadata
  private metadataSections = 3; // Number of metadata backup sections
  private sectionSize: number;
  private metadata: DistributedMetadata;
  private metadataLoaded = false;
  private metadataCorrupted = false;
  private compressionThreshold = 100; // Only compress chunks larger than 100 bytes

  constructor(disk: Disk) {
    this.disk = disk;
    this.sectionSize = Math.floor(this.metadataSize / this.metadataSections);
    this.metadata = {
      primary: this.createEmptyMetadataSection(),
      backups: [],
      lastCheckpoint: 0
    };
  }

  private createEmptyMetadataSection(): MetadataSection {
    return {
      version: 1,
      files: [],
      chunks: new Map(),
      freeSpace: [],
      checksum: ''
    };
  }

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
      Logger.warning(`[YOIFS] Compression failed, using original data: ${error}`);
      return data;
    }
  }

  private async decompress(data: Buffer, originalSize: number): Promise<Buffer> {
    if (data.length === originalSize) {
      return data; // Not compressed
    }
    try {
      return await gunzip(data);
    } catch (error) {
      Logger.error(`[YOIFS] Decompression failed: ${error}`);
      throw new Error('Decompression failed');
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

  private async loadMetadata(): Promise<void> {
    if (this.metadataLoaded && !this.metadataCorrupted) return;

    try {
      // Try to load primary metadata first
      const primaryData = await this.disk.read(this.metadataOffset, this.sectionSize);
      const primarySection = this.parseMetadataSection(primaryData);
      
      if (primarySection && this.validateMetadataSection(primarySection)) {
        this.metadata.primary = primarySection;
        this.metadataCorrupted = false;
        Logger.info(`[YOIFS] Primary metadata loaded (${this.metadata.primary.files.length} files, ${this.metadata.primary.chunks.size} chunks).`);
      } else {
        // Check if this is an empty disk (all zeros)
        const isEmpty = primaryData.every(byte => byte === 0);
        if (isEmpty) {
          Logger.info('[YOIFS] Empty disk detected, initializing fresh metadata.');
          this.metadata.primary = this.createEmptyMetadataSection();
          this.metadataCorrupted = false;
          // Save initial metadata
          await this.saveMetadata();
        } else {
          throw new Error('Primary metadata invalid');
        }
      }

      // Load backup metadata sections
      this.metadata.backups = [];
      for (let i = 1; i < this.metadataSections; i++) {
        try {
          const backupOffset = this.metadataOffset + (i * this.sectionSize);
          const backupData = await this.disk.read(backupOffset, this.sectionSize);
          const backupSection = this.parseMetadataSection(backupData);
          
          if (backupSection && this.validateMetadataSection(backupSection)) {
            this.metadata.backups.push(backupSection);
          }
        } catch (error) {
          Logger.warning(`[YOIFS] Backup metadata section ${i} corrupted or missing`);
        }
      }

      // If primary is corrupted, try to recover from backup
      if (this.metadataCorrupted && this.metadata.backups.length > 0) {
        const bestBackup = this.findBestBackup();
        if (bestBackup) {
          this.metadata.primary = bestBackup;
          this.metadataCorrupted = false;
          Logger.info('[YOIFS] Recovered metadata from backup');
        }
      }

    } catch (error) {
      Logger.error('[YOIFS] Could not load metadata! Disk might be empty or corrupted.');
      this.metadata.primary = this.createEmptyMetadataSection();
      this.metadataCorrupted = true;
    }

    this.metadataLoaded = true;
  }

  private parseMetadataSection(data: Buffer): MetadataSection | null {
    try {
      const json = data.toString().replace(/\0+$/, '');
      if (!json.trim()) return null;
      
      const parsed = JSON.parse(json);
      
      // Reconstruct Map from serialized data
      const chunks = new Map<string, FileChunk>();
      if (parsed.chunks) {
        for (const [key, value] of Object.entries(parsed.chunks)) {
          chunks.set(key, value as FileChunk);
        }
      }
      
      return {
        version: parsed.version || 1,
        files: parsed.files || [],
        chunks,
        freeSpace: parsed.freeSpace || [],
        checksum: parsed.checksum || ''
      };
    } catch (error) {
      return null;
    }
  }

  private validateMetadataSection(section: MetadataSection): boolean {
    try {
      const dataToCheck = {
        version: section.version,
        files: section.files,
        chunks: Object.fromEntries(section.chunks),
        freeSpace: section.freeSpace
      };
      const expectedChecksum = this.calculateChecksum(Buffer.from(JSON.stringify(dataToCheck)));
      return expectedChecksum === section.checksum;
    } catch (error) {
      return false;
    }
  }

  private findBestBackup(): MetadataSection | null {
    if (this.metadata.backups.length === 0) return null;
    
    // Find backup with highest version number
    return this.metadata.backups.reduce((best, current) => 
      current.version > best.version ? current : best
    );
  }

  private async saveMetadata(): Promise<void> {
    // Update version and calculate checksum
    this.metadata.primary.version++;
    this.metadata.primary.modifiedAt = Date.now();
    
    const dataToCheck = {
      version: this.metadata.primary.version,
      files: this.metadata.primary.files,
      chunks: Object.fromEntries(this.metadata.primary.chunks),
      freeSpace: this.metadata.primary.freeSpace
    };
    
    this.metadata.primary.checksum = this.calculateChecksum(Buffer.from(JSON.stringify(dataToCheck)));

    // Serialize metadata
    const json = JSON.stringify(this.metadata.primary);
    const metadataBuffer = Buffer.alloc(this.sectionSize, 0);
    metadataBuffer.write(json);

    // Write to all sections (primary + backups)
    const writePromises = [];
    for (let i = 0; i < this.metadataSections; i++) {
      const offset = this.metadataOffset + (i * this.sectionSize);
      writePromises.push(this.disk.write(offset, metadataBuffer));
    }

    await Promise.all(writePromises);
    Logger.info(`[YOIFS] Metadata saved (version ${this.metadata.primary.version})`);
  }

  private getNextOffset(): number {
    let maxEnd = this.metadataOffset + this.metadataSize;
    
    // Check file chunks
    for (const chunk of this.metadata.primary.chunks.values()) {
      maxEnd = Math.max(maxEnd, chunk.offset + chunk.compressedData.length, chunk.replicaOffset + chunk.compressedData.length);
    }
    
    // Check free space entries
    for (const freeSpace of this.metadata.primary.freeSpace) {
      maxEnd = Math.max(maxEnd, freeSpace.offset + freeSpace.size);
    }
    
    return Math.ceil(maxEnd / this.blockSize) * this.blockSize;
  }

  private findFreeSpace(size: number): number | null {
    // Simple first-fit algorithm
    for (const freeSpace of this.metadata.primary.freeSpace) {
      if (freeSpace.size >= size) {
        const offset = freeSpace.offset;
        freeSpace.offset += size;
        freeSpace.size -= size;
        
        // Remove if completely used
        if (freeSpace.size === 0) {
          this.metadata.primary.freeSpace = this.metadata.primary.freeSpace.filter(fs => fs.size > 0);
        }
        
        return offset;
      }
    }
    return null;
  }

  private markFreeSpace(offset: number, size: number): void {
    // Merge adjacent free spaces
    const newFreeSpace: FreeSpaceEntry = { offset, size };
    
    // Find adjacent free spaces and merge
    const adjacent = this.metadata.primary.freeSpace.filter(fs => 
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
        this.metadata.primary.freeSpace = this.metadata.primary.freeSpace.filter(fs => fs !== adj);
      }
    }
    
    this.metadata.primary.freeSpace.push(newFreeSpace);
  }

  async writeFile(fileName: string, content: Buffer): Promise<FileSystemResult<void>> {
    await this.loadMetadata();
    
    if (this.metadataCorrupted) {
      Logger.error('[YOIFS] Cannot write file: metadata is corrupted!');
      return { success: false, error: 'Metadata corrupted' };
    }

    try {
      // Remove existing file if it exists
      await this.deleteFileInternal(fileName);

      const chunks = this.splitIntoChunks(content);
      const chunkRefs: string[] = [];
      const now = Date.now();

      // Process each chunk
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const hash = this.calculateChecksum(chunk);
        
        // Check if chunk already exists
        if (this.metadata.primary.chunks.has(hash)) {
          // Increment reference count
          const existingChunk = this.metadata.primary.chunks.get(hash)!;
          existingChunk.references++;
          chunkRefs.push(hash);
          continue;
        }

        // Compress chunk
        const compressedData = await this.compress(chunk);
        const chunkChecksum = this.calculateChecksum(compressedData);

        // Find space for chunk and replica
        const chunkSize = compressedData.length;
        const replicaOffset = this.getNextOffset() + Math.ceil(chunkSize / this.blockSize) * this.blockSize;
        
        let offset = this.findFreeSpace(chunkSize);
        if (offset === null) {
          offset = this.getNextOffset();
        }

        // Check disk space
        const diskSize = this.disk.size ? this.disk.size() : Infinity;
        if (replicaOffset + chunkSize > diskSize) {
          Logger.error('[YOIFS] Not enough disk space for file and replica!');
          return { success: false, error: 'Disk full: not enough space for file and replica' };
        }

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
          checksum: chunkChecksum
        };

        this.metadata.primary.chunks.set(hash, chunkMeta);
        chunkRefs.push(hash);
      }

      // Create file metadata
      const fileMeta: FileMeta = {
        name: fileName,
        size: content.length,
        checksum: this.calculateChecksum(content),
        chunkRefs,
        createdAt: now,
        modifiedAt: now
      };

      this.metadata.primary.files.push(fileMeta);
      await this.saveMetadata();

      Logger.info(`[YOIFS] File '${fileName}' written successfully (${chunks.length} chunks)`);
      return { success: true };

    } catch (error: any) {
      Logger.error(`[YOIFS] Failed to write file '${fileName}': ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  async readFile(fileName: string): Promise<FileSystemResult<Buffer>> {
    await this.loadMetadata();
    
    if (this.metadataCorrupted) {
      Logger.error('[YOIFS] Cannot read file: metadata is corrupted!');
      return { success: false, error: 'Metadata corrupted' };
    }

    const fileMeta = this.metadata.primary.files.find(f => f.name === fileName);
    if (!fileMeta) {
      Logger.info(`[YOIFS] File '${fileName}' not found.`);
      return { success: false, error: 'File not found' };
    }

    try {
      const recoveredChunks: Buffer[] = [];
      let corruptedChunks = 0;
      let totalChunks = fileMeta.chunkRefs.length;

      for (const chunkRef of fileMeta.chunkRefs) {
        const chunkMeta = this.metadata.primary.chunks.get(chunkRef);
        if (!chunkMeta) {
          corruptedChunks++;
          Logger.error(`[YOIFS] Chunk ${chunkRef} not found in metadata`);
          continue;
        }

        const chunkResult = await this.readChunk(chunkMeta);
        if (chunkResult.success) {
          recoveredChunks.push(chunkResult.data!);
        } else {
          corruptedChunks++;
          Logger.error(`[YOIFS] Failed to read chunk ${chunkRef}: ${chunkResult.error}`);
        }
      }

      if (corruptedChunks === 0) {
        const fullContent = Buffer.concat(recoveredChunks);
        
        // Verify file checksum
        if (this.calculateChecksum(fullContent) === fileMeta.checksum) {
          return { success: true, data: fullContent };
        } else {
          Logger.error(`[YOIFS] File checksum verification failed for '${fileName}'`);
          return { success: false, error: 'File checksum verification failed' };
        }
      } else {
        Logger.warning(`[YOIFS] ${corruptedChunks}/${totalChunks} chunks corrupted in file '${fileName}'`);
        return { 
          success: false, 
          error: `${corruptedChunks} chunks corrupted out of ${totalChunks}` 
        };
      }

    } catch (error: any) {
      Logger.error(`[YOIFS] Failed to read file '${fileName}': ${error.message}`);
      return { success: false, error: error.message };
    }
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
      Logger.warning(`[YOIFS] Failed to read primary chunk at offset ${chunkMeta.offset}`);
    }

    // Try to read replica
    try {
      replica = await this.disk.read(chunkMeta.replicaOffset, chunkMeta.compressedData.length);
      if (replica && this.calculateChecksum(replica) === chunkMeta.checksum) {
        replicaOk = true;
      }
    } catch (error) {
      Logger.warning(`[YOIFS] Failed to read replica chunk at offset ${chunkMeta.replicaOffset}`);
    }

    // Return best available data
    if (primaryOk && replicaOk && primary) {
      // Both are good, return primary
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

  async deleteFile(fileName: string): Promise<FileSystemResult<void>> {
    await this.loadMetadata();
    
    if (this.metadataCorrupted) {
      Logger.error('[YOIFS] Cannot delete file: metadata is corrupted!');
      return { success: false, error: 'Metadata corrupted' };
    }

    return this.deleteFileInternal(fileName);
  }

  private async deleteFileInternal(fileName: string): Promise<FileSystemResult<void>> {
    const fileIndex = this.metadata.primary.files.findIndex(f => f.name === fileName);
    if (fileIndex === -1) {
      return { success: false, error: 'File not found' };
    }

    const fileMeta = this.metadata.primary.files[fileIndex];
    
    // Decrement reference counts for chunks
    for (const chunkRef of fileMeta.chunkRefs) {
      const chunk = this.metadata.primary.chunks.get(chunkRef);
      if (chunk) {
        chunk.references--;
        if (chunk.references === 0) {
          // Mark space as free
          this.markFreeSpace(chunk.offset, chunk.compressedData.length);
          this.markFreeSpace(chunk.replicaOffset, chunk.compressedData.length);
          this.metadata.primary.chunks.delete(chunkRef);
          Logger.info(`[YOIFS] Freed chunk ${chunkRef} (no more references)`);
        }
      }
    }

    // Remove file from metadata
    this.metadata.primary.files.splice(fileIndex, 1);
    await this.saveMetadata();

    Logger.info(`[YOIFS] File '${fileName}' deleted successfully`);
    return { success: true };
  }

  async listFiles(): Promise<FileSystemResult<string[]>> {
    await this.loadMetadata();
    
    if (this.metadataCorrupted) {
      Logger.error('[YOIFS] Cannot list files: metadata is corrupted!');
      return { success: false, error: 'Metadata corrupted' };
    }

    const fileNames = this.metadata.primary.files.map(f => f.name);
    return { success: true, data: fileNames };
  }

  async getFileInfo(fileName: string): Promise<FileSystemResult<FileMeta>> {
    await this.loadMetadata();
    
    if (this.metadataCorrupted) {
      return { success: false, error: 'Metadata corrupted' };
    }

    const fileMeta = this.metadata.primary.files.find(f => f.name === fileName);
    if (!fileMeta) {
      return { success: false, error: 'File not found' };
    }

    return { success: true, data: fileMeta };
  }

  async appendFile(fileName: string, additionalContent: Buffer): Promise<FileSystemResult<void>> {
    const existingResult = await this.readFile(fileName);
    if (!existingResult.success) {
      return { success: false, error: existingResult.error };
    }

    const combinedContent = Buffer.concat([existingResult.data!, additionalContent]);
    return this.writeFile(fileName, combinedContent);
  }

  async getDiskUsage(): Promise<FileSystemResult<{ used: number; free: number; total: number }>> {
    await this.loadMetadata();
    
    const total = this.disk.size ? this.disk.size() : 0;
    let used = this.metadataOffset + this.metadataSize; // Metadata space
    
    // Calculate used space from chunks
    for (const chunk of this.metadata.primary.chunks.values()) {
      used += chunk.compressedData.length * 2; // Primary + replica
    }
    
    const free = total - used;
    
    return { 
      success: true, 
      data: { used, free, total } 
    };
  }

  async getCompressionStats(): Promise<FileSystemResult<{ originalSize: number; compressedSize: number; ratio: number }>> {
    await this.loadMetadata();
    
    let originalSize = 0;
    let compressedSize = 0;
    
    for (const chunk of this.metadata.primary.chunks.values()) {
      originalSize += chunk.originalSize * chunk.references;
      compressedSize += chunk.compressedData.length * chunk.references;
    }
    
    const ratio = originalSize > 0 ? (compressedSize / originalSize) * 100 : 0;
    
    return { 
      success: true, 
      data: { originalSize, compressedSize, ratio } 
    };
  }
}
