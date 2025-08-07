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

// Import enhanced types from V2
import { ReadOptions, PartialFileResult, CorruptionReport } from '../../v2-enhanced/version2-enhanced-solution';

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

export class FileSystemCore {
  private disk: Disk;
  private cacheService: CacheService;
  private blockSize = 512;
  private chunkSize = 4096;
  private compressionThreshold = 100;
  
  // Enhanced corruption resilience settings
  private redundancyLevel = 3; // Number of replicas per chunk
  private errorCorrectionEnabled = true;
  private corruptionScanInterval = 60 * 1000; // 1 minute
  private healthCheckInterval?: NodeJS.Timeout;
  
  // File System State
  private files = new Map<string, FileMeta>();
  private chunks = new Map<string, FileChunk>();
  private freeSpace: Array<{ offset: number; size: number }> = [];
  
  // Corruption tracking
  private corruptionReport = {
    detectedCorruptions: 0,
    repairedCorruptions: 0,
    unrecoverableCorruptions: 0,
    lastHealthCheck: new Date(),
    corruptedChunks: new Set<string>()
  };
  
  // Performance metrics
  private metrics = {
    readOperations: 0,
    writeOperations: 0,
    corruptionDetections: 0,
    autoRepairs: 0,
    lastResetTime: new Date()
  };

  constructor(disk: Disk, cacheService: CacheService) {
    this.disk = disk;
    this.cacheService = cacheService;
    this.initializeHealthMonitoring();
  }

  // ============================================================================
  // ADVANCED CORRUPTION RESILIENCE
  // ============================================================================

  private initializeHealthMonitoring(): void {
    // Start periodic health checks
    this.healthCheckInterval = setInterval(async () => {
      await this.performHealthCheck();
    }, this.corruptionScanInterval);
    
    Logger.info('[CORE] Health monitoring initialized with periodic corruption scans');
  }

  private async performHealthCheck(): Promise<void> {
    Logger.info('[CORE] Starting periodic health check...');
    
    let scannedChunks = 0;
    let detectedCorruptions = 0;
    let repairedCorruptions = 0;
    
    for (const [chunkId, chunkMeta] of this.chunks.entries()) {
      scannedChunks++;
      
      const healthResult = await this.checkChunkHealth(chunkId, chunkMeta);
      if (!healthResult.healthy) {
        detectedCorruptions++;
        this.corruptionReport.detectedCorruptions++;
        this.metrics.corruptionDetections++;
        
        if (healthResult.repaired) {
          repairedCorruptions++;
          this.corruptionReport.repairedCorruptions++;
          this.metrics.autoRepairs++;
          Logger.info(`[CORE] Auto-repaired chunk ${chunkId}`);
        } else {
          this.corruptionReport.unrecoverableCorruptions++;
          this.corruptionReport.corruptedChunks.add(chunkId);
          Logger.error(`[CORE] Unrecoverable corruption in chunk ${chunkId}`);
        }
      }
    }
    
    this.corruptionReport.lastHealthCheck = new Date();
    
    Logger.info(`[CORE] Health check complete: scanned ${scannedChunks} chunks, ` +
      `detected ${detectedCorruptions} corruptions, repaired ${repairedCorruptions}`);
  }

  private async checkChunkHealth(chunkId: string, chunkMeta: FileChunk): Promise<{
    healthy: boolean;
    repaired: boolean;
    details: string;
  }> {
    let primaryOk = false;
    let replicaOk = false;
    let primary: Buffer | undefined;
    let replica: Buffer | undefined;

    // Check primary copy
    try {
      primary = await this.disk.read(chunkMeta.offset, chunkMeta.compressedData.length);
      if (primary && this.calculateChecksum(primary) === chunkMeta.checksum) {
        primaryOk = true;
      }
    } catch (error) {
      // Primary read failed
    }

    // Check replica copy
    try {
      replica = await this.disk.read(chunkMeta.replicaOffset, chunkMeta.compressedData.length);
      if (replica && this.calculateChecksum(replica) === chunkMeta.checksum) {
        replicaOk = true;
      }
    } catch (error) {
      // Replica read failed
    }

    // Determine health and attempt repair
    if (primaryOk && replicaOk) {
      return { healthy: true, repaired: false, details: 'All copies healthy' };
    } else if (primaryOk && !replicaOk) {
      // Repair replica from primary
      try {
        if (primary) {
          await this.disk.write(chunkMeta.replicaOffset, primary);
          return { healthy: false, repaired: true, details: 'Repaired replica from primary' };
        }
      } catch (error) {
        return { healthy: false, repaired: false, details: 'Failed to repair replica' };
      }
    } else if (!primaryOk && replicaOk) {
      // Repair primary from replica
      try {
        if (replica) {
          await this.disk.write(chunkMeta.offset, replica);
          return { healthy: false, repaired: true, details: 'Repaired primary from replica' };
        }
      } catch (error) {
        return { healthy: false, repaired: false, details: 'Failed to repair primary' };
      }
    }
    
    return { healthy: false, repaired: false, details: 'Both copies corrupted - unrecoverable' };
  }

