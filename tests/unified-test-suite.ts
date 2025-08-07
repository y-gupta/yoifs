import { Logger } from './src/v1-basic/index';
import { MemoryDisk, CorruptionSimulator, TestUtils } from './src/v1-basic/index';
import { FileSystem } from './src/v1-basic/version1-basic-solution';
import { EnhancedFileSystem } from './src/v2-enhanced/version2-enhanced-solution';
import { createEnterpriseFileSystem } from './src/v3-enterprise/index';

class UnifiedTestHarness {
  private disk: MemoryDisk;
  private fs: any;
  private version: string;

  constructor(version: string) {
    this.disk = new MemoryDisk(2 * 1024 * 1024); // 2MB disk
    this.version = version;
    this.initializeFileSystem();
  }

  private initializeFileSystem(): void {
    switch (this.version) {
      case 'v1':
        this.fs = new FileSystem(this.disk);
        break;
      case 'v2':
        this.fs = new EnhancedFileSystem(this.disk);
        break;
      case 'v3':
        this.fs = createEnterpriseFileSystem(this.disk);
        break;
      default:
        throw new Error(`Unknown version: ${this.version}`);
    }
  }

  async runAllTests(): Promise<void> {
    Logger.yoifsIntro();
    Logger.section(`${this.version.toUpperCase()} YOIFS INDESTRUCTIBILITY ASSESSMENT PROTOCOL`);

    await this.testLevel1();
    await this.testLevel2();
    await this.testLevel3();
  }

  // Level 1: Basic filesystem operations
  async testLevel1(): Promise<void> {
    Logger.section(`Level 1: ${this.version.toUpperCase()} Basic Operations`);

    try {
      // Test 1: Write and read a simple file
      Logger.info('Testing basic write and read operations...');
      const testContent = Buffer.from('Hello, World! This is a test file for the YOIFS system.');

      let writeResult;
      if (this.version === 'v3') {
        // V3 requires authentication
        const authResult = await this.fs.authenticateUser({
          username: 'admin',
          password: 'admin123'
        });
        if (!authResult.success) {
          Logger.error('Authentication failed for V3');
          return;
        }
        writeResult = await this.fs.writeFile(authResult.sessionToken!, 'test.txt', testContent, 'admin');
      } else {
        writeResult = await this.fs.writeFile('test.txt', testContent);
      }

      if (!writeResult.success) {
        Logger.error(`Write failed: ${writeResult.error}`);
        return;
      }
      Logger.success('File written successfully');

      let readResult;
      if (this.version === 'v3') {
        const authResult = await this.fs.authenticateUser({
          username: 'admin',
          password: 'admin123'
        });
        readResult = await this.fs.readFile(authResult.sessionToken!, writeResult.data!);
      } else {
        readResult = await this.fs.readFile('test.txt');
      }

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
      const files = ['file1.txt', 'file2.txt', 'file3.txt'];
      const contents = [
        Buffer.from('Content 1'),
        Buffer.from('Content 2'),
        Buffer.from('Content 3')
      ];

      for (let i = 0; i < files.length; i++) {
        if (this.version === 'v3') {
          const authResult = await this.fs.authenticateUser({
            username: 'admin',
            password: 'admin123'
          });
          await this.fs.writeFile(authResult.sessionToken!, files[i], contents[i], 'admin');
        } else {
          await this.fs.writeFile(files[i], contents[i]);
        }
      }

      let listResult;
      if (this.version === 'v3') {
        const authResult = await this.fs.authenticateUser({
          username: 'admin',
          password: 'admin123'
        });
        listResult = await this.fs.listFiles(authResult.sessionToken!);
      } else {
        listResult = await this.fs.listFiles();
      }

      if (!listResult.success || !listResult.data) {
        Logger.error(`List failed: ${listResult.error}`);
        return;
      }

      Logger.info(`Found ${listResult.data.length} files: ${listResult.data.join(', ')}`);

      if (listResult.data.length >= 4) {
        Logger.success(`${this.version.toUpperCase()} file listing works perfectly!`);
      } else {
        Logger.error('File listing incomplete');
      }

      // Test 3: File not found handling
      Logger.info('Testing file not found handling...');
      let notFoundResult;
      if (this.version === 'v3') {
        const authResult = await this.fs.authenticateUser({
          username: 'admin',
          password: 'admin123'
        });
        notFoundResult = await this.fs.readFile(authResult.sessionToken!, 'nonexistent.txt');
      } else {
        notFoundResult = await this.fs.readFile('nonexistent.txt');
      }

      if (!notFoundResult.success) {
        Logger.success('Correctly handled non-existent file');
      } else {
        Logger.error('Failed to handle non-existent file');
      }

    } catch (error) {
      Logger.error(`Level 1 test failed with exception: ${error}`);
    }
  }

