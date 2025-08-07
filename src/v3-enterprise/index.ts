// ============================================================================
// ENTERPRISE YOIFS - MODULAR ARCHITECTURE
// ============================================================================

// Core exports
export { EnterpriseFileSystem } from './core/EnterpriseFileSystem';
export { FileSystemCore } from './core/FileSystemCore';

// Security exports
export { AuthenticationService } from './security/AuthenticationService';
export { AuthorizationService } from './security/AuthorizationService';

// Monitoring exports
export { MonitoringService } from './monitoring/MonitoringService';

// Performance exports
export { CacheService } from './performance/CacheService';

// Quota exports
export { QuotaService } from './quota/QuotaService';

// Encryption exports
export { EncryptionService } from './security/EncryptionService';

// Utility exports
export { ConfigFactory } from './utils/ConfigFactory';

// Type exports
export * from './types';

// ============================================================================
// CONVENIENCE FACTORY FUNCTION
// ============================================================================

import { Disk } from '../v1-basic/index';
import { EnterpriseFileSystem } from './core/EnterpriseFileSystem';
import { ConfigFactory } from './utils/ConfigFactory';
import { EnterpriseConfig } from './types';

/**
 * Creates an Enterprise File System instance with the specified configuration
 * @param disk - The disk interface to use for storage
 * @param config - Optional configuration, uses default if not provided
 * @returns EnterpriseFileSystem instance
 */
export function createEnterpriseFileSystem(disk: Disk, config?: EnterpriseConfig): EnterpriseFileSystem {
  const finalConfig = config || ConfigFactory.createDefaultConfig();
  
  // Validate configuration
  const errors = ConfigFactory.validateConfig(finalConfig);
  if (errors.length > 0) {
    throw new Error(`Invalid configuration: ${errors.join(', ')}`);
  }
  
  return new EnterpriseFileSystem(disk, finalConfig);
}

/**
 * Creates an Enterprise File System with healthcare-optimized configuration
 * @param disk - The disk interface to use for storage
 * @returns EnterpriseFileSystem instance with healthcare settings
 */
export function createHealthcareFileSystem(disk: Disk): EnterpriseFileSystem {
  return createEnterpriseFileSystem(disk, ConfigFactory.createHealthcareConfig());
}

/**
 * Creates an Enterprise File System with high-performance configuration
 * @param disk - The disk interface to use for storage
 * @returns EnterpriseFileSystem instance with performance settings
 */
export function createHighPerformanceFileSystem(disk: Disk): EnterpriseFileSystem {
  return createEnterpriseFileSystem(disk, ConfigFactory.createHighPerformanceConfig());
}

/**
 * Creates an Enterprise File System with high-security configuration
 * @param disk - The disk interface to use for storage
 * @returns EnterpriseFileSystem instance with security settings
 */
export function createHighSecurityFileSystem(disk: Disk): EnterpriseFileSystem {
  return createEnterpriseFileSystem(disk, ConfigFactory.createHighSecurityConfig());
}

/**
 * Creates an Enterprise File System with development configuration
 * @param disk - The disk interface to use for storage
 * @returns EnterpriseFileSystem instance with development settings
 */
export function createDevelopmentFileSystem(disk: Disk): EnterpriseFileSystem {
  return createEnterpriseFileSystem(disk, ConfigFactory.createDevelopmentConfig());
}

/**
 * Creates an Enterprise File System with production configuration
 * @param disk - The disk interface to use for storage
 * @returns EnterpriseFileSystem instance with production settings
 */
export function createProductionFileSystem(disk: Disk): EnterpriseFileSystem {
  return createEnterpriseFileSystem(disk, ConfigFactory.createProductionConfig());
}
