import * as crypto from 'crypto';
import { FileSystem } from './solution';

// Disk abstraction interface
interface Disk {
  read(offset: number, length: number): Promise<Buffer>;
  write(offset: number, data: Buffer): Promise<void>;
  size(): number;
}

// Memory-based disk implementation for testing
class MemoryDisk implements Disk {
  private storage: Buffer;

  constructor(size: number) {
    this.storage = Buffer.alloc(size);
  }

  async read(offset: number, length: number): Promise<Buffer> {
    if (offset + length > this.storage.length) {
      throw new Error('Read beyond disk boundary');
    }
    return this.storage.subarray(offset, offset + length);
  }

  async write(offset: number, data: Buffer): Promise<void> {
    if (offset + data.length > this.storage.length) {
      throw new Error('Write beyond disk boundary');
    }
    data.copy(this.storage, offset);
  }

  size(): number {
    return this.storage.length;
  }

  // For testing - direct access to corrupt data
  corruptByte(offset: number, newValue: number): void {
    if (offset < this.storage.length) {
      this.storage[offset] = newValue;
    }
  }

  // Get raw storage for inspection (testing only)
  getRawStorage(): Buffer {
    return this.storage;
  }
}

// Data corruption simulator
class CorruptionSimulator {
  static randomByteCorruption(disk: MemoryDisk, corruptionRate: number = 0.01): number {
    const storage = disk.getRawStorage();
    const totalBytes = storage.length;
    const bytesToCorrupt = Math.floor(totalBytes * corruptionRate);

    let corruptedCount = 0;
    for (let i = 0; i < bytesToCorrupt; i++) {
      const randomOffset = Math.floor(Math.random() * totalBytes);
      const randomValue = Math.floor(Math.random() * 256);
      const originalValue = storage[randomOffset];

      if (originalValue !== randomValue) {
        disk.corruptByte(randomOffset, randomValue);
        corruptedCount++;
      }
    }

    return corruptedCount;
  }

  static sequentialCorruption(disk: MemoryDisk, startOffset: number, length: number): void {
    for (let i = 0; i < length; i++) {
      const randomValue = Math.floor(Math.random() * 256);
      disk.corruptByte(startOffset + i, randomValue);
    }
  }
}

// Test utilities
class TestUtils {
  static generateRandomData(size: number): Buffer {
    return crypto.randomBytes(size);
  }

  static generateTestFiles(count: number, minSize: number = 100, maxSize: number = 1000): Array<{ name: string, content: Buffer; }> {
    const files = [];
    for (let i = 0; i < count; i++) {
      const size = minSize + Math.floor(Math.random() * (maxSize - minSize));
      files.push({
        name: `test_file_${i}.txt`,
        content: this.generateRandomData(size)
      });
    }
    return files;
  }
}

// Logging utilities
class Logger {
  static info(message: string): void {
    console.log(`[INFO] ${message}`);
  }

  static success(message: string): void {
    console.log(`[SUCCESS] ✓ ${message}`);
  }

  static error(message: string): void {
    console.log(`[ERROR] ✗ ${message}`);
  }

  static warning(message: string): void {
    console.log(`[WARNING] ⚠ ${message}`);
  }

  static section(title: string): void {
    console.log(`\n${'='.repeat(50)}`);
    console.log(`${title.toUpperCase()}`);
    console.log(`${'='.repeat(50)}`);
  }
}

// Test harness
class TestHarness {
  private disk: MemoryDisk;
  private fs: FileSystem;

  constructor() {
    this.disk = new MemoryDisk(1024 * 1024); // 1MB disk
    this.fs = new FileSystem(this.disk);
  }

  async runAllTests(): Promise<void> {
    Logger.section('Fault-Tolerant File System Tests');

    await this.testLevel1();
    await this.testLevel2();
    await this.testLevel3();
  }

