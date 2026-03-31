import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { FrameworkConfig, Message, IncomingMessage, Session } from './types';
import { ContextManager } from './context';
// RAGMemoryManager replaces HybridMemoryManager
import { AgentManager } from './agents';
import { LLMProvider, createLLMProvider, LLMChatResult } from '../llm';
import { RegisteredTool, ToolCall, ToolDefinition, ToolResult } from './tools';
import { PlatformAdapter } from '../adapters/base';
import { Plugin, PluginManager } from '../plugins';
import { PermissionManager, getPermissionManager } from '../permission';
import { generateSecureId, validateUrl } from '../utils/security';
import { RAGService, getRAGService } from '../rag';
import { MemoryManager, initMemoryManager } from './memory-manager';

/**
 * 聊天机器人引擎
 */
export class ChatBotEngine {
  private config: FrameworkConfig;
  private adapters: Map<string, PlatformAdapter> = new Map();
  private llmProvider!: LLMProvider;
  private contextManager: ContextManager;
  private memoryManager: any; // RAGMemoryManager
  private agentManager?: AgentManager;
  private pluginManager: PluginManager;
  private permissionManager: PermissionManager;
  private sessions: Map<string, Session> = new Map();
  private isRunning = false;
  private tools: Map<string, RegisteredTool> = new Map();
  private memManager: MemoryManager;

  constructor(config: FrameworkConfig) {
    this.config = config;
    this.contextManager = new ContextManager(config.memory);
    
    // 初始化 Mem0 记忆管理器
    // Initialize RAG memory manager (semantic retrieval with embeddings)
    try {
      const { RAGMemoryManager } = require('./rag-memory');
      const llmBaseUrl = (config.llm?.baseUrl || process.env.OPENAI_BASE_URL || '').replace(/\/v1\/?$/, '');
      const llmApiKey = config.llm?.apiKey || process.env.OPENAI_API_KEY || '';
      this.memoryManager = new RAGMemoryManager({
        embeddingBaseUrl: llmBaseUrl,
        embeddingApiKey: llmApiKey,
        embeddingModel: 'BAAI/bge-m3',
        dataDir: path.join(process.cwd(), 'data'),
        shortTermWindow: config.memory?.shortTermWindow || 20,
      });
      console.log('[Engine] RAG memory initialized (semantic)');
    } catch (e: any) {
      console.warn('[Engine] RAG init failed, falling back to keyword memory:', e.message);
      const { HybridMemoryManager } = require('./memory');
      this.memoryManager = new HybridMemoryManager({ localMode: true }, config.memory?.shortTermWindow || 20);
    }
    
    // 初始化多 Agent 管理器
    if (config.agents?.enabled && config.agents.list.length > 0) {
      this.agentManager = new AgentManager(
        config.agents.list,
        config.agents.groupChat,
        config.llm
      );
    }
    
    // 初始化插件管理器
    this.pluginManager = new PluginManager();
    
    // 初始化权限管理器
    this.permissionManager = getPermissionManager();
    
    // 初始化内存管理器（性能优化）
    this.memManager = initMemoryManager({
      maxSessions: 10000,
      sessionTimeout: 24 * 60 * 60 * 1000, // 24 小时
      cleanupInterval: 5 * 60 * 1000, // 5 分钟
    });
  }

  /**
   * 初始化引擎
   */
  async init(): Promise<void> {
    // 初始化 LLM
    this.llmProvider = createLLMProvider(this.config.llm);
    console.log(`[Engine] LLM initialized: ${this.config.llm.provider}/${this.config.llm.model}`);

    // 加载插件
    if (this.config.plugins?.enabled) {
      await this.pluginManager.loadPlugins(this.config.plugins.enabled);
      console.log(`[Engine] Loaded ${this.pluginManager.getPlugins().length} plugins`);
    }
  }

  /**
   * 注册平台适配器
   */
  registerAdapter(adapter: PlatformAdapter): void {
    this.adapters.set(adapter.name, adapter);
    console.log(`[Engine] Adapter registered: ${adapter.name}`);
  }

  /**
   * 注册插件
   */
  registerPlugin(plugin: Plugin): void {
    this.pluginManager.registerPlugin(plugin);
    console.log(`[Engine] Plugin registered: ${plugin.name}`);
  }

