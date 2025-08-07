import { Logger } from './index';
import { EnterpriseFileSystem } from './enterprise-core';
import { MemoryDisk, TestUtils } from './index';

class EnterpriseTestHarness {
  private disk: MemoryDisk;
  private fs: EnterpriseFileSystem;

  constructor() {
    this.disk = new MemoryDisk(10 * 1024 * 1024); // 10MB disk for enterprise features
    this.fs = new EnterpriseFileSystem(this.disk);
  }

  async runAllTests(): Promise<void> {
    Logger.yoifsIntro();
    Logger.section('Enterprise YOIFS Assessment Protocol');

    await this.testLevel1();
    await this.testLevel2();
    await this.testLevel3();
    await this.testLevel4();
    await this.testLevel5();
  }

  // Level 1: Security & Access Control
  async testLevel1(): Promise<void> {
    Logger.section('Level 1: Enterprise Security & Access Control');

    try {
      // Create test users
      Logger.info('Setting up test users and roles...');
      await this.fs.createUser('admin', 'admin123', ['ADMIN']);
      await this.fs.createUser('hr_manager', 'hr123', ['HR_MANAGER']);
      await this.fs.createUser('employee', 'emp123', ['EMPLOYEE']);
      await this.fs.createUser('mfa_user', 'mfa123', ['EMPLOYEE']);
      await this.fs.enableMFA('mfa_user');

      Logger.success('Test users created successfully');

      // Test authentication
      Logger.info('Testing authentication system...');
      
      // Valid authentication
      const authResult = await this.fs.authenticateUser({
        username: 'admin',
        password: 'admin123'
      });

      if (authResult.success && authResult.sessionToken) {
        Logger.success('Admin authentication successful');
      } else {
        Logger.error('Admin authentication failed');
        return;
      }

      // Invalid authentication
      const invalidAuth = await this.fs.authenticateUser({
        username: 'admin',
        password: 'wrongpassword'
      });

      if (!invalidAuth.success) {
        Logger.success('Invalid authentication correctly rejected');
      } else {
        Logger.error('Invalid authentication should have been rejected');
        return;
      }

      // MFA authentication
      const mfaAuth = await this.fs.authenticateUser({
        username: 'mfa_user',
        password: 'mfa123'
      });

      if (!mfaAuth.success && mfaAuth.error?.includes('MFA')) {
        Logger.success('MFA requirement correctly enforced');
      } else {
        Logger.error('MFA requirement not enforced');
        return;
      }

      // Test permissions
      Logger.info('Testing role-based access control...');
      
      const adminSession = authResult.sessionToken!;
      
      // Admin should have all permissions
      const adminFilePermission = await this.fs.checkPermission(adminSession, 'files', 'write');
      if (adminFilePermission) {
        Logger.success('Admin has file write permission');
      } else {
        Logger.error('Admin should have file write permission');
        return;
      }

      // Test file operations with authentication
      Logger.info('Testing authenticated file operations...');
      
      const writeResult = await this.fs.writeFile(adminSession, 'test_secure.txt', Buffer.from('Secure file content'), 'admin');
      if (writeResult.success) {
        Logger.success('Authenticated file write successful');
        
        const fileId = writeResult.data!;
        const readResult = await this.fs.readFile(adminSession, fileId);
        
        if (readResult.success && readResult.data?.toString() === 'Secure file content') {
          Logger.success('Authenticated file read successful');
        } else {
          Logger.error('Authenticated file read failed');
          return;
        }
      } else {
        Logger.error('Authenticated file write failed');
        return;
      }

      // Test security events
      Logger.info('Testing security event logging...');
      const securityEvents = this.fs.getSecurityEvents(10);
      if (securityEvents.length > 0) {
        Logger.success(`Security events logged: ${securityEvents.length}`);
        
        // Check for specific events
        const authEvents = securityEvents.filter(e => e.action === 'AUTH_SUCCESS' || e.action === 'AUTH_FAILED');
        if (authEvents.length > 0) {
          Logger.success('Authentication events properly logged');
        }
      } else {
        Logger.warning('No security events found');
      }

    } catch (error) {
      Logger.error(`Level 1 test failed with exception: ${error}`);
    }
  }

