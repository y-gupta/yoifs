import { 
  EnterpriseConfig, 
  SecurityConfig, 
  PerformanceConfig, 
  BackupConfig, 
  QuotaConfig 
} from '../types';

export class ConfigFactory {
  static createDefaultConfig(): EnterpriseConfig {
    return {
      security: ConfigFactory.createDefaultSecurityConfig(),
      performance: ConfigFactory.createDefaultPerformanceConfig(),
      backup: ConfigFactory.createDefaultBackupConfig(),
      quota: ConfigFactory.createDefaultQuotaConfig()
    };
  }

  static createDefaultSecurityConfig(): SecurityConfig {
    return {
      sessionTimeout: 30 * 60 * 1000, // 30 minutes
      mfaRequired: false,
      maxLoginAttempts: 5,
      lockoutDuration: 15 * 60 * 1000, // 15 minutes
      encryptionAlgorithm: 'aes-256-gcm',
      keyRotationDays: 365, // 1 year for testing to avoid frequent rotations
      hsmEnabled: false
    };
  }

  static createDefaultPerformanceConfig(): PerformanceConfig {
    return {
      cacheMaxSize: 100 * 1024 * 1024, // 100MB
      cacheTTL: 5 * 60 * 1000, // 5 minutes
      evictionPolicy: 'LRU',
      metricsInterval: 30 * 1000, // 30 seconds
      alertThresholds: {
        latencyP95: 1000, // 1 second
        errorRate: 5, // 5%
        cacheHitRate: 80 // 80%
      }
    };
  }

  static createDefaultBackupConfig(): BackupConfig {
    return {
      retentionDays: 30,
      backupInterval: '0 2 * * *', // Daily at 2 AM
      destinationType: 'LOCAL',
      destinationPath: '/backups',
      encryptionEnabled: true
    };
  }

  static createDefaultQuotaConfig(): QuotaConfig {
    return {
      defaultStorageLimit: 10 * 1024 * 1024 * 1024, // 10GB
      defaultFileCountLimit: 10000,
      defaultBandwidthLimit: 100 * 1024 * 1024, // 100MB/day
      warningThreshold: 80, // 80%
      enforcementEnabled: true
    };
  }

  static createHighSecurityConfig(): EnterpriseConfig {
    const config = ConfigFactory.createDefaultConfig();
    config.security.mfaRequired = true;
    config.security.maxLoginAttempts = 3;
    config.security.lockoutDuration = 30 * 60 * 1000; // 30 minutes
    config.security.keyRotationDays = 30;
    config.security.hsmEnabled = true;
    return config;
  }

  static createHighPerformanceConfig(): EnterpriseConfig {
    const config = ConfigFactory.createDefaultConfig();
    config.performance.cacheMaxSize = 1 * 1024 * 1024 * 1024; // 1GB
    config.performance.cacheTTL = 15 * 60 * 1000; // 15 minutes
    config.performance.metricsInterval = 10 * 1000; // 10 seconds
    config.performance.alertThresholds.latencyP95 = 500; // 500ms
    config.performance.alertThresholds.cacheHitRate = 90; // 90%
    return config;
  }

  static createHealthcareConfig(): EnterpriseConfig {
    const config = ConfigFactory.createHighSecurityConfig();
    config.backup.retentionDays = 2555; // 7 years for healthcare
    config.backup.backupInterval = '0 */4 * * *'; // Every 4 hours
    config.quota.defaultStorageLimit = 50 * 1024 * 1024 * 1024; // 50GB
    config.quota.enforcementEnabled = true;
    return config;
  }

  static createDevelopmentConfig(): EnterpriseConfig {
    const config = ConfigFactory.createDefaultConfig();
    config.security.sessionTimeout = 24 * 60 * 60 * 1000; // 24 hours
    config.security.mfaRequired = false;
    config.performance.cacheMaxSize = 10 * 1024 * 1024; // 10MB
    config.performance.metricsInterval = 60 * 1000; // 1 minute
    config.quota.enforcementEnabled = false;
    return config;
  }

  static createProductionConfig(): EnterpriseConfig {
    const config = ConfigFactory.createDefaultConfig();
    config.security.mfaRequired = true;
    config.security.maxLoginAttempts = 3;
    config.performance.cacheMaxSize = 500 * 1024 * 1024; // 500MB
    config.performance.alertThresholds.latencyP95 = 500;
    config.backup.retentionDays = 90;
    config.quota.enforcementEnabled = true;
    return config;
  }

  static mergeConfigs(base: EnterpriseConfig, overrides: Partial<EnterpriseConfig>): EnterpriseConfig {
    return {
      security: { ...base.security, ...overrides.security },
      performance: { ...base.performance, ...overrides.performance },
      backup: { ...base.backup, ...overrides.backup },
      quota: { ...base.quota, ...overrides.quota }
    };
  }

  static validateConfig(config: EnterpriseConfig): string[] {
    const errors: string[] = [];

    // Validate security config
    if (config.security.sessionTimeout < 5 * 60 * 1000) {
      errors.push('Session timeout must be at least 5 minutes');
    }
    if (config.security.maxLoginAttempts < 1) {
      errors.push('Max login attempts must be at least 1');
    }

    // Validate performance config
    if (config.performance.cacheMaxSize < 1024 * 1024) {
      errors.push('Cache max size must be at least 1MB');
    }
    if (config.performance.cacheTTL < 1000) {
      errors.push('Cache TTL must be at least 1 second');
    }
    if (config.performance.metricsInterval < 1000) {
      errors.push('Metrics interval must be at least 1 second');
    }

    // Validate backup config
    if (config.backup.retentionDays < 1) {
      errors.push('Backup retention must be at least 1 day');
    }

    // Validate quota config
    if (config.quota.defaultStorageLimit < 1024 * 1024) {
      errors.push('Default storage limit must be at least 1MB');
    }
    if (config.quota.warningThreshold < 1 || config.quota.warningThreshold > 100) {
      errors.push('Warning threshold must be between 1 and 100');
    }

    return errors;
  }
}
