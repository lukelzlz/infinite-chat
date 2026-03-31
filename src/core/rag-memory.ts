import { Message } from './types';
import { LocalVectorStore, VectorSearchResult } from './vector-store';
import * as path from 'path';

/**
 * RAG 记忆管理器 — 基于语义向量检索
 * 
 * 流程：
 * 1. 对话中的关键信息 → 调 embedding API → 存入向量库
 * 2. 新查询到来 → 调 embedding → 向量检索相关记忆 → 注入 system prompt
 * 
 * 不依赖外部向量数据库，纯 JSON 文件持久化
 */

export interface RAGMemoryConfig {
  /** Embedding API base URL */
  embeddingBaseUrl: string;
  /** Embedding API key */
  embeddingApiKey: string;
  /** Embedding 模型名称 */
  embeddingModel: string;
  /** 持久化目录 */
  dataDir?: string;
  /** 短期上下文窗口大小 */
  shortTermWindow?: number;
  /** 记忆保留天数 */
  maxAgeDays?: number;
}

interface EmbeddingResponse {
  data: Array<{ embedding: number[]; index: number }>;
  model: string;
  usage: { prompt_tokens: number; total_tokens: number };
}

export class RAGMemoryManager {
  private config: Required<RAGMemoryConfig>;
  private vectorStore: LocalVectorStore;
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(config: RAGMemoryConfig) {
    this.config = {
      embeddingBaseUrl: config.embeddingBaseUrl,
      embeddingApiKey: config.embeddingApiKey,
      embeddingModel: config.embeddingModel,
      dataDir: config.dataDir || path.join(process.cwd(), 'data'),
      shortTermWindow: config.shortTermWindow || 20,
      maxAgeDays: config.maxAgeDays || 90,
    };

    const vectorPath = path.join(this.config.dataDir, 'vectors.json');
    this.vectorStore = new LocalVectorStore(vectorPath);

    // 每 5 分钟清理过期记忆
    this.cleanupTimer = setInterval(() => {
      const removed = this.vectorStore.cleanup(this.config.maxAgeDays * 24 * 3600_000);
      if (removed > 0) console.log(`[RAG] Cleaned ${removed} expired memories`);
    }, 300_000);

    console.log(`[RAG] Initialized (model=${this.config.embeddingModel}, vectors=${this.vectorStore.count()})`);
  }

  dispose(): void {
    if (this.cleanupTimer) { clearInterval(this.cleanupTimer); this.cleanupTimer = null; }
    this.vectorStore.dispose();
  }

  // ============ 核心 RAG 流程 ============

  /**
   * 构建增强上下文 — RAG 检索入口
   * 
   * @param messages 最近对话历史
   * @param userId 用户 ID
   * @param currentQuery 当前查询
   * @returns systemPrompt 增强 + 相关记忆
   */
  async buildContext(
    messages: Message[],
    userId: string,
    currentQuery: string
  ): Promise<{
    systemPrompt: string;
    relevantMemories: VectorSearchResult[];
  }> {
    // 1. 并行：存新记忆 + 检索相关记忆
    const [, relevantMemories] = await Promise.all([
      this.ingestMessages(messages, userId),
      this.retrieve(currentQuery, userId),
    ]);

    // 2. 构建 system prompt
    let systemPrompt = '';
    if (relevantMemories.length > 0) {
      const memoryLines = relevantMemories
        .slice(0, 5) // 最多注入 5 条
        .map(m => `- ${m.content}`)
        .join('\n');
      systemPrompt = `[关于这个用户的信息（来自记忆）]\n${memoryLines}\n\n请自然地利用这些信息，不要生硬地提到"我记得"。`;
    }

    return { systemPrompt, relevantMemories };
  }