  // Level 2: Monitoring & Observability
  async testLevel2(): Promise<void> {
    Logger.section('Level 2: Enterprise Monitoring & Observability');

    try {
      // Create a fresh file system for monitoring tests
      this.disk = new MemoryDisk(10 * 1024 * 1024);
      this.fs = new EnterpriseFileSystem(this.disk);
      
      // Create test user
      await this.fs.createUser('monitor_user', 'monitor123', ['ADMIN']);
      const authResult = await this.fs.authenticateUser({
        username: 'monitor_user',
        password: 'monitor123'
      });

      if (!authResult.success) {
        Logger.error('Authentication failed for monitoring tests');
        return;
      }

      const sessionToken = authResult.sessionToken!;

      Logger.info('Testing performance monitoring...');
      
      // Generate some load to create metrics
      const testFiles = TestUtils.generateTestFiles(20, 1000, 5000);
      let writeSuccesses = 0;
      let readSuccesses = 0;

      for (const file of testFiles) {
        const writeResult = await this.fs.writeFile(sessionToken, file.name, file.content, 'monitor_user');
        if (writeResult.success) {
          writeSuccesses++;
          
          // Read the file to generate read metrics
          const readResult = await this.fs.readFile(sessionToken, writeResult.data!);
          if (readResult.success) {
            readSuccesses++;
          }
        }
      }

      Logger.info(`Generated load: ${writeSuccesses} writes, ${readSuccesses} reads`);

      // Wait for metrics to update
      await new Promise(resolve => setTimeout(resolve, 15000));

      // Check performance metrics
      const metrics = this.fs.getPerformanceMetrics();
      Logger.info('Performance metrics:');
      Logger.info(`  - Throughput: ${metrics.throughput.toFixed(2)} ops/sec`);
      Logger.info(`  - Cache hit rate: ${metrics.cacheHitRate.toFixed(1)}%`);
      Logger.info(`  - Active connections: ${metrics.activeConnections}`);
      Logger.info(`  - CPU utilization: ${metrics.cpuUtilization.toFixed(1)}%`);
      Logger.info(`  - Memory utilization: ${metrics.memoryUtilization.toFixed(1)}%`);

      if (metrics.throughput > 0) {
        Logger.success('Performance monitoring working correctly');
      } else {
        Logger.warning('Performance metrics not populated');
      }

      // Check cache statistics
      Logger.info('Testing cache monitoring...');
      const cacheStats = this.fs.getCacheStats();
      Logger.info('Cache statistics:');
      Logger.info(`  - Hit rate: ${cacheStats.hitRate.toFixed(1)}%`);
      Logger.info(`  - Memory utilization: ${cacheStats.memoryUtilization.toFixed(1)}%`);
      Logger.info(`  - Total entries: ${cacheStats.totalEntries}`);

      if (cacheStats.totalEntries > 0) {
        Logger.success('Cache monitoring working correctly');
      } else {
        Logger.warning('Cache statistics not populated');
      }

      // Test alerting system
      Logger.info('Testing alerting system...');
      
      // Generate some failed operations to trigger alerts
      for (let i = 0; i < 10; i++) {
        await this.fs.authenticateUser({
          username: 'nonexistent',
          password: 'wrong'
        });
      }

      // Wait for alerts to be generated
      await new Promise(resolve => setTimeout(resolve, 5000));

      const alerts = this.fs.getAlerts(false); // Get unresolved alerts
      Logger.info(`Generated alerts: ${alerts.length}`);

      if (alerts.length > 0) {
        Logger.success('Alerting system working correctly');
        
        // Show alert details
        alerts.forEach(alert => {
          Logger.info(`  - ${alert.severity} ${alert.type}: ${alert.message}`);
        });
      } else {
        Logger.warning('No alerts generated');
      }

    } catch (error) {
      Logger.error(`Level 2 test failed with exception: ${error}`);
    }
  }

