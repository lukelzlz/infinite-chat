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

/**
 * OpenAI 提供者
 */
export class OpenAIProvider extends LLMProvider {
  private client: any = null;

  constructor(config: LLMConfig) {
    super(config);
    this.initClient();
  }

  private async initClient(): Promise<void> {
    try {
      const { default: OpenAI } = await import('openai');
      this.client = new OpenAI({
        apiKey: this.config.apiKey,
        baseURL: this.config.baseUrl,
      });
    } catch (e) {
      console.error('[OpenAI] SDK not found. Run: npm install openai');
    }
  }

  async chat(
    messages: Message[],
    options?: {
      systemPrompt?: string;
      maxTokens?: number;
      temperature?: number;
    }
  ): Promise<string> {
    if (!this.client) {
      throw new Error('OpenAI client not initialized');
    }

    const formattedMessages: any[] = [];
    
    if (options?.systemPrompt) {
      formattedMessages.push({
        role: 'system',
        content: options.systemPrompt,
      });
    }

    for (const msg of messages) {
      formattedMessages.push({
        role: msg.role,
        content: msg.content,
      });
    }

    const response = await this.client.chat.completions.create({
      model: this.config.model,
      messages: formattedMessages,
      max_tokens: options?.maxTokens || this.config.maxTokens || 4096,
      temperature: options?.temperature ?? this.config.temperature ?? 0.7,
    });

    return response.choices[0]?.message?.content || '';
  }

  async streamChat(
    messages: Message[],
    onToken: (token: string) => void,
    options?: {
      systemPrompt?: string;
      maxTokens?: number;
      temperature?: number;
    }
  ): Promise<string> {
    if (!this.client) {
      throw new Error('OpenAI client not initialized');
    }

    const formattedMessages: any[] = [];
    
    if (options?.systemPrompt) {
      formattedMessages.push({
        role: 'system',
        content: options.systemPrompt,
      });
    }

    for (const msg of messages) {
      formattedMessages.push({
        role: msg.role,
        content: msg.content,
      });
    }

    const stream = await this.client.chat.completions.create({
      model: this.config.model,
      messages: formattedMessages,
      max_tokens: options?.maxTokens || this.config.maxTokens || 4096,
      temperature: options?.temperature ?? this.config.temperature ?? 0.7,
      stream: true,
    });

    let fullContent = '';
    for await (const chunk of stream) {
      const token = chunk.choices[0]?.delta?.content || '';
      if (token) {
        fullContent += token;
        onToken(token);
      }
    }

    return fullContent;
  }
}

/**
 * Anthropic (Claude) 提供者
 */
export class AnthropicProvider extends LLMProvider {
  private client: any = null;

  constructor(config: LLMConfig) {
    super(config);
    this.initClient();
  }

  private async initClient(): Promise<void> {
    try {
      const { default: Anthropic } = await import('@anthropic-ai/sdk');
      this.client = new Anthropic({
        apiKey: this.config.apiKey,
      });
    } catch (e) {
      console.error('[Anthropic] SDK not found. Run: npm install @anthropic-ai/sdk');
    }
  }

  async chat(
    messages: Message[],
    options?: {
      systemPrompt?: string;
      maxTokens?: number;
      temperature?: number;
    }
  ): Promise<string> {
    if (!this.client) {
      throw new Error('Anthropic client not initialized');
    }

    const formattedMessages = messages.map(msg => ({
      role: msg.role === 'assistant' ? 'assistant' : 'user',
      content: msg.content,
    }));

    const response = await this.client.messages.create({
      model: this.config.model,
      max_tokens: options?.maxTokens || this.config.maxTokens || 4096,
      system: options?.systemPrompt,
      messages: formattedMessages,
    });

    return response.content[0]?.text || '';
  }

  // Anthropic SDK 支持流式，但这里暂时用非流式实现
  async streamChat?(
    messages: Message[],
    onToken: (token: string) => void,
    options?: {
      systemPrompt?: string;
      maxTokens?: number;
      temperature?: number;
    }
  ): Promise<string> {
    // 简单实现：使用 chat 然后逐字回调
    const result = await this.chat(messages, options);
    for (const char of result) {
      onToken(char);
    }
    return result;
  }
}

/**
 * 本地模型提供者 (Ollama / LM Studio)
 */