  /**
   * 启动引擎
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.warn('[Engine] Already running');
      return;
    }

    await this.init();

    // 启动所有适配器
    for (const [name, adapter] of this.adapters) {
      try {
        // 注册消息处理器
        adapter.onMessage(this.handleIncomingMessage.bind(this));
        await adapter.start();
        console.log(`[Engine] Adapter started: ${name}`);
      } catch (e) {
        console.error(`[Engine] Failed to start adapter ${name}:`, e);
      }
    }

    // 启动内存管理器清理任务（性能优化）
    this.memManager.startCleanup(
      () => this.sessions,
      (sessionId) => this.clearSession(sessionId)
    );

    this.isRunning = true;
    console.log('[Engine] Started');
  }

  /**
   * 停止引擎
   */
  async stop(): Promise<void> {
    // 停止内存管理器清理
    this.memManager.stopCleanup();

    for (const [name, adapter] of this.adapters) {
      try {
        await adapter.stop();
        console.log(`[Engine] Adapter stopped: ${name}`);
      } catch (e) {
        console.error(`[Engine] Failed to stop adapter ${name}:`, e);
      }
    }
    this.isRunning = false;
    console.log('[Engine] Stopped');
  }

  /**
   * 处理入站消息
   */
  private async handleIncomingMessage(incoming: IncomingMessage): Promise<void> {
    const { sessionId, content, sender, attachments } = incoming;

    const logPreview = content || `[附件: ${attachments?.length || 0} 个]`;
    console.log(`[Engine] Message from ${sessionId}: ${logPreview.slice(0, 50)}...`);

    try {
      // 获取或创建会话
      const session = this.getOrCreateSession(sessionId, incoming);

      // 获取适配器（声明一次，复用）
      const adapter = this.adapters.get(session.platform);

      // 处理附件（自动导入文档到 RAG）
      if (attachments && attachments.length > 0) {
        await this.handleAttachments(attachments, session, adapter, content);
        return; // 附件处理完毕，等待用户下一步指令
      }

      // 获取或创建用户
      const user = this.permissionManager.getOrCreateUser(session.platform, session.userId);

      // 检查用户是否被封禁
      if (user.banned) {
        if (user.banExpiresAt && user.banExpiresAt < Date.now()) {
          this.permissionManager.unbanUser(session.platform, session.userId);
        } else {
          console.log(`[Engine] User ${session.userId} is banned`);
          if (adapter) {
            await adapter.sendMessage(sessionId, `你已被封禁: ${user.banReason || '无原因'}`);
          }
          return;
        }
      }

      // 检查权限
      if (!this.permissionManager.hasPermission(user, 'chat')) {
        console.log(`[Engine] User ${session.userId} has no chat permission`);
        return;
      }

      // 检查频率限制
      const rateLimitResult = this.permissionManager.checkRateLimit(user);
      if (!rateLimitResult.allowed) {
        console.log(`[Engine] Rate limit hit for ${session.userId}`);
        if (adapter) {
          await adapter.sendMessage(sessionId, `${rateLimitResult.reason}，请 ${rateLimitResult.retryAfter} 秒后再试。`);
        }
        return;
      }

      // 发送 typing 状态
      if (adapter && 'sendTyping' in adapter) {
        (adapter as any).sendTyping(sessionId).catch(() => {});
      }

      // 检查是否是插件命令
      const pluginResult = await this.pluginManager.processMessage(content, session);
      if (pluginResult) {
        if (adapter) {
          await adapter.sendMessage(sessionId, pluginResult);
        }
        return;
      }

      // 添加用户消息到上下文
      await this.contextManager.addMessage(sessionId, {
        sessionId,
        role: 'user',
        content,
        metadata: { sender },
      });

      // 获取上下文
      const messages = await this.contextManager.getContext(sessionId);

      // 选择 Agent（如果启用多 Agent）
      let selectedAgent = null;
      let llmProvider = this.llmProvider;
      let systemPrompt: string | undefined;

      if (this.agentManager) {
        selectedAgent = this.agentManager.selectAgent(content, messages);
        llmProvider = this.agentManager.getLLMProvider(selectedAgent.id);
        systemPrompt = this.agentManager.buildMultiAgentSystemPrompt(
          selectedAgent,
          !!session.groupId
        );
        console.log(`[Engine] Selected agent: ${selectedAgent.name}`);
      } else {
        // 使用 Mem0 构建增强上下文
        const memContext = await this.memoryManager.buildContext(
          messages,
          session.userId,
          content
        );
        systemPrompt = memContext.systemPrompt;
      }

      // RAG: 检索知识库相关内容
      const rag = getRAGService();
      const ragResults = rag.searchSync(content, 3);
      if (ragResults.length > 0) {
        const ragContext = ragResults
          .map((r, i) => `【参考资料${i + 1}】(来源: ${r.source}, 相关度: ${(r.score * 100).toFixed(0)}%)\n${r.content}`)
          .join('\n\n');
        
        systemPrompt = (systemPrompt || '') + `\n\n📚 以下是与用户问题相关的知识库内容，请参考这些内容回答：\n\n${ragContext}`;
        console.log(`[Engine] RAG: Found ${ragResults.length} relevant documents`);
      }

      // 工具调用循环
      const toolDefs = this.getToolDefinitions();
      let llmResult: LLMChatResult;
      let maxToolRounds = 5; // 最多5轮工具调用
      const toolMessages: any[] = []; // tool role messages

      do {
        llmResult = await llmProvider.chat(messages, {
          systemPrompt,
          temperature: this.config.llm.temperature,
          maxTokens: this.config.llm.maxTokens,
          tools: toolDefs.length > 0 ? toolDefs : undefined,
        });

        // 如果没有工具调用，退出循环
        if (!llmResult.toolCalls || llmResult.toolCalls.length === 0) break;

        // 执行工具调用
        const toolResults = await this.executeToolCalls(llmResult.toolCalls);

        // 把 assistant 的 tool_calls 和 tool results 加入 messages
        // (用 any 绕过 Message 类型检查，因为 tool role 不在原始类型里)
        (messages as any[]).push({
          role: 'assistant',
          content: llmResult.content || null,
          tool_calls: llmResult.toolCalls.map(tc => ({
            id: tc.id,
            type: 'function',
            function: { name: tc.name, arguments: tc.arguments },
          })),
        });

        for (const tr of toolResults) {
          (messages as any[]).push({
            role: 'tool',
            tool_call_id: tr.toolCallId,
            content: tr.result,
          });
        }

        maxToolRounds--;
      } while (maxToolRounds > 0);

      const response = llmResult.content;

      // 添加助手消息到上下文
      await this.contextManager.addMessage(sessionId, {
        sessionId,
        role: 'assistant',
        content: response,
        agentId: selectedAgent?.id,
      });

      // 发送回复
      if (adapter) {
        if (session.groupId && this.agentManager?.getGroupChatConfig().agentInteraction) {
          await this.sendMessageWithPossibleChain(
            adapter,
            sessionId,
            response,
            selectedAgent?.id,
            0
          );
        } else {
          const sess = this.sessions.get(sessionId);
          await adapter.sendMessage(sessionId, response, sess?.metadata as any);
        }
      }

      console.log(`[Engine] Response sent to ${sessionId}`);
    } catch (e: any) {
      console.error(`[Engine] Error processing message:`, e);
      console.error(`[Engine] Error stack:`, e?.stack);
      console.error(`[Engine] Session: ${sessionId}, Platform: ${sessionId.split(':')[0]}`);

      const errorAdapter = this.adapters.get(sessionId.split(':')[0]);
      if (errorAdapter) {
        try {
          await errorAdapter.sendMessage(sessionId, `抱歉，处理消息时出错: ${e?.message || '未知错误'}`);
        } catch (sendError) {
          console.error(`[Engine] Failed to send error message:`, sendError);
        }
      }
    }
  }

