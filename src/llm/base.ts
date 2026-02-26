import { Message, LLMConfig } from '../core/types';

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
    }
  ): Promise<string>;

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
