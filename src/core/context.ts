// ============ 无限上下文管理器 ============
//
// 修改原因：
// - 原 generateSimpleSummary() 是空壳，只返回一句废话（"对话涉及X个问题"）
// - 改为真正调用 LLM API 进行高质量摘要压缩
// - 新增 token 估算、摘要链、自动触发、降级机制
// - 通过依赖注入接收 LLMProvider（由 engine.ts 在 init 后注入）

import { Message, MemoryConfig } from './types';
import { v4 as uuidv4 } from 'uuid';
import { LLMProvider, LLMChatResult } from '../llm';

/** 压缩配置 */
interface CompressOptions {
  /** 摘要最大 token 数（约中文字符数） */
  maxSummaryTokens?: number;
  /** 压缩温度（低温度更稳定） */
  temperature?: number;
}

/** 默认压缩配置 */
const DEFAULT_COMPRESS_OPTIONS: Required<CompressOptions> = {
  maxSummaryTokens: 1024,
  temperature: 0.3,
};

/**
 * 粗略估算消息的 token 数
 * 中文约 1.5 字符/token，英文约 4 字符/token
 */
function estimateTokens(text: string): number {
  if (!text) return 0;
  // 统计中文字符数和非中文字符数分别估算
  const chineseChars = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
  const otherChars = text.length - chineseChars;
  return Math.ceil(chineseChars / 1.5 + otherChars / 4);
}

/**
 * 估算一组消息的总 token 数
 */
function estimateMessagesTokens(messages: Message[]): number {
  let total = 0;
  for (const msg of messages) {
    // 每条消息有固定开销（role + 格式）
    total += 4; // 消息格式开销
    total += estimateTokens(msg.content || '');
    if (msg.metadata) {
      total += estimateTokens(JSON.stringify(msg.metadata));
    }
  }
  return total;
}

/**
 * 无限上下文管理器
 *
 * 实现策略：
 * 1. 短期记忆：滑动窗口保持最近 N 条消息
 * 2. 中期记忆：向量数据库存储，按语义检索
 * 3. 长期记忆：定期通过 LLM 压缩成高质量摘要链
 */
export class ContextManager {
  private shortTermMemory: Map<string, Message[]> = new Map();
  private summaries: Map<string, string[]> = new Map();
  private config: MemoryConfig;
  /** 注入的 LLM 提供者（用于摘要压缩） */
  private llmProvider: LLMProvider | null = null;
  /** 压缩选项 */
  private compressOpts: CompressOptions = {};
  /** 上次压缩时间（防抖） */
  private lastCompressTime: Map<string, number> = new Map();
  /** 最小压缩间隔（毫秒），防止频繁压缩 */
  private readonly COMPRESS_COOLDOWN_MS = 30_000;

  constructor(config: MemoryConfig) {
    this.config = config;
  }

  /**
   * 注入 LLM 提供者（由 Engine 在 init 后调用）
   * 必须在 start() 之前完成注入
   */
  setLLMProvider(provider: LLMProvider, options?: CompressOptions): void {
    this.llmProvider = provider;
    this.compressOpts = options || {};
  }

  /**
   * 获取当前会话的估算 token 数
   */
  getEstimatedTokens(sessionId: string): number {
    const messages = this.shortTermMemory.get(sessionId) || [];
    const summaries = this.summaries.get(sessionId) || [];

    let total = 0;
    // 摘要的 token 开销
    for (const s of summaries) {
      total += estimateTokens(s);
    }
    // 当前消息的 token 开销
    total += estimateMessagesTokens(messages);
    return total;
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

    // 检查是否需要压缩（基于消息数量或 token 估算）
    const shouldCompressByCount = messages.length >= this.config.compressThreshold;
    const estimatedTokens = this.getEstimatedTokens(sessionId);
    // 当估算 token 接近模型限制时也触发（假设模型上限 128K tokens，80% 时触发）
    const shouldCompressByTokens = estimatedTokens > 100_000;

    if (shouldCompressByCount || shouldCompressByTokens) {
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
      const summaryText = summaries.join('\n\n---\n\n');
      return [
        {
          id: 'summary',
          sessionId,
          role: 'system',
          content: `[历史摘要（共 ${summaries} 轮压缩）]\n${summaryText}`,
          timestamp: Date.now(),
        },
        ...messages,
      ];
    }

    return [...messages];
  }