  /**
   * 发送消息并可能触发链式 Agent 回复
   */
  private async sendMessageWithPossibleChain(
    adapter: PlatformAdapter,
    sessionId: string,
    response: string,
    lastAgentId: string | undefined,
    chainCount: number
  ): Promise<void> {
    // 发送当前回复
    // Pass session metadata to adapter for platform-specific routing (e.g., tieba thread_id)
    const session = this.sessions.get(sessionId);
    await adapter.sendMessage(sessionId, response, session?.metadata as any);

    // 检查是否需要链式回复
    if (!this.agentManager || !lastAgentId) return;

    const { shouldChain, nextAgent } = this.agentManager.shouldChainAgent(
      lastAgentId,
      response,
      chainCount
    );

    if (shouldChain && nextAgent) {
      // 短暂延迟
      await new Promise(resolve => setTimeout(resolve, 1000));

      // 获取上下文
      const messages = await this.contextManager.getContext(sessionId);
      const llmProvider = this.agentManager.getLLMProvider(nextAgent.id);
      const systemPrompt = this.agentManager.buildMultiAgentSystemPrompt(nextAgent, true);

      // 生成回复
      const chainResult = await llmProvider.chat(messages, {
        systemPrompt,
        temperature: this.config.llm.temperature,
        maxTokens: this.config.llm.maxTokens,
      });
      const chainResponse = chainResult.content;

      // 添加到上下文
      await this.contextManager.addMessage(sessionId, {
        sessionId,
        role: 'assistant',
        content: chainResponse,
        agentId: nextAgent.id,
      });

      // 递归检查是否继续链式
      await this.sendMessageWithPossibleChain(
        adapter,
        sessionId,
        chainResponse,
        nextAgent.id,
        chainCount + 1
      );
    }
  }

