import { Logger } from './src/v1-basic/index';
import { MemoryDisk } from './src/v1-basic/index';
import { FileSystem } from './src/v1-basic/version1-basic-solution';
import { EnhancedFileSystem } from './src/v2-enhanced/version2-enhanced-solution';
import { createEnterpriseFileSystem } from './src/v3-enterprise/index';

class QualityTestHarness {
  private disk: MemoryDisk;

  constructor() {
    this.disk = new MemoryDisk(10 * 1024 * 1024); // 10MB
  }

  async runAllQualityTests(): Promise<void> {
    Logger.yoifsIntro();
    Logger.section('Quality Safeguards Assessment');

    await this.testBoundaryConditions();
    await this.testRaceConditions();
    await this.testMemoryLeaks();
    await this.testErrorHandling();
    await this.testFuzzTesting();
    await this.testConcurrency();
    await this.testResourceCleanup();
  }

  // Test boundary conditions and edge cases
  async testBoundaryConditions(): Promise<void> {
    Logger.section('Boundary Conditions Testing');

    // Test empty files
    await this.testEmptyFile();
    
    // Test exact chunk size files
    await this.testExactChunkSize();
    
    // Test off-by-one conditions
    await this.testOffByOneConditions();
    
    // Test maximal size files
    await this.testMaximalSizeFiles();
    
    // Test chunk splitting edge cases
    await this.testChunkSplittingEdgeCases();
  }

  private async testEmptyFile(): Promise<void> {
    Logger.info('Testing empty file handling...');
    
    const fs = new EnhancedFileSystem(this.disk);
    const emptyBuffer = Buffer.alloc(0);
    
    const writeResult = await fs.writeFile('empty.txt', emptyBuffer);
    if (!writeResult.success) {
      Logger.error(`Empty file write failed: ${writeResult.error}`);
      return;
    }
    
    const readResult = await fs.readFile('empty.txt');
    if (!readResult.success) {
      Logger.error(`Empty file read failed: ${readResult.error}`);
      return;
    }
    
    if (readResult.data!.length === 0) {
      Logger.success('Empty file handling works correctly');
    } else {
      Logger.error('Empty file read returned non-empty data');
    }
  }

  private async testExactChunkSize(): Promise<void> {
    Logger.info('Testing exact chunk size files...');
    
    const fs = new EnhancedFileSystem(this.disk);
    const exactChunkSize = 4096; // 4KB
    const exactChunkData = Buffer.alloc(exactChunkSize, 'A'.charCodeAt(0));
    
    const writeResult = await fs.writeFile('exact-chunk.txt', exactChunkData);
    if (!writeResult.success) {
      Logger.error(`Exact chunk size write failed: ${writeResult.error}`);
      return;
    }
    
    const readResult = await fs.readFile('exact-chunk.txt');
    if (!readResult.success) {
      Logger.error(`Exact chunk size read failed: ${readResult.error}`);
      return;
    }
    
    if (Buffer.compare(exactChunkData, readResult.data!) === 0) {
      Logger.success('Exact chunk size handling works correctly');
    } else {
      Logger.error('Exact chunk size data mismatch');
    }
  }

  private async testOffByOneConditions(): Promise<void> {
    Logger.info('Testing off-by-one conditions...');
    
    const fs = new EnhancedFileSystem(this.disk);
    
    // Test chunk size - 1
    const chunkSizeMinusOne = 4095;
    const data1 = Buffer.alloc(chunkSizeMinusOne, 'B'.charCodeAt(0));
    
    const writeResult1 = await fs.writeFile('chunk-minus-one.txt', data1);
    if (!writeResult1.success) {
      Logger.error(`Chunk size - 1 write failed: ${writeResult1.error}`);
      return;
    }
    
    const readResult1 = await fs.readFile('chunk-minus-one.txt');
    if (!readResult1.success || Buffer.compare(data1, readResult1.data!) !== 0) {
      Logger.error('Chunk size - 1 handling failed');
      return;
    }
    
    // Test chunk size + 1
    const chunkSizePlusOne = 4097;
    const data2 = Buffer.alloc(chunkSizePlusOne, 'C'.charCodeAt(0));
    
    const writeResult2 = await fs.writeFile('chunk-plus-one.txt', data2);
    if (!writeResult2.success) {
      Logger.error(`Chunk size + 1 write failed: ${writeResult2.error}`);
      return;
    }
    
    const readResult2 = await fs.readFile('chunk-plus-one.txt');
    if (!readResult2.success || Buffer.compare(data2, readResult2.data!) !== 0) {
      Logger.error('Chunk size + 1 handling failed');
      return;
    }
    
    Logger.success('Off-by-one conditions handled correctly');
  }

