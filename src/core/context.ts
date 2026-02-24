import { Message, MemoryConfig } from './types';
import { v4 as uuidv4 } from 'uuid';

/**
 * 无限上下文管理器
 * 
 * 实现策略：
 * 1. 短期记忆：滑动窗口保持最近 N 条消息
 * 2. 中期记忆：向量数据库存储，按语义检索
 * 3. 长期记忆：定期压缩成摘要
 */
export class ContextManager {
  private shortTermMemory: Map<string, Message[]> = new Map();
  private summaries: Map<string, string[]> = new Map();
  private config: MemoryConfig;

  constructor(config: MemoryConfig) {
    this.config = config;
  }

  /** 添加消息到上下文 */
  async addMessage(sessionId: string, message: Omit<Message, 'id' | 'timestamp'>): Promise<Message> {
    const fullMessage: Message = {
      ...message,
      id: uuidv4(),
      timestamp: Date.now(),
    };

    // 获取或创建会话记忆
    if (!this.shortTermMemory.has(sessionId)) {
      this.shortTermMemory.set(sessionId, []);
    }

    const messages = this.shortTermMemory.get(sessionId)!;
    messages.push(fullMessage);

    // 检查是否需要压缩
    if (messages.length >= this.config.compressThreshold) {
      await this.compressHistory(sessionId);
    }

    // 保持滑动窗口
    if (messages.length > this.config.shortTermWindow) {
      messages.shift();
    }

    return fullMessage;
  }

  /** 获取上下文（用于 LLM） */
  async getContext(sessionId: string, query?: string): Promise<Message[]> {
    const messages = this.shortTermMemory.get(sessionId) || [];
    
    // 如果有摘要，作为系统消息添加
    const summaries = this.summaries.get(sessionId) || [];
    if (summaries.length > 0) {
      const summaryText = summaries.join('\n\n');
      return [
        {
          id: 'summary',
          sessionId,
          role: 'system',
          content: `[历史摘要]\n${summaryText}`,
          timestamp: Date.now(),
        },
        ...messages,
      ];
    }

    return [...messages];
  }

  /** 压缩历史（将旧消息压缩成摘要） */
  private async compressHistory(sessionId: string): Promise<void> {
    const messages = this.shortTermMemory.get(sessionId) || [];
    if (messages.length < 10) return;

    // 取出要压缩的消息（保留最近的一半）
    const toCompress = messages.slice(0, Math.floor(messages.length / 2));
    const toKeep = messages.slice(Math.floor(messages.length / 2));

    // 生成摘要（这里简化处理，实际应调用 LLM）
    const summary = this.generateSimpleSummary(toCompress);

    // 存储摘要
    if (!this.summaries.has(sessionId)) {
      this.summaries.set(sessionId, []);
    }
    this.summaries.get(sessionId)!.push(summary);

    // 更新短期记忆
    this.shortTermMemory.set(sessionId, toKeep);

    console.log(`[Context] Compressed ${toCompress.length} messages for ${sessionId}`);
  }

  /** 简单摘要生成（实际应使用 LLM） */
  private generateSimpleSummary(messages: Message[]): string {
    const userMsgs = messages.filter(m => m.role === 'user').map(m => m.content);
    const assistantMsgs = messages.filter(m => m.role === 'assistant').map(m => m.content);
    
    return `对话涉及 ${userMsgs.length} 个用户问题和 ${assistantMsgs.length} 个回复。` +
           `主要话题：${userMsgs.slice(0, 3).join(', ')}...`;
  }

  /** 清除会话上下文 */
  clearContext(sessionId: string): void {
    this.shortTermMemory.delete(sessionId);
    this.summaries.delete(sessionId);
  }

  /** 获取统计信息 */
  getStats(sessionId: string): { messages: number; summaries: number } {
    return {
      messages: (this.shortTermMemory.get(sessionId) || []).length,
      summaries: (this.summaries.get(sessionId) || []).length,
    };
  }
}