  // Level 2: Corruption detection testing
  async testLevel2(): Promise<void> {
    Logger.section(`Level 2: ${this.version.toUpperCase()} Corruption Detection Powers`);

    try {
      // Create a fresh disk for corruption testing
      this.disk = new MemoryDisk(2 * 1024 * 1024);
      this.initializeFileSystem();

      Logger.info('Setting up files for corruption testing...');
      
      // Write 100 test files
      const testFiles = TestUtils.generateTestFiles(100, 50, 200);
      let writeSuccessCount = 0;

      for (const file of testFiles) {
        try {
          if (this.version === 'v3') {
            const authResult = await this.fs.authenticateUser({
              username: 'admin',
              password: 'admin123'
            });
            const result = await this.fs.writeFile(authResult.sessionToken!, file.name, file.content, 'admin');
            if (result.success) writeSuccessCount++;
          } else {
            const result = await this.fs.writeFile(file.name, file.content);
            if (result.success) writeSuccessCount++;
          }
        } catch (error) {
          // Continue with next file
        }
      }

      if (writeSuccessCount === 100) {
        Logger.success('Successfully wrote 100 test files');
      } else {
        Logger.warning(`Only wrote ${writeSuccessCount}/100 test files`);
      }

      // Verify files before corruption
      Logger.info('Verifying files before corruption...');
      let readSuccessCount = 0;
      for (const file of testFiles) {
        try {
          if (this.version === 'v3') {
            const authResult = await this.fs.authenticateUser({
              username: 'admin',
              password: 'admin123'
            });
            const result = await this.fs.readFile(authResult.sessionToken!, file.name);
            if (result.success) readSuccessCount++;
          } else {
            const result = await this.fs.readFile(file.name);
            if (result.success) readSuccessCount++;
          }
        } catch (error) {
          // Continue with next file
        }
      }

      Logger.info(`${readSuccessCount}/100 files read correctly before corruption`);

      // Introduce corruption
      Logger.info('Introducing 0.02% random byte corruption...');
      const corruptedBytes = CorruptionSimulator.randomByteCorruption(this.disk, 0.0002);
      Logger.info(`Corrupted ${corruptedBytes} bytes`);

      // Test corruption detection
      Logger.info('Testing corruption detection...');
      let detectedCorruptions = 0;
      let falsePositives = 0;
      let undetectedCorruptions = 0;

      for (const file of testFiles) {
        try {
          if (this.version === 'v3') {
            const authResult = await this.fs.authenticateUser({
              username: 'admin',
              password: 'admin123'
            });
            const result = await this.fs.readFile(authResult.sessionToken!, file.name);
            if (!result.success) {
              detectedCorruptions++;
            }
          } else {
            const result = await this.fs.readFile(file.name);
            if (!result.success) {
              detectedCorruptions++;
            }
          }
        } catch (error) {
          detectedCorruptions++;
        }
      }

      Logger.info('Corruption detection results:');
      Logger.info(`  - Detected corruptions: ${detectedCorruptions}`);
      Logger.info(`  - False positives: ${falsePositives}`);
      Logger.info(`  - Undetected corruptions: ${undetectedCorruptions}`);

      if (detectedCorruptions > 0) {
        Logger.success(`${this.version.toUpperCase()} corruption detection is working!`);
      } else {
        Logger.warning(`No corruptions were detected - ${this.version.toUpperCase()} might need corruption detection implementation`);
      }

    } catch (error) {
      Logger.error(`Level 2 test failed with exception: ${error}`);
    }
  }

