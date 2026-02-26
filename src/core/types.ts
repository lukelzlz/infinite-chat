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
  id: string;           // 格式: platform:userId (如 telegram:12345)
  platform: string;
  userId: string;
  groupId?: string;     // 群聊场景
  createdAt: number;
  lastActiveAt: number;
  metadata?: Record<string, any>;
  /** 群聊中激活的 Agent */
  activeAgentId?: string;
}

/** Agent 定义 */
export interface Agent {
  id: string;
  name: string;
  description?: string;
  systemPrompt: string;
  /** 触发关键词 */
  triggers?: string[];
  /** LLM 配置覆盖 */
  llmOverride?: Partial<LLMConfig>;
  /** 是否是默认 Agent */
  isDefault?: boolean;
}

/** 群聊配置 */
export interface GroupChatConfig {
  enabled: boolean;
  /** Agent 之间是否可以互相响应 */
  agentInteraction: boolean;
  /** 最多连续 Agent 回复数 */
  maxAgentChain: number;
  /** 触发下一个 Agent 的概率阈值 */
  chainThreshold: number;
}

/** 入站消息（来自平台） */
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

/** LLM 配置 */
export interface LLMConfig {
  provider: 'openai' | 'anthropic' | 'local' | 'siliconflow' | 'openai-compatible' | 'custom';
  model: string;
  apiKey?: string;
  baseUrl?: string;
  maxTokens?: number;
  temperature?: number;
  /** 自定义模型预设名称 */
  preset?: string;
}

/** 自定义模型配置 */
export interface CustomModelConfig {
  baseUrl: string;
  model: string;
  description?: string;
  /** 额外参数 */
  extraParams?: Record<string, any>;
}

/** 记忆配置 */
export interface MemoryConfig {
  /** 短期记忆窗口大小 */
  shortTermWindow: number;
  /** 向量数据库配置 */
  vectorDb?: {
    type: 'chromadb' | 'memory';
    url?: string;
    collection?: string;
  };
  /** 压缩阈值（消息数） */
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
  /** 多 Agent 配置 */
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
}