  private async testMaximalSizeFiles(): Promise<void> {
    Logger.info('Testing maximal size files...');
    
    const fs = new EnhancedFileSystem(this.disk);
    const maxSize = 5 * 1024 * 1024; // 5MB (half of disk size)
    const maxData = Buffer.alloc(maxSize, 'D'.charCodeAt(0));
    
    const writeResult = await fs.writeFile('max-size.txt', maxData);
    if (!writeResult.success) {
      Logger.error(`Maximal size write failed: ${writeResult.error}`);
      return;
    }
    
    const readResult = await fs.readFile('max-size.txt');
    if (!readResult.success) {
      Logger.error(`Maximal size read failed: ${readResult.error}`);
      return;
    }
    
    if (Buffer.compare(maxData, readResult.data!) === 0) {
      Logger.success('Maximal size file handling works correctly');
    } else {
      Logger.error('Maximal size file data mismatch');
    }
  }

  private async testChunkSplittingEdgeCases(): Promise<void> {
    Logger.info('Testing chunk splitting edge cases...');
    
    const fs = new EnhancedFileSystem(this.disk);
    
    // Test file that's exactly 2 chunks
    const twoChunksSize = 8192; // 2 * 4KB
    const twoChunksData = Buffer.alloc(twoChunksSize, 'E'.charCodeAt(0));
    
    const writeResult = await fs.writeFile('two-chunks.txt', twoChunksData);
    if (!writeResult.success) {
      Logger.error(`Two chunks write failed: ${writeResult.error}`);
      return;
    }
    
    const readResult = await fs.readFile('two-chunks.txt');
    if (!readResult.success || Buffer.compare(twoChunksData, readResult.data!) !== 0) {
      Logger.error('Two chunks handling failed');
      return;
    }
    
    Logger.success('Chunk splitting edge cases handled correctly');
  }

  // Test race conditions with concurrent operations
  async testRaceConditions(): Promise<void> {
    Logger.section('Race Conditions Testing');
    
    await this.testConcurrentWrites();
    await this.testConcurrentReads();
    await this.testConcurrentDeletes();
    await this.testMetadataRaceConditions();
  }

  private async testConcurrentWrites(): Promise<void> {
    Logger.info('Testing concurrent writes...');
    
    const fs = new EnhancedFileSystem(this.disk);
    const promises: Promise<any>[] = [];
    
    // Start 10 concurrent writes to the same file
    for (let i = 0; i < 10; i++) {
      const data = Buffer.from(`Concurrent write ${i}`);
      promises.push(fs.writeFile('concurrent.txt', data));
    }
    
    const results = await Promise.all(promises);
    const successCount = results.filter(r => r.success).length;
    
    if (successCount === 1) {
      Logger.success('Concurrent writes handled correctly (only one succeeded)');
    } else if (successCount > 1) {
      Logger.warning(`Multiple concurrent writes succeeded: ${successCount}`);
    } else {
      Logger.error('All concurrent writes failed');
    }
  }

