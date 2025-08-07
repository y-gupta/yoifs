import { MemoryDisk } from '../v1-basic/index';
import { 
  createEnterpriseFileSystem
} from './index';
import { ReadOptions } from '../v2-enhanced/version2-enhanced-solution';
import { Logger } from '../v1-basic/index';

class PartialRecoveryTestHarness {
  private disk: MemoryDisk;
  private fs: any;

  constructor() {
    this.disk = new MemoryDisk(10 * 1024 * 1024); // 10MB
  }

  async runAllTests(): Promise<void> {
    Logger.info('🛡️ Starting Partial Corruption Recovery Tests');
    
    await this.testStrictMode();
    await this.testPartialRecoveryMode();
    await this.testRecoveryRateThresholds();
    await this.testDifferentFillPatterns();
    
    Logger.info('✅ All partial recovery tests completed successfully!');
  }

  private async testStrictMode(): Promise<void> {
    Logger.info('\n🔒 Testing Strict Mode (No Partial Recovery)');
    
    this.fs = createEnterpriseFileSystem(this.disk);
    
    // Authenticate user
    const authResult = await this.fs.authenticateUser({
      username: 'admin',
      password: 'admin123'
    });
    
    if (!authResult.success) {
      throw new Error('Authentication failed for strict mode test');
    }
    
    const sessionToken = authResult.sessionToken!;
    
    // Write a test file
    const content = Buffer.from('This is a test file with some content that will be corrupted');
    const writeResult = await this.fs.writeFile(sessionToken, 'strict-test.txt', content, 'admin');
    
    if (!writeResult.success) {
      throw new Error('File write failed for strict mode test');
    }
    
    // Read file in strict mode (default behavior)
    const readResult = await this.fs.readFile(sessionToken, writeResult.data!);
    
    if (readResult.success) {
      Logger.success('✅ Strict mode read successful');
      if (Buffer.compare(content, readResult.data!) === 0) {
        Logger.success('✅ File content matches original');
      } else {
        throw new Error('File content mismatch in strict mode');
      }
    } else {
      throw new Error(`Strict mode read failed: ${readResult.error}`);
    }
  }

  private async testPartialRecoveryMode(): Promise<void> {
    Logger.info('\n🛡️ Testing Partial Recovery Mode');
    
    this.fs = createEnterpriseFileSystem(this.disk);
    
    // Authenticate user
    const authResult = await this.fs.authenticateUser({
      username: 'admin',
      password: 'admin123'
    });
    
    if (!authResult.success) {
      throw new Error('Authentication failed for partial recovery test');
    }
    
    const sessionToken = authResult.sessionToken!;
    
    // Write a large test file (multiple chunks)
    const largeContent = Buffer.alloc(8192, 'A'); // 8KB file (2 chunks)
    const writeResult = await this.fs.writeFile(sessionToken, 'partial-recovery-test.txt', largeContent, 'admin');
    
    if (!writeResult.success) {
      throw new Error('File write failed for partial recovery test');
    }
    
    // Simulate corruption by corrupting some disk data
    await this.simulateCorruption();
    
    // Read file with partial recovery enabled
    const readOptions: ReadOptions = {
      allowPartialRecovery: true,
      fillCorruptedChunks: 'zeros',
      minimumRecoveryRate: 50 // At least 50% recovery
    };
    
    const readResult = await this.fs.readFile(sessionToken, writeResult.data!, readOptions);
    
    if (readResult.success) {
      Logger.success('✅ Partial recovery successful');
      
      if (readResult.corruptionReport) {
        Logger.info(`📊 Recovery Report:`);
        Logger.info(`   Total Chunks: ${readResult.corruptionReport.totalChunks}`);
        Logger.info(`   Recovered Chunks: ${readResult.corruptionReport.recoveredChunks}`);
        Logger.info(`   Corrupted Chunks: ${readResult.corruptionReport.corruptedChunks}`);
        Logger.info(`   Recovery Rate: ${readResult.corruptionReport.recoveryRate.toFixed(1)}%`);
        
        if (readResult.corruptionReport.corruptedChunks > 0) {
          Logger.success('✅ Partial corruption detected and handled gracefully');
        } else {
          Logger.success('✅ No corruption detected');
        }
      }
    } else {
      Logger.warning(`⚠️ Partial recovery failed: ${readResult.error}`);
      if (readResult.corruptionReport) {
        Logger.info(`📊 Recovery Report: ${readResult.corruptionReport.recoveryRate.toFixed(1)}% recovery rate`);
      }
    }
  }

