// ============ 工具调用系统 ============

/** 工具参数定义 (OpenAI function calling 格式) */
export interface ToolParameter {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description?: string;
  enum?: string[];
  items?: ToolParameter;
  properties?: Record<string, ToolParameter>;
  required?: string[];
}

/** 工具定义 */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, ToolParameter>;
    required: string[];
  };
}

/** 工具调用请求 (LLM 返回的) */
export interface ToolCall {
  id: string;
  name: string;
  arguments: string; // JSON string
}

/** 工具调用结果 */
export interface ToolResult {
  toolCallId: string;
  success: boolean;
  result: string;
}

/** 工具执行器 */
export type ToolExecutor = (args: Record<string, any>) => Promise<string>;

/** 注册的工具 */
export interface RegisteredTool {
  definition: ToolDefinition;
  executor: ToolExecutor;
}
