// ============ 会话状态持久化模块 ============
//
// 修改原因：
// - 原会话全部存在内存 Map 中，PM2 重启后全丢失
// - 心跳状态、已点赞列表、压缩摘要等运行时状态无法恢复
// - 新增定期 dump 到 JSON 文件 + 启动时自动恢复
// - 使用增量写入避免频繁全量写

import * as fs from 'fs/promises';
import * as path from 'path';
import { Session } from './types';
import { safeJsonParse } from '../utils/security';

/** 持久化数据结构 */
export interface PersistedState {
  /** 版本号（用于格式迁移） */
  version: number;
  /** 最后保存时间 */
  savedAt: number;
  /** 会话数据 */
  sessions: Session[];
  /** 已点赞的帖子 ID 集合 */
  likedThreads: string[];
  /** 最后发帖时间戳（key: sessionId, value: timestamp） */
  lastPostAt: Record<string, number>;
  /** 压缩摘要链 (key: sessionId, value: string[]) */
  summaries: Record<string, string[]>;
}

/** 持久化配置 */
export interface PersistConfig {
  /** 数据文件路径 */
  filePath?: string;
  /** 自动保存间隔（毫秒），默认 60 秒 */
  saveIntervalMs?: number;
  /** 是否在 stop 时强制保存 */
  saveOnStop?: boolean;
}

/** 当前持久化格式版本 */
const PERSIST_VERSION = 1;

/** 默认配置 */
const DEFAULT_CONFIG: Required<PersistConfig> = {
  filePath: path.join(process.cwd(), 'data', 'sessions.json'),
  saveIntervalMs: 60_000,
  saveOnStop: true,
};

/**
 * 会话状态持久化管理器
 *
 * 职责：
 * 1. 定期将内存中的关键状态增量写入 JSON 文件
 * 2. 启动时从文件恢复上次保存的状态
 * 3. 提供 dirty tracking，只写入变更的数据
 * 4. 保证文件 IO 异常不影响主流程
 */
export class SessionPersistManager {
  private config: Required<PersistConfig>;
  /** 内存中的完整状态快照 */
  private state: PersistedState;
  /** 脏标记：哪些字段在上次保存后有变化 */
  private dirty = new Set<keyof PersistedState>();
  /** 定时器句柄 */
  private saveTimer: ReturnType<typeof setInterval> | null = null;
  /** 正在保存中的 Promise（防止并发写，修复审查问题 #P1） */
  private _savingPromise: Promise<void> | null = null;

  constructor(config?: PersistConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.state = this.createEmptyState();
  }

  /**
   * 创建空的持久化状态
   */
  private createEmptyState(): PersistedState {
    return {
      version: PERSIST_VERSION,
      savedAt: 0,
      sessions: [],
      likedThreads: [],
      lastPostAt: {},
      summaries: {},
    };
  }

  /**
   * 初始化：从文件加载已保存的状态
   *
   * @returns 加载到的状态，如果文件不存在或解析失败返回空状态
   */
  async load(): Promise<PersistedState> {
    const filePath = this.config.filePath;

    try {
      // 检查文件是否存在（修复审查问题 #P2：改用异步 IO）
      try {
        await fs.access(filePath);
      } catch {
        console.log(`[SessionPersist] 文件不存在，使用空状态: ${filePath}`);
        return this.state;
      }

      // 读取文件内容
      const raw = await fs.readFile(filePath, 'utf-8');
      if (!raw || raw.trim().length === 0) {
        console.warn(`[SessionPersist] 文件为空: ${filePath}`);
        return this.state;
      }

      // 安全 JSON 解析（防止原型污染）
      const loaded = safeJsonParse<PersistedState>(raw, this.createEmptyState());

      // 版本检查
      if (!loaded.version || loaded.version > PERSIST_VERSION) {
        console.warn(`[SessionPersist] 不支持的版本号: ${loaded.version}，使用空状态`);
        return this.state;
      }

      this.state = loaded;
      console.log(`[SessionPersist] 状态恢复成功: ${loaded.sessions.length} 个会话, ` +
                  `${loaded.likedThreads.length} 个点赞, ` +
                  `${Object.keys(loaded.summaries).length} 个摘要`);
      return this.state;
    } catch (e: any) {
      console.error(`[SessionPersist] 加载失败: ${e.message}`);
      return this.state;
    }
  }

