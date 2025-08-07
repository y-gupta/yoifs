import { EventEmitter } from 'events';
import * as crypto from 'crypto';
import { 
  Quota, 
  QuotaUsage, 
  QuotaConfig,
  SecurityEvent 
} from '../types';
import { Logger } from '../../v1-basic/index';

export interface QuotaViolation {
  entityId: string;
  entityType: 'USER' | 'GROUP' | 'DEPARTMENT';
  quotaType: 'STORAGE' | 'FILE_COUNT' | 'BANDWIDTH';
  currentUsage: number;
  limit: number;
  timestamp: Date;
}

export interface QuotaCheckResult {
  allowed: boolean;
  violations: QuotaViolation[];
  usage: QuotaUsage;
}

export class QuotaService extends EventEmitter {
  private quotas = new Map<string, Quota>();
  private usage = new Map<string, QuotaUsage>();
  private config: QuotaConfig;
  private bandwidthTracking = new Map<string, { bytes: number; resetTime: number }>();

  constructor(config: QuotaConfig) {
    super();
    this.config = config;
    this.initializeDefaultQuotas();
  }

  private initializeDefaultQuotas(): void {
    // Set default quotas for all entities
    const defaultQuota: Quota = {
      storageLimit: this.config.defaultStorageLimit,
      fileCountLimit: this.config.defaultFileCountLimit,
      bandwidthLimit: this.config.defaultBandwidthLimit,
      retentionPeriod: 365 * 24 * 60 * 60 * 1000 // 1 year in milliseconds
    };

    // Initialize quota for admin user
    this.quotas.set('admin', {
      ...defaultQuota,
      storageLimit: defaultQuota.storageLimit * 10, // 10x storage for admin
      fileCountLimit: defaultQuota.fileCountLimit * 5 // 5x file count for admin
    });

    Logger.info('[QUOTA] Default quotas initialized');
  }

  // Set quota for a specific entity
  setQuota(entityId: string, entityType: 'USER' | 'GROUP' | 'DEPARTMENT', quota: Quota): void {
    const key = `${entityType}:${entityId}`;
    this.quotas.set(key, quota);
    
    // Initialize usage tracking if not exists
    if (!this.usage.has(key)) {
      this.usage.set(key, {
        entityId,
        entityType,
        storageUsed: 0,
        fileCount: 0,
        bandwidthUsed: 0,
        quota,
        lastUpdated: new Date()
      });
    }

    Logger.info(`[QUOTA] Quota set for ${entityType}:${entityId}`);
    this.emit('quotaUpdated', { entityId, entityType, quota });
  }

  // Get quota for an entity
  getQuota(entityId: string, entityType: 'USER' | 'GROUP' | 'DEPARTMENT'): Quota | null {
    const key = `${entityType}:${entityId}`;
    return this.quotas.get(key) || null;
  }