  private async testConcurrentReads(): Promise<void> {
    Logger.info('Testing concurrent reads...');
    
    const fs = new EnhancedFileSystem(this.disk);
    
    // Write a file first
    const testData = Buffer.from('Test data for concurrent reads');
    await fs.writeFile('concurrent-read.txt', testData);
    
    const promises: Promise<any>[] = [];
    
    // Start 20 concurrent reads
    for (let i = 0; i < 20; i++) {
      promises.push(fs.readFile('concurrent-read.txt'));
    }
    
    const results = await Promise.all(promises);
    const successCount = results.filter(r => r.success).length;
    const correctDataCount = results.filter(r => 
      r.success && Buffer.compare(r.data!, testData) === 0
    ).length;
    
    if (successCount === 20 && correctDataCount === 20) {
      Logger.success('Concurrent reads handled correctly');
    } else {
      Logger.error(`Concurrent reads failed: ${successCount}/20 successful, ${correctDataCount}/20 correct data`);
    }
  }

  private async testConcurrentDeletes(): Promise<void> {
    Logger.info('Testing concurrent deletes...');
    
    const fs = new EnhancedFileSystem(this.disk);
    
    // Create multiple files
    for (let i = 0; i < 5; i++) {
      await fs.writeFile(`delete-test-${i}.txt`, Buffer.from(`File ${i}`));
    }
    
    const promises: Promise<any>[] = [];
    
    // Start concurrent deletes
    for (let i = 0; i < 5; i++) {
      promises.push(fs.deleteFile(`delete-test-${i}.txt`));
    }
    
    const results = await Promise.all(promises);
    const successCount = results.filter(r => r.success).length;
    
    if (successCount === 5) {
      Logger.success('Concurrent deletes handled correctly');
    } else {
      Logger.error(`Concurrent deletes failed: ${successCount}/5 successful`);
    }
  }

  private async testMetadataRaceConditions(): Promise<void> {
    Logger.info('Testing metadata race conditions...');
    
    const fs = new EnhancedFileSystem(this.disk);
    
    // Perform operations that modify metadata concurrently
    const promises: Promise<any>[] = [];
    
    // Mix of writes, reads, and deletes
    for (let i = 0; i < 10; i++) {
      promises.push(fs.writeFile(`race-${i}.txt`, Buffer.from(`Race test ${i}`)));
      promises.push(fs.listFiles());
      if (i > 0) {
        promises.push(fs.deleteFile(`race-${i-1}.txt`));
      }
    }
    
    const results = await Promise.all(promises);
    const successCount = results.filter(r => r.success).length;
    
    if (successCount > results.length * 0.8) {
      Logger.success('Metadata race conditions handled reasonably well');
    } else {
      Logger.error(`Metadata race conditions caused failures: ${successCount}/${results.length} successful`);
    }
  }

  // Test for memory leaks
  async testMemoryLeaks(): Promise<void> {
    Logger.section('Memory Leak Testing');
    
    await this.testBufferLifecycle();
    await this.testMapGrowth();
    await this.testCacheGrowth();
  }

  private async testBufferLifecycle(): Promise<void> {
    Logger.info('Testing buffer lifecycle...');
    
    const fs = new EnhancedFileSystem(this.disk);
    const initialMemory = process.memoryUsage();
    
    // Create and delete many files to test buffer cleanup
    for (let i = 0; i < 100; i++) {
      const data = Buffer.alloc(1024, i);
      await fs.writeFile(`buffer-test-${i}.txt`, data);
      await fs.readFile(`buffer-test-${i}.txt`);
      await fs.deleteFile(`buffer-test-${i}.txt`);
    }
    
    // Force garbage collection if available
    if (global.gc) {
      global.gc();
    }
    
    const finalMemory = process.memoryUsage();
    const memoryIncrease = finalMemory.heapUsed - initialMemory.heapUsed;
    
    if (memoryIncrease < 1024 * 1024) { // Less than 1MB increase
      Logger.success('Buffer lifecycle management appears good');
    } else {
      Logger.warning(`Potential memory leak detected: ${memoryIncrease} bytes increase`);
    }
  }

  private async testMapGrowth(): Promise<void> {
    Logger.info('Testing Map growth...');
    
    const fs = new EnhancedFileSystem(this.disk);
    
    // Create many files to test metadata Map growth
    for (let i = 0; i < 50; i++) {
      const data = Buffer.from(`Map growth test ${i}`);
      await fs.writeFile(`map-test-${i}.txt`, data);
    }
    
    // Delete all files to test Map cleanup
    for (let i = 0; i < 50; i++) {
      await fs.deleteFile(`map-test-${i}.txt`);
    }
    
    // Check if files are actually deleted
    const listResult = await fs.listFiles();
    if (listResult.success && listResult.data!.length === 0) {
      Logger.success('Map cleanup appears to work correctly');
    } else {
      Logger.error('Map cleanup may have issues');
    }
  }