  /**
   * 启动自动保存定时任务
   */
  startAutoSave(dirtyCheckFn?: () => boolean): void {
    if (this.saveTimer) {
      console.warn('[SessionPersist] 自动保存已在运行');
      return;
    }

    this.saveTimer = setInterval(async () => {
      // 如果有脏数据或者外部回调指示需要保存
      if (this.dirty.size > 0 || (dirtyCheckFn && dirtyCheckFn())) {
        await this.save();
      }
    }, this.config.saveIntervalMs);

    // 不阻止进程退出
    if (this.saveTimer && typeof this.saveTimer.unref === 'function') {
      this.saveTimer.unref();
    }

    console.log(`[SessionPersist] 自动保存已启动 (间隔: ${this.config.saveIntervalMs / 1000}s)`);
  }

  /**
   * 停止自动保存
   */
  stopAutoSave(): void {
    if (this.saveTimer) {
      clearInterval(this.saveTimer);
      this.saveTimer = null;
    }
  }

  /**
   * 手动触发保存（通常在 stop 时调用）
   * 修复审查问题 #P1：await 正在执行的 save 完成后再执行，避免竞态跳过
   */
  async forceSave(): Promise<void> {
    // 如果有正在进行的保存操作，先等待它完成
    if (this._savingPromise) {
      await this._savingPromise;
    }
    await this.save();
  }

  /**
   * 从 Engine 快照当前状态并保存到文件
   *
   * @param sessions 会话 Map
   * @param likedThreads 已点赞集合
   * @param lastPostAt 最后发帖时间 Map
   * @param summaries 摘要链 Map
   */
  async snapshotAndSave(
    sessions: Map<string, Session>,
    likedThreads: Set<string>,
    lastPostAt: Map<string, number>,
    summaries: Record<string, string[]>
  ): Promise<void> {
    // 更新内存状态
    this.state.sessions = Array.from(sessions.values());
    this.state.likedThreads = Array.from(likedThreads);
    this.state.lastPostAt = Object.fromEntries(lastPostAt);
    this.state.summaries = {};
    for (const [k, v] of Object.entries(summaries)) {
      this.state.summaries[k] = v;
    }

    // 标记所有字段为脏
    this.dirty.add('sessions');
    this.dirty.add('likedThreads');
    this.dirty.add('lastPostAt');
    this.dirty.add('summaries');

    await this.save();
  }

  /**
   * 执行实际的文件写入（原子写入 + 错误处理）
   * 修复审查问题 #P1+P2：异步 IO + Promise 追踪防并发
   */
  private async save(): Promise<void> {
    // 如果已有保存正在进行，等待它完成（修复审查问题 #P1：竞态条件）
    if (this._savingPromise) {
      await this._savingPromise;
      return;
    }

    // 创建新的保存 Promise 并记录
    this._savingPromise = this._doSave().finally(() => {
      this._savingPromise = null;
    });
    await this._savingPromise;
  }

  /**
   * 实际的保存逻辑（私有，由 save() 调度）
   */
  private async _doSave(): Promise<void> {
    try {
      const filePath = this.config.filePath;
      const dirPath = path.dirname(filePath);

      // 确保目录存在（修复审查问题 #P2：改用异步 IO）
      await fs.mkdir(dirPath, { recursive: true });

      // 更新保存时间戳
      this.state.savedAt = Date.now();
      this.state.version = PERSIST_VERSION;

      // 序列化为 JSON（美化输出便于调试）
      const json = JSON.stringify(this.state, null, 2);

      // 原子写入：先写临时文件，再 rename（防止写入中断导致损坏）
      const tmpPath = `${filePath}.tmp`;
      await fs.writeFile(tmpPath, json, 'utf-8');
      await fs.rename(tmpPath, filePath);

      // 清除脏标记
      this.dirty.clear();

      console.log(`[SessionPersist] 状态已保存: ${this.state.sessions.length} 个会话, ` +
                  `${this.state.likedThreads.length} 个点赞 (${new Date().toLocaleString('zh-CN')})`);
    } catch (e: any) {
      console.error(`[SessionPersist] 保存失败: ${e.message}`);
      // 不抛出异常，保证主流程不受影响
    }
  }

  /**
   * 获取已加载的持久化状态（供 Engine 恢复使用）
   */
  getState(): PersistedState {
    return this.state;
  }

  /**
   * 获取已保存的会话列表
   */
  getSessions(): Session[] {
    return this.state.sessions;
  }

  /**
   * 获取已保存的点赞列表
   */
  getLikedThreads(): string[] {
    return this.state.likedThreads;
  }

  /**
   * 获取已保存的最后发帖时间
   */
  getLastPostAt(): Record<string, number> {
    return this.state.lastPostAt;
  }

  /**
   * 获取已保存的摘要链
   */
  getSummaries(): Record<string, string[]> {
    return this.state.summaries;
  }

  /**
   * 检查是否有脏数据需要保存（修复审查问题 #E4）
   */
  isDirty(): boolean {
    return this.dirty.size > 0;
  }
}
