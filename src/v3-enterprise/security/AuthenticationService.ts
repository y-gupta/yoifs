import { EventEmitter } from 'events';
import * as crypto from 'crypto';
import { 
  UserCredentials, 
  AuthResult, 
  SessionToken, 
  SecurityEvent,
  SecurityConfig 
} from '../types';
import { Logger } from '../../v1-basic/index';
import { SharedUtils } from '../utils/SharedUtils';
import { RateLimiter } from '../utils/RateLimiter';
import { StructuredLogger } from '../utils/StructuredLogger';
import { ErrorCodes } from '../types';
// Note: In production, use bcrypt package: npm install bcrypt @types/bcrypt

export class AuthenticationService extends EventEmitter {
  private users = new Map<string, { 
    password: string; 
    roles: string[]; 
    mfaEnabled: boolean;
    salt: string;
    lastLoginAttempt?: Date;
    failedLoginAttempts: number;
    lockedUntil?: Date;
  }>();
  private sessions = new Map<string, SessionToken>();
  private securityEvents: SecurityEvent[] = [];
  private config: SecurityConfig;
  private cleanupInterval?: NodeJS.Timeout;
  private maxSecurityEvents = 1000; // Limit security events to prevent memory leaks
  private rateLimiter: RateLimiter;
  private logger: StructuredLogger;
  private initializationPromise: Promise<void>;

  constructor(config: SecurityConfig) {
    super();
    this.config = config;
    this.rateLimiter = new RateLimiter({
      windowSizeMs: 15 * 60 * 1000, // 15 minutes
      maxRequests: config.maxLoginAttempts || 5,
      blockDurationMs: config.lockoutDuration || 15 * 60 * 1000
    });
    this.logger = StructuredLogger.getInstance();
    this.initializationPromise = this.initializeDefaultRoles();
    this.startAutomaticCleanup();
  }

  private async hashPassword(password: string, salt: string): Promise<string> {
    // Enhanced PBKDF2 with higher iterations for better security
    // In production, replace with bcrypt: await bcrypt.hash(password, 12)
    return new Promise((resolve, reject) => {
      crypto.pbkdf2(password, salt, 210000, 64, 'sha512', (err, derivedKey) => {
        if (err) reject(err);
        else resolve(derivedKey.toString('hex'));
      });
    });
  }

  private generateSalt(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  private async verifyPassword(password: string, hash: string, salt: string): Promise<boolean> {
    try {
      const computedHash = await this.hashPassword(password, salt);
      return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(computedHash, 'hex'));
    } catch (error) {
      return false;
    }
  }

  private async initializeDefaultRoles(): Promise<void> {
    // Create default admin user with hashed password
    const salt = this.generateSalt();
    const hashedPassword = await this.hashPassword('admin123', salt);
    
    this.users.set('admin', {
      password: hashedPassword,
      salt: salt,
      roles: ['ADMIN'],
      mfaEnabled: false,
      failedLoginAttempts: 0
    });
    
    Logger.info('[AUTH] Default admin user created with hashed password');
  }

