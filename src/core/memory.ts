import { Message } from './types';

/**
 * Mem0 记忆层集成
 * 
 * 支持本地模式和 Mem0 API（可选）
 */

export interface Mem0Config {
  apiKey?: string;           // Mem0 API Key（托管服务）
  organizationId?: string;   // 组织 ID
  projectId?: string;        // 项目 ID
  localMode?: boolean;       // 本地模式（默认 true）
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
 * 记忆管理器
 * 
 * 默认使用本地存储，可选支持 Mem0 API
 */
export class Mem0Manager {
  private config: Mem0Config;
  private client: any = null;
  private localStore: Map<string, Memory[]> = new Map();

  constructor(config: Mem0Config) {
    this.config = { localMode: true, ...config };
    
    // 只有明确提供 API Key 且不是本地模式时才尝试初始化客户端
    if (!this.config.localMode && config.apiKey) {
      this.initClient();
    }
  }

  private async initClient(): Promise<void> {
    try {
      // 动态加载 mem0ai SDK（可选依赖）
      // 使用 Function 构造函数绕过 TypeScript 静态检查
      const dynamicImport = new Function('module', 'return import(module)');
      const mem0Module = await dynamicImport('mem0ai').catch(() => null);
      if (mem0Module && mem0Module.Mem0) {
        this.client = new mem0Module.Mem0({
          apiKey: this.config.apiKey,
          organizationId: this.config.organizationId,
          projectId: this.config.projectId,
        });
        console.log('[Mem0] Client initialized');
      } else {
        console.warn('[Mem0] SDK not found, using local mode');
        this.config.localMode = true;
      }
    } catch (e) {
      console.warn('[Mem0] SDK load failed, using local mode');
      this.config.localMode = true;
    }
  }

  /**
   * 添加记忆
   */
  async addMemory(
    messages: Message[],
    userId: string,
    metadata?: Record<string, any>
  ): Promise<void> {
    if (this.config.localMode || !this.client) {
      return this.addMemoryLocal(messages, userId, metadata);
    }

    try {
      await this.client.add(
        messages.map(m => ({
          role: m.role,
          content: m.content,
        })),
        { userId, metadata }
      );
    } catch (e) {
      console.error('[Mem0] Add error:', e);
      return this.addMemoryLocal(messages, userId, metadata);
    }
  }

  /**
   * 检索相关记忆
   */
  async searchMemory(
    query: string,
    userId: string,
    limit: number = 10
  ): Promise<Memory[]> {
    if (this.config.localMode || !this.client) {
      return this.searchMemoryLocal(query, userId, limit);
    }

    try {
      const results = await this.client.search(query, { userId, limit });
      return results.map((r: any) => ({
        id: r.id,
        content: r.memory,
        userId: r.userId,
        score: r.score,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      }));
    } catch (e) {
      console.error('[Mem0] Search error:', e);
      return this.searchMemoryLocal(query, userId, limit);
    }
  }

  /**
   * 获取用户所有记忆
   */
  async getAllMemories(userId: string): Promise<Memory[]> {
    if (this.config.localMode || !this.client) {
      return this.localStore.get(userId) || [];
    }

    try {
      const results = await this.client.getAll({ userId });
      return results.map((r: any) => ({
        id: r.id,
        content: r.memory,
        userId: r.userId,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      }));
    } catch (e) {
      console.error('[Mem0] Get all error:', e);
      return this.localStore.get(userId) || [];
    }
  }

  /**
   * 删除记忆
   */
  async deleteMemory(memoryId: string): Promise<void> {
    if (this.config.localMode || !this.client) {
      for (const [userId, memories] of this.localStore) {
        const index = memories.findIndex(m => m.id === memoryId);
        if (index !== -1) {
          memories.splice(index, 1);
          return;
        }
      }
      return;
    }

    try {
      await this.client.delete(memoryId);
    } catch (e) {
      console.error('[Mem0] Delete error:', e);
    }
  }

  // ============ 本地模式实现 ============

  private addMemoryLocal(
    messages: Message[],
    userId: string,
    metadata?: Record<string, any>
  ): void {
    if (!this.localStore.has(userId)) {
      this.localStore.set(userId, []);
    }

    const userMessages = messages.filter(m => m.role === 'user');
    for (const msg of userMessages) {
      if (this.isImportantInfo(msg.content)) {
        const memory: Memory = {
          id: `local-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          content: msg.content,
          userId,
          metadata,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        this.localStore.get(userId)!.push(memory);
      }
    }
  }

  private searchMemoryLocal(
    query: string,
    userId: string,
    limit: number
  ): Memory[] {
    const memories = this.localStore.get(userId) || [];
    const queryWords = query.toLowerCase().split(/\s+/);
    
    return memories
      .map(m => ({
        ...m,
        score: this.calculateRelevance(m.content, queryWords),
      }))
      .filter(m => m.score! > 0)
      .sort((a, b) => (b.score || 0) - (a.score || 0))
      .slice(0, limit);
  }

  private isImportantInfo(content: string): boolean {
    const patterns = [
      /我叫|我的名字|我是/i,
      /我喜欢|我讨厌|我偏好/i,
      /我的工作是|我是做/i,
      /我住|我在|我的地址/i,
      /记得|记住|别忘了/i,
      /重要|关键|必须/i,
    ];
    return patterns.some(p => p.test(content));
  }

  private calculateRelevance(content: string, queryWords: string[]): number {
    const contentLower = content.toLowerCase();
    let score = 0;
    for (const word of queryWords) {
      if (contentLower.includes(word)) {
        score += 1;
      }
    }
    return queryWords.length > 0 ? score / queryWords.length : 0;
  }
}

/**
 * 混合记忆管理器
 * 
 * 结合长期记忆和滑动窗口短期上下文
 */
export class HybridMemoryManager {
  private mem0: Mem0Manager;
  private shortTermWindow: number;

  constructor(mem0Config: Mem0Config, shortTermWindow: number = 10) {
    this.mem0 = new Mem0Manager(mem0Config);
    this.shortTermWindow = shortTermWindow;
  }

  /**
   * 构建增强的上下文
   */
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
}
