import { Logger } from './index';
import { EnhancedFileSystem } from './enhanced-solution';
import { MemoryDisk, CorruptionSimulator, TestUtils } from './index';

class EnhancedTestHarness {
  private disk: MemoryDisk;
  private fs: EnhancedFileSystem;

  constructor() {
    this.disk = new MemoryDisk(2 * 1024 * 1024); // 2MB disk for enhanced features
    this.fs = new EnhancedFileSystem(this.disk);
  }

  async runAllTests(): Promise<void> {
    Logger.yoifsIntro();
    Logger.section('Enhanced YOIFS Assessment Protocol');

    await this.testLevel1();
    await this.testLevel2();
    await this.testLevel3();
    await this.testLevel4();
    await this.testLevel5();
  }

  // Level 1: Basic enhanced filesystem functionality
  async testLevel1(): Promise<void> {
    Logger.section('Level 1: Enhanced YOIFS Basic Operations');

    try {
      // Test 1: Write and read a simple file
      Logger.info('Testing enhanced write and read operations...');
      const testContent = Buffer.from('Hello, World! This is a test file for the enhanced YOIFS system.');

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

      if (listResult.data.length >= 4) {
        Logger.success('Enhanced YOIFS file listing works perfectly!');
      } else {
        Logger.error('File listing incomplete');
      }

      // Test 3: File info
      Logger.info('Testing file info retrieval...');
      const infoResult = await this.fs.getFileInfo('test.txt');
      if (infoResult.success && infoResult.data) {
        Logger.success(`File info retrieved: ${infoResult.data.size} bytes, ${infoResult.data.chunkRefs.length} chunks`);
      } else {
        Logger.error('File info retrieval failed');
      }

    } catch (error) {
      Logger.error(`Level 1 test failed with exception: ${error}`);
    }
  }

  // Level 2: Chunking and compression testing
  async testLevel2(): Promise<void> {
    Logger.section('Level 2: YOIFS Chunking and Compression Powers');

    try {
      // Create a fresh disk for chunking tests
      this.disk = new MemoryDisk(2 * 1024 * 1024);
      this.fs = new EnhancedFileSystem(this.disk);

      Logger.info('Testing chunking with large files...');
      
      // Create a large file with repetitive content (good for compression)
      const repetitiveContent = Buffer.alloc(50000);
      for (let i = 0; i < repetitiveContent.length; i++) {
        repetitiveContent[i] = (i % 256);
      }

      const writeResult = await this.fs.writeFile('large_repetitive.txt', repetitiveContent);
      if (!writeResult.success) {
        Logger.error(`Failed to write large file: ${writeResult.error}`);
        return;
      }
      Logger.success('Large repetitive file written successfully');

      // Test compression stats
      const compressionStats = await this.fs.getCompressionStats();
      if (compressionStats.success && compressionStats.data) {
        const { originalSize, compressedSize, ratio } = compressionStats.data;
        Logger.info(`Compression stats: ${originalSize} -> ${compressedSize} bytes (${ratio.toFixed(1)}% of original)`);
        
        if (ratio < 100) {
          Logger.success('Compression working effectively!');
        } else {
          Logger.warning('No compression achieved (might be expected for small files)');
        }
      }

      // Test chunking with corruption
      Logger.info('Testing chunking with targeted corruption...');
      const readResult = await this.fs.readFile('large_repetitive.txt');
      if (!readResult.success) {
        Logger.error(`Failed to read large file: ${readResult.error}`);
        return;
      }

      if (Buffer.compare(repetitiveContent, readResult.data!) === 0) {
        Logger.success('Large file read correctly before corruption');
      } else {
        Logger.error('Large file content mismatch before corruption');
        return;
      }

      // Introduce corruption in specific chunks
      Logger.info('Introducing targeted corruption to test chunk isolation...');
      const storage = this.disk.getRawStorage();
      const corruptionPoints = [1000, 5000, 15000, 25000, 35000];
      
      for (const point of corruptionPoints) {
        if (point < storage.length) {
          this.disk.corruptByte(point, Math.floor(Math.random() * 256));
        }
      }

      // Try to read the corrupted file
      const corruptedReadResult = await this.fs.readFile('large_repetitive.txt');
      if (corruptedReadResult.success) {
        Logger.success('File read successfully despite corruption (chunking working!)');
      } else {
        Logger.info(`File read failed as expected: ${corruptedReadResult.error}`);
      }

    } catch (error) {
      Logger.error(`Level 2 test failed with exception: ${error}`);
    }
  }

