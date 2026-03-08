/**
 * 内存管理器
 * 
 * 负责会话清理、内存限制、性能监控
 */

import { Session } from './types';

export interface MemoryManagerConfig {
  /** 最大会话数量 */
  maxSessions: number;
  /** 会话超时时间（毫秒） */
  sessionTimeout: number;
  /** 清理间隔（毫秒） */
  cleanupInterval: number;
  /** 内存使用警告阈值（MB） */
  memoryWarningThreshold: number;
}

const DEFAULT_CONFIG: MemoryManagerConfig = {
  maxSessions: 10000,
  sessionTimeout: 24 * 60 * 60 * 1000, // 24 小时
  cleanupInterval: 5 * 60 * 1000, // 5 分钟
  memoryWarningThreshold: 512, // 512 MB
};

export interface MemoryStats {
  sessions: number;
  oldestSession: number;
  newestSession: number;
  memoryUsageMB: number;
  lastCleanup: number;
  cleanedSessions: number;
}

export class MemoryManager {
  private config: MemoryManagerConfig;
  private cleanupTimer?: NodeJS.Timeout;
  private lastCleanup: number = 0;
  private cleanedSessions: number = 0;

  constructor(config: Partial<MemoryManagerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 启动定时清理
   */
  startCleanup(
    getSessions: () => Map<string, Session>,
    clearSession: (sessionId: string) => void
  ): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }

    this.cleanupTimer = setInterval(() => {
      this.cleanup(getSessions, clearSession);
    }, this.config.cleanupInterval);

    // 避免阻止进程退出
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }

    console.log(`[MemoryManager] Started cleanup timer (interval: ${this.config.cleanupInterval}ms)`);
  }

  /**
   * 停止定时清理
   */
  stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
  }

  /**
   * 执行清理
   */
  cleanup(
    getSessions: () => Map<string, Session>,
    clearSession: (sessionId: string) => void
  ): { removed: number; reason: string } {
    const sessions = getSessions();
    const now = Date.now();
    let removed = 0;
    const reason: string[] = [];

    // 1. 清理超时会话
    const timeoutThreshold = now - this.config.sessionTimeout;
    for (const [id, session] of sessions) {
      if (session.lastActiveAt < timeoutThreshold) {
        clearSession(id);
        removed++;
      }
    }
    if (removed > 0) {
      reason.push(`${removed} expired sessions`);
    }

    // 2. 如果会话数超过限制，清理最旧的
    if (sessions.size > this.config.maxSessions) {
      const sortedSessions = Array.from(sessions.entries())
        .sort((a, b) => a[1].lastActiveAt - b[1].lastActiveAt);
      
      const toRemove = sessions.size - this.config.maxSessions;
      for (let i = 0; i < toRemove && i < sortedSessions.length; i++) {
        clearSession(sortedSessions[i][0]);
        removed++;
      }
      reason.push(`${toRemove} oldest sessions (limit: ${this.config.maxSessions})`);
    }

    this.lastCleanup = now;
    this.cleanedSessions += removed;

    if (removed > 0) {
      console.log(`[MemoryManager] Cleaned ${removed} sessions (${reason.join(', ')})`);
    }

    return { removed, reason: reason.join(', ') };
  }

  /**
   * 检查内存使用
   */
  checkMemoryUsage(): { usageMB: number; warning: boolean; percentage: number } {
    const memUsage = process.memoryUsage();
    const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
    const heapTotalMB = Math.round(memUsage.heapTotal / 1024 / 1024);
    const percentage = Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100);
    
    const warning = heapUsedMB > this.config.memoryWarningThreshold;

    if (warning) {
      console.warn(`[MemoryManager] High memory usage: ${heapUsedMB}MB / ${heapTotalMB}MB (${percentage}%)`);
    }

    return { usageMB: heapUsedMB, warning, percentage };
  }

  /**
   * 获取统计信息
   */
  getStats(sessions: Map<string, Session>): MemoryStats {
    const now = Date.now();
    let oldestSession = now;
    let newestSession = 0;

    for (const session of sessions.values()) {
      if (session.createdAt < oldestSession) {
        oldestSession = session.createdAt;
      }
      if (session.createdAt > newestSession) {
        newestSession = session.createdAt;
      }
    }

    const { usageMB } = this.checkMemoryUsage();

    return {
      sessions: sessions.size,
      oldestSession: sessions.size > 0 ? oldestSession : 0,
      newestSession: sessions.size > 0 ? newestSession : 0,
      memoryUsageMB: usageMB,
      lastCleanup: this.lastCleanup,
      cleanedSessions: this.cleanedSessions,
    };
  }

  /**
   * 获取配置
   */
  getConfig(): MemoryManagerConfig {
    return { ...this.config };
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<MemoryManagerConfig>): void {
    this.config = { ...this.config, ...config };
    console.log(`[MemoryManager] Config updated:`, config);
  }
}

// 单例
let globalMemoryManager: MemoryManager | null = null;

export function getMemoryManager(config?: Partial<MemoryManagerConfig>): MemoryManager {
  if (!globalMemoryManager) {
    globalMemoryManager = new MemoryManager(config);
  }
  return globalMemoryManager;
}

export function initMemoryManager(config: Partial<MemoryManagerConfig> = {}): MemoryManager {
  globalMemoryManager = new MemoryManager(config);
  return globalMemoryManager;
}