  private async testRecoveryRateThresholds(): Promise<void> {
    Logger.info('\n📊 Testing Recovery Rate Thresholds');
    
    this.fs = createEnterpriseFileSystem(this.disk);
    
    // Authenticate user
    const authResult = await this.fs.authenticateUser({
      username: 'admin',
      password: 'admin123'
    });
    
    if (!authResult.success) {
      throw new Error('Authentication failed for threshold test');
    }
    
    const sessionToken = authResult.sessionToken!;
    
    // Write a test file
    const content = Buffer.alloc(4096, 'B'); // 4KB file
    const writeResult = await this.fs.writeFile(sessionToken, 'threshold-test.txt', content, 'admin');
    
    if (!writeResult.success) {
      throw new Error('File write failed for threshold test');
    }
    
    // Simulate heavy corruption
    await this.simulateHeavyCorruption();
    
    // Test with high threshold (90%) - should fail
    const highThresholdOptions: ReadOptions = {
      allowPartialRecovery: true,
      fillCorruptedChunks: 'zeros',
      minimumRecoveryRate: 90
    };
    
    const highThresholdResult = await this.fs.readFile(sessionToken, writeResult.data!, highThresholdOptions);
    
    if (!highThresholdResult.success) {
      Logger.success('✅ High threshold correctly rejected low recovery rate');
      if (highThresholdResult.corruptionReport) {
        Logger.info(`📊 Recovery rate was ${highThresholdResult.corruptionReport.recoveryRate.toFixed(1)}% (below 90% threshold)`);
      }
    } else {
      throw new Error('High threshold should have failed');
    }
    
    // Test with low threshold (10%) - should succeed
    const lowThresholdOptions: ReadOptions = {
      allowPartialRecovery: true,
      fillCorruptedChunks: 'zeros',
      minimumRecoveryRate: 10
    };
    
    const lowThresholdResult = await this.fs.readFile(sessionToken, writeResult.data!, lowThresholdOptions);
    
    if (lowThresholdResult.success) {
      Logger.success('✅ Low threshold correctly allowed partial recovery');
      if (lowThresholdResult.corruptionReport) {
        Logger.info(`📊 Recovery rate was ${lowThresholdResult.corruptionReport.recoveryRate.toFixed(1)}% (above 10% threshold)`);
      }
    } else {
      throw new Error('Low threshold should have succeeded');
    }
  }

  private async testDifferentFillPatterns(): Promise<void> {
    Logger.info('\n🎨 Testing Different Fill Patterns');
    
    this.fs = createEnterpriseFileSystem(this.disk);
    
    // Authenticate user
    const authResult = await this.fs.authenticateUser({
      username: 'admin',
      password: 'admin123'
    });
    
    if (!authResult.success) {
      throw new Error('Authentication failed for fill pattern test');
    }
    
    const sessionToken = authResult.sessionToken!;
    
    // Write a test file
    const content = Buffer.alloc(2048, 'C'); // 2KB file
    const writeResult = await this.fs.writeFile(sessionToken, 'pattern-test.txt', content, 'admin');
    
    if (!writeResult.success) {
      throw new Error('File write failed for pattern test');
    }
    
    // Simulate corruption
    await this.simulateCorruption();
    
    // Test with zeros pattern
    const zerosOptions: ReadOptions = {
      allowPartialRecovery: true,
      fillCorruptedChunks: 'zeros',
      minimumRecoveryRate: 0
    };
    
    const zerosResult = await this.fs.readFile(sessionToken, writeResult.data!, zerosOptions);
    
    if (zerosResult.success) {
      Logger.success('✅ Zeros pattern test successful');
      // Check if corrupted parts are filled with zeros
      const hasZeros = zerosResult.data!.some((byte: number) => byte === 0);
      if (hasZeros) {
        Logger.success('✅ Corrupted chunks filled with zeros');
      }
    }
    
    // Test with pattern fill
    const patternOptions: ReadOptions = {
      allowPartialRecovery: true,
      fillCorruptedChunks: 'pattern',
      minimumRecoveryRate: 0
    };
    
    const patternResult = await this.fs.readFile(sessionToken, writeResult.data!, patternOptions);
    
    if (patternResult.success) {
      Logger.success('✅ Pattern fill test successful');
      // Check if corrupted parts are filled with pattern (0xDEADBEEF)
      const hasPattern = patternResult.data!.some((byte: number) => byte === 0xEF);
      if (hasPattern) {
        Logger.success('✅ Corrupted chunks filled with pattern');
      }
    }
  }

  private async simulateCorruption(): Promise<void> {
    Logger.info('🔧 Simulating corruption...');
    
    // Corrupt some random bytes in the disk
    const diskSize = this.disk.size();
    const corruptionCount = Math.floor(diskSize * 0.01); // Corrupt 1% of disk
    
    for (let i = 0; i < corruptionCount; i++) {
      const offset = Math.floor(Math.random() * diskSize);
      const corruptedByte = Math.floor(Math.random() * 256);
      
      try {
        const currentData = await this.disk.read(offset, 1);
        if (currentData) {
          // Corrupt the byte
          const corruptedData = Buffer.from([corruptedByte]);
          await this.disk.write(offset, corruptedData);
        }
      } catch (error) {
        // Ignore read/write errors during corruption simulation
      }
    }
    
    Logger.info(`🔧 Corrupted ${corruptionCount} bytes`);
  }

  private async simulateHeavyCorruption(): Promise<void> {
    Logger.info('🔧 Simulating heavy corruption...');
    
    // Corrupt more bytes for heavy corruption test
    const diskSize = this.disk.size();
    const corruptionCount = Math.floor(diskSize * 0.05); // Corrupt 5% of disk
    
    for (let i = 0; i < corruptionCount; i++) {
      const offset = Math.floor(Math.random() * diskSize);
      const corruptedByte = Math.floor(Math.random() * 256);
      
      try {
        const currentData = await this.disk.read(offset, 1);
        if (currentData) {
          // Corrupt the byte
          const corruptedData = Buffer.from([corruptedByte]);
          await this.disk.write(offset, corruptedData);
        }
      } catch (error) {
        // Ignore read/write errors during corruption simulation
      }
    }
    
    Logger.info(`🔧 Heavily corrupted ${corruptionCount} bytes`);
  }
}

// Run the tests
async function main() {
  const harness = new PartialRecoveryTestHarness();
  await harness.runAllTests();
}

if (require.main === module) {
  main().catch(console.error);
}