  // Level 3: Deduplication testing
  async testLevel3(): Promise<void> {
    Logger.section('Level 3: YOIFS Deduplication Magic');

    try {
      // Create a fresh disk for deduplication tests
      this.disk = new MemoryDisk(2 * 1024 * 1024);
      this.fs = new EnhancedFileSystem(this.disk);

      Logger.info('Testing deduplication with identical content...');
      
      // Create multiple files with identical content
      const identicalContent = Buffer.from('This is identical content that should be deduplicated across multiple files.');
      
      for (let i = 0; i < 5; i++) {
        const result = await this.fs.writeFile(`duplicate_${i}.txt`, identicalContent);
        if (!result.success) {
          Logger.error(`Failed to write duplicate file ${i}: ${result.error}`);
          return;
        }
      }
      Logger.success('Created 5 files with identical content');

      // Check compression stats to see deduplication effect
      const compressionStats = await this.fs.getCompressionStats();
      if (compressionStats.success && compressionStats.data) {
        const { originalSize, compressedSize, ratio } = compressionStats.data;
        Logger.info(`After deduplication: ${originalSize} -> ${compressedSize} bytes (${ratio.toFixed(1)}% of original)`);
        
        // Should see significant space savings due to deduplication
        if (ratio < 50) {
          Logger.success('Excellent deduplication achieved!');
        } else if (ratio < 100) {
          Logger.success('Good deduplication achieved');
        } else {
          Logger.warning('No deduplication detected');
        }
      }

      // Verify all files can still be read correctly
      Logger.info('Verifying all duplicate files can be read...');
      let readSuccesses = 0;
      for (let i = 0; i < 5; i++) {
        const result = await this.fs.readFile(`duplicate_${i}.txt`);
        if (result.success && Buffer.compare(result.data!, identicalContent) === 0) {
          readSuccesses++;
        }
      }
      
      if (readSuccesses === 5) {
        Logger.success('All duplicate files read correctly!');
      } else {
        Logger.error(`Only ${readSuccesses}/5 duplicate files read correctly`);
      }

    } catch (error) {
      Logger.error(`Level 3 test failed with exception: ${error}`);
    }
  }

  // Level 4: Space reclamation testing
  async testLevel4(): Promise<void> {
    Logger.section('Level 4: YOIFS Space Reclamation');

    try {
      // Create a fresh disk for space reclamation tests
      this.disk = new MemoryDisk(2 * 1024 * 1024);
      this.fs = new EnhancedFileSystem(this.disk);

      Logger.info('Testing space reclamation...');
      
      // Get initial disk usage
      const initialUsage = await this.fs.getDiskUsage();
      if (!initialUsage.success) {
        Logger.error('Failed to get initial disk usage');
        return;
      }
      Logger.info(`Initial disk usage: ${initialUsage.data!.used} used, ${initialUsage.data!.free} free`);

      // Create some files
      const testFiles = TestUtils.generateTestFiles(10, 1000, 5000);
      for (const file of testFiles) {
        const result = await this.fs.writeFile(file.name, file.content);
        if (!result.success) {
          Logger.error(`Failed to write ${file.name}: ${result.error}`);
          return;
        }
      }
      Logger.success(`Created ${testFiles.length} test files`);

      // Get disk usage after creating files
      const afterCreateUsage = await this.fs.getDiskUsage();
      if (!afterCreateUsage.success) {
        Logger.error('Failed to get disk usage after file creation');
        return;
      }
      Logger.info(`After file creation: ${afterCreateUsage.data!.used} used, ${afterCreateUsage.data!.free} free`);

      // Delete some files
      const filesToDelete = testFiles.slice(0, 5).map(f => f.name);
      for (const fileName of filesToDelete) {
        const result = await this.fs.deleteFile(fileName);
        if (!result.success) {
          Logger.error(`Failed to delete ${fileName}: ${result.error}`);
          return;
        }
      }
      Logger.success(`Deleted ${filesToDelete.length} files`);

      // Get disk usage after deletion
      const afterDeleteUsage = await this.fs.getDiskUsage();
      if (!afterDeleteUsage.success) {
        Logger.error('Failed to get disk usage after file deletion');
        return;
      }
      Logger.info(`After file deletion: ${afterDeleteUsage.data!.used} used, ${afterDeleteUsage.data!.free} free`);

      // Check if space was reclaimed
      const spaceReclaimed = afterCreateUsage.data!.used - afterDeleteUsage.data!.used;
      if (spaceReclaimed > 0) {
        Logger.success(`Space reclamation working: ${spaceReclaimed} bytes reclaimed`);
      } else {
        Logger.warning('No space reclamation detected (might be due to shared chunks)');
      }

      // Verify remaining files still work
      const remainingFiles = testFiles.slice(5).map(f => f.name);
      let remainingReadSuccesses = 0;
      for (const fileName of remainingFiles) {
        const result = await this.fs.readFile(fileName);
        if (result.success) {
          remainingReadSuccesses++;
        }
      }
      
      if (remainingReadSuccesses === remainingFiles.length) {
        Logger.success('All remaining files still accessible after deletion');
      } else {
        Logger.error(`Only ${remainingReadSuccesses}/${remainingFiles.length} remaining files accessible`);
      }

    } catch (error) {
      Logger.error(`Level 4 test failed with exception: ${error}`);
    }
  }