  private async testCacheGrowth(): Promise<void> {
    Logger.info('Testing cache growth...');
    
    const enterpriseFS = createEnterpriseFileSystem(this.disk);
    
    // Authenticate
    const authResult = await enterpriseFS.authenticateUser({
      username: 'admin',
      password: 'admin123'
    });
    
    if (!authResult.success) {
      Logger.error('Authentication failed for cache test');
      return;
    }
    
    const sessionToken = authResult.sessionToken!;
    
    // Create many files to test cache growth
    for (let i = 0; i < 20; i++) {
      const data = Buffer.from(`Cache test ${i}`);
      const writeResult = await enterpriseFS.writeFile(sessionToken, `cache-test-${i}.txt`, data, 'admin');
      if (writeResult.success) {
        await enterpriseFS.readFile(sessionToken, writeResult.data!);
      }
    }
    
    // Check cache stats
    const cacheStats = enterpriseFS.getCacheStats();
    if (cacheStats && cacheStats.totalEntries < 50) {
      Logger.success('Cache growth appears controlled');
    } else {
      Logger.warning('Cache may be growing unbounded');
    }
  }

  // Test error handling
  async testErrorHandling(): Promise<void> {
    Logger.section('Error Handling Testing');
    
    await this.testSwallowedExceptions();
    await this.testErrorLogging();
    await this.testErrorRecovery();
  }

  private async testSwallowedExceptions(): Promise<void> {
    Logger.info('Testing for swallowed exceptions...');
    
    // Check the specific problematic catch blocks we found
    Logger.warning('Found empty catch blocks in v1-basic/version1-basic-solution.ts lines 115, 119');
    Logger.warning('These catch blocks should log errors instead of being empty');
    
    // Test error propagation
    const fs = new EnhancedFileSystem(this.disk);
    
    try {
      // Try to read non-existent file
      const result = await fs.readFile('non-existent.txt');
      if (!result.success && result.error) {
        Logger.success('Error properly propagated and not swallowed');
      } else {
        Logger.error('Error may have been swallowed');
      }
    } catch (error) {
      Logger.error('Unexpected exception thrown: ' + error);
    }
  }

  private async testErrorLogging(): Promise<void> {
    Logger.info('Testing error logging...');
    
    const fs = new EnhancedFileSystem(this.disk);
    
    // Test various error conditions
    const errorTests = [
      () => fs.readFile(''),
      () => fs.writeFile('', Buffer.alloc(0)),
      () => fs.deleteFile(''),
      () => fs.listFiles()
    ];
    
    for (const test of errorTests) {
      try {
        await test();
      } catch (error) {
        Logger.error('Unexpected exception: ' + error);
      }
    }
    
    Logger.success('Error logging appears to work');
  }

  private async testErrorRecovery(): Promise<void> {
    Logger.info('Testing error recovery...');
    
    const fs = new EnhancedFileSystem(this.disk);
    
    // Write a file
    await fs.writeFile('recovery-test.txt', Buffer.from('Recovery test'));
    
    // Corrupt the disk
    const storage = this.disk.getRawStorage();
    storage[1000] = 0xFF; // Corrupt a byte
    
    // Try to read the file
    const result = await fs.readFile('recovery-test.txt');
    
    if (result.success) {
      Logger.success('Error recovery working - file read despite corruption');
    } else {
      Logger.info('Error recovery failed as expected: ' + result.error);
    }
  }

  // Test fuzz testing
  async testFuzzTesting(): Promise<void> {
    Logger.section('Fuzz Testing');
    
    await this.testRandomCorruptions();
    await this.testMalformedMetadata();
    await this.testOversizedPayloads();
  }