  // Check if an operation is allowed based on quotas
  async checkQuota(
    entityId: string, 
    entityType: 'USER' | 'GROUP' | 'DEPARTMENT',
    operation: 'WRITE' | 'READ' | 'DELETE',
    fileSize: number = 0,
    bandwidthUsage: number = 0
  ): Promise<QuotaCheckResult> {
    const key = `${entityType}:${entityId}`;
    const quota = this.quotas.get(key);
    
    if (!quota) {
      // Use default quota if none set
      const defaultQuota: Quota = {
        storageLimit: this.config.defaultStorageLimit,
        fileCountLimit: this.config.defaultFileCountLimit,
        bandwidthLimit: this.config.defaultBandwidthLimit,
        retentionPeriod: 365 * 24 * 60 * 60 * 1000
      };
      this.setQuota(entityId, entityType, defaultQuota);
      return this.checkQuota(entityId, entityType, operation, fileSize, bandwidthUsage);
    }

    const usage = this.usage.get(key) || {
      entityId,
      entityType,
      storageUsed: 0,
      fileCount: 0,
      bandwidthUsed: 0,
      quota,
      lastUpdated: new Date()
    };

    const violations: QuotaViolation[] = [];

    // Check storage quota for write operations
    if (operation === 'WRITE') {
      const projectedStorage = usage.storageUsed + fileSize;
      if (projectedStorage > quota.storageLimit) {
        violations.push({
          entityId,
          entityType,
          quotaType: 'STORAGE',
          currentUsage: projectedStorage,
          limit: quota.storageLimit,
          timestamp: new Date()
        });
      }

      // Check file count quota
      const projectedFileCount = usage.fileCount + 1;
      if (projectedFileCount > quota.fileCountLimit) {
        violations.push({
          entityId,
          entityType,
          quotaType: 'FILE_COUNT',
          currentUsage: projectedFileCount,
          limit: quota.fileCountLimit,
          timestamp: new Date()
        });
      }
    }

    // Check bandwidth quota for read operations
    if (operation === 'READ') {
      const currentBandwidth = this.getCurrentBandwidthUsage(entityId, entityType);
      const projectedBandwidth = currentBandwidth + bandwidthUsage;
      
      if (projectedBandwidth > quota.bandwidthLimit) {
        violations.push({
          entityId,
          entityType,
          quotaType: 'BANDWIDTH',
          currentUsage: projectedBandwidth,
          limit: quota.bandwidthLimit,
          timestamp: new Date()
        });
      }
    }

    const allowed = violations.length === 0 || !this.config.enforcementEnabled;

    // Log quota check
    this.logQuotaCheck(entityId, entityType, operation, allowed, violations);

    // Emit events for violations
    if (violations.length > 0) {
      this.emit('quotaViolation', { entityId, entityType, violations });
      
      // Check if violations exceed warning threshold
      const currentBandwidth = this.getCurrentBandwidthUsage(entityId, entityType);
      const totalUsage = usage.storageUsed + usage.fileCount + currentBandwidth;
      const totalLimit = quota.storageLimit + quota.fileCountLimit + quota.bandwidthLimit;
      const usagePercentage = (totalUsage / totalLimit) * 100;
      
      if (usagePercentage > this.config.warningThreshold) {
        this.emit('quotaWarning', { entityId, entityType, usagePercentage });
      }
    }

    return {
      allowed,
      violations,
      usage: { ...usage }
    };
  }

  // Update usage after successful operations
  updateUsage(
    entityId: string,
    entityType: 'USER' | 'GROUP' | 'DEPARTMENT',
    operation: 'WRITE' | 'READ' | 'DELETE',
    fileSize: number = 0,
    bandwidthUsage: number = 0
  ): void {
    const key = `${entityType}:${entityId}`;
    const usage = this.usage.get(key);
    
    if (!usage) {
      Logger.warning(`[QUOTA] No usage tracking found for ${entityType}:${entityId}`);
      return;
    }

    const now = new Date();

    switch (operation) {
      case 'WRITE':
        usage.storageUsed += fileSize;
        usage.fileCount += 1;
        break;
      case 'READ':
        this.updateBandwidthUsage(entityId, entityType, bandwidthUsage);
        break;
      case 'DELETE':
        usage.storageUsed = Math.max(0, usage.storageUsed - fileSize);
        usage.fileCount = Math.max(0, usage.fileCount - 1);
        break;
    }

    usage.lastUpdated = now;
    this.usage.set(key, usage);

    Logger.info(`[QUOTA] Updated usage for ${entityType}:${entityId} - Storage: ${usage.storageUsed}, Files: ${usage.fileCount}`);
  }

  // Get current usage for an entity
  getUsage(entityId: string, entityType: 'USER' | 'GROUP' | 'DEPARTMENT'): QuotaUsage | null {
    const key = `${entityType}:${entityId}`;
    return this.usage.get(key) || null;
  }

  // Get all usage data
  getAllUsage(): QuotaUsage[] {
    return Array.from(this.usage.values());
  }

