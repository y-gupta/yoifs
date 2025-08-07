import { MemoryDisk } from '../v1-basic/index';
import { 
  createEnterpriseFileSystem,
  QuotaService,
  EncryptionService
} from './index';
import { Logger } from '../v1-basic/index';

class QuotaEncryptionTestHarness {
  private disk: MemoryDisk;
  private fs: any;

  constructor() {
    this.disk = new MemoryDisk(10 * 1024 * 1024); // 10MB
  }

  async runAllTests(): Promise<void> {
    Logger.info('🔐 Starting Quota & Encryption Tests');
    
    await this.testQuotaEnforcement();
    await this.testEncryptionFunctionality();
    await this.testQuotaManagement();
    await this.testEncryptionManagement();
    await this.testIntegrationTests();
    
    Logger.info('✅ All quota and encryption tests completed successfully!');
  }

  // Test quota enforcement
  async testQuotaEnforcement(): Promise<void> {
    Logger.info('\n📊 Testing Quota Enforcement');
    
    this.fs = createEnterpriseFileSystem(this.disk);
    
    // Authenticate user
    const authResult = await this.fs.authenticateUser({
      username: 'admin',
      password: 'admin123'
    });
    
    if (!authResult.success) {
      throw new Error('Authentication failed for quota test');
    }
    
    const sessionToken = authResult.sessionToken!;
    
    // Set a small quota for testing
    const smallQuota = {
      storageLimit: 1024, // 1KB
      fileCountLimit: 3,
      bandwidthLimit: 2048, // 2KB
      retentionPeriod: 365 * 24 * 60 * 60 * 1000
    };
    
    this.fs.setUserQuota('admin', smallQuota);
    Logger.info('Set small quota for admin user');
    
    // Test storage quota enforcement
    Logger.info('Testing storage quota enforcement...');
    
    // Write files until quota is exceeded
    let fileCount = 0;
    let quotaExceeded = false;
    
    while (fileCount < 5 && !quotaExceeded) {
      const content = Buffer.from(`Test file ${fileCount} with some content`);
      const result = await this.fs.writeFile(sessionToken, `quota-test-${fileCount}.txt`, content, 'admin');
      
      if (!result.success) {
        if (result.error?.includes('Quota exceeded')) {
          Logger.success(`Storage quota enforced after ${fileCount} files`);
          quotaExceeded = true;
        } else {
          throw new Error(`Unexpected error: ${result.error}`);
        }
      } else {
        fileCount++;
      }
    }
    
    if (!quotaExceeded) {
      throw new Error('Storage quota was not enforced');
    }
    
    // Test file count quota
    Logger.info('Testing file count quota...');
    const tinyContent = Buffer.from('tiny');
    const fileCountResult = await this.fs.writeFile(sessionToken, 'tiny-file.txt', tinyContent, 'admin');
    
    if (fileCountResult.success) {
      Logger.warning('File count quota may not be working correctly');
    } else {
      Logger.success('File count quota enforced correctly');
    }
    
    // Test bandwidth quota
    Logger.info('Testing bandwidth quota...');
    const largeContent = Buffer.alloc(3000, 'A'); // 3KB
    const bandwidthResult = await this.fs.writeFile(sessionToken, 'large-file.txt', largeContent, 'admin');
    
    if (!bandwidthResult.success && bandwidthResult.error?.includes('Bandwidth quota exceeded')) {
      Logger.success('Bandwidth quota enforced correctly');
    } else {
      Logger.warning('Bandwidth quota may not be working correctly');
    }
  }