  /**
   * 摄入对话 → 提取关键信息 → embedding → 存储
   */
  async ingestMessages(messages: Message[], userId: string): Promise<void> {
    if (!messages || messages.length === 0) return;

    // 提取值得记住的内容
    const candidates = this.extractMemorable(messages, userId);
    if (candidates.length === 0) return;

    // 批量 embedding
    const texts = candidates.map(c => c.content);
    const embeddings = await this.getEmbeddings(texts);

    // 存入向量库
    for (let i = 0; i < candidates.length; i++) {
      if (embeddings[i]) {
        this.vectorStore.insert({
          id: `mem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          content: candidates[i].content,
          userId,
          embedding: embeddings[i],
          metadata: candidates[i].metadata,
          createdAt: Date.now(),
        });
      }
    }
  }

  /**
   * 语义检索
   */
  async retrieve(query: string, userId: string, topK = 5): Promise<VectorSearchResult[]> {
    if (!query || query.trim().length === 0) return [];

    try {
      const embeddings = await this.getEmbeddings([query]);
      if (!embeddings[0]) return this.fallbackSearch(query, userId, topK);

      const results = this.vectorStore.search(embeddings[0], userId, topK, 0.3);
      
      // 如果语义检索没结果，兜底模糊匹配
      if (results.length === 0) {
        return this.fallbackSearch(query, userId, topK);
      }

      return results;
    } catch (e) {
      console.warn('[RAG] Retrieve failed, fallback:', (e as Error).message);
      return this.fallbackSearch(query, userId, topK);
    }
  }

  // ============ 内部方法 ============

  /**
   * 调 embedding API（支持 OpenAI 兼容接口）
   */
  private async getEmbeddings(texts: string[]): Promise<number[][]> {
    const url = `${this.config.embeddingBaseUrl}/embeddings`;
    
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.embeddingApiKey}`,
      },
      body: JSON.stringify({
        model: this.config.embeddingModel,
        input: texts,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Embedding API error: ${res.status} ${body.slice(0, 200)}`);
    }

    const data = (await res.json()) as EmbeddingResponse;
    // 按 index 排序确保顺序正确
    return data.data
      .sort((a, b) => a.index - b.index)
      .map(d => d.embedding);
  }

  /**
   * 从对话中提取值得记忆的内容
   */
  private extractMemorable(messages: Message[], _userId: string): Array<{ content: string; metadata?: Record<string, any> }> {
    const results: Array<{ content: string; metadata?: Record<string, any> }> = [];

    for (const msg of messages) {
      // 主要记忆用户说的话，但也记忆 bot 的关键回复
      const isUser = msg.role === 'user';
      const content = msg.content?.trim();
      if (!content || content.length < 5) continue;

      if (isUser) {
        // 用户消息：提取重要信息
        const importance = this.assessImportance(content);
        if (importance > 0) {
          results.push({
            content,
            metadata: { source: 'user', importance },
          });
        }
      } else if (msg.role === 'assistant') {
        // bot 回复：只记忆包含事实/决策的长回复
        if (content.length > 50 && this.containsFactualInfo(content)) {
          results.push({
            content: content.slice(0, 500), // 截断避免太长
            metadata: { source: 'assistant' },
          });
        }
      }
    }

    return results;
  }

  /**
   * 评估信息重要性（0 = 不重要，1-3 = 越高越重要）
   */
  private assessImportance(content: string): number {
    const high: RegExp[] = [
      /我叫|我的名字|我是(?!(?:AI|ai|一个|小悠))/i,
      /记得|记住|别忘了|要记住/,
      /重要|关键|必须|一定/,
    ];
    const medium: RegExp[] = [
      /我喜欢|我讨厌|我偏好|我爱|我最爱/,
      /我的工作|职业|我是做/,
      /我住|我在|坐标/,
      /生日|年龄|岁/,
    ];
    const low: RegExp[] = [
      /觉得|认为|想法|看法/,
      /最近|今天|昨天|之前/,
    ];

    if (high.some(p => p.test(content))) return 3;
    if (medium.some(p => p.test(content))) return 2;
    if (low.some(p => p.test(content))) return 1;
    return 0;
  }

  /**
   * 判断是否包含事实性信息
   */
  private containsFactualInfo(content: string): boolean {
    const patterns = [
      /根据|资料显示|数据显示|研究表明/i,
      /实际上|事实上|真实情况/i,
      /步骤|方法|解决方案/i,
    ];
    return patterns.some(p => p.test(content));
  }

  /**
   * 兜底：文本模糊搜索
   */
  private fallbackSearch(query: string, userId: string, topK: number): VectorSearchResult[] {
    // 拆关键词
    const keywords = query.toLowerCase().split(/\s+/).filter(w => w.length > 1);
    if (keywords.length === 0) return [];

    return this.vectorStore.searchByContent(keywords[0], userId, topK);
  }

  /**
   * 手动添加记忆（供外部调用）
   */
  async addMemory(content: string, userId: string, metadata?: Record<string, any>): Promise<void> {
    const embeddings = await this.getEmbeddings([content]);
    if (embeddings[0]) {
      this.vectorStore.insert({
        id: `mem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        content,
        userId,
        embedding: embeddings[0],
        metadata,
        createdAt: Date.now(),
      });
    }
  }

  /**
   * 获取统计信息
   */
  getStats(userId?: string): { total: number; userTotal: number } {
    return {
      total: this.vectorStore.count(),
      userTotal: this.vectorStore.count(userId),
    };
  }
}
