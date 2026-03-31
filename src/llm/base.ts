import { Message, LLMConfig } from '../core/types';
import { ToolCall, ToolDefinition } from '../core/tools';

/** LLM chat 返回结果 */
export interface LLMChatResult {
  content: string;
  toolCalls?: ToolCall[];
  /** 原始 finish_reason */
  finishReason?: string;
}

/**
 * LLM 提供者基类
 */
export abstract class LLMProvider {
  protected config: LLMConfig;

  constructor(config: LLMConfig) {
    this.config = config;
  }

  abstract chat(
    messages: Message[],
    options?: {
      systemPrompt?: string;
      maxTokens?: number;
      temperature?: number;
      tools?: ToolDefinition[];
    }
  ): Promise<LLMChatResult>;

  abstract streamChat?(
    messages: Message[],
    onToken: (token: string) => void,
    options?: {
      systemPrompt?: string;
      maxTokens?: number;
      temperature?: number;
    }
  ): Promise<string>;
}
