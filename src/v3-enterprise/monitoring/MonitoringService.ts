import { EventEmitter } from 'events';
import { 
  PerformanceMetrics, 
  Alert, 
  PerformanceConfig 
} from '../types';
import { Logger } from '../../v1-basic/index';

export class MonitoringService extends EventEmitter {
  private metrics: PerformanceMetrics = {
    readLatency: [],
    writeLatency: [],
    throughput: 0,
    errorRate: 0,
    cpuUtilization: 0,
    memoryUtilization: 0,
    cacheHitRate: 0,
    missRate: 0,
    evictionRate: 0,
    activeConnections: 0
  };
  
  private alerts: Alert[] = [];
  private config: PerformanceConfig;
  private operationCount = 0;
  private startTime = Date.now();
  private lastMetricsUpdate = Date.now();

  constructor(config: PerformanceConfig) {
    super();
    this.config = config;
    this.startMonitoring();
  }

  private startMonitoring(): void {
    // Update metrics every interval
    setInterval(() => {
      this.updateSystemMetrics();
    }, this.config.metricsInterval);

    // Clean up old alerts (keep last 24 hours)
    setInterval(() => {
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
      this.alerts = this.alerts.filter(alert => alert.timestamp > cutoff);
    }, 60 * 60 * 1000); // Every hour
  }

  private updateSystemMetrics(): void {
    const now = Date.now();
    const uptime = now - this.startTime;
    
    // Calculate throughput
    const timeDiff = now - this.lastMetricsUpdate;
    this.metrics.throughput = (this.operationCount / timeDiff) * 1000; // ops/sec
    
    // Calculate cache hit rate
    const totalCacheAccess = this.metrics.cacheHitRate + this.metrics.missRate;
    this.metrics.cacheHitRate = totalCacheAccess > 0 ? (this.metrics.cacheHitRate / totalCacheAccess) * 100 : 0;
    
    // Simulate system metrics
    this.metrics.cpuUtilization = Math.random() * 30 + 20; // 20-50%
    this.metrics.memoryUtilization = Math.random() * 20 + 40; // 40-60%
    
    this.lastMetricsUpdate = now;
    this.operationCount = 0;

    // Only check for performance alerts if we have meaningful data
    if (totalCacheAccess > 0) {
      this.checkPerformanceAlerts();
    }
  }

  updateMetrics(metric: string, value: number): void {
    this.operationCount++;
    
    switch (metric) {
      case 'read_latency':
        this.metrics.readLatency.push(value);
        if (this.metrics.readLatency.length > 100) {
          this.metrics.readLatency.shift();
        }
        break;
      case 'write_latency':
        this.metrics.writeLatency.push(value);
        if (this.metrics.writeLatency.length > 100) {
          this.metrics.writeLatency.shift();
        }
        break;
      case 'cache_hit':
        this.metrics.cacheHitRate++;
        break;
      case 'cache_miss':
        this.metrics.missRate++;
        break;
      case 'cache_eviction':
        this.metrics.evictionRate++;
        break;
    }
  }

  updateConnectionCount(count: number): void {
    this.metrics.activeConnections = count;
  }

  private checkPerformanceAlerts(): void {
    // Check read latency P95
    if (this.metrics.readLatency.length > 0) {
      const sorted = [...this.metrics.readLatency].sort((a, b) => a - b);
      const p95 = sorted[Math.floor(sorted.length * 0.95)];
      
      if (p95 > this.config.alertThresholds.latencyP95) {
        this.createAlert('PERFORMANCE', 'HIGH', `Read latency P95 exceeded ${this.config.alertThresholds.latencyP95}ms: ${p95}ms`);
      }
    }

    // Check error rate
    if (this.metrics.errorRate > this.config.alertThresholds.errorRate) {
      this.createAlert('PERFORMANCE', 'MEDIUM', `Error rate exceeded ${this.config.alertThresholds.errorRate}%: ${this.metrics.errorRate}%`);
    }

    // Check cache hit rate
    if (this.metrics.cacheHitRate < this.config.alertThresholds.cacheHitRate) {
      this.createAlert('PERFORMANCE', 'LOW', `Cache hit rate below ${this.config.alertThresholds.cacheHitRate}%: ${this.metrics.cacheHitRate}%`);
    }
  }

  createAlert(type: Alert['type'], severity: Alert['severity'], message: string, metadata?: Record<string, any>): void {
    const alert: Alert = {
      id: this.generateId(),
      type,
      severity,
      message,
      timestamp: new Date(),
      resolved: false,
      metadata
    };

    this.alerts.push(alert);
    this.emit('alert', alert);
    
    Logger.warning(`[MONITORING] Alert: ${severity} - ${message}`);
  }

  resolveAlert(alertId: string, resolution: string): void {
    const alert = this.alerts.find(a => a.id === alertId);
    if (alert) {
      alert.resolved = true;
      Logger.info(`[MONITORING] Alert ${alertId} resolved: ${resolution}`);
    }
  }

  getPerformanceMetrics(): PerformanceMetrics {
    return { ...this.metrics };
  }

  getAlerts(resolved: boolean = false): Alert[] {
    return this.alerts.filter(alert => alert.resolved === resolved);
  }

  getSystemUptime(): number {
    return Date.now() - this.startTime;
  }

  private generateId(): string {
    return Math.random().toString(36).substr(2, 9);
  }
}