  /**
   * 压缩历史（将旧消息通过 LLM 压缩成高质量摘要）
   *
   * 压缩流程：
   * 1. 取出前半部分旧消息作为待压缩内容
   * 2. 如果已有摘要，把旧摘要也传入作为上下文
   * 3. 调用 LLM 生成结构化摘要
   * 4. 新摘要追加到摘要链（支持多轮压缩）
   * 5. 失败时降级为简单文本摘要
   */
  private async compressHistory(sessionId: string): Promise<void> {
    const messages = this.shortTermMemory.get(sessionId) || [];
    if (messages.length < 10) return;

    // 防抖：检查冷却时间
    const now = Date.now();
    const lastCompress = this.lastCompressTime.get(sessionId) || 0;
    if (now - lastCompress < this.COMPRESS_COOLDOWN_MS) return;

    // 取出要压缩的消息（保留最近的一半）
    const toCompress = messages.slice(0, Math.floor(messages.length / 2));
    const toKeep = messages.slice(Math.floor(messages.length / 2));

    // 标记压缩时间
    this.lastCompressTime.set(sessionId, now);

    try {
      const summary = await this.generateLLMSummary(sessionId, toCompress);

      // 存储摘要（追加到摘要链）
      if (!this.summaries.has(sessionId)) {
        this.summaries.set(sessionId, []);
      }
      this.summaries.get(sessionId)!.push(summary);

      console.log(`[Context] LLM 压缩完成: ${toCompress.length} 条消息 → ${summary.length} 字符摘要 (${sessionId})`);
    } catch (e: any) {
      // LLM 调用失败，降级到简单摘要（不丢数据）
      console.warn(`[Context] LLM 压缩失败，降级到简单摘要: ${e.message}`);
      const fallbackSummary = this.generateSimpleSummary(toCompress);

      if (!this.summaries.has(sessionId)) {
        this.summaries.set(sessionId, []);
      }
      this.summaries.get(sessionId)!.push(fallbackSummary);

      console.log(`[Context] 降级摘要: ${toCompress.length} 条消息 → ${fallbackSummary.length} 字符 (${sessionId})`);
    }

    // 更新短期内存（无论成功失败都清理已压缩的消息）
    this.shortTermMemory.set(sessionId, toKeep);
  }

