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

export class AuthenticationService extends EventEmitter {
  private users = new Map<string, { password: string; roles: string[]; mfaEnabled: boolean }>();
  private sessions = new Map<string, SessionToken>();
  private securityEvents: SecurityEvent[] = [];
  private config: SecurityConfig;

  constructor(config: SecurityConfig) {
    super();
    this.config = config;
    this.initializeDefaultRoles();
  }

  private initializeDefaultRoles(): void {
    // Create default admin user
    this.users.set('admin', {
      password: 'admin123', // In production, use bcrypt hashed passwords
      roles: ['ADMIN'],
      mfaEnabled: false
    });
  }

  async authenticateUser(credentials: UserCredentials): Promise<AuthResult> {
    const startTime = Date.now();
    
    try {
      const user = this.users.get(credentials.username);
      if (!user) {
        this.logSecurityEvent(credentials.username, 'AUTH_FAILED', 'user', 'FAILURE', { reason: 'user_not_found' });
        return { success: false, error: 'Invalid credentials' };
      }

      // Verify password (in production, use bcrypt)
      if (user.password !== credentials.password) {
        this.logSecurityEvent(credentials.username, 'AUTH_FAILED', 'user', 'FAILURE', { reason: 'invalid_password' });
        return { success: false, error: 'Invalid credentials' };
      }

      // Verify MFA if enabled
      if (user.mfaEnabled && !credentials.mfaToken) {
        this.logSecurityEvent(credentials.username, 'AUTH_FAILED', 'user', 'FAILURE', { reason: 'mfa_required' });
        return { success: false, error: 'MFA token required' };
      }

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

      this.logSecurityEvent(credentials.username, 'AUTH_SUCCESS', 'user', 'SUCCESS');
      
      const authTime = Date.now() - startTime;
      this.emit('authMetrics', { authTime });

      return {
        success: true,
        sessionToken: sessionToken.id,
        userId: credentials.username,
        roles: user.roles,
        expiresAt: sessionToken.expiresAt
      };

    } catch (error: any) {
      this.logSecurityEvent(credentials.username, 'AUTH_ERROR', 'user', 'FAILURE', { error: error.message });
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
    this.users.set(username, { password, roles, mfaEnabled: false });
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
    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.expiresAt < now) {
        this.sessions.delete(sessionId);
        this.logSecurityEvent(session.userId, 'SESSION_EXPIRED', 'session', 'SUCCESS');
      }
    }
  }
}
