import { LogContext, StructuredLog } from '../types';
import { Logger } from '../../v1-basic/index';
import * as crypto from 'crypto';

export class StructuredLogger {
  private static instance: StructuredLogger;
  private logs: StructuredLog[] = [];
  private maxLogs = 10000; // Prevent memory leaks
  private correlationIds = new Map<string, string>(); // Operation -> correlationId mapping

  private constructor() {
    this.startLogCleanup();
  }

  static getInstance(): StructuredLogger {
    if (!StructuredLogger.instance) {
      StructuredLogger.instance = new StructuredLogger();
    }
    return StructuredLogger.instance;
  }

  /**
   * Generate a correlation ID for tracking operations
   */
  generateCorrelationId(): string {
    return crypto.randomUUID();
  }

  /**
   * Set correlation ID for current operation context
   */
  setCorrelationId(operation: string, correlationId: string): void {
    this.correlationIds.set(operation, correlationId);
  }

  /**
   * Get correlation ID for current operation
   */
  getCorrelationId(operation: string): string {
    return this.correlationIds.get(operation) || this.generateCorrelationId();
  }

  /**
   * Log a debug message
   */
  debug(message: string, context: Partial<LogContext>): void {
    this.log('DEBUG', message, context);
  }

  /**
   * Log an info message
   */
  info(message: string, context: Partial<LogContext>): void {
    this.log('INFO', message, context);
    Logger.info(`[${context.operation || 'SYSTEM'}] ${message}`);
  }

  /**
   * Log a warning message
   */
  warn(message: string, context: Partial<LogContext>, error?: Error): void {
    this.log('WARN', message, context, error);
    Logger.warning(`[${context.operation || 'SYSTEM'}] ${message}`);
  }

  /**
   * Log an error message
   */
  error(message: string, context: Partial<LogContext>, error?: Error): void {
    this.log('ERROR', message, context, error);
    Logger.error(`[${context.operation || 'SYSTEM'}] ${message}${error ? `: ${error.message}` : ''}`);
  }

  /**
   * Log a fatal error message
   */
  fatal(message: string, context: Partial<LogContext>, error?: Error): void {
    this.log('FATAL', message, context, error);
    Logger.error(`[FATAL][${context.operation || 'SYSTEM'}] ${message}${error ? `: ${error.message}` : ''}`);
  }

  /**
   * Create a performance timer for operations
   */
  startTimer(operation: string, userId?: string, sessionId?: string): () => void {
    const startTime = Date.now();
    const correlationId = this.generateCorrelationId();
    this.setCorrelationId(operation, correlationId);

    this.debug('Operation started', {
      operation,
      userId,
      sessionId,
      correlationId,
      timestamp: new Date(),
      metadata: { startTime }
    });

    return () => {
      const duration = Date.now() - startTime;
      this.info('Operation completed', {
        operation,
        userId,
        sessionId,
        duration,
        correlationId,
        timestamp: new Date(),
        metadata: { duration, endTime: Date.now() }
      });
    };
  }

  /**
   * Log with security context
   */
  security(
    level: 'INFO' | 'WARN' | 'ERROR', 
    message: string, 
    context: Partial<LogContext> & { securityEvent: string }
  ): void {
    const securityContext = {
      ...context,
      operation: context.operation || 'SECURITY',
      metadata: {
        ...context.metadata,
        securityEvent: context.securityEvent,
        timestamp: new Date().toISOString()
      }
    };

    this.log(level, message, securityContext);
    
    // Also log to regular logger with security prefix
    const logMessage = `[SECURITY][${context.securityEvent}] ${message}`;
    switch (level) {
      case 'INFO':
        Logger.info(logMessage);
        break;
      case 'WARN':
        Logger.warning(logMessage);
        break;
      case 'ERROR':
        Logger.error(logMessage);
        break;
    }
  }

