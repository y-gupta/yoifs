// ============================================================================
// ENTERPRISE FILE SYSTEM TYPES
// ============================================================================

// Enhanced error handling with structured error codes
export enum ErrorCodes {
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  FILE_NOT_FOUND = 'FILE_NOT_FOUND',
  QUOTA_EXCEEDED = 'QUOTA_EXCEEDED',
  ENCRYPTION_FAILED = 'ENCRYPTION_FAILED',
  AUTHENTICATION_FAILED = 'AUTHENTICATION_FAILED',
  SESSION_EXPIRED = 'SESSION_EXPIRED',
  CORRUPTION_DETECTED = 'CORRUPTION_DETECTED',
  INVALID_INPUT = 'INVALID_INPUT',
  SYSTEM_ERROR = 'SYSTEM_ERROR',
  RATE_LIMITED = 'RATE_LIMITED'
}

export interface FileSystemError {
  code: ErrorCodes;
  message: string;
  context?: Record<string, unknown>;
  timestamp: Date;
  correlationId?: string;
}

export interface FileSystemResult<T> {
  success: boolean;
  data?: T;
  error?: FileSystemError;
}

// ============================================================================
// SECURITY TYPES
// ============================================================================

export interface UserCredentials {
  username: string;
  password: string;
  mfaToken?: string;
}

export interface AuthResult {
  success: boolean;
  sessionToken?: string;
  userId?: string;
  roles?: string[];
  expiresAt?: Date;
  error?: string;
}

export interface SessionToken {
  id: string;
  userId: string;
  roles: string[];
  createdAt: Date;
  expiresAt: Date;
  lastActivity: Date;
}

export interface Permission {
  resource: string;
  actions: string[];
  conditions?: Record<string, any>;
}

export interface Role {
  name: string;
  permissions: Permission[];
  description: string;
}

export interface SecurityEvent {
  id: string;
  timestamp: Date;
  userId: string;
  action: string;
  resource: string;
  result: 'SUCCESS' | 'FAILURE' | 'BLOCKED';
  ipAddress?: string;
  userAgent?: string;
  details?: Record<string, any>;
}

// ============================================================================
// MONITORING TYPES
// ============================================================================

export interface PerformanceMetrics {
  readLatency: number[];
  writeLatency: number[];
  throughput: number;
  errorRate: number;
  cpuUtilization: number;
  memoryUtilization: number;
  cacheHitRate: number;
  missRate: number;
  evictionRate: number;
  activeConnections: number;
}

export interface Alert {
  id: string;
  type: 'PERFORMANCE' | 'SECURITY' | 'CAPACITY' | 'BACKUP';
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  message: string;
  timestamp: Date;
  resolved: boolean;
  metadata?: Record<string, any>;
}

// ============================================================================
// BACKUP TYPES
// ============================================================================

export interface BackupJob {
  id: string;
  type: 'FULL' | 'INCREMENTAL' | 'DIFFERENTIAL';
  schedule: string; // Cron expression
  retention: RetentionPolicy;
  destination: BackupDestination;
  status: 'SCHEDULED' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  lastRun?: Date;
  nextRun?: Date;
}

export interface RetentionPolicy {
  days: number;
  versions: number;
  archiveAfterDays: number;
}

export interface BackupDestination {
  type: 'LOCAL' | 'S3' | 'AZURE' | 'GCP';
  path: string;
  credentials?: Record<string, string>;
}

export interface RecoveryRequest {
  fileIds: string[];
  targetTimestamp: Date;
  recoveryLocation: string;
  verificationRequired: boolean;
}

// ============================================================================
// PERFORMANCE TYPES
// ============================================================================

export interface CacheEntry {
  key: string;
  data: Buffer;
  ttl: number;
  createdAt: Date;
  accessCount: number;
  lastAccessed: Date;
}

export interface CacheStats {
  hitRate: number;
  missRate: number;
  evictionRate: number;
  memoryUtilization: number;
  totalEntries: number;
}

// ============================================================================
// QUOTA TYPES
// ============================================================================

export interface Quota {
  storageLimit: number;
  fileCountLimit: number;
  bandwidthLimit: number;
  retentionPeriod: number;
}

export interface QuotaUsage {
  entityId: string;
  entityType: 'USER' | 'GROUP' | 'DEPARTMENT';
  storageUsed: number;
  fileCount: number;
  bandwidthUsed: number;
  quota: Quota;
  lastUpdated: Date;
}

// ============================================================================
// FILE SYSTEM TYPES
// ============================================================================

export interface FileMeta {
  id: string;
  name: string;
  size: number;
  checksum: string;
  chunkRefs: string[];
  createdAt: Date;
  modifiedAt: Date;
  owner: string;
  permissions: Permission[];
  encryptionKeyId?: string;
  compressionRatio?: number;
  accessCount: number;
  lastAccessed: Date;
  tier: 'HOT' | 'WARM' | 'COLD';
}

export interface FileChunk {
  hash: string;
  compressedData: Buffer;
  originalSize: number;
  references: number;
  offset: number;
  replicaOffset: number;
  checksum: string;
  encryptionKeyId?: string;
  backupLocations: string[];
}

// ============================================================================
// CONFIGURATION TYPES
// ============================================================================

export interface SecurityConfig {
  sessionTimeout: number;
  mfaRequired: boolean;
  maxLoginAttempts: number;
  lockoutDuration: number;
  encryptionAlgorithm: string;
  keyRotationDays: number;
  hsmEnabled: boolean;
}

export interface PerformanceConfig {
  cacheMaxSize: number;
  cacheTTL: number;
  evictionPolicy: 'LRU' | 'LFU' | 'FIFO';
  metricsInterval: number;
  alertThresholds: {
    latencyP95: number;
    errorRate: number;
    cacheHitRate: number;
  };
}

export interface BackupConfig {
  retentionDays: number;
  backupInterval: string;
  destinationType: string;
  destinationPath: string;
  encryptionEnabled: boolean;
}

export interface QuotaConfig {
  defaultStorageLimit: number;
  defaultFileCountLimit: number;
  defaultBandwidthLimit: number;
  warningThreshold: number;
  enforcementEnabled: boolean;
}

export interface EnterpriseConfig {
  security: SecurityConfig;
  performance: PerformanceConfig;
  backup: BackupConfig;
  quota: QuotaConfig;
}

// ============================================================================
// LOGGING & OBSERVABILITY TYPES
// ============================================================================

export interface LogContext {
  userId?: string;
  sessionId?: string;
  operation: string;
  duration?: number;
  correlationId: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

export interface StructuredLog {
  level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL';
  message: string;
  context: LogContext;
  error?: Error;
}

// ============================================================================
// RATE LIMITING TYPES
// ============================================================================

export interface RateLimitConfig {
  windowSizeMs: number;
  maxRequests: number;
  blockDurationMs: number;
}

export interface RateLimitEntry {
  count: number;
  resetTime: number;
  blocked: boolean;
  blockUntil: number;
}

// ============================================================================
// CIRCUIT BREAKER TYPES
// ============================================================================

export enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN'
}

export interface CircuitBreakerConfig {
  failureThreshold: number;
  recoveryTimeMs: number;
  monitoringPeriodMs: number;
  expectedErrorRate: number;
}

export interface CircuitBreakerState {
  state: CircuitState;
  failureCount: number;
  lastFailureTime: number;
  nextAttemptTime: number;
}

// ============================================================================
// VALIDATION TYPES
// ============================================================================

export interface ValidationRule {
  field: string;
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  pattern?: RegExp;
  validator?: (value: unknown) => boolean;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}