  // Level 1: Basic filesystem functionality
  async testLevel1(): Promise<void> {
    Logger.section('Level 1: Basic File System Operations');

    try {
      // Test 1: Write and read a simple file
      Logger.info('Testing basic write and read operations...');
      const testContent = Buffer.from('Hello, World! This is a test file.');

      const writeResult = await this.fs.writeFile('test.txt', testContent);
      if (!writeResult.success) {
        Logger.error(`Write failed: ${writeResult.error}`);
        return;
      }
      Logger.success('File written successfully');

      const readResult = await this.fs.readFile('test.txt');
      if (!readResult.success || !readResult.data) {
        Logger.error(`Read failed: ${readResult.error}`);
        return;
      }

      if (Buffer.compare(testContent, readResult.data) === 0) {
        Logger.success('File content matches original');
      } else {
        Logger.error('File content does not match original');
        return;
      }

      // Test 2: Multiple files and listing
      Logger.info('Testing multiple files and listing...');
      await this.fs.writeFile('file1.txt', Buffer.from('Content 1'));
      await this.fs.writeFile('file2.txt', Buffer.from('Content 2'));
      await this.fs.writeFile('file3.txt', Buffer.from('Content 3'));

      const listResult = await this.fs.listFiles();
      if (!listResult.success || !listResult.data) {
        Logger.error(`List failed: ${listResult.error}`);
        return;
      }

      Logger.info(`Found ${listResult.data.length} files: ${listResult.data.join(', ')}`);

      if (listResult.data.length >= 4) { // Should have at least test.txt + 3 new files
        Logger.success('File listing works correctly');
      } else {
        Logger.error('File listing incomplete');
      }

      // Test 3: File not found
      Logger.info('Testing file not found handling...');
      const notFoundResult = await this.fs.readFile('nonexistent.txt');
      if (!notFoundResult.success) {
        Logger.success('Correctly handled non-existent file');
      } else {
        Logger.error('Should have failed for non-existent file');
      }

    } catch (error) {
      Logger.error(`Level 1 test failed with exception: ${error}`);
    }
  }

  // Level 2: Corruption detection
  async testLevel2(): Promise<void> {
    Logger.section('Level 2: Corruption Detection');

    try {
      // Create a fresh disk for corruption tests
      this.disk = new MemoryDisk(1024 * 1024);
      this.fs = new FileSystem(this.disk);

      Logger.info('Setting up files for corruption testing...');
      const testFiles = TestUtils.generateTestFiles(5, 200, 800);

      // Write all test files
      for (const file of testFiles) {
        const result = await this.fs.writeFile(file.name, file.content);
        if (!result.success) {
          Logger.error(`Failed to write ${file.name}: ${result.error}`);
          return;
        }
      }
      Logger.success(`Successfully wrote ${testFiles.length} test files`);

      // Verify all files read correctly before corruption
      Logger.info('Verifying files before corruption...');
      let beforeCorruptionSuccess = 0;
      for (const file of testFiles) {
        const result = await this.fs.readFile(file.name);
        if (result.success && result.data && Buffer.compare(file.content, result.data) === 0) {
          beforeCorruptionSuccess++;
        }
      }
      Logger.info(`${beforeCorruptionSuccess}/${testFiles.length} files read correctly before corruption`);

      // Introduce mild corruption (1% of bytes)
      Logger.info('Introducing 1% random byte corruption...');
      const corruptedBytes = CorruptionSimulator.randomByteCorruption(this.disk, 0.01);
      Logger.info(`Corrupted ${corruptedBytes} bytes`);

      // Test corruption detection
      Logger.info('Testing corruption detection...');
      let detectedCorruptions = 0;
      let falsePositives = 0;
      let undetectedCorruptions = 0;

      for (const file of testFiles) {
        const result = await this.fs.readFile(file.name);
        const actuallyCorrupted = !result.data || Buffer.compare(file.content, result.data) !== 0;

        if (!result.success) {
          // FileSystem detected corruption
          detectedCorruptions++;
          if (!actuallyCorrupted) {
            falsePositives++;
          }
        } else if (actuallyCorrupted) {
          // FileSystem didn't detect corruption but file is actually corrupt
          undetectedCorruptions++;
        }
      }

      Logger.info(`Corruption detection results:`);
      Logger.info(`  - Detected corruptions: ${detectedCorruptions}`);
      Logger.info(`  - False positives: ${falsePositives}`);
      Logger.info(`  - Undetected corruptions: ${undetectedCorruptions}`);

      if (detectedCorruptions > 0 && undetectedCorruptions === 0) {
        Logger.success('Corruption detection working correctly');
      } else if (undetectedCorruptions > 0) {
        Logger.error(`${undetectedCorruptions} corruptions went undetected`);
      } else {
        Logger.warning('No corruptions were detected - may indicate detection not implemented');
      }

    } catch (error) {
      Logger.error(`Level 2 test failed with exception: ${error}`);
    }
  }

