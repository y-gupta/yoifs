import { Logger } from '../v1-basic/index';
import * as crypto from 'crypto';
import { Disk } from '../v1-basic/index';
import * as zlib from 'zlib';
import { promisify } from 'util';

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

interface FileSystemResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

// New interfaces for partial corruption recovery
export interface ReadOptions {
  allowPartialRecovery?: boolean;
  fillCorruptedChunks?: 'zeros' | 'pattern' | 'skip';
  minimumRecoveryRate?: number;
}

export interface CorruptionReport {
  totalChunks: number;
  corruptedChunks: number;
  recoveredChunks: number;
  recoveryRate: number;
  corruptedChunkRefs: string[];
  partialDataAvailable: boolean;
}

export interface PartialFileResult extends FileSystemResult<Buffer> {
  corruptionReport?: CorruptionReport;
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
      const raw = await this.disk.read(this.metadataOffset, this.metadataSize);
      const sections: MetadataSection[] = [];

      // Parse all metadata sections
      for (let i = 0; i < this.metadataSections; i++) {
        const sectionStart = i * this.sectionSize;
        const sectionData = raw.subarray(sectionStart, sectionStart + this.sectionSize);
        const section = this.parseMetadataSection(sectionData);
        if (section && this.validateMetadataSection(section)) {
          sections.push(section);
        }
      }