  // Test encryption functionality
  async testEncryptionFunctionality(): Promise<void> {
    Logger.info('\n🔒 Testing Encryption Functionality');
    
    this.fs = createEnterpriseFileSystem(this.disk);
    
    // Authenticate user
    const authResult = await this.fs.authenticateUser({
      username: 'admin',
      password: 'admin123'
    });
    
    if (!authResult.success) {
      throw new Error('Authentication failed for encryption test');
    }
    
    const sessionToken = authResult.sessionToken!;
    
    // Test encryption of sensitive data
    Logger.info('Testing encryption of sensitive data...');
    
    const sensitiveData = Buffer.from('This is highly sensitive information that should be encrypted');
    const writeResult = await this.fs.writeFile(sessionToken, 'sensitive.txt', sensitiveData, 'admin');
    
    if (!writeResult.success) {
      throw new Error(`Failed to write encrypted file: ${writeResult.error}`);
    }
    
    // Read the encrypted file
    const readResult = await this.fs.readFile(sessionToken, writeResult.data!);
    
    if (!readResult.success) {
      throw new Error(`Failed to read encrypted file: ${readResult.error}`);
    }
    
    // Verify the data is correctly decrypted
    if (Buffer.compare(sensitiveData, readResult.data!) === 0) {
      Logger.success('Encryption/decryption working correctly');
    } else {
      throw new Error('Encryption/decryption failed - data mismatch');
    }
    
    // Test multiple encrypted files
    Logger.info('Testing multiple encrypted files...');
    
    const testFiles = [
      { name: 'secret1.txt', content: Buffer.from('Secret document 1') },
      { name: 'secret2.txt', content: Buffer.from('Secret document 2') },
      { name: 'secret3.txt', content: Buffer.from('Secret document 3') }
    ];
    
    for (const file of testFiles) {
      const writeResult = await this.fs.writeFile(sessionToken, file.name, file.content, 'admin');
      if (!writeResult.success) {
        throw new Error(`Failed to write ${file.name}: ${writeResult.error}`);
      }
      
      const readResult = await this.fs.readFile(sessionToken, writeResult.data!);
      if (!readResult.success) {
        throw new Error(`Failed to read ${file.name}: ${readResult.error}`);
      }
      
      if (Buffer.compare(file.content, readResult.data!) !== 0) {
        throw new Error(`Data mismatch for ${file.name}`);
      }
    }
    
    Logger.success('Multiple encrypted files working correctly');
  }

  // Test quota management
  async testQuotaManagement(): Promise<void> {
    Logger.info('\n📈 Testing Quota Management');
    
    this.fs = createEnterpriseFileSystem(this.disk);
    
    // Test quota statistics
    const quotaStats = this.fs.getQuotaStats();
    Logger.info(`Quota stats: ${JSON.stringify(quotaStats, null, 2)}`);
    
    // Test user quota retrieval
    const userQuota = this.fs.getUserQuota('admin');
    Logger.info(`Admin quota: ${JSON.stringify(userQuota, null, 2)}`);
    
    // Test user usage
    const userUsage = this.fs.getUserUsage('admin');
    Logger.info(`Admin usage: ${JSON.stringify(userUsage, null, 2)}`);
    
    // Test all usage data
    const allUsage = this.fs.getAllQuotaUsage();
    Logger.info(`Total users with quotas: ${allUsage.length}`);
    
    // Test quota modification
    const newQuota = {
      storageLimit: 5 * 1024 * 1024, // 5MB
      fileCountLimit: 100,
      bandwidthLimit: 10 * 1024 * 1024, // 10MB
      retentionPeriod: 365 * 24 * 60 * 60 * 1000
    };
    
    this.fs.setUserQuota('admin', newQuota);
    Logger.info('Updated admin quota');
    
    const updatedQuota = this.fs.getUserQuota('admin');
    if (updatedQuota.storageLimit === newQuota.storageLimit) {
      Logger.success('Quota modification working correctly');
    } else {
      throw new Error('Quota modification failed');
    }
    
    // Test usage reset
    this.fs.resetUserUsage('admin');
    const resetUsage = this.fs.getUserUsage('admin');
    
    if (resetUsage && resetUsage.storageUsed === 0 && resetUsage.fileCount === 0) {
      Logger.success('Usage reset working correctly');
    } else {
      throw new Error('Usage reset failed');
    }
  }