  // Level 3: Fault tolerance rate testing
  async testLevel3(): Promise<void> {
    Logger.section('Level 3: Fault Tolerance Rate Testing');

    const corruptionRates = [0.001, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.3];
    const testFileCount = 10;

    Logger.info(`Testing fault tolerance across corruption rates: ${corruptionRates.map(r => `${(r * 100).toFixed(1)}%`).join(', ')}`);

    for (const rate of corruptionRates) {
      Logger.info(`\nTesting corruption rate: ${(rate * 100).toFixed(1)}%`);

      // Create fresh disk and filesystem for each test
      const testDisk = new MemoryDisk(1024 * 1024);
      const testFs = new FileSystem(testDisk);

      // Generate and write test files
      const testFiles = TestUtils.generateTestFiles(testFileCount, 300, 1000);
      let writeSuccesses = 0;

      for (const file of testFiles) {
        const result = await testFs.writeFile(file.name, file.content);
        if (result.success) {
          writeSuccesses++;
        }
      }

      if (writeSuccesses !== testFileCount) {
        Logger.error(`Only ${writeSuccesses}/${testFileCount} files written successfully`);
        continue;
      }

      // Introduce corruption
      const corruptedBytes = CorruptionSimulator.randomByteCorruption(testDisk, rate);

      // Test file system resilience
      let successfulReads = 0;
      let detectedCorruptions = 0;
      let dataIntegrityFailures = 0;

      for (const file of testFiles) {
        const result = await testFs.readFile(file.name);

        if (result.success && result.data) {
          if (Buffer.compare(file.content, result.data) === 0) {
            successfulReads++;
          } else {
            // Data was returned but doesn't match original
            dataIntegrityFailures++;
          }
        } else {
          // FileSystem detected corruption or error
          detectedCorruptions++;
        }
      }

      const totalHandledCorrectly = successfulReads + detectedCorruptions;
      const faultToleranceRate = (totalHandledCorrectly / testFileCount) * 100;

      Logger.info(`  Results for ${(rate * 100).toFixed(1)}% corruption:`);
      Logger.info(`    - Corrupted bytes: ${corruptedBytes}`);
      Logger.info(`    - Successful reads: ${successfulReads}/${testFileCount} (${(successfulReads / testFileCount * 100).toFixed(1)}%)`);
      Logger.info(`    - Detected corruptions: ${detectedCorruptions}/${testFileCount} (${(detectedCorruptions / testFileCount * 100).toFixed(1)}%)`);
      Logger.info(`    - Data integrity failures: ${dataIntegrityFailures}/${testFileCount} (${(dataIntegrityFailures / testFileCount * 100).toFixed(1)}%)`);
      Logger.info(`    - Fault tolerance rate: ${faultToleranceRate.toFixed(1)}%`);

      if (faultToleranceRate < 80) {
        Logger.warning(`Fault tolerance drops below 80% at ${(rate * 100).toFixed(1)}% corruption rate`);
      }

      if (dataIntegrityFailures > 0) {
        Logger.error(`Data integrity compromised: ${dataIntegrityFailures} files returned incorrect data without detection`);
      }
    }
  }
}

// Main execution
async function main() {
  const harness = new TestHarness();
  await harness.runAllTests();
}

// Export for use in solution
export { Disk, MemoryDisk, CorruptionSimulator, TestUtils, Logger };

// Run tests if this file is executed directly
if (require.main === module) {
  main().catch(console.error);
}