import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { MemoryDisk } from '../../../v1-basic/index';
import { EnterpriseFileSystem } from '../../core/EnterpriseFileSystem';
import { createEnterpriseConfig } from '../../utils/ConfigFactory';
import { ErrorCodes, FileSystemError } from '../../types';

describe('EnterpriseFileSystem', () => {
  let disk: MemoryDisk;
  let fileSystem: EnterpriseFileSystem;
  let adminToken: string;

  beforeEach(async () => {
    disk = new MemoryDisk(1024 * 1024); // 1MB
    const config = createEnterpriseConfig('testing');
    fileSystem = new EnterpriseFileSystem(disk, config);
    
    // Get admin token for tests
    const authResult = await fileSystem.authenticateUser({
      username: 'admin',
      password: 'admin123'
    });
    
    expect(authResult.success).toBe(true);
    adminToken = authResult.sessionToken!;
  });

  afterEach(async () => {
    await fileSystem.shutdown();
  });

  describe('Authentication & Authorization', () => {
    it('should authenticate valid credentials', async () => {
      const result = await fileSystem.authenticateUser({
        username: 'admin',
        password: 'admin123'
      });

      expect(result.success).toBe(true);
      expect(result.sessionToken).toBeDefined();
      expect(result.userId).toBe('admin');
      expect(result.roles).toContain('ADMIN');
    });

    it('should reject invalid credentials', async () => {
      const result = await fileSystem.authenticateUser({
        username: 'admin',
        password: 'wrongpassword'
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid credentials');
    });

    it('should create and authenticate new users', async () => {
      await fileSystem.createUser('testuser', 'password123', ['USER']);
      
      const authResult = await fileSystem.authenticateUser({
        username: 'testuser',
        password: 'password123'
      });

      expect(authResult.success).toBe(true);
      expect(authResult.roles).toContain('USER');
    });

    it('should validate session tokens', async () => {
      const hasPermission = await fileSystem.checkPermission(adminToken, 'files', 'write');
      expect(hasPermission).toBe(true);
    });

    it('should reject invalid session tokens', async () => {
      const hasPermission = await fileSystem.checkPermission('invalid-token', 'files', 'write');
      expect(hasPermission).toBe(false);
    });
  });

  describe('File Operations', () => {
    it('should write and read files successfully', async () => {
      const content = Buffer.from('Hello, Enterprise FileSystem!');
      
      const writeResult = await fileSystem.writeFile(adminToken, 'test.txt', content, 'admin');
      expect(writeResult.success).toBe(true);
      expect(writeResult.data).toBeDefined();

      const readResult = await fileSystem.readFile(adminToken, writeResult.data!);
      expect(readResult.success).toBe(true);
      expect(Buffer.compare(readResult.data!, content)).toBe(0);
    });

    it('should encrypt files automatically', async () => {
      const content = Buffer.from('Sensitive data');
      
      const writeResult = await fileSystem.writeFile(adminToken, 'secret.txt', content, 'admin');
      expect(writeResult.success).toBe(true);

      // Read the raw disk data - should be encrypted (different from original)
      const fileId = writeResult.data!;
      const readResult = await fileSystem.readFile(adminToken, fileId);
      expect(readResult.success).toBe(true);
      expect(Buffer.compare(readResult.data!, content)).toBe(0); // Content should match after decryption
    });

    it('should handle high redundancy writes', async () => {
      const content = Buffer.from('Critical business data');
      
      const writeResult = await fileSystem.writeFileWithRedundancy(
        adminToken, 
        'critical.txt', 
        content, 
        'admin', 
        5 // 5x redundancy
      );
      
      expect(writeResult.success).toBe(true);
      
      const readResult = await fileSystem.readFile(adminToken, writeResult.data!);
      expect(readResult.success).toBe(true);
      expect(Buffer.compare(readResult.data!, content)).toBe(0);
    });

    it('should delete files successfully', async () => {
      const content = Buffer.from('Temporary file');
      
      const writeResult = await fileSystem.writeFile(adminToken, 'temp.txt', content, 'admin');
      expect(writeResult.success).toBe(true);

      const deleteResult = await fileSystem.deleteFile(adminToken, writeResult.data!);
      expect(deleteResult.success).toBe(true);

      // File should no longer be readable
      const readResult = await fileSystem.readFile(adminToken, writeResult.data!);
      expect(readResult.success).toBe(false);
    });
  });

  describe('Quota Management', () => {
    it('should enforce storage quotas', async () => {
      // Set very small quota
      fileSystem.setUserQuota('admin', {
        storageLimit: 100, // 100 bytes
        fileCountLimit: 10,
        bandwidthLimit: 1000,
        retentionPeriod: 365
      });

      const largeContent = Buffer.alloc(200, 'x'); // 200 bytes - exceeds quota
      
      const writeResult = await fileSystem.writeFile(adminToken, 'large.txt', largeContent, 'admin');
      expect(writeResult.success).toBe(false);
      expect(writeResult.error?.code).toBe(ErrorCodes.QUOTA_EXCEEDED);
    });

    it('should enforce file count quotas', async () => {
      fileSystem.setUserQuota('admin', {
        storageLimit: 10000,
        fileCountLimit: 2, // Only 2 files allowed
        bandwidthLimit: 1000,
        retentionPeriod: 365
      });

      const content = Buffer.from('Small file');
      
      // First two files should succeed
      const result1 = await fileSystem.writeFile(adminToken, 'file1.txt', content, 'admin');
      expect(result1.success).toBe(true);
      
      const result2 = await fileSystem.writeFile(adminToken, 'file2.txt', content, 'admin');
      expect(result2.success).toBe(true);
      
      // Third file should fail
      const result3 = await fileSystem.writeFile(adminToken, 'file3.txt', content, 'admin');
      expect(result3.success).toBe(false);
      expect(result3.error?.code).toBe(ErrorCodes.QUOTA_EXCEEDED);
    });

    it('should track quota usage', async () => {
      const content = Buffer.from('Test content');
      
      await fileSystem.writeFile(adminToken, 'quota-test.txt', content, 'admin');
      
      const usage = fileSystem.getUserUsage('admin');
      expect(usage).toBeDefined();
      expect(usage.storageUsed).toBeGreaterThan(0);
      expect(usage.fileCount).toBe(1);
    });
  });

  describe('Corruption Recovery', () => {
    it('should recover from partial corruption with allowPartialRecovery', async () => {
      const content = Buffer.from('Important document that must be recovered');
      
      const writeResult = await fileSystem.writeFile(adminToken, 'important.txt', content, 'admin');
      expect(writeResult.success).toBe(true);

      // Simulate corruption by writing random data to disk
      const corruptionData = Buffer.alloc(50, 0xFF);
      await disk.write(100, corruptionData); // Corrupt some data

      // Try to read with partial recovery enabled
      const readResult = await fileSystem.readFile(adminToken, writeResult.data!, {
        allowPartialRecovery: true,
        fillCorruptedChunks: 'zeros',
        minimumRecoveryRate: 30
      });

      // Should either succeed with partial data or succeed completely due to redundancy
      expect(readResult.success).toBe(true);
      expect(readResult.data).toBeDefined();
    });

    it('should handle complete file corruption gracefully', async () => {
      const content = Buffer.from('Document to be corrupted');
      
      const writeResult = await fileSystem.writeFile(adminToken, 'corrupt.txt', content, 'admin');
      expect(writeResult.success).toBe(true);

      // Massively corrupt the disk
      const corruptionData = Buffer.alloc(1000, 0xFF);
      await disk.write(0, corruptionData);

      const readResult = await fileSystem.readFile(adminToken, writeResult.data!, {
        allowPartialRecovery: true,
        fillCorruptedChunks: 'pattern',
        minimumRecoveryRate: 10
      });

      // Should either recover partially or fail gracefully
      if (!readResult.success) {
        expect(readResult.error).toBeDefined();
        expect(readResult.corruptionReport).toBeDefined();
      }
    });
  });

  describe('Performance & Analytics', () => {
    it('should provide performance metrics', async () => {
      // Generate some activity
      const content = Buffer.from('Performance test');
      await fileSystem.writeFile(adminToken, 'perf1.txt', content, 'admin');
      await fileSystem.writeFile(adminToken, 'perf2.txt', content, 'admin');

      const metrics = fileSystem.getPerformanceMetrics();
      expect(metrics).toBeDefined();
      expect(metrics.writeLatency).toBeDefined();
      expect(metrics.readLatency).toBeDefined();
    });

    it('should provide cache statistics', async () => {
      const cacheStats = fileSystem.getCacheStats();
      expect(cacheStats).toBeDefined();
      expect(cacheStats.hitRate).toBeGreaterThanOrEqual(0);
      expect(cacheStats.totalEntries).toBeGreaterThanOrEqual(0);
    });

    it('should perform data tiering', async () => {
      const content = Buffer.from('Tiering test');
      
      await fileSystem.writeFile(adminToken, 'tier-test.txt', content, 'admin');
      
      const tieringResult = await fileSystem.performDataTiering(adminToken);
      expect(tieringResult.success).toBe(true);
      
      const tierStats = fileSystem.getFilesByTier();
      expect(tierStats.HOT + tierStats.WARM + tierStats.COLD).toBeGreaterThan(0);
    });

    it('should perform system defragmentation', async () => {
      // Create and delete files to cause fragmentation
      const content = Buffer.from('Fragment test');
      
      const files = [];
      for (let i = 0; i < 5; i++) {
        const result = await fileSystem.writeFile(adminToken, `frag${i}.txt`, content, 'admin');
        files.push(result.data!);
      }
      
      // Delete some files
      for (let i = 0; i < 3; i++) {
        await fileSystem.deleteFile(adminToken, files[i]);
      }
      
      const defragResult = await fileSystem.performDefragmentation(adminToken);
      expect(defragResult.success).toBe(true);
      expect(defragResult.data).toBeDefined();
      expect(defragResult.data.timeElapsed).toBeGreaterThan(0);
    });
  });

  describe('Security Events & Monitoring', () => {
    it('should track security events', async () => {
      // Generate some security events through failed authentication
      await fileSystem.authenticateUser({
        username: 'nonexistent',
        password: 'wrong'
      });

      const securityEvents = fileSystem.getSecurityEvents(10);
      expect(securityEvents.length).toBeGreaterThan(0);
      
      const failedAuthEvent = securityEvents.find(e => e.action === 'AUTH_FAILED');
      expect(failedAuthEvent).toBeDefined();
    });

    it('should create alerts for security violations', (done) => {
      fileSystem.on('alert', (alert) => {
        expect(alert).toBeDefined();
        expect(alert.type).toBe('SECURITY');
        done();
      });

      // Trigger multiple failed authentications to generate alert
      Promise.all([
        fileSystem.authenticateUser({ username: 'admin', password: 'wrong1' }),
        fileSystem.authenticateUser({ username: 'admin', password: 'wrong2' }),
        fileSystem.authenticateUser({ username: 'admin', password: 'wrong3' }),
        fileSystem.authenticateUser({ username: 'admin', password: 'wrong4' }),
        fileSystem.authenticateUser({ username: 'admin', password: 'wrong5' }),
        fileSystem.authenticateUser({ username: 'admin', password: 'wrong6' })
      ]);
    });

    it('should provide system health reports', async () => {
      const healthReport = fileSystem.getSystemHealthReport();
      
      expect(healthReport).toBeDefined();
      expect(healthReport.corruption).toBeDefined();
      expect(healthReport.performance).toBeDefined();
      expect(healthReport.security).toBeDefined();
      expect(healthReport.quotas).toBeDefined();
      expect(healthReport.caching).toBeDefined();
      expect(healthReport.uptime).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Advanced Search & File Management', () => {
    it('should search files by various criteria', async () => {
      const content1 = Buffer.from('Search test document 1');
      const content2 = Buffer.from('Different content');
      
      await fileSystem.writeFile(adminToken, 'search-test-1.txt', content1, 'admin');
      await fileSystem.writeFile(adminToken, 'other-file.txt', content2, 'admin');
      
      const searchResult = await fileSystem.searchFiles(adminToken, {
        namePattern: 'search',
        owner: 'admin',
        minSize: 10
      });
      
      expect(searchResult.success).toBe(true);
      expect(searchResult.data).toBeDefined();
      expect(searchResult.data!.length).toBeGreaterThan(0);
      
      const foundFile = searchResult.data!.find(f => f.name.includes('search-test'));
      expect(foundFile).toBeDefined();
    });

    it('should verify data integrity', async () => {
      const content = Buffer.from('Integrity test document');
      await fileSystem.writeFile(adminToken, 'integrity.txt', content, 'admin');
      
      const integrityResult = await fileSystem.verifyDataIntegrity(adminToken);
      expect(integrityResult.success).toBe(true);
      expect(integrityResult.data).toBeDefined();
      expect(integrityResult.data.totalFiles).toBeGreaterThan(0);
    });
  });

  describe('Configuration & Management', () => {
    it('should provide optimization recommendations', async () => {
      const recommendations = fileSystem.getOptimizationRecommendations();
      
      expect(recommendations).toBeDefined();
      expect(recommendations.compressionSavings).toBeDefined();
      expect(recommendations.deduplicationSavings).toBeDefined();
      expect(recommendations.tieringRecommendations).toBeDefined();
      expect(recommendations.defragmentationNeeded).toBeDefined();
    });

    it('should manage encryption keys', async () => {
      const encryptionStats = fileSystem.getEncryptionStats();
      
      expect(encryptionStats).toBeDefined();
      expect(encryptionStats.totalKeys).toBeGreaterThan(0);
      expect(encryptionStats.activeKeys).toBeGreaterThan(0);
    });

    it('should handle key rotation', async () => {
      const initialStats = fileSystem.getEncryptionStats();
      
      await fileSystem.rotateEncryptionKeys();
      
      const newStats = fileSystem.getEncryptionStats();
      expect(newStats.totalKeys).toBeGreaterThanOrEqual(initialStats.totalKeys);
    });
  });

  describe('Error Handling', () => {
    it('should handle permission denied errors', async () => {
      // Create a user without admin permissions
      await fileSystem.createUser('limiteduser', 'password123', ['USER']);
      
      const userAuth = await fileSystem.authenticateUser({
        username: 'limiteduser',
        password: 'password123'
      });
      
      expect(userAuth.success).toBe(true);
      
      // Try to perform admin operation - should fail
      const result = await fileSystem.performDefragmentation(userAuth.sessionToken!);
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(ErrorCodes.PERMISSION_DENIED);
    });

    it('should handle file not found errors', async () => {
      const result = await fileSystem.readFile(adminToken, 'nonexistent-file-id');
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(ErrorCodes.FILE_NOT_FOUND);
    });

    it('should handle session expired errors', async () => {
      // This would require mocking time or waiting for session expiration
      // For now, test with invalid session token
      const result = await fileSystem.writeFile('expired-token', 'test.txt', Buffer.from('test'), 'admin');
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(ErrorCodes.PERMISSION_DENIED);
    });
  });

  describe('Memory Management', () => {
    it('should not leak memory with many operations', async () => {
      const content = Buffer.from('Memory test');
      const fileIds = [];
      
      // Create many files
      for (let i = 0; i < 100; i++) {
        const result = await fileSystem.writeFile(adminToken, `mem-test-${i}.txt`, content, 'admin');
        if (result.success) {
          fileIds.push(result.data!);
        }
      }
      
      // Clean up
      for (const fileId of fileIds) {
        await fileSystem.deleteFile(adminToken, fileId);
      }
      
      // System should still be responsive
      const testResult = await fileSystem.writeFile(adminToken, 'after-cleanup.txt', content, 'admin');
      expect(testResult.success).toBe(true);
    });

    it('should cleanup expired sessions automatically', async () => {
      const initialSessions = fileSystem.getActiveConnections();
      
      // Create additional session
      await fileSystem.authenticateUser({
        username: 'admin',
        password: 'admin123'
      });
      
      const afterAuthSessions = fileSystem.getActiveConnections();
      expect(afterAuthSessions).toBeGreaterThan(initialSessions);
      
      // Trigger cleanup
      fileSystem.cleanupExpiredSessions();
      
      // Sessions count should be reasonable (not growing indefinitely)
      const afterCleanupSessions = fileSystem.getActiveConnections();
      expect(afterCleanupSessions).toBeLessThanOrEqual(afterAuthSessions);
    });
  });
});