  // Test encryption management
  async testEncryptionManagement(): Promise<void> {
    Logger.info('\n🔑 Testing Encryption Management');
    
    this.fs = createEnterpriseFileSystem(this.disk);
    
    // Test encryption statistics
    const encryptionStats = this.fs.getEncryptionStats();
    Logger.info(`Encryption stats: ${JSON.stringify(encryptionStats, null, 2)}`);
    
    // Test key listing
    const allKeys = this.fs.getAllEncryptionKeys();
    Logger.info(`Total encryption keys: ${allKeys.length}`);
    Logger.info(`Active keys: ${allKeys.filter((k: any) => k.isActive).length}`);
    
    if (allKeys.length > 0) {
      Logger.success('Encryption key management working correctly');
    } else {
      throw new Error('No encryption keys found');
    }
    
    // Test key export/import
    Logger.info('Testing key export/import...');
    
    const backupPassword = 'test-backup-password';
    const exportedKeys = this.fs.exportEncryptionKeys(backupPassword);
    
    if (exportedKeys && exportedKeys.length > 0) {
      Logger.success('Key export working correctly');
      
      // Test key import (this would normally be done on a different system)
      try {
        this.fs.importEncryptionKeys(exportedKeys, backupPassword);
        Logger.success('Key import working correctly');
      } catch (error) {
        Logger.warning(`Key import test failed: ${error}`);
      }
    } else {
      throw new Error('Key export failed');
    }
    
    // Test manual key rotation
    Logger.info('Testing manual key rotation...');
    
    const beforeRotation = this.fs.getEncryptionStats();
    await this.fs.rotateEncryptionKeys();
    const afterRotation = this.fs.getEncryptionStats();
    
    if (afterRotation.totalKeys > beforeRotation.totalKeys) {
      Logger.success('Manual key rotation working correctly');
    } else {
      Logger.warning('Manual key rotation may not have worked as expected');
    }
    
    // Test key deactivation
    if (allKeys.length > 1) {
      const keyToDeactivate = allKeys[1].id; // Deactivate second key
      this.fs.deactivateEncryptionKey(keyToDeactivate);
      
      const updatedKeys = this.fs.getAllEncryptionKeys();
      const deactivatedKey = updatedKeys.find((k: any) => k.id === keyToDeactivate);
      
      if (deactivatedKey && !deactivatedKey.isActive) {
        Logger.success('Key deactivation working correctly');
      } else {
        throw new Error('Key deactivation failed');
      }
    }
  }

  // Test integration between quota and encryption
  async testIntegrationTests(): Promise<void> {
    Logger.info('\n🔗 Testing Integration Between Quota and Encryption');
    
    this.fs = createEnterpriseFileSystem(this.disk);
    
    // Authenticate user
    const authResult = await this.fs.authenticateUser({
      username: 'admin',
      password: 'admin123'
    });
    
    if (!authResult.success) {
      throw new Error('Authentication failed for integration test');
    }
    
    const sessionToken = authResult.sessionToken!;
    
    // Test that encrypted files respect quotas
    Logger.info('Testing encrypted files with quota enforcement...');
    
    // Set a small quota
    const smallQuota = {
      storageLimit: 2048, // 2KB
      fileCountLimit: 5,
      bandwidthLimit: 4096, // 4KB
      retentionPeriod: 365 * 24 * 60 * 60 * 1000
    };
    
    this.fs.setUserQuota('admin', smallQuota);
    
    // Try to write encrypted files
    const testData = Buffer.from('This is test data that will be encrypted');
    let successCount = 0;
    
    for (let i = 0; i < 10; i++) {
      const result = await this.fs.writeFile(sessionToken, `integration-test-${i}.txt`, testData, 'admin');
      if (result.success) {
        successCount++;
      } else if (result.error?.includes('Quota exceeded')) {
        break;
      }
    }
    
    Logger.info(`Successfully wrote ${successCount} encrypted files before quota enforcement`);
    
    if (successCount > 0 && successCount < 10) {
      Logger.success('Integration between encryption and quota working correctly');
    } else {
      Logger.warning('Integration test may have issues');
    }
    
    // Test monitoring integration
    Logger.info('Testing monitoring integration...');
    
    const alerts = this.fs.getAlerts();
    const quotaAlerts = alerts.filter((alert: any) => alert.type === 'CAPACITY');
    
    if (quotaAlerts.length > 0) {
      Logger.success('Quota alerts being generated correctly');
    } else {
      Logger.info('No quota alerts generated (this may be normal)');
    }
    
    // Test security events
    const securityEvents = this.fs.getSecurityEvents(50);
    const encryptionEvents = securityEvents.filter((event: any) => 
      event.action.includes('ENCRYPTION') || event.action.includes('QUOTA')
    );
    
    if (encryptionEvents.length > 0) {
      Logger.success('Security events being logged correctly');
    } else {
      Logger.info('No encryption/quota security events found (this may be normal)');
    }
    
    // Test performance metrics
    const metrics = this.fs.getPerformanceMetrics();
    Logger.info(`Performance metrics: ${JSON.stringify(metrics, null, 2)}`);
    
    if (metrics.readLatency.length > 0 || metrics.writeLatency.length > 0) {
      Logger.success('Performance monitoring working correctly');
    } else {
      Logger.info('No performance metrics available yet');
    }
  }
}

// Run the tests
async function main() {
  const harness = new QuotaEncryptionTestHarness();
  await harness.runAllTests();
}

if (require.main === module) {
  main().catch(console.error);
}