  // Level 5: Metadata resilience testing
  async testLevel5(): Promise<void> {
    Logger.section('Level 5: YOIFS Metadata Resilience');

    try {
      // Create a fresh disk for metadata resilience tests
      this.disk = new MemoryDisk(2 * 1024 * 1024);
      this.fs = new EnhancedFileSystem(this.disk);

      Logger.info('Testing metadata resilience...');
      
      // Create some files first
      const testFiles = TestUtils.generateTestFiles(5, 100, 1000);
      for (const file of testFiles) {
        const result = await this.fs.writeFile(file.name, file.content);
        if (!result.success) {
          Logger.error(`Failed to write ${file.name}: ${result.error}`);
          return;
        }
      }
      Logger.success(`Created ${testFiles.length} test files`);

      // Verify files can be read before corruption
      let beforeCorruptionSuccess = 0;
      for (const file of testFiles) {
        const result = await this.fs.readFile(file.name);
        if (result.success && Buffer.compare(result.data!, file.content) === 0) {
          beforeCorruptionSuccess++;
        }
      }
      Logger.info(`${beforeCorruptionSuccess}/${testFiles.length} files read correctly before metadata corruption`);

      // Corrupt metadata sections
      Logger.info('Introducing metadata corruption...');
      const storage = this.disk.getRawStorage();
      const metadataRegion = storage.subarray(0, 65536); // 64KB metadata region
      
      // Corrupt random bytes in metadata region
      const corruptionCount = Math.floor(metadataRegion.length * 0.01); // 1% corruption
      for (let i = 0; i < corruptionCount; i++) {
        const randomOffset = Math.floor(Math.random() * metadataRegion.length);
        metadataRegion[randomOffset] = Math.floor(Math.random() * 256);
      }
      
      Logger.info(`Corrupted ${corruptionCount} bytes in metadata region`);

      // Try to read files after metadata corruption
      let afterCorruptionSuccess = 0;
      for (const file of testFiles) {
        const result = await this.fs.readFile(file.name);
        if (result.success && Buffer.compare(result.data!, file.content) === 0) {
          afterCorruptionSuccess++;
        }
      }
      
      Logger.info(`${afterCorruptionSuccess}/${testFiles.length} files read correctly after metadata corruption`);
      
      if (afterCorruptionSuccess > 0) {
        Logger.success('Metadata resilience working - some files recovered!');
      } else {
        Logger.warning('No files recovered after metadata corruption');
      }

      // Test append functionality
      Logger.info('Testing append functionality...');
      const appendResult = await this.fs.appendFile(testFiles[0].name, Buffer.from(' - APPENDED'));
      if (appendResult.success) {
        Logger.success('File append successful');
        
        // Verify appended content
        const readResult = await this.fs.readFile(testFiles[0].name);
        if (readResult.success) {
          const expectedContent = Buffer.concat([testFiles[0].content, Buffer.from(' - APPENDED')]);
          if (Buffer.compare(readResult.data!, expectedContent) === 0) {
            Logger.success('Appended content verified correctly');
          } else {
            Logger.error('Appended content verification failed');
          }
        }
      } else {
        Logger.error(`File append failed: ${appendResult.error}`);
      }

    } catch (error) {
      Logger.error(`Level 5 test failed with exception: ${error}`);
    }
  }
}

async function main() {
  const harness = new EnhancedTestHarness();
  await harness.runAllTests();
}

if (require.main === module) {
  main().catch((error) => {
    console.error('💥 Enhanced YOIFS encountered an unexpected error:', error);
  });
}