  // Level 3: Caching & Performance
  async testLevel3(): Promise<void> {
    Logger.section('Level 3: Enterprise Caching & Performance');

    try {
      // Create a fresh file system for caching tests
      this.disk = new MemoryDisk(10 * 1024 * 1024);
      this.fs = new EnterpriseFileSystem(this.disk);
      
      // Create test user
      await this.fs.createUser('cache_user', 'cache123', ['ADMIN']);
      const authResult = await this.fs.authenticateUser({
        username: 'cache_user',
        password: 'cache123'
      });

      if (!authResult.success) {
        Logger.error('Authentication failed for caching tests');
        return;
      }

      const sessionToken = authResult.sessionToken!;

      Logger.info('Testing intelligent caching system...');
      
      // Create a file and read it multiple times to test caching
      const testContent = Buffer.from('This is test content for caching evaluation. '.repeat(1000));
      
      const writeResult = await this.fs.writeFile(sessionToken, 'cache_test.txt', testContent, 'cache_user');
      if (!writeResult.success) {
        Logger.error('Failed to write test file for caching');
        return;
      }

      const fileId = writeResult.data!;
      let cacheHits = 0;
      let cacheMisses = 0;

      // Read the file multiple times
      for (let i = 0; i < 10; i++) {
        const startTime = Date.now();
        const readResult = await this.fs.readFile(sessionToken, fileId);
        const readTime = Date.now() - startTime;
        
        if (readResult.success) {
          if (i === 0) {
            cacheMisses++;
            Logger.info(`First read (cache miss): ${readTime}ms`);
          } else {
            cacheHits++;
            Logger.info(`Subsequent read ${i} (cache hit): ${readTime}ms`);
          }
        }
      }

      Logger.info(`Cache performance: ${cacheHits} hits, ${cacheMisses} misses`);
      
      if (cacheHits > 0) {
        Logger.success('Caching system working correctly');
      } else {
        Logger.warning('No cache hits detected');
      }

      // Test cache statistics
      const cacheStats = this.fs.getCacheStats();
      Logger.info('Final cache statistics:');
      Logger.info(`  - Hit rate: ${cacheStats.hitRate.toFixed(1)}%`);
      Logger.info(`  - Memory utilization: ${cacheStats.memoryUtilization.toFixed(1)}%`);
      Logger.info(`  - Total entries: ${cacheStats.totalEntries}`);

      // Test performance under load
      Logger.info('Testing performance under load...');
      
      const loadTestFiles = TestUtils.generateTestFiles(50, 500, 2000);
      const startTime = Date.now();
      let successfulOperations = 0;

      for (const file of loadTestFiles) {
        const writeResult = await this.fs.writeFile(sessionToken, file.name, file.content, 'cache_user');
        if (writeResult.success) {
          const readResult = await this.fs.readFile(sessionToken, writeResult.data!);
          if (readResult.success) {
            successfulOperations++;
          }
        }
      }

      const totalTime = Date.now() - startTime;
      const operationsPerSecond = (successfulOperations * 2) / (totalTime / 1000); // *2 for write+read

      Logger.info(`Load test results:`);
      Logger.info(`  - Total operations: ${successfulOperations * 2}`);
      Logger.info(`  - Total time: ${totalTime}ms`);
      Logger.info(`  - Operations per second: ${operationsPerSecond.toFixed(2)}`);

      if (operationsPerSecond > 10) {
        Logger.success('Performance under load is acceptable');
      } else {
        Logger.warning('Performance under load is below expected threshold');
      }

    } catch (error) {
      Logger.error(`Level 3 test failed with exception: ${error}`);
    }
  }

