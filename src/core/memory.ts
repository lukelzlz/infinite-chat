import { Message } from './types';

/**
 * Mem0 记忆层集成
 * 
 * 官方 SDK: https://github.com/mem0ai/mem0
 * 文档: https://docs.mem0.ai
 */
export interface Mem0Config {
  apiKey?: string;           // Mem0 API Key（托管服务）
  organizationId?: string;   // 组织 ID
  projectId?: string;        // 项目 ID
  localMode?: boolean;       // 本地模式（不使用托管服务）
}

export interface Memory {
  id: string;
  content: string;
  userId: string;
  metadata?: Record<string, any>;
  score?: number;  // 检索相关性分数
  createdAt: number;
  updatedAt: number;
}

/**
 * Mem0 记忆管理器
 * 
 * 提供自动化的记忆提取、存储和检索
 */
export class Mem0Manager {
  private config: Mem0Config;
  private client: any = null;
  private localStore: Map<string, Memory[]> = new Map();

  constructor(config: Mem0Config) {
    this.config = config;
    if (!config.localMode && config.apiKey) {
      this.initClient();
    }
  }

  private async initClient(): Promise<void> {
    try {
      // 动态加载 mem0ai SDK
      const { Mem0 } = await import('mem0ai');
      this.client = new Mem0({
        apiKey: this.config.apiKey,
        organizationId: this.config.organizationId,
        projectId: this.config.projectId,
      });
      console.log('[Mem0] Client initialized');
    } catch (e) {
      console.warn('[Mem0] SDK not found, falling back to local mode');
      this.config.localMode = true;
    }
  }

  /**
   * 添加记忆
   * Mem0 会自动从对话中提取重要信息
   */
  async addMemory(
    messages: Message[],
    userId: string,
    metadata?: Record<string, any>
  ): Promise<void> {
    if (this.config.localMode) {
      return this.addMemoryLocal(messages, userId, metadata);
    }

    try {
      // 使用 Mem0 API
      await this.client.add(
        messages.map(m => ({
          role: m.role,
          content: m.content,
        })),
        {
          userId,
          metadata: {
            sessionId: messages[0]?.sessionId,
            ...metadata,
          },
        }
      );
    } catch (e) {
      console.error('[Mem0] Add memory error:', e);
      // Fallback to local
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
    if (this.config.localMode) {
      return this.searchMemoryLocal(query, userId, limit);
    }

    try {
      const results = await this.client.search(query, {
        userId,
        limit,
      });

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
    if (this.config.localMode) {
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
    if (this.config.localMode) {
      // 本地模式下遍历删除
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

    // 简单提取关键信息（实际应该用 LLM）
    const userMessages = messages.filter(m => m.role === 'user');
    for (const msg of userMessages) {
      // 检查是否包含重要信息
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
    // 简单关键词匹配
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
    // 检测是否包含个人信息、偏好等
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
    return score / queryWords.length;
  }
}

/**
 * 混合记忆管理器
 * 
 * 结合 Mem0（长期语义记忆）和滑动窗口（短期上下文）
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
   * 
   * 1. 从 Mem0 检索相关长期记忆
   * 2. 结合短期对话历史
   */
  async buildContext(
    messages: Message[],
    userId: string,
    currentQuery: string
  ): Promise<{
    systemPrompt: string;
    relevantMemories: Memory[];
  }> {
    // 检索相关长期记忆
    const relevantMemories = await this.mem0.searchMemory(
      currentQuery,
      userId,
      5
    );

    // 构建系统提示
    let systemPrompt = '';
    if (relevantMemories.length > 0) {
      systemPrompt = `[用户相关信息]\n${
        relevantMemories.map(m => `- ${m.content}`).join('\n')
      }\n\n请根据这些信息提供个性化回复。`;
    }

    // 自动将新对话添加到 Mem0
    if (messages.length > 0) {
      await this.mem0.addMemory(messages, userId);
    }

    return { systemPrompt, relevantMemories };
  }

  getMem0(): Mem0Manager {
    return this.mem0;
  }
}