export class LocalModelProvider extends LLMProvider {
  async chat(
    messages: Message[],
    options?: {
      systemPrompt?: string;
      maxTokens?: number;
      temperature?: number;
    }
  ): Promise<string> {
    const baseUrl = this.config.baseUrl || 'http://localhost:11434';
    
    const formattedMessages: any[] = [];
    
    if (options?.systemPrompt) {
      formattedMessages.push({
        role: 'system',
        content: options.systemPrompt,
      });
    }

    for (const msg of messages) {
      formattedMessages.push({
        role: msg.role,
        content: msg.content,
      });
    }

    // Ollama API
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.config.model,
        messages: formattedMessages,
        stream: false,
        options: {
          num_predict: options?.maxTokens || this.config.maxTokens || 4096,
          temperature: options?.temperature ?? this.config.temperature ?? 0.7,
        },
      }),
    });

    const data = await response.json() as { message?: { content?: string } };
    return data.message?.content || '';
  }

  async streamChat(
    messages: Message[],
    onToken: (token: string) => void,
    options?: {
      systemPrompt?: string;
      maxTokens?: number;
      temperature?: number;
    }
  ): Promise<string> {
    const baseUrl = this.config.baseUrl || 'http://localhost:11434';
    
    const formattedMessages: any[] = [];
    
    if (options?.systemPrompt) {
      formattedMessages.push({
        role: 'system',
        content: options.systemPrompt,
      });
    }

    for (const msg of messages) {
      formattedMessages.push({
        role: msg.role,
        content: msg.content,
      });
    }

    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.config.model,
        messages: formattedMessages,
        stream: true,
        options: {
          num_predict: options?.maxTokens || this.config.maxTokens || 4096,
          temperature: options?.temperature ?? this.config.temperature ?? 0.7,
        },
      }),
    });

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    let fullContent = '';
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const lines = decoder.decode(value).split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const data = JSON.parse(line);
          const token = data.message?.content || '';
          if (token) {
            fullContent += token;
            onToken(token);
          }
        } catch (e) {
          // Skip invalid JSON
        }
      }
    }

    return fullContent;
  }
}

/**
 * SiliconFlow 提供者（国内 API）
 * 支持 DeepSeek、Qwen、GLM 等模型
 */
export class SiliconFlowProvider extends LLMProvider {
  private client: any = null;

  constructor(config: LLMConfig) {
    super(config);
    this.config.baseUrl = config.baseUrl || 'https://api.siliconflow.cn/v1';
    this.initClient();
  }

  private async initClient(): Promise<void> {
    try {
      const { default: OpenAI } = await import('openai');
      this.client = new OpenAI({
        apiKey: this.config.apiKey,
        baseURL: this.config.baseUrl,
      });
    } catch (e) {
      console.error('[SiliconFlow] SDK not found. Run: npm install openai');
    }
  }

  async chat(
    messages: Message[],
    options?: {
      systemPrompt?: string;
      maxTokens?: number;
      temperature?: number;
    }
  ): Promise<string> {
    if (!this.client) {
      throw new Error('SiliconFlow client not initialized');
    }

    const formattedMessages: any[] = [];
    
    if (options?.systemPrompt) {
      formattedMessages.push({
        role: 'system',
        content: options.systemPrompt,
      });
    }

    for (const msg of messages) {
      formattedMessages.push({
        role: msg.role,
        content: msg.content,
      });
    }

    const response = await this.client.chat.completions.create({
      model: this.config.model,
      messages: formattedMessages,
      max_tokens: options?.maxTokens || this.config.maxTokens || 4096,
      temperature: options?.temperature ?? this.config.temperature ?? 0.7,
    });

    return response.choices[0]?.message?.content || '';
  }

  async streamChat(
    messages: Message[],
    onToken: (token: string) => void,
    options?: {
      systemPrompt?: string;
      maxTokens?: number;
      temperature?: number;
    }
  ): Promise<string> {
    if (!this.client) {
      throw new Error('SiliconFlow client not initialized');
    }

    const formattedMessages: any[] = [];
    
    if (options?.systemPrompt) {
      formattedMessages.push({
        role: 'system',
        content: options.systemPrompt,
      });
    }

    for (const msg of messages) {
      formattedMessages.push({
        role: msg.role,
        content: msg.content,
      });
    }

    const stream = await this.client.chat.completions.create({
      model: this.config.model,
      messages: formattedMessages,
      max_tokens: options?.maxTokens || this.config.maxTokens || 4096,
      temperature: options?.temperature ?? this.config.temperature ?? 0.7,
      stream: true,
    });

    let fullContent = '';
    for await (const chunk of stream) {
      const token = chunk.choices[0]?.delta?.content || '';
      if (token) {
        fullContent += token;
        onToken(token);
      }
    }

    return fullContent;
  }
}

/**
 * OpenAI Compatible 提供者
 * 兼容所有 OpenAI 格式的 API（One-Hub、vLLM 等）
 */
export class OpenAICompatibleProvider extends OpenAIProvider {
  constructor(config: LLMConfig) {
    super(config);
    // 强制使用自定义 baseUrl
    if (!config.baseUrl) {
      console.warn('[OpenAI-Compatible] No baseUrl provided, using default OpenAI endpoint');
    }
  }
}

/**
 * LLM 工厂
 */
export function createLLMProvider(config: LLMConfig): LLMProvider {
  switch (config.provider) {
    case 'openai':
      return new OpenAIProvider(config);
    case 'anthropic':
      return new AnthropicProvider(config);
    case 'local':
      return new LocalModelProvider(config);
    case 'siliconflow':
      return new SiliconFlowProvider(config);
    case 'openai-compatible':
      return new OpenAICompatibleProvider(config);
    default:
      throw new Error(`Unknown LLM provider: ${config.provider}`);
  }
}
