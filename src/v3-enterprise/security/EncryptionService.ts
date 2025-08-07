import { EventEmitter } from 'events';
import * as crypto from 'crypto';
import { 
  SecurityConfig,
  SecurityEvent 
} from '../types';
import { Logger } from '../../v1-basic/index';

export interface EncryptionKey {
  id: string;
  algorithm: string;
  key: Buffer;
  createdAt: Date;
  expiresAt: Date;
  isActive: boolean;
  usageCount: number;
}

export interface EncryptedData {
  keyId: string;
  algorithm: string;
  iv: Buffer;
  encryptedData: Buffer;
  authTag?: Buffer; // For GCM mode
  metadata?: Record<string, any>;
}

export interface KeyRotationPolicy {
  rotationDays: number;
  overlapDays: number;
  maxKeyAge: number;
  algorithm: string;
}

export class EncryptionService extends EventEmitter {
  private keys = new Map<string, EncryptionKey>();
  private config: SecurityConfig;
  private currentKeyId: string | null = null;
  private keyRotationTimer: NodeJS.Timeout | null = null;

  constructor(config: SecurityConfig) {
    super();
    this.config = config;
    this.initializeEncryption();
  }

  private initializeEncryption(): void {
    // Generate initial encryption key
    this.generateNewKey();
    
    // Set up key rotation timer (disabled for testing)
    // this.setupKeyRotation();
    
    Logger.info('[ENCRYPTION] Encryption service initialized');
  }

  // Generate a new encryption key
  private generateNewKey(): string {
    const keyId = crypto.randomUUID();
    const algorithm = this.config.encryptionAlgorithm || 'aes-256-gcm';
    
    // Generate key based on algorithm
    let key: Buffer;
    if (algorithm.includes('aes')) {
      key = crypto.randomBytes(32); // 256-bit key
    } else if (algorithm.includes('chacha20')) {
      key = crypto.randomBytes(32); // 256-bit key
    } else {
      throw new Error(`Unsupported encryption algorithm: ${algorithm}`);
    }

    const expiresAt = new Date(Date.now() + (this.config.keyRotationDays * 24 * 60 * 60 * 1000));
    
    const encryptionKey: EncryptionKey = {
      id: keyId,
      algorithm,
      key,
      createdAt: new Date(),
      expiresAt,
      isActive: true,
      usageCount: 0
    };

    this.keys.set(keyId, encryptionKey);
    this.currentKeyId = keyId;

    Logger.info(`[ENCRYPTION] Generated new key: ${keyId}`);
    this.emit('keyGenerated', { keyId, algorithm });

    return keyId;
  }

  // Encrypt data
  async encrypt(data: Buffer, metadata?: Record<string, any>): Promise<EncryptedData> {
    if (!this.currentKeyId) {
      throw new Error('No active encryption key available');
    }

    const key = this.keys.get(this.currentKeyId);
    if (!key || !key.isActive) {
      throw new Error('Current encryption key is not available or inactive');
    }

    try {
      const algorithm = key.algorithm;
      const iv = crypto.randomBytes(16); // 128-bit IV
      
      let encryptedData: Buffer;
      let authTag: Buffer | undefined;

      if (algorithm === 'aes-256-gcm') {
        const cipher = crypto.createCipheriv(algorithm, key.key, iv);
        encryptedData = Buffer.concat([
          cipher.update(data),
          cipher.final()
        ]);
        authTag = cipher.getAuthTag();
      } else if (algorithm === 'aes-256-cbc') {
        const cipher = crypto.createCipheriv(algorithm, key.key, iv);
        encryptedData = Buffer.concat([
          cipher.update(data),
          cipher.final()
        ]);
      } else if (algorithm === 'chacha20-poly1305') {
        const cipher = crypto.createCipheriv(algorithm, key.key, iv);
        encryptedData = Buffer.concat([
          cipher.update(data),
          cipher.final()
        ]);
        authTag = cipher.getAuthTag();
      } else {
        throw new Error(`Unsupported encryption algorithm: ${algorithm}`);
      }

      // Update key usage
      key.usageCount++;
      this.keys.set(this.currentKeyId, key);

      const result: EncryptedData = {
        keyId: this.currentKeyId,
        algorithm,
        iv,
        encryptedData,
        authTag,
        metadata
      };

      this.logEncryptionEvent('ENCRYPT', true, { keyId: this.currentKeyId, dataSize: data.length });
      return result;

    } catch (error: any) {
      this.logEncryptionEvent('ENCRYPT', false, { keyId: this.currentKeyId, error: error.message });
      throw new Error(`Encryption failed: ${error.message}`);
    }
  }

