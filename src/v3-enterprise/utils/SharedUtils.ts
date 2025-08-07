import * as crypto from 'crypto';
import { SecurityEvent } from '../types';
import { Logger } from '../../v1-basic/index';

/**
 * Shared utilities to eliminate code duplication across services
 */
export class SharedUtils {
  /**
   * Calculate SHA-256 checksum for data
   */
  static calculateChecksum(data: Buffer): string {
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  /**
   * Generate a unique ID
   */
  static generateId(): string {
    return crypto.randomUUID();
  }

  /**
   * Create a security event with common fields
   */
  static createSecurityEvent(
    userId: string, 
    action: string, 
    resource: string, 
    result: 'SUCCESS' | 'FAILURE' | 'BLOCKED',
    details?: Record<string, any>
  ): SecurityEvent {
    return {
      id: this.generateId(),
      timestamp: new Date(),
      userId,
      action,
      resource,
      result,
      details
    };
  }

  /**
   * Check for failed login attempts and generate alerts
   */
  static checkFailedLoginAlerts(
    securityEvents: SecurityEvent[],
    userId: string,
    maxAttempts: number = 5,
    timeWindow: number = 5 * 60 * 1000 // 5 minutes
  ): boolean {
    const recentFailures = securityEvents.filter(e => 
      e.userId === userId && 
      e.action === 'AUTH_FAILED' && 
      e.timestamp > new Date(Date.now() - timeWindow)
    );

    return recentFailures.length >= maxAttempts;
  }

  /**
   * Check for permission violations and generate alerts
   */
  static checkPermissionViolations(
    securityEvents: SecurityEvent[],
    userId: string,
    maxViolations: number = 10,
    timeWindow: number = 10 * 60 * 1000 // 10 minutes
  ): boolean {
    const recentViolations = securityEvents.filter(e => 
      e.userId === userId && 
      e.action === 'PERMISSION_DENIED' && 
      e.timestamp > new Date(Date.now() - timeWindow)
    );

    return recentViolations.length >= maxViolations;
  }

  /**
   * Validate configuration values
   */
  static validateConfigValue(value: number, min: number, name: string, max?: number): string[] {
    const errors: string[] = [];
    
    if (value < min) {
      errors.push(`${name} must be at least ${min}`);
    }
    
    if (max !== undefined && value > max) {
      errors.push(`${name} must be at most ${max}`);
    }
    
    return errors;
  }

  /**
   * Format bytes to human readable format
   */
  static formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * Calculate percentage
   */
  static calculatePercentage(part: number, total: number): number {
    return total > 0 ? (part / total) * 100 : 0;
  }

  /**
   * Deep clone an object
   */
  static deepClone<T>(obj: T): T {
    return JSON.parse(JSON.stringify(obj));
  }

  /**
   * Debounce function calls
   */
  static debounce<T extends (...args: any[]) => any>(
    func: T,
    wait: number
  ): (...args: Parameters<T>) => void {
    let timeout: NodeJS.Timeout;
    return (...args: Parameters<T>) => {
      clearTimeout(timeout);
      timeout = setTimeout(() => func(...args), wait);
    };
  }

  /**
   * Throttle function calls
   */
  static throttle<T extends (...args: any[]) => any>(
    func: T,
    limit: number
  ): (...args: Parameters<T>) => void {
    let inThrottle: boolean;
    return (...args: Parameters<T>) => {
      if (!inThrottle) {
        func(...args);
        inThrottle = true;
        setTimeout(() => inThrottle = false, limit);
      }
    };
  }
}