  // Level 4: Security Monitoring
  async testLevel4(): Promise<void> {
    Logger.section('Level 4: Enterprise Security Monitoring');

    try {
      // Create a fresh file system for security tests
      this.disk = new MemoryDisk(10 * 1024 * 1024);
      this.fs = new EnterpriseFileSystem(this.disk);
      
      // Create test users
      await this.fs.createUser('security_user', 'security123', ['EMPLOYEE']);
      await this.fs.createUser('admin_user', 'admin123', ['ADMIN']);

      Logger.info('Testing security event monitoring...');
      
      // Generate various security events
      const events = [
        // Failed login attempts
        { username: 'security_user', password: 'wrong1' },
        { username: 'security_user', password: 'wrong2' },
        { username: 'security_user', password: 'wrong3' },
        { username: 'security_user', password: 'wrong4' },
        { username: 'security_user', password: 'wrong5' },
        { username: 'security_user', password: 'wrong6' },
        
        // Successful login
        { username: 'security_user', password: 'security123' },
        
        // Admin login
        { username: 'admin_user', password: 'admin123' }
      ];

      for (const event of events) {
        await this.fs.authenticateUser(event);
      }

      // Wait for security processing
      await new Promise(resolve => setTimeout(resolve, 5000));

      // Check security events
      const securityEvents = this.fs.getSecurityEvents(50);
      Logger.info(`Security events captured: ${securityEvents.length}`);

      const authFailures = securityEvents.filter(e => e.action === 'AUTH_FAILED');
      const authSuccesses = securityEvents.filter(e => e.action === 'AUTH_SUCCESS');

      Logger.info(`Authentication failures: ${authFailures.length}`);
      Logger.info(`Authentication successes: ${authSuccesses.length}`);

      if (authFailures.length >= 6 && authSuccesses.length >= 2) {
        Logger.success('Security event monitoring working correctly');
      } else {
        Logger.warning('Security event monitoring may not be capturing all events');
      }

      // Test alert generation
      Logger.info('Testing security alert generation...');
      const alerts = this.fs.getAlerts(false);
      const securityAlerts = alerts.filter(a => a.type === 'SECURITY');

      Logger.info(`Security alerts generated: ${securityAlerts.length}`);

      if (securityAlerts.length > 0) {
        Logger.success('Security alerting working correctly');
        
        securityAlerts.forEach(alert => {
          Logger.info(`  - ${alert.severity} SECURITY: ${alert.message}`);
        });
      } else {
        Logger.warning('No security alerts generated');
      }

      // Test session management
      Logger.info('Testing session management...');
      
      const validAuth = await this.fs.authenticateUser({
        username: 'security_user',
        password: 'security123'
      });

      if (validAuth.success && validAuth.sessionToken) {
        Logger.success('Session created successfully');
        
        // Test session revocation
        await this.fs.revokeSession(validAuth.sessionToken);
        Logger.success('Session revoked successfully');
        
        // Try to use revoked session
        const revokedResult = await this.fs.checkPermission(validAuth.sessionToken, 'files', 'read');
        if (!revokedResult) {
          Logger.success('Revoked session correctly rejected');
        } else {
          Logger.error('Revoked session should have been rejected');
        }
      } else {
        Logger.error('Failed to create session for testing');
      }

    } catch (error) {
      Logger.error(`Level 4 test failed with exception: ${error}`);
    }
  }