  // Decrypt data
  async decrypt(encryptedData: EncryptedData): Promise<Buffer> {
    const key = this.keys.get(encryptedData.keyId);
    if (!key) {
      throw new Error(`Encryption key not found: ${encryptedData.keyId}`);
    }

    if (!key.isActive) {
      throw new Error(`Encryption key is inactive: ${encryptedData.keyId}`);
    }

    try {
      const algorithm = encryptedData.algorithm;
      let decryptedData: Buffer;

      if (algorithm === 'aes-256-gcm') {
        const decipher = crypto.createDecipheriv(algorithm, key.key, encryptedData.iv);
        if (encryptedData.authTag) {
          decipher.setAuthTag(encryptedData.authTag);
        }
        decryptedData = Buffer.concat([
          decipher.update(encryptedData.encryptedData),
          decipher.final()
        ]);
      } else if (algorithm === 'aes-256-cbc') {
        const decipher = crypto.createDecipheriv(algorithm, key.key, encryptedData.iv);
        decryptedData = Buffer.concat([
          decipher.update(encryptedData.encryptedData),
          decipher.final()
        ]);
      } else if (algorithm === 'chacha20-poly1305') {
        const decipher = crypto.createDecipheriv(algorithm, key.key, encryptedData.iv);
        if (encryptedData.authTag) {
          decipher.setAuthTag(encryptedData.authTag);
        }
        decryptedData = Buffer.concat([
          decipher.update(encryptedData.encryptedData),
          decipher.final()
        ]);
      } else {
        throw new Error(`Unsupported encryption algorithm: ${algorithm}`);
      }

      this.logEncryptionEvent('DECRYPT', true, { keyId: encryptedData.keyId, dataSize: decryptedData.length });
      return decryptedData;

    } catch (error: any) {
      this.logEncryptionEvent('DECRYPT', false, { keyId: encryptedData.keyId, error: error.message });
      throw new Error(`Decryption failed: ${error.message}`);
    }
  }

  // Rotate encryption keys
  async rotateKeys(): Promise<void> {
    Logger.info('[ENCRYPTION] Starting key rotation...');

    // Generate new key
    const newKeyId = this.generateNewKey();
    const newKey = this.keys.get(newKeyId)!;

    // Mark old key for retirement (with overlap period)
    if (this.currentKeyId && this.currentKeyId !== newKeyId) {
      const oldKey = this.keys.get(this.currentKeyId);
      if (oldKey) {
        const overlapExpiry = new Date(Date.now() + (this.config.keyRotationDays * 24 * 60 * 60 * 1000));
        oldKey.expiresAt = overlapExpiry;
        this.keys.set(this.currentKeyId, oldKey);
        
        Logger.info(`[ENCRYPTION] Marked old key ${this.currentKeyId} for retirement`);
      }
    }

    this.currentKeyId = newKeyId;

    // Clean up expired keys
    this.cleanupExpiredKeys();

    Logger.info(`[ENCRYPTION] Key rotation completed. New active key: ${newKeyId}`);
    this.emit('keyRotated', { newKeyId, oldKeyId: this.currentKeyId });
  }

  // Setup automatic key rotation
  private setupKeyRotation(): void {
    const rotationInterval = this.config.keyRotationDays * 24 * 60 * 60 * 1000; // Convert days to milliseconds
    
    this.keyRotationTimer = setInterval(() => {
      this.rotateKeys().catch(error => {
        Logger.error(`[ENCRYPTION] Key rotation failed: ${error.message}`);
        this.emit('keyRotationFailed', { error: error.message });
      });
    }, rotationInterval);

    Logger.info(`[ENCRYPTION] Key rotation scheduled every ${this.config.keyRotationDays} days`);
  }