      if (sections.length === 0) {
        Logger.error('[YOIFS] No valid metadata sections found!');
        this.metadataCorrupted = true;
        this.metadata.primary = this.createEmptyMetadataSection();
        this.metadata.backups = [];
      } else {
        // Use the most recent valid section as primary
        sections.sort((a, b) => (b.modifiedAt || 0) - (a.modifiedAt || 0));
        this.metadata.primary = sections[0];
        this.metadata.backups = sections.slice(1);
        this.metadataCorrupted = false;
        Logger.info(`[YOIFS] Metadata loaded (${this.metadata.primary.files.length} files, ${this.metadata.primary.chunks.size} chunks).`);
      }
    } catch (error) {
      Logger.error('[YOIFS] Could not load metadata! Disk might be empty or corrupted.');
      this.metadata.primary = this.createEmptyMetadataSection();
      this.metadata.backups = [];
      this.metadataCorrupted = true;
    }

    this.metadataLoaded = true;
  }

  private parseMetadataSection(data: Buffer): MetadataSection | null {
    try {
      const json = data.toString().replace(/\0+$/, '');
      if (!json.trim()) return null;

      const parsed = JSON.parse(json);
      return {
        version: parsed.version || 1,
        files: parsed.files || [],
        chunks: new Map(Object.entries(parsed.chunks || {})),
        freeSpace: parsed.freeSpace || [],
        checksum: parsed.checksum || '',
        modifiedAt: parsed.modifiedAt
      };
    } catch (error) {
      Logger.warning(`[YOIFS] Failed to parse metadata section: ${error}`);
      return null;
    }
  }

  private validateMetadataSection(section: MetadataSection): boolean {
    if (!section.files || !section.chunks || !section.freeSpace) {
      return false;
    }

    // Validate checksum if present
    if (section.checksum) {
      const calculatedChecksum = this.calculateChecksum(Buffer.from(JSON.stringify({
        files: section.files,
        chunks: Object.fromEntries(section.chunks),
        freeSpace: section.freeSpace
      })));
      return calculatedChecksum === section.checksum;
    }

    return true;
  }

  private findBestBackup(): MetadataSection | null {
    if (this.metadata.backups.length === 0) return null;
    
    // Find the most recent valid backup
    return this.metadata.backups
      .filter(section => this.validateMetadataSection(section))
      .sort((a, b) => (b.modifiedAt || 0) - (a.modifiedAt || 0))[0] || null;
  }

  private async saveMetadata(): Promise<void> {
    if (this.metadataCorrupted) {
      Logger.error('[YOIFS] Cannot save metadata: metadata is corrupted!');
      throw new Error('Metadata corrupted');
    }

    // Update modification time
    this.metadata.primary.modifiedAt = Date.now();

    // Calculate checksum
    const metadataString = JSON.stringify({
      files: this.metadata.primary.files,
      chunks: Object.fromEntries(this.metadata.primary.chunks),
      freeSpace: this.metadata.primary.freeSpace
    });
    this.metadata.primary.checksum = this.calculateChecksum(Buffer.from(metadataString));

    // Create backup sections
    const backupSections = [this.metadata.primary];
    for (let i = 1; i < this.metadataSections; i++) {
      backupSections.push({ ...this.metadata.primary });
    }

    // Write all sections
    const buf = Buffer.alloc(this.metadataSize, 0);
    for (let i = 0; i < backupSections.length; i++) {
      const sectionData = Buffer.from(JSON.stringify(backupSections[i]));
      const sectionStart = i * this.sectionSize;
      sectionData.copy(buf, sectionStart, 0, Math.min(sectionData.length, this.sectionSize));
    }

    await this.disk.write(this.metadataOffset, buf);
    Logger.info(`[YOIFS] Metadata saved (${this.metadata.primary.files.length} files, ${this.metadata.primary.chunks.size} chunks).`);
  }

  private getNextOffset(): number {
    let maxEnd = this.metadataOffset + this.metadataSize;
    for (const chunk of this.metadata.primary.chunks.values()) {
      maxEnd = Math.max(maxEnd, chunk.offset + chunk.compressedData.length, chunk.replicaOffset + chunk.compressedData.length);
    }
    return Math.ceil(maxEnd / this.blockSize) * this.blockSize;
  }

  private findFreeSpace(size: number): number | null {
    // Simple first-fit algorithm
    for (let i = 0; i < this.metadata.primary.freeSpace.length; i++) {
      if (this.metadata.primary.freeSpace[i].size >= size) {
        const offset = this.metadata.primary.freeSpace[i].offset;
        this.metadata.primary.freeSpace[i].offset += size;
        this.metadata.primary.freeSpace[i].size -= size;
        
        if (this.metadata.primary.freeSpace[i].size === 0) {
          this.metadata.primary.freeSpace.splice(i, 1);
        }
        
        return offset;
      }
    }
    return null;
  }

  private markFreeSpace(offset: number, size: number): void {
    // Merge adjacent free spaces
    const newFreeSpace = { offset, size };
    
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

    // Remove existing file if it exists
    const existingFileIndex = this.metadata.primary.files.findIndex(f => f.name === fileName);
    if (existingFileIndex !== -1) {
      await this.deleteFileInternal(fileName);
    }

    // Split into chunks
    const chunks = this.splitIntoChunks(content);
    const chunkRefs: string[] = [];
    const fileId = crypto.randomUUID();

    // Process each chunk
    for (const chunk of chunks) {
      const hash = this.calculateChecksum(chunk);
      
      // Check if chunk already exists
      if (this.metadata.primary.chunks.has(hash)) {
        const existingChunk = this.metadata.primary.chunks.get(hash)!;
        existingChunk.references++;
        chunkRefs.push(hash);
        continue;
      }

      // Compress chunk
      const compressedData = await this.compress(chunk);
      
      // Find space for chunk and replica
      const offset = this.findFreeSpace(compressedData.length) || this.getNextOffset();
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
        checksum: this.calculateChecksum(compressedData)
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
      createdAt: Date.now(),
      modifiedAt: Date.now()
    };

    this.metadata.primary.files.push(fileMeta);
    await this.saveMetadata();

    Logger.info(`[YOIFS] File '${fileName}' written successfully (${chunks.length} chunks)`);
    return { success: true };
  }

  // Enhanced readFile with partial corruption recovery
  async readFile(fileName: string, options: ReadOptions = {}): Promise<PartialFileResult> {
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

    if (options.allowPartialRecovery) {
      return this.readFileWithGracefulDegradation(fileName, fileMeta, options);
    } else {
      return this.readFileStrict(fileName, fileMeta);
    }
  }

  // Original strict readFile behavior
  private async readFileStrict(fileName: string, fileMeta: FileMeta): Promise<PartialFileResult> {
    const recoveredChunks: Buffer[] = [];
    
    for (const chunkRef of fileMeta.chunkRefs) {
      const chunkMeta = this.metadata.primary.chunks.get(chunkRef);
      if (!chunkMeta) {
        Logger.error(`[YOIFS] Chunk ${chunkRef} not found for file '${fileName}'`);
        return { success: false, error: `Chunk ${chunkRef} not found` };
      }

      const chunkResult = await this.readChunk(chunkMeta);
      if (!chunkResult.success) {
        Logger.error(`[YOIFS] Failed to read chunk ${chunkRef}: ${chunkResult.error}`);
        return { success: false, error: `Failed to read chunk ${chunkRef}: ${chunkResult.error}` };
      }
      
      recoveredChunks.push(chunkResult.data!);
    }

    const fullContent = Buffer.concat(recoveredChunks);
    
    // Verify file checksum
    if (this.calculateChecksum(fullContent) !== fileMeta.checksum) {
      Logger.error(`[YOIFS] File checksum verification failed for '${fileName}'`);
      return { success: false, error: 'File checksum verification failed' };
    }

    Logger.info(`[YOIFS] File '${fileName}' read successfully`);
    return { success: true, data: fullContent };
  }

  // New partial recovery implementation
  private async readFileWithGracefulDegradation(
    fileName: string, 
    fileMeta: FileMeta, 
    options: ReadOptions
  ): Promise<PartialFileResult> {
    const recoveredChunks: Buffer[] = [];
    const corruptedChunkRefs: string[] = [];
    let totalRecoveredSize = 0;
    const fillPattern = options.fillCorruptedChunks === 'pattern' ? 0xDEADBEEF : 0x00;

    Logger.info(`[YOIFS] Attempting partial recovery for file '${fileName}'`);

    for (const chunkRef of fileMeta.chunkRefs) {
      const chunkMeta = this.metadata.primary.chunks.get(chunkRef);
      if (!chunkMeta) {
        Logger.warning(`[YOIFS] Chunk ${chunkRef} not found, filling with ${options.fillCorruptedChunks || 'zeros'}`);
        corruptedChunkRefs.push(chunkRef);
        
        // Fill missing chunk with zeros or pattern
        const fillSize = this.chunkSize; // Default chunk size
        const fillBuffer = Buffer.alloc(fillSize, fillPattern);
        recoveredChunks.push(fillBuffer);
        continue;
      }

      const chunkResult = await this.readChunk(chunkMeta);
      if (chunkResult.success) {
        recoveredChunks.push(chunkResult.data!);
        totalRecoveredSize += chunkResult.data!.length;
        Logger.info(`[YOIFS] Successfully recovered chunk ${chunkRef}`);
      } else {
        Logger.warning(`[YOIFS] Failed to recover chunk ${chunkRef}: ${chunkResult.error}`);
        corruptedChunkRefs.push(chunkRef);
        
        // Fill corrupted chunk
        const fillSize = chunkMeta.originalSize;
        const fillBuffer = Buffer.alloc(fillSize, fillPattern);
        recoveredChunks.push(fillBuffer);
      }
    }

    const partialData = Buffer.concat(recoveredChunks);
    const recoveryRate = (totalRecoveredSize / fileMeta.size) * 100;
    const minimumRate = options.minimumRecoveryRate || 0;

    // Create corruption report
    const corruptionReport: CorruptionReport = {
      totalChunks: fileMeta.chunkRefs.length,
      corruptedChunks: corruptedChunkRefs.length,
      recoveredChunks: fileMeta.chunkRefs.length - corruptedChunkRefs.length,
      recoveryRate: recoveryRate,
      corruptedChunkRefs: corruptedChunkRefs,
      partialDataAvailable: recoveryRate > 0
    };

    // Check if recovery meets minimum threshold
    if (recoveryRate < minimumRate) {
      Logger.warning(`[YOIFS] Recovery rate ${recoveryRate.toFixed(1)}% below minimum ${minimumRate}%`);
      return {
        success: false,
        error: `Recovery rate ${recoveryRate.toFixed(1)}% below minimum ${minimumRate}%`,
        corruptionReport
      };
    }

    if (corruptedChunkRefs.length > 0) {
      Logger.warning(`[YOIFS] Partial recovery completed for '${fileName}': ${recoveryRate.toFixed(1)}% recovered`);
      return {
        success: true,
        data: partialData,
        error: `Partial corruption detected: ${corruptedChunkRefs.length} chunks corrupted`,
        corruptionReport
      };
    } else {
      Logger.info(`[YOIFS] Full recovery completed for '${fileName}'`);
      return {
        success: true,
        data: partialData,
        corruptionReport
      };
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
      Logger.error('[YOIFS] Cannot get file info: metadata is corrupted!');
      return { success: false, error: 'Metadata corrupted' };
    }

    const fileMeta = this.metadata.primary.files.find(f => f.name === fileName);
    if (!fileMeta) {
      return { success: false, error: 'File not found' };
    }

    return { success: true, data: fileMeta };
  }

  async appendFile(fileName: string, additionalContent: Buffer): Promise<FileSystemResult<void>> {
    // Read existing file
    const existingResult = await this.readFile(fileName);
    if (!existingResult.success) {
      return { success: false, error: 'Cannot read existing file for append' };
    }

    // Combine content
    const combinedContent = Buffer.concat([existingResult.data!, additionalContent]);
    
    // Write combined file
    return this.writeFile(fileName, combinedContent);
  }

  async getDiskUsage(): Promise<FileSystemResult<{ used: number; free: number; total: number }>> {
    await this.loadMetadata();
    
    if (this.metadataCorrupted) {
      Logger.error('[YOIFS] Cannot get disk usage: metadata is corrupted!');
      return { success: false, error: 'Metadata corrupted' };
    }

    let usedSpace = 0;
    for (const chunk of this.metadata.primary.chunks.values()) {
      usedSpace += chunk.compressedData.length * 2; // Primary + replica
    }

    const totalSpace = this.disk.size ? this.disk.size() : 0;
    const freeSpace = totalSpace - usedSpace;

    return {
      success: true,
      data: {
        used: usedSpace,
        free: freeSpace,
        total: totalSpace
      }
    };
  }

  async getCompressionStats(): Promise<FileSystemResult<{ originalSize: number; compressedSize: number; ratio: number }>> {
    await this.loadMetadata();
    
    if (this.metadataCorrupted) {
      Logger.error('[YOIFS] Cannot get compression stats: metadata is corrupted!');
      return { success: false, error: 'Metadata corrupted' };
    }

    let totalOriginal = 0;
    let totalCompressed = 0;

    for (const chunk of this.metadata.primary.chunks.values()) {
      totalOriginal += chunk.originalSize * chunk.references;
      totalCompressed += chunk.compressedData.length * chunk.references;
    }

    const ratio = totalOriginal > 0 ? (totalCompressed / totalOriginal) * 100 : 0;

    return {
      success: true,
      data: {
        originalSize: totalOriginal,
        compressedSize: totalCompressed,
        ratio: ratio
      }
    };
  }
}
