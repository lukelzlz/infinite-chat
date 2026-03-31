import { Message } from './types';
import { generateSecureId, validateApiKey } from '../utils/security';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Mem0 记忆层集成
 * 
 * 支持本地模式（JSON 文件持久化）和 Mem0 API（可选）
 */

export interface Mem0Config {
  apiKey?: string;
  organizationId?: string;
  projectId?: string;
  localMode?: boolean;
}

export interface Memory {
  id: string;
  content: string;
  userId: string;
  metadata?: Record<string, any>;
  score?: number;
  createdAt: number;
  updatedAt: number;
}

/**
 * 记忆管理器 — 带文件持久化
 */
export class Mem0Manager {
  private config: Mem0Config;
  private client: any = null;
  private localStore: Map<string, Memory[]> = new Map();
  private persistPath: string;
  private flushTimer: NodeJS.Timeout | null = null;
  private dirty: boolean = false;

  constructor(config: Mem0Config, persistPath?: string) {
    this.config = { localMode: true, ...config };
    this.persistPath = persistPath || path.join(process.cwd(), 'data', 'memory.json');

    this.loadFromDisk();
    this.flushTimer = setInterval(() => this.flushToDisk(), 30_000);

    if (!this.config.localMode && config.apiKey && !validateApiKey(config.apiKey)) {
      console.warn('[Mem0] Invalid API key format, using local mode');
      this.config.localMode = true;
    }

    if (!this.config.localMode && config.apiKey) {
      this.initClient();
    }
  }

  dispose(): void {
    if (this.flushTimer) { clearInterval(this.flushTimer); this.flushTimer = null; }
    this.flushToDisk();
  }

  // ============ 持久化 ============

  private loadFromDisk(): void {
    try {
      if (!fs.existsSync(this.persistPath)) return;
      const raw = fs.readFileSync(this.persistPath, 'utf-8');
      const data = JSON.parse(raw) as Record<string, Memory[]>;
      for (const [userId, memories] of Object.entries(data)) {
        this.localStore.set(userId, memories);
      }
      const total = Array.from(this.localStore.values()).reduce((s, m) => s + m.length, 0);
      if (total > 0) console.log(`[Mem0] Loaded ${total} memories from disk`);
    } catch (e) {
      console.warn('[Mem0] Failed to load:', (e as Error).message);
    }
  }