  /**
   * 处理附件（自动导入文档到 RAG）
   */
  private async handleAttachments(
    attachments: import('./types').MessageAttachment[],
    session: Session,
    adapter: PlatformAdapter | undefined,
    caption: string
  ): Promise<void> {
    const rag = getRAGService();
    const results: string[] = [];

    for (const attachment of attachments) {
      // 只处理文档类型
      if (attachment.type !== 'document') continue;

      try {
        // 检查文件扩展名
        const ext = attachment.filename?.split('.').pop()?.toLowerCase();
        const allowedExts = ['txt', 'md', 'json', 'csv', 'log', 'js', 'ts', 'py', 'go', 'rs', 'html', 'css', 'xml', 'yaml', 'yml', 'sh'];
        
        if (!ext || !allowedExts.includes(ext)) {
          results.push(`❌ ${attachment.filename}: 不支持的文件类型 (.${ext})`);
          continue;
        }

        // 检查文件大小 (5MB 限制)
        if (attachment.size && attachment.size > 5 * 1024 * 1024) {
          results.push(`❌ ${attachment.filename}: 文件过大 (最大 5MB)`);
          continue;
        }

        // 下载文件
        let content: string;
        
        if (session.platform === 'telegram' && adapter && 'downloadFile' in adapter) {
          const fileData = await (adapter as any).downloadFile(attachment.fileId);
          content = fileData.content.toString('utf-8');
        } else if (session.platform === 'discord' && attachment.url) {
          // Discord 文件通过 URL 下载 - 验证 URL 防止 SSRF
          const urlValidation = validateUrl(attachment.url, { allowPrivateIp: false });
          if (!urlValidation.valid) {
            results.push(`❌ ${attachment.filename}: 无效的文件 URL`);
            continue;
          }
          const response = await fetch(urlValidation.normalizedUrl!);
          if (!response.ok) {
            throw new Error(`Download failed: ${response.statusText}`);
          }
          content = await response.text();
        } else {
          results.push(`❌ ${attachment.filename}: 平台不支持文件下载`);
          continue;
        }

        // 导入到 RAG
        const doc = await rag.uploadDocument(content, attachment.filename || 'unknown.txt');
        results.push(`✅ ${attachment.filename}: 已导入知识库 (${doc.chunks.length} 个分块)`);
        console.log(`[Engine] Document imported: ${attachment.filename}`);
      } catch (error) {
        console.error(`[Engine] Failed to process attachment:`, error);
        results.push(`❌ ${attachment.filename}: 处理失败`);
      }
    }

    // 发送结果
    if (adapter && results.length > 0) {
      const message = results.length === 1 
        ? results[0] 
        : `📎 文件处理结果:\n\n${results.join('\n')}`;
      await adapter.sendMessage(session.id, message + '\n\n💡 现在可以问我关于这些文件的问题了！');
    }
  }

