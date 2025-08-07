import { EventEmitter } from 'events';
import { Disk } from '../../v1-basic/index';
import { 
  FileSystemResult, 
  UserCredentials, 
  AuthResult, 
  SessionToken,
  FileMeta,
  FileChunk,
  EnterpriseConfig,
  SecurityConfig,
  PerformanceConfig,
  BackupConfig,
  QuotaConfig
} from '../types';

// Import enhanced types from V2
import { ReadOptions, PartialFileResult, CorruptionReport } from '../../v2-enhanced/version2-enhanced-solution';

import { AuthenticationService } from '../security/AuthenticationService';
import { AuthorizationService } from '../security/AuthorizationService';
import { MonitoringService } from '../monitoring/MonitoringService';
import { CacheService } from '../performance/CacheService';
import { QuotaService } from '../quota/QuotaService';
import { EncryptionService } from '../security/EncryptionService';
import { FileSystemCore } from './FileSystemCore';
import { Logger } from '../../v1-basic/index';

export class EnterpriseFileSystem extends EventEmitter {
  private disk: Disk;
  private config: EnterpriseConfig;
  
  // Services
  private authService: AuthenticationService;
  private authzService: AuthorizationService;
  private monitoringService: MonitoringService;
  private cacheService: CacheService;
  private quotaService: QuotaService;
  private encryptionService: EncryptionService;
  private fileSystemCore: FileSystemCore;

  constructor(disk: Disk, config: EnterpriseConfig) {
    super();
    this.disk = disk;
    this.config = config;
    
    // Initialize services
    this.authService = new AuthenticationService(config.security);
    this.authzService = new AuthorizationService();
    this.monitoringService = new MonitoringService(config.performance);
    this.cacheService = new CacheService(config.performance);
    this.quotaService = new QuotaService(config.quota);
    this.encryptionService = new EncryptionService(config.security);
    this.fileSystemCore = new FileSystemCore(disk, this.cacheService);
    
    // Wire up event listeners
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    // Authentication events
    this.authService.on('sessionCreated', (session: SessionToken) => {
      this.monitoringService.updateConnectionCount(this.authService.getActiveSessions());
    });

    this.authService.on('sessionRevoked', (session: SessionToken) => {
      this.monitoringService.updateConnectionCount(this.authService.getActiveSessions());
    });

    this.authService.on('securityEvent', (event) => {
      this.emit('securityEvent', event);
    });

    this.authService.on('securityAlert', (alert) => {
      this.monitoringService.createAlert(alert.type, alert.severity, alert.message, alert.metadata);
    });

    // Authorization events
    this.authzService.on('securityEvent', (event) => {
      this.emit('securityEvent', event);
    });

    this.authzService.on('securityAlert', (alert) => {
      this.monitoringService.createAlert(alert.type, alert.severity, alert.message, alert.metadata);
    });

    // Cache events
    this.cacheService.on('cacheHit', (key: string) => {
      this.monitoringService.updateMetrics('cache_hit', 1);
    });

    this.cacheService.on('cacheMiss', (key: string) => {
      this.monitoringService.updateMetrics('cache_miss', 1);
    });

    this.cacheService.on('cacheEviction', (key: string, policy: string) => {
      this.monitoringService.updateMetrics('cache_eviction', 1);
    });

    // Monitoring events
    this.monitoringService.on('alert', (alert) => {
      this.emit('alert', alert);
    });

    // Quota events
    this.quotaService.on('quotaViolation', (violation) => {
      this.monitoringService.createAlert('CAPACITY', 'HIGH', 
        `Quota violation for ${violation.entityType}:${violation.entityId}`, 
        { violations: violation.violations });
    });

    this.quotaService.on('quotaWarning', (warning) => {
      this.monitoringService.createAlert('CAPACITY', 'MEDIUM',
        `Quota warning for ${warning.entityType}:${warning.entityId} - ${warning.usagePercentage.toFixed(1)}% usage`,
        { usagePercentage: warning.usagePercentage });
    });

    // Encryption events
    this.encryptionService.on('keyGenerated', (event) => {
      Logger.info(`[ENTERPRISE] New encryption key generated: ${event.keyId}`);
    });

    this.encryptionService.on('keyRotated', (event) => {
      this.monitoringService.createAlert('SECURITY', 'LOW',
        `Encryption key rotated: ${event.newKeyId}`,
        { newKeyId: event.newKeyId, oldKeyId: event.oldKeyId });
    });

    this.encryptionService.on('securityEvent', (event) => {
      this.emit('securityEvent', event);
    });
  }

