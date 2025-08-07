import { Logger } from '../src/v1-basic/index';
import { MemoryDisk, CorruptionSimulator, TestUtils } from '../src/v1-basic/index';
import { FileSystem } from '../src/v1-basic/version1-basic-solution';
import { EnhancedFileSystem } from '../src/v2-enhanced/version2-enhanced-solution';
import { createEnterpriseFileSystem } from '../src/v3-enterprise/index';

class SimpleVersionTest {
  private version: string;

  constructor(version: string) {
    this.version = version;
  }

  async runTest(): Promise<void> {
    Logger.info(`\n${'='.repeat(60)}`);
    Logger.info(`🚀 TESTING ${this.version.toUpperCase()} YOIFS`);
    Logger.info(`${'='.repeat(60)}`);

    // Test 1: Basic Operations
    await this.testBasicOperations();
    
    // Test 2: Corruption Resilience
    await this.testCorruptionResilience();
    
    Logger.info(`✅ ${this.version.toUpperCase()} testing completed`);
  }

  private async testBasicOperations(): Promise<void> {
    Logger.info('\n📁 Testing Basic Operations');
    
    const disk = new MemoryDisk(1024 * 1024); // 1MB fresh disk
    let fs: any;
    let sessionToken: string | undefined;

    // Initialize file system
    switch (this.version) {
      case 'v1':
        fs = new FileSystem(disk);
        break;
      case 'v2':
        fs = new EnhancedFileSystem(disk);
        break;
      case 'v3':
        fs = createEnterpriseFileSystem(disk);
        // Authenticate once for V3
        const authResult = await fs.authenticateUser({
          username: 'admin',
          password: 'admin123'
        });
        if (authResult.success && authResult.sessionToken) {
          sessionToken = authResult.sessionToken;
        } else {
          Logger.error(`❌ V3 authentication failed: ${JSON.stringify(authResult.error)}`);
          return;
        }
        break;
    }

    try {
      // Write a test file
      const content = Buffer.from('Hello, YOIFS! This is a test file.');
      let writeResult: any;

      if (this.version === 'v3') {
        writeResult = await fs.writeFile(sessionToken!, 'test.txt', content, 'admin');
      } else {
        writeResult = await fs.writeFile('test.txt', content);
      }

      if (writeResult.success) {
        Logger.success(`✅ ${this.version.toUpperCase()} write successful`);
      } else {
        Logger.error(`❌ ${this.version.toUpperCase()} write failed: ${JSON.stringify(writeResult.error)}`);
        return;
      }

      // Read the file
      let readResult: any;
      if (this.version === 'v3') {
        readResult = await fs.readFile(sessionToken!, writeResult.data!);
      } else {
        readResult = await fs.readFile('test.txt');
      }

      if (readResult.success && Buffer.compare(content, readResult.data!) === 0) {
        Logger.success(`✅ ${this.version.toUpperCase()} read successful - content matches`);
      } else {
        Logger.error(`❌ ${this.version.toUpperCase()} read failed: ${JSON.stringify(readResult.error)}`);
      }

    } catch (error) {
      Logger.error(`❌ ${this.version.toUpperCase()} basic operations failed: ${error}`);
    }
  }

  private async testCorruptionResilience(): Promise<void> {
    Logger.info('\n🛡️ Testing Corruption Resilience');
    
    const disk = new MemoryDisk(1024 * 1024); // 1MB fresh disk
    let fs: any;
    let sessionToken: string | undefined;

    // Initialize file system
    switch (this.version) {
      case 'v1':
        fs = new FileSystem(disk);
        break;
      case 'v2':
        fs = new EnhancedFileSystem(disk);
        break;
      case 'v3':
        fs = createEnterpriseFileSystem(disk);
        // Authenticate once for V3
        const authResult = await fs.authenticateUser({
          username: 'admin',
          password: 'admin123'
        });
        if (authResult.success && authResult.sessionToken) {
          sessionToken = authResult.sessionToken;
        } else {
          Logger.error(`❌ V3 authentication failed: ${JSON.stringify(authResult.error)}`);
          return;
        }
        break;
    }

    try {
      // Write test files
      const testFiles = TestUtils.generateTestFiles(10, 50, 200);
      let writeSuccessCount = 0;
      const fileMap: { [name: string]: string } = {}; // For V3: filename -> fileId mapping

      for (const file of testFiles) {
        try {
          if (this.version === 'v3') {
            const result = await fs.writeFile(sessionToken!, file.name, file.content, 'admin');
            if (result.success) {
              writeSuccessCount++;
              fileMap[file.name] = result.data!; // Store fileId for V3
            }
          } else {
            const result = await fs.writeFile(file.name, file.content);
            if (result.success) writeSuccessCount++;
          }
        } catch (error) {
          // Continue with next file
        }
      }

      Logger.info(`📝 Wrote ${writeSuccessCount}/10 test files`);

      // Introduce light corruption
      const corruptedBytes = CorruptionSimulator.randomByteCorruption(disk, 0.001); // 0.1% corruption
      Logger.info(`🔧 Introduced ${corruptedBytes} bytes of corruption (0.1%)`);

      // Test read success rate
      let successfulReads = 0;
      let failedReads = 0;

      for (const file of testFiles) {
        try {
          if (this.version === 'v3') {
            const fileId = fileMap[file.name]; // Use stored fileId for V3
            if (fileId) {
              const result = await fs.readFile(sessionToken!, fileId, {
                allowPartialRecovery: true,
                fillCorruptedChunks: 'zeros',
                minimumRecoveryRate: 30
              });
              if (result.success) {
                successfulReads++;
              } else {
                failedReads++;
              }
            } else {
              failedReads++; // File wasn't written successfully
            }
          } else {
            const result = await fs.readFile(file.name);
            if (result.success) {
              successfulReads++;
            } else {
              failedReads++;
            }
          }
        } catch (error) {
          failedReads++;
        }
      }

      const successRate = (successfulReads / testFiles.length) * 100;
      Logger.info(`📊 Corruption resilience results:`);
      Logger.info(`   - Successful reads: ${successfulReads}/${testFiles.length} (${successRate.toFixed(1)}%)`);
      Logger.info(`   - Failed reads: ${failedReads}/${testFiles.length} (${(100 - successRate).toFixed(1)}%)`);

      if (successRate >= 80) {
        Logger.success(`✅ ${this.version.toUpperCase()} shows excellent corruption resilience`);
      } else if (successRate >= 50) {
        Logger.success(`✅ ${this.version.toUpperCase()} shows good corruption resilience`);
      } else {
        Logger.warning(`⚠️ ${this.version.toUpperCase()} shows limited corruption resilience`);
      }

    } catch (error) {
      Logger.error(`❌ ${this.version.toUpperCase()} corruption test failed: ${error}`);
    }
  }
}

// Run tests for all versions
async function runAllVersions(): Promise<void> {
  const versions = ['v1', 'v2', 'v3'];
  
  for (const version of versions) {
    try {
      const tester = new SimpleVersionTest(version);
      await tester.runTest();
    } catch (error) {
      Logger.error(`❌ ${version.toUpperCase()} testing failed: ${error}`);
    }
  }
  
  Logger.info(`\n${'='.repeat(60)}`);
  Logger.info('🎉 ALL VERSION TESTING COMPLETED');
  Logger.info(`${'='.repeat(60)}`);
}

// Run the simple version test
if (require.main === module) {
  runAllVersions().catch(console.error);
}