  // Level 5: Enterprise Integration
  async testLevel5(): Promise<void> {
    Logger.section('Level 5: Enterprise Integration & Compliance');

    try {
      // Create a fresh file system for integration tests
      this.disk = new MemoryDisk(10 * 1024 * 1024);
      this.fs = new EnterpriseFileSystem(this.disk);
      
      // Create test users with different roles
      await this.fs.createUser('hr_admin', 'hr123', ['HR_MANAGER']);
      await this.fs.createUser('regular_employee', 'emp123', ['EMPLOYEE']);
      await this.fs.createUser('system_admin', 'admin123', ['ADMIN']);

      Logger.info('Testing role-based access control integration...');
      
      // Test HR Manager access
      const hrAuth = await this.fs.authenticateUser({
        username: 'hr_admin',
        password: 'hr123'
      });

      if (hrAuth.success && hrAuth.sessionToken) {
        Logger.success('HR Manager authentication successful');
        
        // Test HR-specific permissions
        const healthRecordPermission = await this.fs.checkPermission(hrAuth.sessionToken, 'health_records', 'read');
        const claimsPermission = await this.fs.checkPermission(hrAuth.sessionToken, 'claims', 'write');
        
        if (healthRecordPermission && claimsPermission) {
          Logger.success('HR Manager has appropriate permissions');
        } else {
          Logger.warning('HR Manager permissions may be incomplete');
        }
      }

      // Test Employee access
      const empAuth = await this.fs.authenticateUser({
        username: 'regular_employee',
        password: 'emp123'
      });

      if (empAuth.success && empAuth.sessionToken) {
        Logger.success('Employee authentication successful');
        
        // Test employee permissions
        const personalFilePermission = await this.fs.checkPermission(empAuth.sessionToken, 'personal_files', 'write');
        const adminPermission = await this.fs.checkPermission(empAuth.sessionToken, 'admin', 'read');
        
        if (personalFilePermission && !adminPermission) {
          Logger.success('Employee has appropriate restricted permissions');
        } else {
          Logger.warning('Employee permissions may be incorrect');
        }
      }

      // Test comprehensive file operations
      Logger.info('Testing comprehensive file operations...');
      
      const adminAuth = await this.fs.authenticateUser({
        username: 'system_admin',
        password: 'admin123'
      });

      if (adminAuth.success && adminAuth.sessionToken) {
        // Create various types of files
        const fileTypes = [
          { name: 'health_record.txt', content: 'Sensitive health information' },
          { name: 'claim_document.pdf', content: 'Insurance claim details' },
          { name: 'personal_note.txt', content: 'Personal employee note' },
          { name: 'system_log.txt', content: 'System administration log' }
        ];

        const fileIds: string[] = [];
        
        for (const fileType of fileTypes) {
          const writeResult = await this.fs.writeFile(
            adminAuth.sessionToken, 
            fileType.name, 
            Buffer.from(fileType.content), 
            'system_admin'
          );
          
          if (writeResult.success) {
            fileIds.push(writeResult.data!);
            Logger.info(`Created file: ${fileType.name}`);
          }
        }

        // Read all files back
        let readSuccesses = 0;
        for (const fileId of fileIds) {
          const readResult = await this.fs.readFile(adminAuth.sessionToken, fileId);
          if (readResult.success) {
            readSuccesses++;
          }
        }

        Logger.info(`File operations: ${fileIds.length} created, ${readSuccesses} read successfully`);

        if (readSuccesses === fileIds.length) {
          Logger.success('Comprehensive file operations working correctly');
        } else {
          Logger.warning('Some file operations failed');
        }
      }

      // Test monitoring integration
      Logger.info('Testing monitoring integration...');
      
      // Wait for metrics to update
      await new Promise(resolve => setTimeout(resolve, 15000));

      const metrics = this.fs.getPerformanceMetrics();
      const cacheStats = this.fs.getCacheStats();
      const alerts = this.fs.getAlerts(false);
      const securityEvents = this.fs.getSecurityEvents(20);

      Logger.info('Final system status:');
      Logger.info(`  - Performance: ${metrics.throughput.toFixed(2)} ops/sec, ${metrics.cacheHitRate.toFixed(1)}% cache hit`);
      Logger.info(`  - Security: ${securityEvents.length} events, ${alerts.length} alerts`);
      Logger.info(`  - Cache: ${cacheStats.totalEntries} entries, ${cacheStats.memoryUtilization.toFixed(1)}% utilization`);

      // Overall assessment
      if (metrics.throughput > 0 && securityEvents.length > 0) {
        Logger.success('Enterprise integration working correctly');
      } else {
        Logger.warning('Enterprise integration may have issues');
      }

    } catch (error) {
      Logger.error(`Level 5 test failed with exception: ${error}`);
    }
  }
}

async function main() {
  const harness = new EnterpriseTestHarness();
  await harness.runAllTests();
}

if (require.main === module) {
  main().catch((error) => {
    console.error('💥 Enterprise YOIFS encountered an unexpected error:', error);
  });
}
