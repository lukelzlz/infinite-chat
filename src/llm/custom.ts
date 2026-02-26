import { Message, LLMConfig, CustomModelConfig } from '../core/types';
import { LLMProvider } from './base';

/**
 * 自定义模型提供者
 * 
 * 支持任何 OpenAI 兼容的 API：
 * - DeepSeek
 * - Moonshot (Kimi)
 * - Zhipu (智谱)
 * - Baidu (文心)
 * - Alibaba (通义千问)
 * - vLLM
 * - Ollama (OpenAI 兼容模式)
 * - One-Hub / New API
 * - 本地部署模型
 */
export class CustomModelProvider extends LLMProvider {
  private client: any = null;
  private customConfig: CustomModelConfig;

  constructor(config: LLMConfig, customConfig?: CustomModelConfig) {
    super(config);
    this.customConfig = customConfig || {
      baseUrl: config.baseUrl || '',
      model: config.model,
    };
    this.initClient();
  }

  private async initClient(): Promise<void> {
    try {
      const { default: OpenAI } = await import('openai');
      this.client = new OpenAI({
        apiKey: this.config.apiKey,
        baseURL: this.customConfig.baseUrl,
      });
    } catch (e) {
      console.error('[CustomModel] OpenAI SDK not found. Run: npm install openai');
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
      throw new Error('CustomModel client not initialized');
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

    const requestOptions: any = {
      model: this.customConfig.model || this.config.model,
      messages: formattedMessages,
      max_tokens: options?.maxTokens || this.config.maxTokens || 4096,
      temperature: options?.temperature ?? this.config.temperature ?? 0.7,
    };

    // 添加额外参数（如 DeepSeek 的推理模式）
    if (this.customConfig.extraParams) {
      Object.assign(requestOptions, this.customConfig.extraParams);
    }

    const response = await this.client.chat.completions.create(requestOptions);

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
      throw new Error('CustomModel client not initialized');
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

    const requestOptions: any = {
      model: this.customConfig.model || this.config.model,
      messages: formattedMessages,
      max_tokens: options?.maxTokens || this.config.maxTokens || 4096,
      temperature: options?.temperature ?? this.config.temperature ?? 0.7,
      stream: true,
    };

    if (this.customConfig.extraParams) {
      Object.assign(requestOptions, this.customConfig.extraParams);
    }

    const stream = await this.client.chat.completions.create(requestOptions);

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
 * 预设的国内模型配置
 */
export const PRESET_MODELS: Record<string, CustomModelConfig> = {
  // DeepSeek
  'deepseek-chat': {
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    description: 'DeepSeek 对话模型',
  },
  'deepseek-reasoner': {
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-reasoner',
    description: 'DeepSeek 推理模型 (R1)',
    extraParams: { reasoning_effort: 'high' },
  },

  // Moonshot (Kimi)
  'moonshot-v1-8k': {
    baseUrl: 'https://api.moonshot.cn/v1',
    model: 'moonshot-v1-8k',
    description: 'Moonshot Kimi 8K',
  },
  'moonshot-v1-32k': {
    baseUrl: 'https://api.moonshot.cn/v1',
    model: 'moonshot-v1-32k',
    description: 'Moonshot Kimi 32K',
  },
  'moonshot-v1-128k': {
    baseUrl: 'https://api.moonshot.cn/v1',
    model: 'moonshot-v1-128k',
    description: 'Moonshot Kimi 128K',
  },

  // 智谱 (GLM)
  'glm-4': {
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4',
    description: '智谱 GLM-4',
  },
  'glm-4-flash': {
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4-flash',
    description: '智谱 GLM-4 Flash (快速)',
  },

  // 通义千问
  'qwen-turbo': {
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-turbo',
    description: '通义千问 Turbo',
  },
  'qwen-plus': {
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
    description: '通义千问 Plus',
  },
  'qwen-max': {
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-max',
    description: '通义千问 Max',
  },

  // 百度 (文心)
  'ernie-4.0': {
    baseUrl: 'https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/completions_pro',
    model: 'ernie-4.0-8k',
    description: '文心一言 4.0',
  },

  // Ollama 本地
  'ollama-llama3': {
    baseUrl: 'http://localhost:11434/v1',
    model: 'llama3',
    description: 'Ollama Llama3 本地',
  },
  'ollama-qwen2': {
    baseUrl: 'http://localhost:11434/v1',
    model: 'qwen2',
    description: 'Ollama Qwen2 本地',
  },

  // vLLM
  'vllm-local': {
    baseUrl: 'http://localhost:8000/v1',
    model: 'default',
    description: 'vLLM 本地部署',
  },
};

/**
 * 获取预设模型配置
 */
export function getPresetModelConfig(name: string): CustomModelConfig | undefined {
  return PRESET_MODELS[name];
}

/**
 * 列出所有预设模型
 */
export function listPresetModels(): string[] {
  return Object.keys(PRESET_MODELS);
}

/**
 * 创建自定义模型提供者
 */
export function createCustomModelProvider(
  config: LLMConfig,
  presetName?: string
): CustomModelProvider {
  let customConfig: CustomModelConfig | undefined;

  if (presetName && PRESET_MODELS[presetName]) {
    customConfig = PRESET_MODELS[presetName];
  } else if (config.baseUrl) {
    customConfig = {
      baseUrl: config.baseUrl,
      model: config.model,
    };
  }

  return new CustomModelProvider(config, customConfig);
}