  // Enhanced write with multiple replicas for critical files
  async writeFileWithRedundancy(
    fileName: string, 
    content: Buffer, 
    owner: string, 
    redundancyLevel: number = this.redundancyLevel
  ): Promise<FileSystemResult<string>> {
    this.metrics.writeOperations++;
    
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

      // Process each chunk with enhanced redundancy
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
        
        // Create multiple replicas
        const replicas: number[] = [];
        for (let i = 0; i < redundancyLevel; i++) {
          const offset = this.findFreeSpace(compressedData.length);
          await this.disk.write(offset, compressedData);
          replicas.push(offset);
        }

        // Store chunk metadata with all replica locations
        const chunkMeta: FileChunk = {
          hash,
          compressedData,
          originalSize: chunk.length,
          references: 1,
          offset: replicas[0],
          replicaOffset: replicas[1] || replicas[0],
          checksum: this.calculateChecksum(compressedData),
          backupLocations: replicas.slice(2).map(r => r.toString()) // Additional replicas beyond primary/replica
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
      
      Logger.info(`[CORE] File '${fileName}' written with ${redundancyLevel}x redundancy (${chunks.length} chunks)`);
      return { success: true, data: fileId };

    } catch (error: any) {
      Logger.error(`[CORE] Failed to write file '${fileName}' with redundancy: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  // Enhanced read with corruption recovery from multiple replicas
  private async readChunkWithMultipleReplicas(chunkMeta: FileChunk): Promise<FileSystemResult<Buffer>> {
    this.metrics.readOperations++;
    
    const allLocations = [chunkMeta.offset, chunkMeta.replicaOffset, ...chunkMeta.backupLocations.map(l => parseInt(l))];
    const results: { data?: Buffer; healthy: boolean; location: number }[] = [];

    // Try to read from all available locations
    for (const location of allLocations) {
      try {
        const data = await this.disk.read(location, chunkMeta.compressedData.length);
        const healthy = data && this.calculateChecksum(data) === chunkMeta.checksum;
        results.push({ data, healthy, location });
      } catch (error) {
        results.push({ healthy: false, location });
      }
    }

    // Find a healthy copy
    const healthyResult = results.find(r => r.healthy && r.data);
    if (healthyResult) {
      // Repair any corrupted copies
      const corruptedResults = results.filter(r => !r.healthy);
      if (corruptedResults.length > 0 && this.errorCorrectionEnabled) {
        this.repairCorruptedReplicas(chunkMeta, healthyResult.data!, corruptedResults);
      }
      
      const decompressed = await this.decompress(healthyResult.data!, chunkMeta.originalSize);
      return { success: true, data: decompressed };
    }

    // All copies are corrupted
    this.corruptionReport.unrecoverableCorruptions++;
    return { success: false, error: 'All replicas corrupted - data unrecoverable' };
  }

  private async repairCorruptedReplicas(
    chunkMeta: FileChunk, 
    healthyData: Buffer, 
    corruptedResults: { location: number; healthy: boolean }[]
  ): Promise<void> {
    for (const corrupted of corruptedResults) {
      try {
        await this.disk.write(corrupted.location, healthyData);
        this.metrics.autoRepairs++;
        Logger.info(`[CORE] Auto-repaired corrupted replica at offset ${corrupted.location}`);
      } catch (error) {
        Logger.error(`[CORE] Failed to repair corrupted replica at offset ${corrupted.location}: ${error}`);
      }
    }
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

  // Enhanced readFile with partial corruption recovery support
  async readFile(fileId: string, options?: ReadOptions): Promise<PartialFileResult> {
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

      if (options?.allowPartialRecovery) {
        return this.readFileWithGracefulDegradation(fileId, fileMeta, options);
      } else {
        return this.readFileStrict(fileId, fileMeta);
      }

    } catch (error: any) {
      Logger.error(`[CORE] Failed to read file ${fileId}: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  // Original strict readFile behavior
  private async readFileStrict(fileId: string, fileMeta: FileMeta): Promise<PartialFileResult> {
    const recoveredChunks: Buffer[] = [];
    
    for (const chunkRef of fileMeta.chunkRefs) {
      const chunkMeta = this.chunks.get(chunkRef);
      if (!chunkMeta) {
        Logger.error(`[CORE] Chunk ${chunkRef} not found for file ${fileId}`);
        return { success: false, error: `Chunk ${chunkRef} not found` };
      }

      const chunkResult = await this.readChunk(chunkMeta);
      if (!chunkResult.success) {
        Logger.error(`[CORE] Failed to read chunk ${chunkRef}: ${chunkResult.error}`);
        return { success: false, error: `Failed to read chunk ${chunkRef}: ${chunkResult.error}` };
      }
      
      recoveredChunks.push(chunkResult.data!);
    }

    const fullContent = Buffer.concat(recoveredChunks);
    
    // Verify file checksum
    if (this.calculateChecksum(fullContent) !== fileMeta.checksum) {
      Logger.error(`[CORE] File checksum verification failed for ${fileId}`);
      return { success: false, error: 'File checksum verification failed' };
    }

    // Cache the file
    await this.cacheService.set(`file_${fileId}`, fullContent);
    
    // Update file access stats
    fileMeta.accessCount++;
    fileMeta.lastAccessed = new Date();
    
    Logger.info(`[CORE] File ${fileId} read successfully`);
    return { success: true, data: fullContent };
  }

  // New partial recovery implementation
  private async readFileWithGracefulDegradation(
    fileId: string, 
    fileMeta: FileMeta, 
    options: ReadOptions
  ): Promise<PartialFileResult> {
    const recoveredChunks: Buffer[] = [];
    const corruptedChunkRefs: string[] = [];
    let totalRecoveredSize = 0;
    const fillPattern = options.fillCorruptedChunks === 'pattern' ? 0xDEADBEEF : 0x00;

    Logger.info(`[CORE] Attempting partial recovery for file ${fileId}`);

    for (const chunkRef of fileMeta.chunkRefs) {
      const chunkMeta = this.chunks.get(chunkRef);
      if (!chunkMeta) {
        Logger.warning(`[CORE] Chunk ${chunkRef} not found, filling with ${options.fillCorruptedChunks || 'zeros'}`);
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
        Logger.info(`[CORE] Successfully recovered chunk ${chunkRef}`);
      } else {
        Logger.warning(`[CORE] Failed to recover chunk ${chunkRef}: ${chunkResult.error}`);
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
      Logger.warning(`[CORE] Recovery rate ${recoveryRate.toFixed(1)}% below minimum ${minimumRate}%`);
      return {
        success: false,
        error: `Recovery rate ${recoveryRate.toFixed(1)}% below minimum ${minimumRate}%`,
        corruptionReport
      };
    }

    if (corruptedChunkRefs.length > 0) {
      Logger.warning(`[CORE] Partial recovery completed for ${fileId}: ${recoveryRate.toFixed(1)}% recovered`);
      return {
        success: true,
        data: partialData,
        error: `Partial corruption detected: ${corruptedChunkRefs.length} chunks corrupted`,
        corruptionReport
      };
    } else {
      Logger.info(`[CORE] Full recovery completed for ${fileId}`);
      return {
        success: true,
        data: partialData,
        corruptionReport
      };
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

  // ============================================================================
  // ENTERPRISE ANALYTICS & MANAGEMENT
  // ============================================================================

  getCorruptionReport(): {
    detectedCorruptions: number;
    repairedCorruptions: number;
    unrecoverableCorruptions: number;
    lastHealthCheck: Date;
    corruptedChunks: string[];
    healthScore: number;
  } {
    const totalChunks = this.chunks.size;
    const healthScore = totalChunks > 0 ? 
      Math.max(0, 100 - (this.corruptionReport.unrecoverableCorruptions / totalChunks) * 100) : 100;
    
    return {
      ...this.corruptionReport,
      corruptedChunks: Array.from(this.corruptionReport.corruptedChunks),
      healthScore: Math.round(healthScore * 100) / 100
    };
  }

  getPerformanceMetrics(): {
    readOperations: number;
    writeOperations: number;
    corruptionDetections: number;
    autoRepairs: number;
    cacheHitRate: number;
    uptimeMinutes: number;
  } {
    const uptimeMs = Date.now() - this.metrics.lastResetTime.getTime();
    const cacheStats = this.cacheService.getStats();
    
    return {
      ...this.metrics,
      cacheHitRate: cacheStats.hitRate || 0,
      uptimeMinutes: Math.round(uptimeMs / (1000 * 60))
    };
  }

  // Data tiering based on access patterns
  async performDataTiering(): Promise<void> {
    Logger.info('[CORE] Starting data tiering analysis...');
    
    const now = new Date();
    const hotThreshold = 7 * 24 * 60 * 60 * 1000; // 7 days
    const warmThreshold = 30 * 24 * 60 * 60 * 1000; // 30 days
    
    let tierChanges = 0;
    
    for (const [fileId, fileMeta] of this.files.entries()) {
      const timeSinceLastAccess = now.getTime() - fileMeta.lastAccessed.getTime();
      let newTier: 'HOT' | 'WARM' | 'COLD' = 'COLD';
      
      if (timeSinceLastAccess < hotThreshold && fileMeta.accessCount > 10) {
        newTier = 'HOT';
      } else if (timeSinceLastAccess < warmThreshold || fileMeta.accessCount > 3) {
        newTier = 'WARM';
      }
      
      if (fileMeta.tier !== newTier) {
        fileMeta.tier = newTier;
        tierChanges++;
        Logger.info(`[CORE] File ${fileId} moved to ${newTier} tier`);
      }
    }
    
    Logger.info(`[CORE] Data tiering complete: ${tierChanges} files changed tiers`);
  }

  // Get files by tier for analytics
  getFilesByTier(): { HOT: number; WARM: number; COLD: number } {
    const tiers = { HOT: 0, WARM: 0, COLD: 0 };
    
    for (const fileMeta of this.files.values()) {
      tiers[fileMeta.tier]++;
    }
    
    return tiers;
  }

  // Advanced file search and filtering
  searchFiles(criteria: {
    namePattern?: string;
    owner?: string;
    minSize?: number;
    maxSize?: number;
    tier?: 'HOT' | 'WARM' | 'COLD';
    createdAfter?: Date;
    createdBefore?: Date;
    minAccessCount?: number;
  }): FileMeta[] {
    const results: FileMeta[] = [];
    
    for (const fileMeta of this.files.values()) {
      let matches = true;
      
      if (criteria.namePattern && !fileMeta.name.includes(criteria.namePattern)) {
        matches = false;
      }
      
      if (criteria.owner && fileMeta.owner !== criteria.owner) {
        matches = false;
      }
      
      if (criteria.minSize && fileMeta.size < criteria.minSize) {
        matches = false;
      }
      
      if (criteria.maxSize && fileMeta.size > criteria.maxSize) {
        matches = false;
      }
      
      if (criteria.tier && fileMeta.tier !== criteria.tier) {
        matches = false;
      }
      
      if (criteria.createdAfter && fileMeta.createdAt < criteria.createdAfter) {
        matches = false;
      }
      
      if (criteria.createdBefore && fileMeta.createdAt > criteria.createdBefore) {
        matches = false;
      }
      
      if (criteria.minAccessCount && fileMeta.accessCount < criteria.minAccessCount) {
        matches = false;
      }
      
      if (matches) {
        results.push(fileMeta);
      }
    }
    
    return results;
  }

  // Defragmentation to optimize storage layout
  async performDefragmentation(): Promise<{
    chunksDefragmented: number;
    spaceReclaimed: number;
    timeElapsed: number;
  }> {
    const startTime = Date.now();
    Logger.info('[CORE] Starting defragmentation...');
    
    // Sort free space by offset to identify fragmentation
    this.freeSpace.sort((a, b) => a.offset - b.offset);
    
    let chunksDefragmented = 0;
    let spaceReclaimed = 0;
    
    // Merge adjacent free spaces
    for (let i = 0; i < this.freeSpace.length - 1; i++) {
      const current = this.freeSpace[i];
      const next = this.freeSpace[i + 1];
      
      if (current.offset + current.size === next.offset) {
        current.size += next.size;
        this.freeSpace.splice(i + 1, 1);
        spaceReclaimed += next.size;
        i--; // Re-check this position
      }
    }
    
    const timeElapsed = Date.now() - startTime;
    
    Logger.info(`[CORE] Defragmentation complete: ${chunksDefragmented} chunks moved, ` +
      `${spaceReclaimed} bytes reclaimed in ${timeElapsed}ms`);
    
    return { chunksDefragmented, spaceReclaimed, timeElapsed };
  }

  // Data integrity verification
  async verifyDataIntegrity(): Promise<{
    totalFiles: number;
    corruptedFiles: number;
    totalChunks: number;
    corruptedChunks: number;
    verificationTime: number;
  }> {
    const startTime = Date.now();
    Logger.info('[CORE] Starting full data integrity verification...');
    
    let corruptedFiles = 0;
    let corruptedChunks = 0;
    
    // Verify all files
    for (const [fileId, fileMeta] of this.files.entries()) {
      let fileCorrupted = false;
      
      for (const chunkRef of fileMeta.chunkRefs) {
        const chunkMeta = this.chunks.get(chunkRef);
        if (!chunkMeta) {
          corruptedChunks++;
          fileCorrupted = true;
          continue;
        }
        
        const healthResult = await this.checkChunkHealth(chunkRef, chunkMeta);
        if (!healthResult.healthy) {
          corruptedChunks++;
          fileCorrupted = true;
        }
      }
      
      if (fileCorrupted) {
        corruptedFiles++;
        Logger.warning(`[CORE] File ${fileId} (${fileMeta.name}) has corrupted chunks`);
      }
    }
    
    const verificationTime = Date.now() - startTime;
    
    const report = {
      totalFiles: this.files.size,
      corruptedFiles,
      totalChunks: this.chunks.size,
      corruptedChunks,
      verificationTime
    };
    
    Logger.info(`[CORE] Integrity verification complete: ${corruptedFiles}/${this.files.size} files corrupted, ` +
      `${corruptedChunks}/${this.chunks.size} chunks corrupted in ${verificationTime}ms`);
    
    return report;
  }

  // Storage optimization recommendations
  getOptimizationRecommendations(): {
    compressionSavings: number;
    deduplicationSavings: number;
    tieringRecommendations: string[];
    defragmentationNeeded: boolean;
  } {
    const recommendations: string[] = [];
    let compressionSavings = 0;
    let deduplicationSavings = 0;
    
    // Analyze compression effectiveness
    for (const chunk of this.chunks.values()) {
      const originalSize = chunk.originalSize * chunk.references;
      const compressedSize = chunk.compressedData.length * chunk.references;
      compressionSavings += originalSize - compressedSize;
    }
    
    // Check for files that could benefit from different tiers
    const tierStats = this.getFilesByTier();
    if (tierStats.HOT > tierStats.WARM + tierStats.COLD) {
      recommendations.push('Consider implementing automated data tiering for better performance');
    }
    
    // Check fragmentation
    const fragmentedSpaces = this.freeSpace.filter(fs => fs.size < this.chunkSize).length;
    const defragmentationNeeded = fragmentedSpaces > this.freeSpace.length * 0.3;
    
    if (defragmentationNeeded) {
      recommendations.push('Defragmentation recommended due to high space fragmentation');
    }
    
    if (this.corruptionReport.detectedCorruptions > 0) {
      recommendations.push(`${this.corruptionReport.detectedCorruptions} corruptions detected - consider increasing redundancy`);
    }
    
    return {
      compressionSavings,
      deduplicationSavings,
      tieringRecommendations: recommendations,
      defragmentationNeeded
    };
  }

  // Resource cleanup and shutdown
  shutdown(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
    
    // Final health check and metrics report
    const metrics = this.getPerformanceMetrics();
    const corruption = this.getCorruptionReport();
    
    Logger.info('[CORE] FileSystem shutdown - Final Statistics:');
    Logger.info(`  - Files: ${this.files.size}, Chunks: ${this.chunks.size}`);
    Logger.info(`  - Operations: ${metrics.readOperations} reads, ${metrics.writeOperations} writes`);
    Logger.info(`  - Corruption: ${corruption.detectedCorruptions} detected, ${corruption.repairedCorruptions} repaired`);
    Logger.info(`  - Health Score: ${corruption.healthScore}%`);
    
    // Clear data structures
    this.files.clear();
    this.chunks.clear();
    this.freeSpace.length = 0;
    this.corruptionReport.corruptedChunks.clear();
  }
}