  // ============================================================================
  // AUTHENTICATION & AUTHORIZATION
  // ============================================================================

  async authenticateUser(credentials: UserCredentials): Promise<AuthResult> {
    return this.authService.authenticateUser(credentials);
  }

  async checkPermission(sessionToken: string, resource: string, action: string): Promise<boolean> {
    const session = await this.authService.validateSession(sessionToken);
    if (!session) {
      return false;
    }

    return this.authzService.checkPermission(session, resource, action);
  }

  async revokeSession(sessionToken: string): Promise<void> {
    await this.authService.revokeSession(sessionToken);
  }

  async createUser(username: string, password: string, roles: string[]): Promise<void> {
    await this.authService.createUser(username, password, roles);
  }

  async enableMFA(username: string): Promise<void> {
    await this.authService.enableMFA(username);
  }

  // ============================================================================
  // FILE SYSTEM OPERATIONS
  // ============================================================================

  async writeFile(sessionToken: string, fileName: string, content: Buffer, owner: string): Promise<FileSystemResult<string>> {
    const startTime = Date.now();
    
    try {
      // Check authentication and permissions
      if (!await this.checkPermission(sessionToken, 'files', 'write')) {
        return { success: false, error: 'Permission denied' };
      }

      // Get user session for quota checking
      const session = await this.authService.validateSession(sessionToken);
      if (!session) {
        return { success: false, error: 'Invalid session' };
      }

      // Check quota before writing
      const quotaCheck = await this.quotaService.checkQuota(
        session.userId, 
        'USER', 
        'WRITE', 
        content.length
      );

      if (!quotaCheck.allowed) {
        const violations = quotaCheck.violations.map(v => `${v.quotaType}: ${v.currentUsage}/${v.limit}`).join(', ');
        return { success: false, error: `Quota exceeded: ${violations}` };
      }

      // Encrypt content before writing
      const encryptedContent = await this.encryptionService.encrypt(content, {
        fileName,
        owner,
        originalSize: content.length
      });

      // Combine IV + encrypted data + auth tag for storage
      const combinedData = Buffer.concat([
        encryptedContent.iv,
        encryptedContent.encryptedData,
        encryptedContent.authTag || Buffer.alloc(0)
      ]);

      // Write encrypted file using core file system
      const result = await this.fileSystemCore.writeFile(fileName, combinedData, owner);
      
      if (result.success) {
        // Update quota usage after successful write
        this.quotaService.updateUsage(session.userId, 'USER', 'WRITE', content.length);
      }
      
      // Update metrics
      const writeTime = Date.now() - startTime;
      this.monitoringService.updateMetrics('write_latency', writeTime);
      
      return result;

    } catch (error: any) {
      this.monitoringService.updateMetrics('error_rate', 1);
      Logger.error(`[ENTERPRISE] Failed to write file '${fileName}': ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  // Enhanced readFile with partial corruption recovery support
  async readFile(sessionToken: string, fileId: string, options?: ReadOptions): Promise<PartialFileResult> {
    const startTime = Date.now();
    
    try {
      // Check authentication and permissions
      if (!await this.checkPermission(sessionToken, 'files', 'read')) {
        return { success: false, error: 'Permission denied' };
      }

      // Get user session for quota checking
      const session = await this.authService.validateSession(sessionToken);
      if (!session) {
        return { success: false, error: 'Invalid session' };
      }

      // Read encrypted file using core file system with partial recovery options
      const result = await this.fileSystemCore.readFile(fileId, options);
      
      if (result.success && result.data) {
        // Check bandwidth quota
        const quotaCheck = await this.quotaService.checkQuota(
          session.userId,
          'USER',
          'READ',
          0,
          result.data.length
        );

        if (!quotaCheck.allowed) {
          const violations = quotaCheck.violations.map(v => `${v.quotaType}: ${v.currentUsage}/${v.limit}`).join(', ');
          return { success: false, error: `Bandwidth quota exceeded: ${violations}` };
        }

        // Decrypt content
        try {
          // For now, use the current active key since we're not storing key metadata
          // In production, this should be stored with the file metadata
          const currentKey = this.encryptionService.getCurrentKey();
          if (!currentKey) {
            throw new Error('No active encryption key available');
          }
          
          // Parse the stored data: IV (16 bytes) + encrypted data + auth tag (16 bytes for GCM)
          const iv = result.data.subarray(0, 16);
          const authTag = result.data.subarray(result.data.length - 16);
          const encryptedData = result.data.subarray(16, result.data.length - 16);
          
          const decryptedContent = await this.encryptionService.decrypt({
            keyId: currentKey.id,
            algorithm: currentKey.algorithm,
            iv: iv,
            encryptedData: encryptedData,
            authTag: authTag
          });

          // Update bandwidth usage
          this.quotaService.updateUsage(session.userId, 'USER', 'READ', 0, result.data.length);

          // Update metrics
          const readTime = Date.now() - startTime;
          this.monitoringService.updateMetrics('read_latency', readTime);
          
          // Return with corruption report if any
          return { 
            success: true, 
            data: decryptedContent,
            corruptionReport: result.corruptionReport
          };
        } catch (decryptError: any) {
          Logger.error(`[ENTERPRISE] Decryption failed for file ${fileId}: ${decryptError.message}`);
          return { success: false, error: 'File decryption failed' };
        }
      }
      
      return result;

    } catch (error: any) {
      this.monitoringService.updateMetrics('error_rate', 1);
      Logger.error(`[ENTERPRISE] Failed to read file ${fileId}: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  async deleteFile(sessionToken: string, fileId: string): Promise<FileSystemResult<void>> {
    try {
      // Check authentication and permissions
      if (!await this.checkPermission(sessionToken, 'files', 'delete')) {
        return { success: false, error: 'Permission denied' };
      }

      return await this.fileSystemCore.deleteFile(fileId);

    } catch (error: any) {
      this.monitoringService.updateMetrics('error_rate', 1);
      Logger.error(`[ENTERPRISE] Failed to delete file ${fileId}: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  // ============================================================================
  // MONITORING & ANALYTICS
  // ============================================================================

  getPerformanceMetrics() {
    return this.monitoringService.getPerformanceMetrics();
  }

  getCacheStats() {
    return this.cacheService.getStats();
  }

  getAlerts(resolved: boolean = false) {
    return this.monitoringService.getAlerts(resolved);
  }

  getSecurityEvents(limit: number = 100) {
    return this.authService.getSecurityEvents(limit);
  }

  resolveAlert(alertId: string, resolution: string): void {
    this.monitoringService.resolveAlert(alertId, resolution);
  }

  // ============================================================================
  // ADMINISTRATIVE METHODS
  // ============================================================================

  getSystemUptime(): number {
    return this.monitoringService.getSystemUptime();
  }

  getActiveConnections(): number {
    return this.authService.getActiveSessions();
  }

  cleanupExpiredSessions(): void {
    this.authService.cleanupExpiredSessions();
  }

  // ============================================================================
  // QUOTA MANAGEMENT
  // ============================================================================

  setUserQuota(userId: string, quota: any): void {
    this.quotaService.setQuota(userId, 'USER', quota);
  }

  getUserQuota(userId: string): any {
    return this.quotaService.getQuota(userId, 'USER');
  }

  getUserUsage(userId: string): any {
    return this.quotaService.getUsage(userId, 'USER');
  }

  getAllQuotaUsage(): any[] {
    return this.quotaService.getAllUsage();
  }

  getQuotaStats(): any {
    return this.quotaService.getQuotaStats();
  }

  resetUserUsage(userId: string): void {
    this.quotaService.resetUsage(userId, 'USER');
  }

  // ============================================================================
  // ENCRYPTION MANAGEMENT
  // ============================================================================

  getEncryptionStats(): any {
    return this.encryptionService.getEncryptionStats();
  }

  getAllEncryptionKeys(): any[] {
    return this.encryptionService.getAllKeys();
  }

  deactivateEncryptionKey(keyId: string): void {
    this.encryptionService.deactivateKey(keyId);
  }

  rotateEncryptionKeys(): Promise<void> {
    return this.encryptionService.rotateKeys();
  }

  exportEncryptionKeys(backupPassword: string): string {
    return this.encryptionService.exportKeys(backupPassword);
  }

  importEncryptionKeys(backupData: string, backupPassword: string): void {
    this.encryptionService.importKeys(backupData, backupPassword);
  }

  // ============================================================================
  // CONFIGURATION MANAGEMENT
  // ============================================================================

  updateConfig(newConfig: Partial<EnterpriseConfig>): void {
    this.config = { ...this.config, ...newConfig };
    Logger.info('[ENTERPRISE] Configuration updated');
  }

  getConfig(): EnterpriseConfig {
    return { ...this.config };
  }
}
