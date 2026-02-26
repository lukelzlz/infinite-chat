// ============ 核心类型定义 ============

/** 消息结构 */
export interface Message {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  metadata?: Record<string, any>;
  /** Agent 标识（多 Agent 场景） */
  agentId?: string;
}

/** 会话结构 */
export interface Session {
  id: string;
  platform: string;
  userId: string;
  groupId?: string;
  createdAt: number;
  lastActiveAt: number;
  metadata?: Record<string, any>;
  activeAgentId?: string;
}

/** Agent 定义 */
export interface Agent {
  id: string;
  name: string;
  description?: string;
  systemPrompt: string;
  triggers?: string[];
  llmOverride?: Partial<LLMConfig>;
  isDefault?: boolean;
}

/** 群聊配置 */
export interface GroupChatConfig {
  enabled: boolean;
  agentInteraction: boolean;
  maxAgentChain: number;
  chainThreshold: number;
}

/** 入站消息 */
export interface IncomingMessage {
  sessionId: string;
  content: string;
  sender?: {
    id: string;
    name?: string;
    isBot?: boolean;
  };
  replyTo?: string;
  metadata?: Record<string, any>;
}

/** LLM 高级参数 */
export interface LLMAdvancedParams {
  /** 思考/推理模式 */
  reasoning?: {
    enabled: boolean;
    effort?: 'low' | 'medium' | 'high';
    /** 是否显示思考过程 */
    showThinking?: boolean;
  };
  /** 上下文长度 */
  contextLength?: number;
  /** Top P 采样 */
  topP?: number;
  /** Top K 采样 */
  topK?: number;
  /** 频率惩罚 */
  frequencyPenalty?: number;
  /** 存在惩罚 */
  presencePenalty?: number;
  /** 停止词 */
  stopSequences?: string[];
  /** 响应格式 */
  responseFormat?: 'text' | 'json';
  /** 种子（可复现输出） */
  seed?: number;
  /** 流式输出 */
  stream?: boolean;
  /** 重试次数 */
  maxRetries?: number;
  /** 超时（毫秒） */
  timeout?: number;
}

/** LLM 配置 */
export interface LLMConfig {
  provider: 'openai' | 'anthropic' | 'local' | 'siliconflow' | 'openai-compatible' | 'custom';
  model: string;
  apiKey?: string;
  baseUrl?: string;
  maxTokens?: number;
  temperature?: number;
  preset?: string;
  /** 高级参数 */
  advanced?: LLMAdvancedParams;
}

/** 自定义模型配置 */
export interface CustomModelConfig {
  baseUrl: string;
  model: string;
  description?: string;
  extraParams?: Record<string, any>;
}

/** 记忆配置 */
export interface MemoryConfig {
  shortTermWindow: number;
  vectorDb?: {
    type: 'chromadb' | 'memory';
    url?: string;
    collection?: string;
  };
  compressThreshold: number;
}

/** 适配器配置 */
export interface AdapterConfig {
  type: 'telegram' | 'discord' | 'feishu' | 'misskey' | 'web';
  enabled: boolean;
  config: Record<string, any>;
}

/** 主配置 */
export interface FrameworkConfig {
  llm: LLMConfig;
  memory: MemoryConfig;
  adapters: AdapterConfig[];
  agents?: {
    enabled: boolean;
    list: Agent[];
    groupChat: GroupChatConfig;
  };
  plugins?: {
    enabled: string[];
    directory?: string;
  };
  logging?: {
    level: 'debug' | 'info' | 'warn' | 'error';
    file?: string;
  };
  /** 热加载配置 */
  hotReload?: {
    enabled: boolean;
    watchPath?: string;
    debounceMs?: number;
  };
}

/** 配置变更事件 */
export interface ConfigChangeEvent {
  type: 'llm' | 'agents' | 'adapters' | 'plugins' | 'all';
  oldConfig: Partial<FrameworkConfig>;
  newConfig: Partial<FrameworkConfig>;
  timestamp: number;
}