  /**
   * Core logging method
   */
  private log(
    level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL',
    message: string,
    context: Partial<LogContext>,
    error?: Error
  ): void {
    const correlationId = context.correlationId || 
                         (context.operation ? this.getCorrelationId(context.operation) : this.generateCorrelationId());

    const fullContext: LogContext = {
      userId: context.userId,
      sessionId: context.sessionId,
      operation: context.operation || 'UNKNOWN',
      duration: context.duration,
      correlationId,
      timestamp: context.timestamp || new Date(),
      metadata: context.metadata
    };

    const logEntry: StructuredLog = {
      level,
      message,
      context: fullContext,
      error
    };

    this.logs.push(logEntry);

    // Prevent memory leaks
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }
  }

  /**
   * Query logs by various criteria
   */
  queryLogs(criteria: {
    level?: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL';
    operation?: string;
    userId?: string;
    correlationId?: string;
    startTime?: Date;
    endTime?: Date;
    limit?: number;
  }): StructuredLog[] {
    let filteredLogs = this.logs;

    if (criteria.level) {
      filteredLogs = filteredLogs.filter(log => log.level === criteria.level);
    }

    if (criteria.operation) {
      filteredLogs = filteredLogs.filter(log => log.context.operation === criteria.operation);
    }

    if (criteria.userId) {
      filteredLogs = filteredLogs.filter(log => log.context.userId === criteria.userId);
    }

    if (criteria.correlationId) {
      filteredLogs = filteredLogs.filter(log => log.context.correlationId === criteria.correlationId);
    }

    if (criteria.startTime) {
      filteredLogs = filteredLogs.filter(log => log.context.timestamp >= criteria.startTime!);
    }

    if (criteria.endTime) {
      filteredLogs = filteredLogs.filter(log => log.context.timestamp <= criteria.endTime!);
    }

    // Sort by timestamp (newest first)
    filteredLogs.sort((a, b) => b.context.timestamp.getTime() - a.context.timestamp.getTime());

    // Apply limit
    if (criteria.limit) {
      filteredLogs = filteredLogs.slice(0, criteria.limit);
    }

    return filteredLogs;
  }

  /**
   * Get log statistics
   */
  getStats(): {
    totalLogs: number;
    logsByLevel: Record<string, number>;
    recentErrors: number;
    averageOperationDuration: number;
  } {
    const logsByLevel: Record<string, number> = {};
    let totalDuration = 0;
    let operationsWithDuration = 0;
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    let recentErrors = 0;

    for (const log of this.logs) {
      // Count by level
      logsByLevel[log.level] = (logsByLevel[log.level] || 0) + 1;

      // Count recent errors
      if ((log.level === 'ERROR' || log.level === 'FATAL') && log.context.timestamp >= oneHourAgo) {
        recentErrors++;
      }

      // Calculate duration averages
      if (log.context.duration) {
        totalDuration += log.context.duration;
        operationsWithDuration++;
      }
    }

    return {
      totalLogs: this.logs.length,
      logsByLevel,
      recentErrors,
      averageOperationDuration: operationsWithDuration > 0 ? totalDuration / operationsWithDuration : 0
    };
  }

  /**
   * Export logs in JSON format
   */
  exportLogs(criteria?: {
    startTime?: Date;
    endTime?: Date;
    level?: string;
  }): string {
    let logsToExport = this.logs;

    if (criteria) {
      logsToExport = this.queryLogs({
        ...criteria,
        level: criteria.level as 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL' | undefined
      });
    }

    return JSON.stringify(logsToExport, null, 2);
  }

  /**
   * Start periodic log cleanup
   */
  private startLogCleanup(): void {
    setInterval(() => {
      const oldLogCount = this.logs.length;
      
      // Remove logs older than 24 hours
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      this.logs = this.logs.filter(log => log.context.timestamp >= oneDayAgo);
      
      // Clean up correlation ID mappings
      const activeOperations = new Set(this.logs.map(log => log.context.operation));
      for (const [operation] of Array.from(this.correlationIds.entries())) {
        if (!activeOperations.has(operation)) {
          this.correlationIds.delete(operation);
        }
      }

      if (oldLogCount > this.logs.length) {
        Logger.info(`[STRUCTURED_LOGGER] Cleaned up ${oldLogCount - this.logs.length} old logs`);
      }
    }, 60 * 60 * 1000); // Run cleanup every hour
  }

  /**
   * Clear all logs (for testing or emergency cleanup)
   */
  clear(): void {
    this.logs.length = 0;
    this.correlationIds.clear();
    Logger.info('[STRUCTURED_LOGGER] All logs cleared');
  }
}