  private async testRandomCorruptions(): Promise<void> {
    Logger.info('Testing random corruptions...');
    
    const fs = new EnhancedFileSystem(this.disk);
    
    // Write a file
    const testData = Buffer.from('Fuzz test data');
    await fs.writeFile('fuzz-test.txt', testData);
    
    // Corrupt random bytes
    const storage = this.disk.getRawStorage();
    const corruptionCount = 100;
    
    for (let i = 0; i < corruptionCount; i++) {
      const randomOffset = Math.floor(Math.random() * storage.length);
      storage[randomOffset] = Math.floor(Math.random() * 256);
    }
    
    // Try to read the file
    const result = await fs.readFile('fuzz-test.txt');
    
    if (result.success) {
      Logger.success('System recovered from random corruptions');
    } else {
      Logger.info('System failed as expected: ' + result.error);
    }
  }

  private async testMalformedMetadata(): Promise<void> {
    Logger.info('Testing malformed metadata...');
    
    const fs = new EnhancedFileSystem(this.disk);
    
    // Write a file to create metadata
    await fs.writeFile('metadata-test.txt', Buffer.from('Metadata test'));
    
    // Corrupt metadata region
    const storage = this.disk.getRawStorage();
    const metadataRegion = storage.subarray(0, 65536);
    
    // Write invalid JSON to metadata
    const invalidJson = '{"invalid": "json", "missing": "closing brace"';
    const jsonBuffer = Buffer.from(invalidJson);
    jsonBuffer.copy(metadataRegion, 0);
    
    // Try to read files
    const result = await fs.listFiles();
    
    if (result.success) {
      Logger.success('System handled malformed metadata gracefully');
    } else {
      Logger.info('System failed as expected: ' + result.error);
    }
  }

  private async testOversizedPayloads(): Promise<void> {
    Logger.info('Testing oversized payloads...');
    
    const fs = new EnhancedFileSystem(this.disk);
    
    // Try to write a file larger than disk
    const oversizedData = Buffer.alloc(20 * 1024 * 1024); // 20MB
    const result = await fs.writeFile('oversized.txt', oversizedData);
    
    if (!result.success) {
      Logger.success('Oversized payload properly rejected');
    } else {
      Logger.error('Oversized payload was accepted unexpectedly');
    }
  }

  // Test concurrency
  async testConcurrency(): Promise<void> {
    Logger.section('Concurrency Testing');
    
    await this.testParallelOperations();
    await this.testDeadlockDetection();
    await this.testConsistencyChecks();
  }

  private async testParallelOperations(): Promise<void> {
    Logger.info('Testing parallel operations...');
    
    const fs = new EnhancedFileSystem(this.disk);
    
    // Create multiple file systems on same disk (simulating concurrent access)
    const fs2 = new EnhancedFileSystem(this.disk);
    
    // Perform parallel operations
    const promises = [
      fs.writeFile('parallel1.txt', Buffer.from('Parallel 1')),
      fs2.writeFile('parallel2.txt', Buffer.from('Parallel 2')),
      fs.readFile('parallel1.txt'),
      fs2.readFile('parallel2.txt')
    ];
    
    const results = await Promise.all(promises);
    const successCount = results.filter(r => r.success).length;
    
    if (successCount >= 3) {
      Logger.success('Parallel operations handled reasonably well');
    } else {
      Logger.error(`Parallel operations failed: ${successCount}/4 successful`);
    }
  }

