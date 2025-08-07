import { MemoryDisk } from '../v1-basic/index';
import { 
  createEnterpriseFileSystem,
  createHealthcareFileSystem,
  createHighPerformanceFileSystem,
  ConfigFactory
} from './index';
import { Logger } from '../v1-basic/index';

class ModularTestHarness {
  private disk: MemoryDisk;
  private fs: any;

  constructor() {
    this.disk = new MemoryDisk(10 * 1024 * 1024); // 10MB
  }

  async runAllTests(): Promise<void> {
    Logger.info('🚀 Starting Modular Enterprise YOIFS Tests');
    
    await this.testDefaultConfiguration();
    await this.testHealthcareConfiguration();
    await this.testHighPerformanceConfiguration();
    await this.testSecurityFeatures();
    await this.testMonitoringFeatures();
    await this.testCacheFeatures();
    await this.testFileOperations();
    
    Logger.info('✅ All modular tests completed successfully!');
  }

  private async testDefaultConfiguration(): Promise<void> {
    Logger.info('\n📋 Testing Default Configuration');
    
    this.fs = createEnterpriseFileSystem(this.disk);
    
    // Test basic functionality
    const authResult = await this.fs.authenticateUser({
      username: 'admin',
      password: 'admin123'
    });
    
    if (!authResult.success) {
      throw new Error('Default authentication failed');
    }
    
    Logger.info('✅ Default configuration test passed');
  }

  private async testHealthcareConfiguration(): Promise<void> {
    Logger.info('\n🏥 Testing Healthcare Configuration');
    
    this.fs = createHealthcareFileSystem(this.disk);
    const config = this.fs.getConfig();
    
    // Verify healthcare-specific settings
    if (config.backup.retentionDays !== 2555) {
      throw new Error('Healthcare backup retention not set correctly');
    }
    
    if (!config.security.mfaRequired) {
      throw new Error('Healthcare MFA not enabled');
    }
    
    Logger.info('✅ Healthcare configuration test passed');
  }

  private async testHighPerformanceConfiguration(): Promise<void> {
    Logger.info('\n⚡ Testing High Performance Configuration');
    
    this.fs = createHighPerformanceFileSystem(this.disk);
    const config = this.fs.getConfig();
    
    // Verify performance settings
    if (config.performance.cacheMaxSize !== 1 * 1024 * 1024 * 1024) {
      throw new Error('High performance cache size not set correctly');
    }
    
    if (config.performance.alertThresholds.latencyP95 !== 500) {
      throw new Error('High performance latency threshold not set correctly');
    }
    
    Logger.info('✅ High performance configuration test passed');
  }

  private async testSecurityFeatures(): Promise<void> {
    Logger.info('\n🔐 Testing Security Features');
    
    this.fs = createEnterpriseFileSystem(this.disk);
    
    // Test user creation
    await this.fs.createUser('testuser', 'password123', ['EMPLOYEE']);
    
    // Test authentication
    const authResult = await this.fs.authenticateUser({
      username: 'testuser',
      password: 'password123'
    });
    
    if (!authResult.success) {
      throw new Error('User authentication failed');
    }
    
    // Test permission checking
    const hasPermission = await this.fs.checkPermission(
      authResult.sessionToken!,
      'files',
      'read'
    );
    
    if (!hasPermission) {
      throw new Error('Permission check failed');
    }
    
    // Test MFA enablement
    await this.fs.enableMFA('testuser');
    
    Logger.info('✅ Security features test passed');
  }

  private async testMonitoringFeatures(): Promise<void> {
    Logger.info('\n📊 Testing Monitoring Features');
    
    this.fs = createEnterpriseFileSystem(this.disk);
    
    // Authenticate user
    const authResult = await this.fs.authenticateUser({
      username: 'admin',
      password: 'admin123'
    });
    
    if (!authResult.success) {
      throw new Error('Authentication failed for monitoring test');
    }
    
    // Perform some operations to generate metrics
    await this.fs.writeFile(authResult.sessionToken!, 'test1.txt', Buffer.from('Hello World'), 'admin');
    await this.fs.writeFile(authResult.sessionToken!, 'test2.txt', Buffer.from('Another file'), 'admin');
    
    // Get performance metrics
    const metrics = this.fs.getPerformanceMetrics();
    if (!metrics) {
      throw new Error('Performance metrics not available');
    }
    
    // Get cache stats
    const cacheStats = this.fs.getCacheStats();
    if (!cacheStats) {
      throw new Error('Cache stats not available');
    }
    
    // Get alerts
    const alerts = this.fs.getAlerts();
    
    Logger.info(`📈 Performance Metrics: ${JSON.stringify(metrics, null, 2)}`);
    Logger.info(`💾 Cache Stats: ${JSON.stringify(cacheStats, null, 2)}`);
    Logger.info(`🚨 Active Alerts: ${alerts.length}`);
    
    Logger.info('✅ Monitoring features test passed');
  }

  private async testCacheFeatures(): Promise<void> {
    Logger.info('\n💾 Testing Cache Features');
    
    this.fs = createEnterpriseFileSystem(this.disk);
    
    // Authenticate user
    const authResult = await this.fs.authenticateUser({
      username: 'admin',
      password: 'admin123'
    });
    
    if (!authResult.success) {
      throw new Error('Authentication failed for cache test');
    }
    
    // Write a file
    const writeResult = await this.fs.writeFile(
      authResult.sessionToken!,
      'cache-test.txt',
      Buffer.from('This is a test file for caching'),
      'admin'
    );
    
    if (!writeResult.success) {
      throw new Error('File write failed for cache test');
    }
    
    // Read the file multiple times to test caching
    for (let i = 0; i < 3; i++) {
      const readResult = await this.fs.readFile(authResult.sessionToken!, writeResult.data!);
      if (!readResult.success) {
        throw new Error(`File read ${i + 1} failed`);
      }
    }
    
    // Check cache stats
    const cacheStats = this.fs.getCacheStats();
    Logger.info(`💾 Cache Hit Rate: ${cacheStats.hitRate.toFixed(2)}%`);
    
    Logger.info('✅ Cache features test passed');
  }

  private async testFileOperations(): Promise<void> {
    Logger.info('\n📁 Testing File Operations');
    
    this.fs = createEnterpriseFileSystem(this.disk);
    
    // Authenticate user
    const authResult = await this.fs.authenticateUser({
      username: 'admin',
      password: 'admin123'
    });
    
    if (!authResult.success) {
      throw new Error('Authentication failed for file operations test');
    }
    
    const sessionToken = authResult.sessionToken!;
    
    // Test file write
    const content = Buffer.from('This is a test file with some content');
    const writeResult = await this.fs.writeFile(sessionToken, 'test-file.txt', content, 'admin');
    
    if (!writeResult.success) {
      throw new Error('File write failed');
    }
    
    // Test file read
    const readResult = await this.fs.readFile(sessionToken, writeResult.data!);
    if (!readResult.success) {
      throw new Error('File read failed');
    }
    
    if (!content.equals(readResult.data!)) {
      throw new Error('File content mismatch');
    }
    
    // Test file delete
    const deleteResult = await this.fs.deleteFile(sessionToken, writeResult.data!);
    if (!deleteResult.success) {
      throw new Error('File delete failed');
    }
    
    Logger.info('✅ File operations test passed');
  }
}

// Run the tests
async function main() {
  const harness = new ModularTestHarness();
  await harness.runAllTests();
}

if (require.main === module) {
  main().catch(console.error);
}
