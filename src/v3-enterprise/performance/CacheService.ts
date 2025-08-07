import { EventEmitter } from 'events';
import { 
  CacheEntry, 
  CacheStats, 
  PerformanceConfig 
} from '../types';
import { Logger } from '../../v1-basic/index';

export class CacheService extends EventEmitter {
  private cache = new Map<string, CacheEntry>();
  private config: PerformanceConfig;
  private currentSize = 0;

  constructor(config: PerformanceConfig) {
    super();
    this.config = config;
  }

  async get(key: string): Promise<Buffer | null> {
    const entry = this.cache.get(key);
    if (!entry) {
      this.emit('cacheMiss', key);
      return null;
    }

    if (entry.createdAt.getTime() + entry.ttl < Date.now()) {
      this.cache.delete(key);
      this.currentSize -= entry.data.length;
      this.emit('cacheMiss', key);
      return null;
    }

    // Update access stats
    entry.accessCount++;
    entry.lastAccessed = new Date();
    this.emit('cacheHit', key);
    
    return entry.data;
  }

  async set(key: string, data: Buffer, ttl: number = this.config.cacheTTL): Promise<void> {
    // Evict if cache is full
    while (this.currentSize + data.length > this.config.cacheMaxSize) {
      this.evictFromCache();
    }

    const entry: CacheEntry = {
      key,
      data,
      ttl,
      createdAt: new Date(),
      accessCount: 0,
      lastAccessed: new Date()
    };

    this.cache.set(key, entry);
    this.currentSize += data.length;
    this.emit('cacheSet', key, data.length);
  }

  async invalidate(pattern: string): Promise<void> {
    const keysToDelete: string[] = [];
    
    for (const key of this.cache.keys()) {
      if (key.includes(pattern)) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      const entry = this.cache.get(key);
      if (entry) {
        this.currentSize -= entry.data.length;
        this.cache.delete(key);
      }
    }

    this.emit('cacheInvalidated', pattern, keysToDelete.length);
    Logger.info(`[CACHE] Invalidated ${keysToDelete.length} entries matching pattern: ${pattern}`);
  }

  private evictFromCache(): void {
    switch (this.config.evictionPolicy) {
      case 'LRU':
        this.evictLRU();
        break;
      case 'LFU':
        this.evictLFU();
        break;
      case 'FIFO':
        this.evictFIFO();
        break;
      default:
        this.evictLRU();
    }
  }

  private evictLRU(): void {
    // LRU eviction - remove least recently used
    let oldestEntry: CacheEntry | null = null;
    let oldestKey: string | null = null;

    for (const [key, entry] of this.cache.entries()) {
      if (!oldestEntry || entry.lastAccessed < oldestEntry.lastAccessed) {
        oldestEntry = entry;
        oldestKey = key;
      }
    }

    if (oldestKey && oldestEntry) {
      this.cache.delete(oldestKey);
      this.currentSize -= oldestEntry.data.length;
      this.emit('cacheEviction', oldestKey, 'LRU');
    }
  }

  private evictLFU(): void {
    // LFU eviction - remove least frequently used
    let leastFrequentEntry: CacheEntry | null = null;
    let leastFrequentKey: string | null = null;

    for (const [key, entry] of this.cache.entries()) {
      if (!leastFrequentEntry || entry.accessCount < leastFrequentEntry.accessCount) {
        leastFrequentEntry = entry;
        leastFrequentKey = key;
      }
    }

    if (leastFrequentKey && leastFrequentEntry) {
      this.cache.delete(leastFrequentKey);
      this.currentSize -= leastFrequentEntry.data.length;
      this.emit('cacheEviction', leastFrequentKey, 'LFU');
    }
  }

  private evictFIFO(): void {
    // FIFO eviction - remove first in
    const firstKey = this.cache.keys().next().value;
    if (firstKey) {
      const entry = this.cache.get(firstKey);
      if (entry) {
        this.cache.delete(firstKey);
        this.currentSize -= entry.data.length;
        this.emit('cacheEviction', firstKey, 'FIFO');
      }
    }
  }

  getStats(): CacheStats {
    const totalAccess = this.getTotalAccess();
    const hitRate = totalAccess > 0 ? (this.getHitCount() / totalAccess) * 100 : 0;
    
    return {
      hitRate,
      missRate: 100 - hitRate,
      evictionRate: this.getEvictionRate(),
      memoryUtilization: (this.currentSize / this.config.cacheMaxSize) * 100,
      totalEntries: this.cache.size
    };
  }

  private getTotalAccess(): number {
    let total = 0;
    for (const entry of this.cache.values()) {
      total += entry.accessCount;
    }
    return total;
  }

  private getHitCount(): number {
    let hits = 0;
    for (const entry of this.cache.values()) {
      hits += entry.accessCount;
    }
    return hits;
  }

  private getEvictionRate(): number {
    // This would need to be tracked over time
    // For now, return a simple calculation
    return this.cache.size > 0 ? 1 : 0;
  }

  clear(): void {
    this.cache.clear();
    this.currentSize = 0;
    this.emit('cacheCleared');
    Logger.info('[CACHE] Cache cleared');
  }

  getSize(): number {
    return this.currentSize;
  }

  getMaxSize(): number {
    return this.config.cacheMaxSize;
  }

  getEntryCount(): number {
    return this.cache.size;
  }
}
