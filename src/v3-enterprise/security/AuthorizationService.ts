import { EventEmitter } from 'events';
import * as crypto from 'crypto';
import { 
  SessionToken, 
  Permission, 
  Role, 
  SecurityEvent 
} from '../types';
import { Logger } from '../../v1-basic/index';

export class AuthorizationService extends EventEmitter {
  private roles = new Map<string, Role>();
  private securityEvents: SecurityEvent[] = [];

  constructor() {
    super();
    this.initializeDefaultRoles();
  }

  private initializeDefaultRoles(): void {
    const roles: Role[] = [
      {
        name: 'ADMIN',
        permissions: [
          { resource: '*', actions: ['*'] }
        ],
        description: 'Full system access'
      },
      {
        name: 'HR_MANAGER',
        permissions: [
          { resource: 'health_records', actions: ['read'], conditions: { department: 'own' } },
          { resource: 'claims', actions: ['read', 'write'], conditions: { department: 'own' } },
          { resource: 'personal_files', actions: ['read', 'write'] }
        ],
        description: 'HR department manager access'
      },
      {
        name: 'EMPLOYEE',
        permissions: [
          { resource: 'files', actions: ['read', 'write'] },
          { resource: 'personal_files', actions: ['read', 'write'] },
          { resource: 'health_records', actions: ['read'], conditions: { owner: 'self' } }
        ],
        description: 'Basic employee access'
      }
    ];

    roles.forEach(role => this.roles.set(role.name, role));
  }

  async checkPermission(session: SessionToken, resource: string, action: string): Promise<boolean> {
    for (const roleName of session.roles) {
      const role = this.roles.get(roleName);
      if (!role) continue;

      for (const permission of role.permissions) {
        if (this.matchesPermission(permission, resource, action)) {
          this.logSecurityEvent(session.userId, 'PERMISSION_GRANTED', resource, 'SUCCESS', { action, role: roleName });
          return true;
        }
      }
    }

    this.logSecurityEvent(session.userId, 'PERMISSION_DENIED', resource, 'BLOCKED', { action });
    return false;
  }

  private matchesPermission(permission: Permission, resource: string, action: string): boolean {
    // Check resource match
    if (permission.resource !== '*' && permission.resource !== resource) {
      return false;
    }

    // Check action match
    if (!permission.actions.includes('*') && !permission.actions.includes(action)) {
      return false;
    }

    // Check conditions (simplified implementation)
    if (permission.conditions) {
      // Implement condition checking logic here
      // For now, return true for conditions
      return true;
    }

    return true;
  }

  async createRole(name: string, permissions: Permission[], description: string): Promise<void> {
    const role: Role = { name, permissions, description };
    this.roles.set(name, role);
    this.logSecurityEvent('system', 'ROLE_CREATED', 'role', 'SUCCESS', { roleName: name });
    Logger.info(`[AUTH] Role ${name} created: ${description}`);
  }

  async updateRole(name: string, permissions: Permission[], description: string): Promise<void> {
    if (this.roles.has(name)) {
      const role: Role = { name, permissions, description };
      this.roles.set(name, role);
      this.logSecurityEvent('system', 'ROLE_UPDATED', 'role', 'SUCCESS', { roleName: name });
      Logger.info(`[AUTH] Role ${name} updated: ${description}`);
    }
  }

  async deleteRole(name: string): Promise<void> {
    if (this.roles.has(name)) {
      this.roles.delete(name);
      this.logSecurityEvent('system', 'ROLE_DELETED', 'role', 'SUCCESS', { roleName: name });
      Logger.info(`[AUTH] Role ${name} deleted`);
    }
  }

  getRole(name: string): Role | undefined {
    return this.roles.get(name);
  }

  getAllRoles(): Role[] {
    return Array.from(this.roles.values());
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
    // Check for permission violations
    if (action === 'PERMISSION_DENIED') {
      const recentViolations = this.securityEvents.filter(e => 
        e.userId === userId && 
        e.action === 'PERMISSION_DENIED' && 
        e.timestamp > new Date(Date.now() - 10 * 60 * 1000) // Last 10 minutes
      );

      if (recentViolations.length >= 10) {
        this.emit('securityAlert', {
          type: 'SECURITY',
          severity: 'MEDIUM',
          message: `Multiple permission violations for user ${userId}`,
          metadata: { userId, violationCount: recentViolations.length }
        });
      }
    }
  }

  getSecurityEvents(limit: number = 100): SecurityEvent[] {
    return this.securityEvents.slice(-limit);
  }
}
