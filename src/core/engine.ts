import { v4 as uuidv4 } from 'uuid';
import { FrameworkConfig, Message, IncomingMessage, Session } from './types';
import { ContextManager } from './context';
import { HybridMemoryManager, Mem0Config } from './memory';
import { AgentManager } from './agents';
import { LLMProvider, createLLMProvider } from '../llm';
import { PlatformAdapter } from '../adapters/base';
import { Plugin, PluginManager } from '../plugins';
import { PermissionManager, getPermissionManager } from '../permission';

/**
 * 聊天机器人引擎
 */
export class ChatBotEngine {
  private config: FrameworkConfig;
  private adapters: Map<string, PlatformAdapter> = new Map();
  private llmProvider!: LLMProvider;
  private contextManager: ContextManager;
  private memoryManager: HybridMemoryManager;
  private agentManager?: AgentManager;
  private pluginManager: PluginManager;
  private permissionManager: PermissionManager;
  private sessions: Map<string, Session> = new Map();
  private isRunning = false;

  constructor(config: FrameworkConfig) {
    this.config = config;
    this.contextManager = new ContextManager(config.memory);
    
    // 初始化 Mem0 记忆管理器
    const mem0Config: Mem0Config = {
      apiKey: process.env.MEM0_API_KEY,
      localMode: !process.env.MEM0_API_KEY,
    };
    this.memoryManager = new HybridMemoryManager(mem0Config, config.memory.shortTermWindow);
    
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

    this.isRunning = true;
    console.log('[Engine] Started');
  }

  /**
   * 停止引擎
   */
  async stop(): Promise<void> {
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
    const { sessionId, content, sender } = incoming;

    console.log(`[Engine] Message from ${sessionId}: ${content.slice(0, 50)}...`);

    try {
      // 获取或创建会话
      const session = this.getOrCreateSession(sessionId, incoming);

      // 获取适配器（声明一次，复用）
      const adapter = this.adapters.get(session.platform);

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

      // 调用 LLM
      const response = await llmProvider.chat(messages, {
        systemPrompt,
        temperature: this.config.llm.temperature,
        maxTokens: this.config.llm.maxTokens,
      });

      // 添加助手消息到上下文
      await this.contextManager.addMessage(sessionId, {
        sessionId,
        role: 'assistant',
        content: response,
        agentId: selectedAgent?.id,
      });

      // 发送回复
      if (adapter) {
        // 如果是群聊且启用了多 Agent，可能需要链式回复
        if (session.groupId && this.agentManager?.getGroupChatConfig().agentInteraction) {
          await this.sendMessageWithPossibleChain(
            adapter,
            sessionId,
            response,
            selectedAgent?.id,
            0
          );
        } else {
          await adapter.sendMessage(sessionId, response);
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
    await adapter.sendMessage(sessionId, response);

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
      const chainResponse = await llmProvider.chat(messages, {
        systemPrompt,
        temperature: this.config.llm.temperature,
        maxTokens: this.config.llm.maxTokens,
      });

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
  } {
    return {
      isRunning: this.isRunning,
      adapters: Array.from(this.adapters.keys()),
      sessions: this.sessions.size,
      plugins: this.pluginManager.getPlugins().length,
      agents: this.agentManager?.getAllAgents().length || 0,
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
export { HybridMemoryManager } from './memory';
export { AgentManager } from './agents';
export { PermissionManager } from '../permission';