  private flushToDisk(): void {
    if (!this.dirty) return;
    try {
      const dir = path.dirname(this.persistPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const data: Record<string, Memory[]> = {};
      for (const [userId, memories] of this.localStore) {
        data[userId] = memories;
      }
      fs.writeFileSync(this.persistPath, JSON.stringify(data, null, 2), 'utf-8');
      this.dirty = false;
    } catch (e) {
      console.warn('[Mem0] Flush failed:', (e as Error).message);
    }
  }

  private markDirty(): void {
    this.dirty = true;
  }

  // ============ API 客户端（可选） ============

  private async initClient(): Promise<void> {
    try {
      const mem0Module = await import('mem0ai').catch(() => null);
      if (mem0Module && mem0Module.Mem0) {
        this.client = new mem0Module.Mem0({
          apiKey: this.config.apiKey,
          organizationId: this.config.organizationId,
          projectId: this.config.projectId,
        });
        console.log('[Mem0] Client initialized');
      } else {
        console.warn('[Mem0] SDK not found, local mode');
        this.config.localMode = true;
      }
    } catch (e) {
      console.warn('[Mem0] SDK load failed, local mode');
      this.config.localMode = true;
    }
  }

  // ============ 公开方法 ============

  async addMemory(messages: Message[], userId: string, metadata?: Record<string, any>): Promise<void> {
    if (this.config.localMode || !this.client) {
      return this.addMemoryLocal(messages, userId, metadata);
    }
    try {
      await this.client.add(
        messages.map(m => ({ role: m.role, content: m.content })),
        { userId, metadata }
      );
    } catch (e) {
      console.error('[Mem0] Add error:', e);
      this.addMemoryLocal(messages, userId, metadata);
    }
  }

  async searchMemory(query: string, userId: string, limit = 10): Promise<Memory[]> {
    if (this.config.localMode || !this.client) {
      return this.searchMemoryLocal(query, userId, limit);
    }
    try {
      const results = await this.client.search(query, { userId, limit });
      return results.map((r: any) => ({
        id: r.id, content: r.memory, userId: r.userId,
        score: r.score, createdAt: r.createdAt, updatedAt: r.updatedAt,
      }));
    } catch (e) {
      console.error('[Mem0] Search error:', e);
      return this.searchMemoryLocal(query, userId, limit);
    }
  }

  async getAllMemories(userId: string): Promise<Memory[]> {
    if (this.config.localMode || !this.client) {
      return this.localStore.get(userId) || [];
    }
    try {
      const results = await this.client.getAll({ userId });
      return results.map((r: any) => ({
        id: r.id, content: r.memory, userId: r.userId,
        createdAt: r.createdAt, updatedAt: r.updatedAt,
      }));
    } catch (e) {
      console.error('[Mem0] Get all error:', e);
      return this.localStore.get(userId) || [];
    }
  }

  async deleteMemory(memoryId: string): Promise<void> {
    if (this.config.localMode || !this.client) {
      for (const [, memories] of this.localStore) {
        const idx = memories.findIndex(m => m.id === memoryId);
        if (idx !== -1) { memories.splice(idx, 1); this.markDirty(); return; }
      }
      return;
    }
    try {
      await this.client.delete(memoryId);
    } catch (e) {
      console.error('[Mem0] Delete error:', e);
    }
  }

  // ============ 本地实现 ============

  private addMemoryLocal(messages: Message[], userId: string, metadata?: Record<string, any>): void {
    if (!this.localStore.has(userId)) this.localStore.set(userId, []);

    const userMessages = messages.filter(m => m.role === 'user');
    for (const msg of userMessages) {
      if (this.isImportantInfo(msg.content)) {
        const existing = this.localStore.get(userId)!;
        // 去重
        if (existing.some(m => m.content === msg.content)) continue;

        existing.push({
          id: `local-${Date.now()}-${generateSecureId(8)}`,
          content: msg.content,
          userId,
          metadata,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
        this.markDirty();
      }
    }
  }

  private searchMemoryLocal(query: string, userId: string, limit: number): Memory[] {
    const memories = this.localStore.get(userId) || [];
    const queryLower = query.toLowerCase();
    const queryChars = [...queryLower];

    return memories
      .map(m => {
        const contentLower = m.content.toLowerCase();
        // 字符级匹配 + 关键词匹配混合
        let charScore = 0;
        for (const ch of queryChars) {
          if (contentLower.includes(ch)) charScore++;
        }
        const wordScore = queryLower.split(/\\s+/).filter(w => contentLower.includes(w)).length;
        const score = charScore / Math.max(queryChars.length, 1) * 0.4 + wordScore / Math.max(queryLower.split(/\\s+/).length, 1) * 0.6;
        return { ...m, score };
      })
      .filter(m => m.score! > 0.2)
      .sort((a, b) => (b.score || 0) - (a.score || 0))
      .slice(0, limit);
  }

  private isImportantInfo(content: string): boolean {
    if (!content || content.trim().length < 5) return false;
    const patterns = [
      /我叫|我的名字|我是/i,
      /我喜欢|我讨厌|我偏好|我爱吃|我最爱/i,
      /我的工作是|我是做|职业/i,
      /我住|我在|坐标/i,
      /记得|记住|别忘了|要记住/i,
      /重要|关键|必须|一定/i,
      /生日|年龄|岁/i,
      /吧规|规矩|注意事项/i,
    ];
    return patterns.some(p => p.test(content));
  }

  private calculateRelevance(content: string, queryWords: string[]): number {
    const contentLower = content.toLowerCase();
    let score = 0;
    for (const word of queryWords) {
      if (contentLower.includes(word)) score++;
    }
    return queryWords.length > 0 ? score / queryWords.length : 0;
  }
}

/**
 * 混合记忆管理器
 */
export class HybridMemoryManager {
  private mem0: Mem0Manager;
  private shortTermWindow: number;
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(mem0Config: Mem0Config, shortTermWindow: number = 10, persistPath?: string) {
    this.mem0 = new Mem0Manager(mem0Config, persistPath);
    this.shortTermWindow = shortTermWindow;
  }

  async buildContext(
    messages: Message[],
    userId: string,
    currentQuery: string
  ): Promise<{
    systemPrompt: string;
    relevantMemories: Memory[];
  }> {
    const relevantMemories = await this.mem0.searchMemory(currentQuery, userId, 5);

    let systemPrompt = '';
    if (relevantMemories.length > 0) {
      systemPrompt = `[用户相关信息]\n${
        relevantMemories.map(m => `- ${m.content}`).join('\n')
      }\n\n请根据这些信息提供个性化回复。`;
    }

    if (messages.length > 0) {
      await this.mem0.addMemory(messages, userId);
    }

    return { systemPrompt, relevantMemories };
  }

  getMem0(): Mem0Manager {
    return this.mem0;
  }

  /** 启动定期清理过期记忆（默认保留 90 天） */
  startCleanup(intervalMs: number = 300_000, maxAgeMs: number = 90 * 24 * 3600_000): void {
    this.cleanupTimer = setInterval(() => {
      const cutoff = Date.now() - maxAgeMs;
      const store = (this.mem0 as any).localStore as Map<string, Memory[]>;
      let cleaned = 0;
      for (const [userId, memories] of store) {
        const before = memories.length;
        const filtered = memories.filter(m => m.createdAt > cutoff);
        if (filtered.length < before) {
          store.set(userId, filtered);
          cleaned += before - filtered.length;
        }
      }
      if (cleaned > 0) {
        (this.mem0 as any).markDirty();
        console.log(`[Mem0] Cleaned ${cleaned} expired memories`);
      }
    }, intervalMs);
    console.log(`[Mem0] Cleanup timer started (every ${intervalMs / 1000}s, max age ${maxAgeMs / 86400000}d)`);
  }

  dispose(): void {
    if (this.cleanupTimer) { clearInterval(this.cleanupTimer); this.cleanupTimer = null; }
    this.mem0.dispose();
  }
}
