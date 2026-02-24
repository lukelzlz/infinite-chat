// ============ 核心类型定义 ============

/** 消息结构 */
export interface Message {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  metadata?: Record<string, any>;
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
  provider: 'openai' | 'anthropic' | 'local' | 'siliconflow' | 'openai-compatible';
  model: string;
  apiKey?: string;
  baseUrl?: string;
  maxTokens?: number;
  temperature?: number;
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
  type: 'telegram' | 'discord' | 'feishu' | 'web';
  enabled: boolean;
  config: Record<string, any>;
}

/** 主配置 */
export interface FrameworkConfig {
  llm: LLMConfig;
  memory: MemoryConfig;
  adapters: AdapterConfig[];
  plugins?: {
    enabled: string[];
    directory?: string;
  };
  logging?: {
    level: 'debug' | 'info' | 'warn' | 'error';
    file?: string;
  };
}