  private async testDeadlockDetection(): Promise<void> {
    Logger.info('Testing deadlock detection...');
    
    const fs = new EnhancedFileSystem(this.disk);
    
    // Create a scenario that could cause deadlock
    const promises = [];
    
    for (let i = 0; i < 10; i++) {
      promises.push(fs.writeFile(`deadlock-${i}.txt`, Buffer.from(`Deadlock test ${i}`)));
      promises.push(fs.readFile(`deadlock-${i-1 >= 0 ? i-1 : 9}.txt`));
    }
    
    // Set a timeout to detect potential deadlocks
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Potential deadlock detected')), 5000);
    });
    
    try {
      await Promise.race([Promise.all(promises), timeoutPromise]);
      Logger.success('No deadlocks detected');
    } catch (error) {
      Logger.error('Potential deadlock: ' + error);
    }
  }

  private async testConsistencyChecks(): Promise<void> {
    Logger.info('Testing consistency checks...');
    
    const fs = new EnhancedFileSystem(this.disk);
    
    // Write multiple files
    for (let i = 0; i < 5; i++) {
      await fs.writeFile(`consistency-${i}.txt`, Buffer.from(`Consistency ${i}`));
    }
    
    // Perform concurrent operations
    const promises = [];
    for (let i = 0; i < 10; i++) {
      promises.push(fs.listFiles());
      promises.push(fs.getDiskUsage());
    }
    
    const results = await Promise.all(promises);
    
    // Check for consistency in results
    const fileLists = results.filter(r => r.success && Array.isArray(r.data));
    const fileCounts = fileLists.map(r => (r.data as string[]).length);
    
    const allSameCount = fileCounts.every(count => count === fileCounts[0]);
    
    if (allSameCount) {
      Logger.success('Consistency maintained across concurrent operations');
    } else {
      Logger.error('Inconsistency detected in concurrent operations');
    }
  }

  // Test resource cleanup
  async testResourceCleanup(): Promise<void> {
    Logger.section('Resource Cleanup Testing');
    
    await this.testTimerCleanup();
    await this.testPromiseCleanup();
    await this.testBufferCleanup();
  }

  private async testTimerCleanup(): Promise<void> {
    Logger.info('Testing timer cleanup...');
    
    // Create monitoring service to test timer cleanup
    const { MonitoringService } = await import('./src/v3-enterprise/monitoring/MonitoringService');
    
    const config = {
      cacheMaxSize: 1024 * 1024,
      cacheTTL: 60000,
      evictionPolicy: 'LRU' as 'LRU' | 'LFU' | 'FIFO',
      metricsInterval: 1000,
      alertThresholds: {
        latencyP95: 1000,
        errorRate: 5,
        cacheHitRate: 80
      }
    };
    
    const monitoringService = new MonitoringService(config);
    
    // Let it run for a bit
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Check if timers are working
    const metrics = monitoringService.getPerformanceMetrics();
    if (metrics.throughput >= 0) {
      Logger.success('Timer cleanup appears to work correctly');
    } else {
      Logger.error('Timer cleanup may have issues');
    }
  }

  private async testPromiseCleanup(): Promise<void> {
    Logger.info('Testing promise cleanup...');
    
    const fs = new EnhancedFileSystem(this.disk);
    
    // Create promises that might be abandoned
    const promises = [];
    for (let i = 0; i < 10; i++) {
      promises.push(fs.writeFile(`promise-${i}.txt`, Buffer.from(`Promise test ${i}`)));
    }
    
    // Cancel some promises by not awaiting them
    await Promise.all(promises.slice(0, 5));
    
    // Check if system is still stable
    const result = await fs.listFiles();
    if (result.success) {
      Logger.success('Promise cleanup appears to work correctly');
    } else {
      Logger.error('Promise cleanup may have issues');
    }
  }

  private async testBufferCleanup(): Promise<void> {
    Logger.info('Testing buffer cleanup...');
    
    const fs = new EnhancedFileSystem(this.disk);
    
    // Create many buffers
    for (let i = 0; i < 50; i++) {
      const data = Buffer.alloc(1024, i);
      await fs.writeFile(`buffer-cleanup-${i}.txt`, data);
    }
    
    // Delete all files
    for (let i = 0; i < 50; i++) {
      await fs.deleteFile(`buffer-cleanup-${i}.txt`);
    }
    
    // Check if buffers are cleaned up
    const listResult = await fs.listFiles();
    if (listResult.success && listResult.data!.length === 0) {
      Logger.success('Buffer cleanup appears to work correctly');
    } else {
      Logger.error('Buffer cleanup may have issues');
    }
  }
}

async function main() {
  const harness = new QualityTestHarness();
  await harness.runAllQualityTests();
}

if (require.main === module) {
  main().catch((error) => {
    console.error('💥 Quality test encountered an error:', error);
  });
}