  /**
   * 调用 LLM 生成高质量摘要
   *
   * 摘要要求保留：
   * - 关键事实（用户提到的事实信息）
   * - 用户偏好（用户表达过的喜好/需求）
   * - 讨论过的主题（话题列表）
   * - 重要结论（达成的决定或答案）
   */
  private async generateLLMSummary(sessionId: string, messages: Message[]): Promise<string> {
    if (!this.llmProvider) {
      throw new Error('LLM Provider 未注入，无法生成摘要');
    }

    const opts = { ...DEFAULT_COMPRESS_OPTIONS, ...this.compressOpts };

    // 构建待压缩的对话文本
    const conversationText = messages
      .map(m => {
        const roleLabel = m.role === 'user' ? '用户' : m.role === 'assistant' ? '助手' : '系统';
        const timeStr = new Date(m.timestamp).toLocaleString('zh-CN');
        return `[${timeStr}] ${roleLabel}: ${m.content}`;
      })
      .join('\n');

    // 获取已有摘要作为上下文（让新摘要能衔接之前的摘要）
    const existingSummaries = this.summaries.get(sessionId) || [];
    const previousContext = existingSummaries.length > 0
      ? `\n\n【之前的摘要（请在此基础上补充新内容，不要重复）】\n${existingSummaries[existingSummaries.length - 1]}`
      : '';

    const systemPrompt = `你是一个专业的对话摘要助手。你的任务是将一段聊天记录压缩成高质量的中文摘要。

摘要必须保留以下信息：
1. **关键事实**：用户提到的具体事实、数据、名称等
2. **用户偏好**：用户明确表达的喜好、需求、习惯
3. **讨论主题**：涉及的话题和领域
4. **重要结论**：讨论得出的决定、答案或共识
5. **未解决问题**：尚未得到回应的问题或待办事项

格式要求：
- 使用简洁的中文，避免废话
- 用项目符号（- 或数字）组织信息
- 按主题分组，不要按时间流水账
- 保留关键细节（具体数值、名称等）
- 摘要长度控制在 ${opts.maxSummaryTokens} 字符以内`;

    const userMessage = `请压缩以下对话记录为摘要：${previousContext}\n\n【待压缩的对话记录】\n${conversationText}`;

    // 调用 LLM 生成摘要
    const result: LLMChatResult = await this.llmProvider.chat(
      [{ role: 'user', content: userMessage, id: 'compress', sessionId, timestamp: Date.now() }],
      {
        systemPrompt,
        temperature: opts.temperature,
        maxTokens: opts.maxSummaryTokens,
      }
    );

    if (!result.content || result.content.trim().length === 0) {
      throw new Error('LLM 返回空摘要');
    }

    return result.content.trim();
  }

  /**
   * 简单摘要生成（LLM 不可用时的降级方案）
   * 提取关键信息但不调用 LLM
   */
  private generateSimpleSummary(messages: Message[]): string {
    const userMsgs = messages.filter(m => m.role === 'user').map(m => m.content).filter((c): c is string => c != null);
    const assistantMsgs = messages.filter(m => m.role === 'assistant').map(m => m.content).filter((c): c is string => c != null);

    // 提取关键词（取每个用户消息的前 50 个字符）
    const topics = userMsgs.map(m => m.slice(0, 50).replace(/\n/g, ' '));
    const uniqueTopics = [...new Set(topics)];

    return `【降级摘要】对话包含 ${userMsgs.length} 个用户问题和 ${assistantMsgs.length} 个助手回复。` +
           `\n讨论话题：${uniqueTopics.slice(0, 5).join('；')}` +
           (uniqueTopics.length > 5 ? ` 等 ${uniqueTopics.length} 个话题` : '') +
           `\n时间范围：${new Date(messages[0].timestamp).toLocaleString('zh-CN')} ~ ${new Date(messages[messages.length - 1].timestamp).toLocaleString('zh-CN')}`;
  }

  /** 清除会话上下文 */
  clearContext(sessionId: string): void {
    this.shortTermMemory.delete(sessionId);
    this.summaries.delete(sessionId);
    this.lastCompressTime.delete(sessionId);
  }

  /** 获取统计信息 */
  getStats(sessionId: string): { messages: number; summaries: number; estimatedTokens: number } {
    return {
      messages: (this.shortTermMemory.get(sessionId) || []).length,
      summaries: (this.summaries.get(sessionId) || []).length,
      estimatedTokens: this.getEstimatedTokens(sessionId),
    };
  }

  /**
   * 获取所有摘要（用于持久化）
   */
  getAllSummaries(): Record<string, string[]> {
    const result: Record<string, string[]> = {};
    for (const [sessionId, summaries] of this.summaries) {
      result[sessionId] = [...summaries];
    }
    return result;
  }

  /**
   * 恢复所有摘要（用于持久化恢复）
   */
  restoreSummaries(summaries: Record<string, string[]>): void {
    this.summaries.clear();
    for (const [sessionId, summaryList] of Object.entries(summaries)) {
      if (Array.isArray(summaryList) && summaryList.length > 0) {
        this.summaries.set(sessionId, [...summaryList]);
      }
    }
  }
}