  // Reset usage for an entity (admin function)
  resetUsage(entityId: string, entityType: 'USER' | 'GROUP' | 'DEPARTMENT'): void {
    const key = `${entityType}:${entityId}`;
    const usage = this.usage.get(key);
    
    if (usage) {
      usage.storageUsed = 0;
      usage.fileCount = 0;
      usage.bandwidthUsed = 0;
      usage.lastUpdated = new Date();
      
      Logger.info(`[QUOTA] Reset usage for ${entityType}:${entityId}`);
      this.emit('usageReset', { entityId, entityType });
    }
  }

  // Bandwidth tracking methods
  private updateBandwidthUsage(entityId: string, entityType: 'USER' | 'GROUP' | 'DEPARTMENT', bytes: number): void {
    const key = `${entityType}:${entityId}`;
    const now = Date.now();
    const tracking = this.bandwidthTracking.get(key);
    
    if (tracking && now < tracking.resetTime) {
      tracking.bytes += bytes;
    } else {
      // Reset bandwidth tracking (daily reset)
      const resetTime = now + (24 * 60 * 60 * 1000); // 24 hours from now
      this.bandwidthTracking.set(key, { bytes, resetTime });
    }

    // Update usage record
    const usage = this.usage.get(key);
    if (usage) {
      usage.bandwidthUsed = this.getCurrentBandwidthUsage(entityId, entityType);
    }
  }

  private getCurrentBandwidthUsage(entityId: string, entityType: 'USER' | 'GROUP' | 'DEPARTMENT'): number {
    const key = `${entityType}:${entityId}`;
    const tracking = this.bandwidthTracking.get(key);
    
    if (tracking && Date.now() < tracking.resetTime) {
      return tracking.bytes;
    }
    
    return 0;
  }

  // Cleanup expired bandwidth tracking
  cleanupExpiredTracking(): void {
    const now = Date.now();
    for (const [key, tracking] of this.bandwidthTracking.entries()) {
      if (now >= tracking.resetTime) {
        this.bandwidthTracking.delete(key);
      }
    }
  }

  // Logging methods
  private logQuotaCheck(
    entityId: string,
    entityType: 'USER' | 'GROUP' | 'DEPARTMENT',
    operation: string,
    allowed: boolean,
    violations: QuotaViolation[]
  ): void {
    const event: SecurityEvent = {
      id: crypto.randomUUID(),
      timestamp: new Date(),
      userId: entityId,
      action: `QUOTA_CHECK_${operation}`,
      resource: 'quota',
      result: allowed ? 'SUCCESS' : 'BLOCKED',
      details: {
        entityType,
        violations: violations.map(v => ({
          type: v.quotaType,
          current: v.currentUsage,
          limit: v.limit
        }))
      }
    };

    this.emit('securityEvent', event);
  }

  // Get quota statistics
  getQuotaStats(): {
    totalEntities: number;
    totalStorageUsed: number;
    totalFiles: number;
    totalBandwidthUsed: number;
    violationsToday: number;
  } {
    let totalStorageUsed = 0;
    let totalFiles = 0;
    let totalBandwidthUsed = 0;
    let violationsToday = 0;

    for (const usage of this.usage.values()) {
      totalStorageUsed += usage.storageUsed;
      totalFiles += usage.fileCount;
      totalBandwidthUsed += usage.bandwidthUsed;
    }

    return {
      totalEntities: this.usage.size,
      totalStorageUsed,
      totalFiles,
      totalBandwidthUsed,
      violationsToday // This would need to be tracked separately
    };
  }

  // Export quota data for backup
  exportQuotaData(): { quotas: Map<string, Quota>; usage: Map<string, QuotaUsage> } {
    return {
      quotas: new Map(this.quotas),
      usage: new Map(this.usage)
    };
  }

  // Import quota data from backup
  importQuotaData(data: { quotas: Map<string, Quota>; usage: Map<string, QuotaUsage> }): void {
    this.quotas = new Map(data.quotas);
    this.usage = new Map(data.usage);
    Logger.info('[QUOTA] Quota data imported from backup');
  }
}