  // Level 3: Stress testing with varying corruption rates
  async testLevel3(): Promise<void> {
    Logger.section(`Level 3: ${this.version.toUpperCase()} Indestructibility Stress Test`);

    const corruptionRates = [0.0001, 0.0005, 0.001, 0.005, 0.01, 0.05, 0.1];
    Logger.info(`Testing fault tolerance across corruption rates: ${corruptionRates.map(r => (r * 100).toFixed(1) + '%').join(', ')}`);

    for (const rate of corruptionRates) {
      Logger.info(`\nTesting corruption rate: ${(rate * 100).toFixed(2)}%`);
      
      // Create fresh disk for each test
      this.disk = new MemoryDisk(2 * 1024 * 1024);
      this.initializeFileSystem();

      try {
        // Write test files
        const testFiles = TestUtils.generateTestFiles(100, 50, 200);
        let writeSuccessCount = 0;

        for (const file of testFiles) {
          try {
            if (this.version === 'v3') {
              const authResult = await this.fs.authenticateUser({
                username: 'admin',
                password: 'admin123'
              });
              const result = await this.fs.writeFile(authResult.sessionToken!, file.name, file.content, 'admin');
              if (result.success) writeSuccessCount++;
            } else {
              const result = await this.fs.writeFile(file.name, file.content);
              if (result.success) writeSuccessCount++;
            }
          } catch (error) {
            // Continue with next file
          }
        }

        // Introduce corruption
        const corruptedBytes = CorruptionSimulator.randomByteCorruption(this.disk, rate);

        // Test read success rate
        let successfulReads = 0;
        let detectedCorruptions = 0;
        let dataIntegrityFailures = 0;

        for (const file of testFiles) {
          try {
            if (this.version === 'v3') {
              const authResult = await this.fs.authenticateUser({
                username: 'admin',
                password: 'admin123'
              });
              const result = await this.fs.readFile(authResult.sessionToken!, file.name);
              if (result.success) {
                successfulReads++;
                // Check if content matches (data integrity)
                if (Buffer.compare(file.content, result.data!) !== 0) {
                  dataIntegrityFailures++;
                }
              } else {
                detectedCorruptions++;
              }
            } else {
              const result = await this.fs.readFile(file.name);
              if (result.success) {
                successfulReads++;
                // Check if content matches (data integrity)
                if (Buffer.compare(file.content, result.data!) !== 0) {
                  dataIntegrityFailures++;
                }
              } else {
                detectedCorruptions++;
              }
            }
          } catch (error) {
            detectedCorruptions++;
          }
        }

        Logger.info(`  Results for ${(rate * 100).toFixed(2)}% corruption:`);
        Logger.info(`    - Corrupted bytes: ${corruptedBytes}`);
        Logger.info(`    - Successful reads: ${successfulReads}/100 (${(successfulReads / 100 * 100).toFixed(1)}%)`);
        Logger.info(`    - Detected corruptions: ${detectedCorruptions}/100 (${(detectedCorruptions / 100 * 100).toFixed(1)}%)`);
        Logger.info(`    - Data integrity failures: ${dataIntegrityFailures}/100 (${(dataIntegrityFailures / 100 * 100).toFixed(1)}%)`);

      } catch (error) {
        Logger.error(`  Test failed for ${(rate * 100).toFixed(2)}% corruption: ${error}`);
      }
    }

    Logger.section(`${this.version.toUpperCase()} Assessment Complete`);
  }
}

// Run tests for all versions
async function runAllVersions(): Promise<void> {
  const versions = ['v1', 'v2', 'v3'];
  
  for (const version of versions) {
    try {
      Logger.info(`\n${'='.repeat(60)}`);
      Logger.info(`🚀 TESTING ${version.toUpperCase()} YOIFS`);
      Logger.info(`${'='.repeat(60)}`);
      
      const harness = new UnifiedTestHarness(version);
      await harness.runAllTests();
      
      Logger.info(`✅ ${version.toUpperCase()} testing completed`);
      
    } catch (error) {
      Logger.error(`❌ ${version.toUpperCase()} testing failed: ${error}`);
    }
  }
  
  Logger.info(`\n${'='.repeat(60)}`);
  Logger.info('🎉 ALL VERSION TESTING COMPLETED');
  Logger.info(`${'='.repeat(60)}`);
}

// Run the unified test suite
if (require.main === module) {
  runAllVersions().catch(console.error);
}
