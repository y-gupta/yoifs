import { 
  CircuitBreakerConfig, 
  CircuitBreakerState, 
  CircuitState, 
  ErrorCodes, 
  FileSystemError 
} from '../types';
import { Logger } from '../../v1-basic/index';

export class CircuitBreaker {
  private state: CircuitBreakerState;
  private config: CircuitBreakerConfig;
  private successCount = 0;

  constructor(config: CircuitBreakerConfig = {
    failureThreshold: 5,
    recoveryTimeMs: 60000, // 1 minute
    monitoringPeriodMs: 10000, // 10 seconds
    expectedErrorRate: 0.5 // 50% error rate threshold
  }) {
    this.config = config;
    this.state = {
      state: CircuitState.CLOSED,
      failureCount: 0,
      lastFailureTime: 0,
      nextAttemptTime: 0
    };
    
    this.startMonitoring();
  }

  /**
   * Execute an operation through the circuit breaker
   */
  async execute<T>(
    operation: () => Promise<T>,
    fallback?: () => Promise<T>
  ): Promise<T> {
    const canExecute = this.canExecute();
    
    if (!canExecute.allowed) {
      if (fallback) {
        Logger.info('[CIRCUIT_BREAKER] Using fallback due to open circuit');
        return await fallback();
      }
      throw new Error(canExecute.error?.message || 'Circuit breaker is open');
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure(error as Error);
      throw error;
    }
  }

  /**
   * Check if operation can be executed
   */
  private canExecute(): { allowed: boolean; error?: FileSystemError } {
    const now = Date.now();

    switch (this.state.state) {
      case CircuitState.CLOSED:
        return { allowed: true };

      case CircuitState.OPEN:
        if (now >= this.state.nextAttemptTime) {
          this.state.state = CircuitState.HALF_OPEN;
          Logger.info('[CIRCUIT_BREAKER] Transitioning to HALF_OPEN state');
          return { allowed: true };
        }
        
        return {
          allowed: false,
          error: {
            code: ErrorCodes.SYSTEM_ERROR,
            message: `Circuit breaker is OPEN. Next attempt in ${Math.ceil((this.state.nextAttemptTime - now) / 1000)} seconds`,
            context: { 
              state: this.state.state,
              failureCount: this.state.failureCount,
              nextAttemptTime: new Date(this.state.nextAttemptTime)
            },
            timestamp: new Date()
          }
        };

      case CircuitState.HALF_OPEN:
        return { allowed: true };

      default:
        return { allowed: false };
    }
  }

  /**
   * Handle successful operation
   */
  private onSuccess(): void {
    this.successCount++;

    if (this.state.state === CircuitState.HALF_OPEN) {
      // Reset to closed after successful recovery
      this.state = {
        state: CircuitState.CLOSED,
        failureCount: 0,
        lastFailureTime: 0,
        nextAttemptTime: 0
      };
      this.successCount = 0;
      Logger.info('[CIRCUIT_BREAKER] Reset to CLOSED state after successful recovery');
    } else if (this.state.state === CircuitState.CLOSED) {
      // Gradually reset failure count on sustained success
      if (this.successCount >= this.config.failureThreshold) {
        this.state.failureCount = Math.max(0, this.state.failureCount - 1);
        this.successCount = 0;
      }
    }
  }

  /**
   * Handle failed operation
   */
  private onFailure(error: Error): void {
    const now = Date.now();
    this.state.failureCount++;
    this.state.lastFailureTime = now;
    this.successCount = 0;

    Logger.warning(`[CIRCUIT_BREAKER] Operation failed: ${error.message}`);

    if (this.state.state === CircuitState.HALF_OPEN) {
      // Failed during recovery, back to open
      this.state.state = CircuitState.OPEN;
      this.state.nextAttemptTime = now + this.config.recoveryTimeMs;
      Logger.warning('[CIRCUIT_BREAKER] Failed during HALF_OPEN, returning to OPEN state');
    } else if (this.state.state === CircuitState.CLOSED && 
               this.state.failureCount >= this.config.failureThreshold) {
      // Too many failures, open the circuit
      this.state.state = CircuitState.OPEN;
      this.state.nextAttemptTime = now + this.config.recoveryTimeMs;
      Logger.error(`[CIRCUIT_BREAKER] Opening circuit after ${this.state.failureCount} failures`);
    }
  }

  /**
   * Get current circuit breaker status
   */
  getStatus(): {
    state: CircuitState;
    failureCount: number;
    successCount: number;
    lastFailureTime?: Date;
    nextAttemptTime?: Date;
  } {
    return {
      state: this.state.state,
      failureCount: this.state.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.state.lastFailureTime > 0 ? new Date(this.state.lastFailureTime) : undefined,
      nextAttemptTime: this.state.nextAttemptTime > 0 ? new Date(this.state.nextAttemptTime) : undefined
    };
  }

  /**
   * Force circuit state change (for testing/admin purposes)
   */
  forceState(newState: CircuitState): void {
    const oldState = this.state.state;
    this.state.state = newState;
    
    if (newState === CircuitState.CLOSED) {
      this.state.failureCount = 0;
      this.state.lastFailureTime = 0;
      this.state.nextAttemptTime = 0;
    }

    Logger.info(`[CIRCUIT_BREAKER] Forced state change: ${oldState} -> ${newState}`);
  }

  /**
   * Start monitoring and periodic health checks
   */
  private startMonitoring(): void {
    setInterval(() => {
      const status = this.getStatus();
      
      // Log status periodically for observability
      Logger.info(`[CIRCUIT_BREAKER] Status: ${status.state}, Failures: ${status.failureCount}, Successes: ${status.successCount}`);
      
      // Auto-recovery logic for long-open circuits
      if (status.state === CircuitState.OPEN && 
          status.nextAttemptTime && 
          Date.now() >= status.nextAttemptTime.getTime()) {
        Logger.info('[CIRCUIT_BREAKER] Auto-transitioning to HALF_OPEN for recovery attempt');
      }
    }, this.config.monitoringPeriodMs);
  }

  /**
   * Reset circuit breaker to initial state
   */
  reset(): void {
    this.state = {
      state: CircuitState.CLOSED,
      failureCount: 0,
      lastFailureTime: 0,
      nextAttemptTime: 0
    };
    this.successCount = 0;
    Logger.info('[CIRCUIT_BREAKER] Reset to initial state');
  }
}