  // Clean up expired keys
  private cleanupExpiredKeys(): void {
    const now = new Date();
    const expiredKeys: string[] = [];

    for (const [keyId, key] of Array.from(this.keys.entries())) {
      if (now > key.expiresAt) {
        expiredKeys.push(keyId);
      }
    }

    for (const keyId of expiredKeys) {
      this.keys.delete(keyId);
      Logger.info(`[ENCRYPTION] Removed expired key: ${keyId}`);
    }

    if (expiredKeys.length > 0) {
      this.emit('keysExpired', { expiredKeys });
    }
  }

  // Get current active key
  getCurrentKey(): EncryptionKey | null {
    if (!this.currentKeyId) return null;
    return this.keys.get(this.currentKeyId) || null;
  }

  // Get all keys (for admin purposes)
  getAllKeys(): EncryptionKey[] {
    return Array.from(this.keys.values());
  }

  // Manually deactivate a key
  deactivateKey(keyId: string): void {
    const key = this.keys.get(keyId);
    if (key) {
      key.isActive = false;
      this.keys.set(keyId, key);
      Logger.info(`[ENCRYPTION] Deactivated key: ${keyId}`);
      this.emit('keyDeactivated', { keyId });
    }
  }

  // Get encryption statistics
  getEncryptionStats(): {
    totalKeys: number;
    activeKeys: number;
    expiredKeys: number;
    currentKeyId: string | null;
    algorithm: string;
  } {
    const now = new Date();
    let activeKeys = 0;
    let expiredKeys = 0;

    for (const key of Array.from(this.keys.values())) {
      if (key.isActive) {
        activeKeys++;
      }
      if (now > key.expiresAt) {
        expiredKeys++;
      }
    }

    const currentKey = this.getCurrentKey();

    return {
      totalKeys: this.keys.size,
      activeKeys,
      expiredKeys,
      currentKeyId: this.currentKeyId,
      algorithm: currentKey?.algorithm || 'unknown'
    };
  }

  // Export keys for backup (encrypted)
  exportKeys(backupPassword: string): string {
    const keysData = {
      keys: Array.from(this.keys.entries()),
      currentKeyId: this.currentKeyId,
      timestamp: new Date()
    };

    const jsonData = JSON.stringify(keysData);
    const salt = crypto.randomBytes(16);
    const key = crypto.pbkdf2Sync(backupPassword, salt, 100000, 32, 'sha256');
    const iv = crypto.randomBytes(16);
    
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    const encrypted = Buffer.concat([
      cipher.update(jsonData, 'utf8'),
      cipher.final()
    ]);

    const result = Buffer.concat([salt, iv, encrypted]);
    return result.toString('base64');
  }

  // Import keys from backup
  importKeys(backupData: string, backupPassword: string): void {
    try {
      const data = Buffer.from(backupData, 'base64');
      const salt = data.subarray(0, 16);
      const iv = data.subarray(16, 32);
      const encrypted = data.subarray(32);

      const key = crypto.pbkdf2Sync(backupPassword, salt, 100000, 32, 'sha256');
      const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
      const decrypted = Buffer.concat([
        decipher.update(encrypted),
        decipher.final()
      ]);

      const keysData = JSON.parse(decrypted.toString('utf8'));
      
      this.keys = new Map(keysData.keys);
      this.currentKeyId = keysData.currentKeyId;

      Logger.info('[ENCRYPTION] Keys imported from backup');
      this.emit('keysImported', { keyCount: this.keys.size });
    } catch (error: any) {
      throw new Error(`Failed to import keys: ${error.message}`);
    }
  }

  // Logging methods
  private logEncryptionEvent(
    action: string,
    success: boolean,
    details: Record<string, any>
  ): void {
    const event: SecurityEvent = {
      id: crypto.randomUUID(),
      timestamp: new Date(),
      userId: 'system',
      action: `ENCRYPTION_${action}`,
      resource: 'encryption',
      result: success ? 'SUCCESS' : 'FAILURE',
      details
    };

    this.emit('securityEvent', event);
  }

  // Cleanup method
  cleanup(): void {
    if (this.keyRotationTimer) {
      clearInterval(this.keyRotationTimer);
      this.keyRotationTimer = null;
    }

    // Clear all keys from memory
    this.keys.clear();
    this.currentKeyId = null;

    Logger.info('[ENCRYPTION] Encryption service cleaned up');
  }
}