  /**
   * 获取或创建会话
   */
  private getOrCreateSession(sessionId: string, incoming: IncomingMessage): Session {
    if (this.sessions.has(sessionId)) {
      const session = this.sessions.get(sessionId)!;
      session.lastActiveAt = Date.now();
      return session;
    }

    const [platform, ...rest] = sessionId.split(':');
    const session: Session = {
      id: sessionId,
      platform,
      userId: rest[rest.length - 1] || 'unknown',
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
      metadata: incoming.metadata,
    };

    // 检查是否是群组
    if (rest[0] === 'group') {
      session.groupId = rest[1];
    }

    this.sessions.set(sessionId, session);
    return session;
  }

  /**
   * 获取会话统计
   */
  getSessionStats(sessionId: string): any {
    const session = this.sessions.get(sessionId);
    const contextStats = this.contextManager.getStats(sessionId);
    
    return {
      session,
      context: contextStats,
    };
  }

  /**
   * 清除会话
   */
  clearSession(sessionId: string): void {
    this.sessions.delete(sessionId);
    this.contextManager.clearContext(sessionId);
    console.log(`[Engine] Session cleared: ${sessionId}`);
  }

  /**
   * 手动发送消息（用于主动推送）
   */
  async sendMessage(sessionId: string, message: string): Promise<void> {
    const [platform] = sessionId.split(':');
    const adapter = this.adapters.get(platform);
    
    if (!adapter) {
      throw new Error(`Adapter not found: ${platform}`);
    }

    await adapter.sendMessage(sessionId, message);
  }

  /**
   * 获取引擎状态
   */
  getStatus(): {
    isRunning: boolean;
    adapters: string[];
    sessions: number;
    plugins: number;
    agents: number;
    memory?: ReturnType<MemoryManager['getStats']>;
  } {
    return {
      isRunning: this.isRunning,
      adapters: Array.from(this.adapters.keys()),
      sessions: this.sessions.size,
      plugins: this.pluginManager.getPlugins().length,
      agents: this.agentManager?.getAllAgents().length || 0,
      memory: this.memManager.getStats(this.sessions),
    };
  }

  /**
   * 获取权限管理器
   */
  getPermissionManager(): PermissionManager {
    return this.permissionManager;
  }

  /**
   * 获取配置
   */
  getConfig(): FrameworkConfig {
    return this.config;
  }

  /**
   * 更新配置
   */
  updateConfig(partial: Partial<FrameworkConfig>): void {
    this.config = { ...this.config, ...partial };
  }

  /** 注册工具 */
  registerTool(definition: ToolDefinition, executor: (args: Record<string, any>) => Promise<string>): void {
    this.tools.set(definition.name, { definition, executor });
    console.log(`[Engine] Tool registered: ${definition.name}`);
  }

  /** 获取所有已注册的工具定义 */
  getToolDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map(t => t.definition);
  }

  /** 执行工具调用 */
  private async executeToolCalls(toolCalls: ToolCall[]): Promise<ToolResult[]> {
    const results: ToolResult[] = [];
    for (const tc of toolCalls) {
      const tool = this.tools.get(tc.name);
      if (!tool) {
        results.push({ toolCallId: tc.id, success: false, result: `Unknown tool: ${tc.name}` });
        continue;
      }
      try {
        let args: Record<string, any> = {};
        try { args = JSON.parse(tc.arguments); } catch { args = {}; }
        console.log(`[Engine] Tool call: ${tc.name}(${JSON.stringify(args).slice(0, 100)})`);
        const result = await tool.executor(args);
        console.log(`[Engine] Tool result: ${result.slice(0, 100)}`);
        results.push({ toolCallId: tc.id, success: true, result });
      } catch (e: any) {
        console.error(`[Engine] Tool error: ${tc.name}`, e.message);
        results.push({ toolCallId: tc.id, success: false, result: `Error: ${e.message}` });
      }
    }
    return results;
  }

  /**
   * 更新 LLM 配置
   */
  updateLLMConfig(llmConfig: Partial<FrameworkConfig['llm']>): void {
    this.config.llm = { ...this.config.llm, ...llmConfig };
    // 重新创建 LLM Provider
    this.llmProvider = createLLMProvider(this.config.llm);
    console.log(`[Engine] LLM config updated: ${this.config.llm.model}`);
  }
}

// 导出
export { FrameworkConfig, Message, IncomingMessage, Session, Agent } from './types';
export { ContextManager } from './context';
// memory exports moved to rag-memory
export { AgentManager } from './agents';
export { PermissionManager } from '../permission';
