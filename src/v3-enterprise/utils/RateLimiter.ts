import { RateLimitConfig, RateLimitEntry, ErrorCodes, FileSystemError } from '../types';
import { Logger } from '../../v1-basic/index';

export class RateLimiter {
  private limits = new Map<string, RateLimitEntry>();
  private config: RateLimitConfig;

  constructor(config: RateLimitConfig = {
    windowSizeMs: 60 * 1000, // 1 minute
    maxRequests: 100,
    blockDurationMs: 5 * 60 * 1000 // 5 minutes
  }) {
    this.config = config;
    this.startCleanup();
  }

  /**
   * Check if a request should be allowed for the given identifier
   */
  checkLimit(identifier: string): { allowed: boolean; error?: FileSystemError } {
    const now = Date.now();
    const entry = this.limits.get(identifier);

    // Check if currently blocked
    if (entry?.blocked && now < entry.blockUntil) {
      return {
        allowed: false,
        error: {
          code: ErrorCodes.RATE_LIMITED,
          message: `Rate limited. Try again in ${Math.ceil((entry.blockUntil - now) / 1000)} seconds`,
          context: { identifier, blockUntil: new Date(entry.blockUntil) },
          timestamp: new Date()
        }
      };
    }

    // Initialize or reset if window expired
    if (!entry || now >= entry.resetTime) {
      this.limits.set(identifier, {
        count: 1,
        resetTime: now + this.config.windowSizeMs,
        blocked: false,
        blockUntil: 0
      });
      return { allowed: true };
    }

    // Increment count
    entry.count++;

    // Check if limit exceeded
    if (entry.count > this.config.maxRequests) {
      entry.blocked = true;
      entry.blockUntil = now + this.config.blockDurationMs;
      
      Logger.warning(`[RATE_LIMITER] Blocking ${identifier} for ${this.config.blockDurationMs}ms`);
      
      return {
        allowed: false,
        error: {
          code: ErrorCodes.RATE_LIMITED,
          message: `Rate limit exceeded. Blocked for ${this.config.blockDurationMs / 1000} seconds`,
          context: { 
            identifier, 
            count: entry.count, 
            limit: this.config.maxRequests,
            blockUntil: new Date(entry.blockUntil)
          },
          timestamp: new Date()
        }
      };
    }

    return { allowed: true };
  }

  /**
   * Get current rate limit status for identifier
   */
  getStatus(identifier: string): {
    count: number;
    limit: number;
    resetTime: Date;
    blocked: boolean;
    blockUntil?: Date;
  } {
    const entry = this.limits.get(identifier);
    const now = Date.now();

    if (!entry || now >= entry.resetTime) {
      return {
        count: 0,
        limit: this.config.maxRequests,
        resetTime: new Date(now + this.config.windowSizeMs),
        blocked: false
      };
    }

    return {
      count: entry.count,
      limit: this.config.maxRequests,
      resetTime: new Date(entry.resetTime),
      blocked: entry.blocked && now < entry.blockUntil,
      blockUntil: entry.blocked ? new Date(entry.blockUntil) : undefined
    };
  }

  /**
   * Manually reset rate limit for identifier
   */
  resetLimit(identifier: string): void {
    this.limits.delete(identifier);
    Logger.info(`[RATE_LIMITER] Reset limit for ${identifier}`);
  }

  /**
   * Get statistics for all rate limited identifiers
   */
  getStats(): {
    totalIdentifiers: number;
    activeBlocks: number;
    totalRequests: number;
  } {
    const now = Date.now();
    let activeBlocks = 0;
    let totalRequests = 0;

    for (const entry of this.limits.values()) {
      totalRequests += entry.count;
      if (entry.blocked && now < entry.blockUntil) {
        activeBlocks++;
      }
    }

    return {
      totalIdentifiers: this.limits.size,
      activeBlocks,
      totalRequests
    };
  }

  /**
   * Clean up expired entries
   */
  private startCleanup(): void {
    setInterval(() => {
      const now = Date.now();
      let cleaned = 0;

      for (const [identifier, entry] of Array.from(this.limits.entries())) {
        if (now >= entry.resetTime && (!entry.blocked || now >= entry.blockUntil)) {
          this.limits.delete(identifier);
          cleaned++;
        }
      }

      if (cleaned > 0) {
        Logger.info(`[RATE_LIMITER] Cleaned up ${cleaned} expired entries`);
      }
    }, this.config.windowSizeMs);
  }

  /**
   * Shutdown and cleanup resources
   */
  shutdown(): void {
    this.limits.clear();
  }
}