  async authenticateUser(credentials: UserCredentials): Promise<AuthResult> {
    // Ensure initialization is complete
    await this.initializationPromise;
    
    const startTime = Date.now();
    const correlationId = this.logger.generateCorrelationId();
    
    try {
      // Check rate limiting first
      const rateLimitCheck = this.rateLimiter.checkLimit(`auth:${credentials.username}`);
      if (!rateLimitCheck.allowed) {
        this.logger.security('WARN', 'Authentication rate limited', {
          operation: 'AUTH',
          userId: credentials.username,
          correlationId,
          securityEvent: 'RATE_LIMITED',
          metadata: { error: rateLimitCheck.error }
        });
        
        return {
          success: false,
          error: rateLimitCheck.error?.message || 'Too many login attempts'
        };
      }

      const user = this.users.get(credentials.username);
      if (!user) {
        this.logSecurityEvent(credentials.username, 'AUTH_FAILED', 'user', 'FAILURE', { 
          reason: 'user_not_found',
          correlationId 
        });
        return { success: false, error: 'Invalid credentials' };
      }

      // Check if account is locked
      if (user.lockedUntil && user.lockedUntil > new Date()) {
        this.logSecurityEvent(credentials.username, 'AUTH_BLOCKED', 'user', 'BLOCKED', { 
          reason: 'account_locked',
          lockedUntil: user.lockedUntil,
          correlationId 
        });
        return { success: false, error: 'Account temporarily locked' };
      }

      // Verify password using hash comparison
      const isValidPassword = await this.verifyPassword(credentials.password, user.password, user.salt);
      if (!isValidPassword) {
        // Increment failed attempts
        user.failedLoginAttempts++;
        user.lastLoginAttempt = new Date();
        
        // Lock account if too many failures
        if (user.failedLoginAttempts >= this.config.maxLoginAttempts) {
          user.lockedUntil = new Date(Date.now() + this.config.lockoutDuration);
          this.logger.security('ERROR', 'Account locked due to failed attempts', {
            operation: 'AUTH',
            userId: credentials.username,
            correlationId,
            securityEvent: 'ACCOUNT_LOCKED',
            metadata: { failedAttempts: user.failedLoginAttempts }
          });
        }
        
        this.logSecurityEvent(credentials.username, 'AUTH_FAILED', 'user', 'FAILURE', { 
          reason: 'invalid_password',
          failedAttempts: user.failedLoginAttempts,
          correlationId 
        });
        return { success: false, error: 'Invalid credentials' };
      }

      // Verify MFA if enabled
      if (user.mfaEnabled && !credentials.mfaToken) {
        this.logSecurityEvent(credentials.username, 'AUTH_FAILED', 'user', 'FAILURE', { 
          reason: 'mfa_required',
          correlationId 
        });
        return { success: false, error: 'MFA token required' };
      }

      // Reset failed attempts on successful login
      user.failedLoginAttempts = 0;
      user.lockedUntil = undefined;
      user.lastLoginAttempt = new Date();

      // Create session
      const sessionToken: SessionToken = {
        id: crypto.randomUUID(),
        userId: credentials.username,
        roles: user.roles,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + this.config.sessionTimeout),
        lastActivity: new Date()
      };

      this.sessions.set(sessionToken.id, sessionToken);
      this.emit('sessionCreated', sessionToken);

      this.logSecurityEvent(credentials.username, 'AUTH_SUCCESS', 'user', 'SUCCESS', {
        correlationId,
        sessionId: sessionToken.id
      });
      
      const authTime = Date.now() - startTime;
      this.emit('authMetrics', { authTime });
      
      this.logger.info('User authenticated successfully', {
        operation: 'AUTH',
        userId: credentials.username,
        duration: authTime,
        correlationId
      });

      return {
        success: true,
        sessionToken: sessionToken.id,
        userId: credentials.username,
        roles: user.roles,
        expiresAt: sessionToken.expiresAt
      };

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logSecurityEvent(credentials.username, 'AUTH_ERROR', 'user', 'FAILURE', { 
        error: errorMessage,
        correlationId 
      });
      
      this.logger.error('Authentication error', {
        operation: 'AUTH',
        userId: credentials.username,
        correlationId
      }, error as Error);
      
      return { success: false, error: 'Authentication failed' };
    }
  }

  async validateSession(sessionToken: string): Promise<SessionToken | null> {
    const session = this.sessions.get(sessionToken);
    if (!session || session.expiresAt < new Date()) {
      return null;
    }

    // Update last activity
    session.lastActivity = new Date();
    return session;
  }

  async revokeSession(sessionToken: string): Promise<void> {
    const session = this.sessions.get(sessionToken);
    if (session) {
      this.sessions.delete(sessionToken);
      this.logSecurityEvent(session.userId, 'SESSION_REVOKED', 'session', 'SUCCESS');
      this.emit('sessionRevoked', session);
    }
  }

  async createUser(username: string, password: string, roles: string[]): Promise<void> {
    // Hash the password before storing
    const salt = this.generateSalt();
    const hashedPassword = await this.hashPassword(password, salt);
    
    this.users.set(username, { 
      password: hashedPassword,
      salt: salt,
      roles, 
      mfaEnabled: false,
      failedLoginAttempts: 0
    });
    
    this.logSecurityEvent('system', 'USER_CREATED', 'user', 'SUCCESS', { username, roles });
    Logger.info(`[AUTH] User ${username} created with roles: ${roles.join(', ')}`);
  }

  async enableMFA(username: string): Promise<void> {
    const user = this.users.get(username);
    if (user) {
      user.mfaEnabled = true;
      this.logSecurityEvent('system', 'MFA_ENABLED', 'user', 'SUCCESS', { username });
      Logger.info(`[AUTH] MFA enabled for user ${username}`);
    }
  }

  private logSecurityEvent(userId: string, action: string, resource: string, result: 'SUCCESS' | 'FAILURE' | 'BLOCKED', details?: Record<string, any>): void {
    const event: SecurityEvent = {
      id: crypto.randomUUID(),
      timestamp: new Date(),
      userId,
      action,
      resource,
      result,
      details
    };

    this.securityEvents.push(event);
    this.emit('securityEvent', event);

    // Check for security alerts
    this.checkSecurityAlerts(userId, action, result);
  }

  private checkSecurityAlerts(userId: string, action: string, result: 'SUCCESS' | 'FAILURE' | 'BLOCKED'): void {
    // Check for failed login attempts
    if (action === 'AUTH_FAILED') {
      const recentFailures = this.securityEvents.filter(e => 
        e.userId === userId && 
        e.action === 'AUTH_FAILED' && 
        e.timestamp > new Date(Date.now() - 5 * 60 * 1000) // Last 5 minutes
      );

      if (recentFailures.length >= this.config.maxLoginAttempts) {
        this.emit('securityAlert', {
          type: 'SECURITY',
          severity: 'HIGH',
          message: `Multiple failed login attempts for user ${userId}`,
          metadata: { userId, failureCount: recentFailures.length }
        });
      }
    }
  }

  getActiveSessions(): number {
    return this.sessions.size;
  }

  getSecurityEvents(limit: number = 100): SecurityEvent[] {
    return this.securityEvents.slice(-limit);
  }

  cleanupExpiredSessions(): void {
    const now = new Date();
    let expiredCount = 0;
    
    for (const [sessionId, session] of Array.from(this.sessions.entries())) {
      if (session.expiresAt < now) {
        this.sessions.delete(sessionId);
        this.logSecurityEvent(session.userId, 'SESSION_EXPIRED', 'session', 'SUCCESS');
        expiredCount++;
      }
    }
    
    if (expiredCount > 0) {
      Logger.info(`[AUTH] Cleaned up ${expiredCount} expired sessions`);
    }
  }

  private startAutomaticCleanup(): void {
    // Clean up expired sessions every 5 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredSessions();
      this.cleanupSecurityEvents();
    }, 5 * 60 * 1000); // 5 minutes
    
    Logger.info('[AUTH] Automatic cleanup started');
  }

  private cleanupSecurityEvents(): void {
    // Keep only the most recent security events to prevent memory leaks
    if (this.securityEvents.length > this.maxSecurityEvents) {
      const eventsToRemove = this.securityEvents.length - this.maxSecurityEvents;
      this.securityEvents.splice(0, eventsToRemove);
      Logger.info(`[AUTH] Cleaned up ${eventsToRemove} old security events`);
    }
  }

  shutdown(): void {
    // Clean up resources when shutting down
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    
    // Clear all sessions and events
    this.sessions.clear();
    this.securityEvents.length = 0;
    
    Logger.info('[AUTH] AuthenticationService shut down');
  }
}
