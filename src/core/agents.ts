import { Agent, GroupChatConfig, Message, LLMConfig } from './types';
import { LLMProvider, createLLMProvider } from '../llm';

/**
 * 多 Agent 管理器
 * 
 * 功能：
 * - 管理多个 AI Agent
 * - 群聊中 Agent 协作
 * - Agent 选择和触发
 */
export class AgentManager {
  private agents: Map<string, Agent> = new Map();
  private defaultAgentId: string | null = null;
  private groupChatConfig: GroupChatConfig;
  private llmConfig: LLMConfig;
  private llmProviders: Map<string, LLMProvider> = new Map();

  constructor(
    agents: Agent[],
    groupChatConfig: GroupChatConfig,
    llmConfig: LLMConfig
  ) {
    this.groupChatConfig = groupChatConfig;
    this.llmConfig = llmConfig;

    // 注册所有 Agent
    for (const agent of agents) {
      this.registerAgent(agent);
    }

    console.log(`[AgentManager] Initialized with ${this.agents.size} agents`);
  }

  /**
   * 注册 Agent
   */
  registerAgent(agent: Agent): void {
    this.agents.set(agent.id, agent);
    
    // 记录默认 Agent
    if (agent.isDefault) {
      this.defaultAgentId = agent.id;
    }

    // 为每个 Agent 创建 LLM Provider（如果有覆盖配置）
    if (agent.llmOverride) {
      const config = { ...this.llmConfig, ...agent.llmOverride };
      this.llmProviders.set(agent.id, createLLMProvider(config));
    }

    console.log(`[AgentManager] Agent registered: ${agent.name} (${agent.id})`);
  }

  /**
   * 获取 Agent
   */
  getAgent(agentId: string): Agent | undefined {
    return this.agents.get(agentId);
  }

  /**
   * 获取默认 Agent
   */
  getDefaultAgent(): Agent | undefined {
    if (this.defaultAgentId) {
      return this.agents.get(this.defaultAgentId);
    }
    // 如果没有明确设置，返回第一个
    return this.agents.values().next().value;
  }

  /**
   * 根据消息内容选择 Agent
   */
  selectAgent(content: string, context?: Message[]): Agent {
    const lowerContent = content.toLowerCase();

    // 检查触发词
    for (const agent of this.agents.values()) {
      if (agent.triggers) {
        for (const trigger of agent.triggers) {
          if (lowerContent.includes(trigger.toLowerCase())) {
            console.log(`[AgentManager] Triggered agent: ${agent.name} (keyword: ${trigger})`);
            return agent;
          }
        }
      }
    }

    // 检查是否在 @ 某个 Agent
    const atMatch = content.match(/@(\w+)/);
    if (atMatch) {
      const name = atMatch[1].toLowerCase();
      for (const agent of this.agents.values()) {
        if (agent.name.toLowerCase().includes(name)) {
          console.log(`[AgentManager] Selected agent by mention: ${agent.name}`);
          return agent;
        }
      }
    }

    // 检查上下文中的最后一个回复
    if (context && context.length > 0) {
      const lastAssistant = [...context].reverse().find(m => m.role === 'assistant');
      if (lastAssistant?.agentId) {
        const agent = this.agents.get(lastAssistant.agentId);
        if (agent) {
          return agent;
        }
      }
    }

    // 返回默认 Agent
    return this.getDefaultAgent()!;
  }

  /**
   * 获取 Agent 的 LLM Provider
   */
  getLLMProvider(agentId: string): LLMProvider {
    // 如果 Agent 有专用配置，使用专用 Provider
    if (this.llmProviders.has(agentId)) {
      return this.llmProviders.get(agentId)!;
    }
    // 否则使用默认配置
    return createLLMProvider(this.llmConfig);
  }

  /**
   * 群聊：决定是否需要另一个 Agent 回复
   */
  shouldChainAgent(
    lastAgentId: string,
    response: string,
    chainCount: number
  ): { shouldChain: boolean; nextAgent?: Agent } {
    if (!this.groupChatConfig.enabled || !this.groupChatConfig.agentInteraction) {
      return { shouldChain: false };
    }

    // 检查是否超过最大链数
    if (chainCount >= this.groupChatConfig.maxAgentChain) {
      return { shouldChain: false };
    }

    // 检查回复中是否提到了其他 Agent
    for (const agent of this.agents.values()) {
      if (agent.id === lastAgentId) continue;
      
      const patterns = [
        `@${agent.name}`,
        agent.name,
        ...(agent.triggers || []),
      ];

      for (const pattern of patterns) {
        if (response.toLowerCase().includes(pattern.toLowerCase())) {
          // 随机决定是否触发（根据阈值）
          if (Math.random() < this.groupChatConfig.chainThreshold) {
            console.log(`[AgentManager] Chaining to agent: ${agent.name}`);
            return { shouldChain: true, nextAgent: agent };
          }
        }
      }
    }

    return { shouldChain: false };
  }

  /**
   * 构建多 Agent 系统提示
   */
  buildMultiAgentSystemPrompt(agent: Agent, allAgents: boolean = false): string {
    let prompt = agent.systemPrompt;

    // 如果启用群聊，添加其他 Agent 信息
    if (this.groupChatConfig.enabled && allAgents && this.agents.size > 1) {
      const otherAgents = Array.from(this.agents.values())
        .filter(a => a.id !== agent.id);
      
      if (otherAgents.length > 0) {
        prompt += '\n\n## 其他 Agent\n';
        prompt += '在群聊中，你可以与其他 Agent 协作。以下是其他 Agent：\n';
        
        for (const other of otherAgents) {
          prompt += `- ${other.name}: ${other.description || '无描述'}\n`;
        }
        
        prompt += '\n如果你想引起某个 Agent 的注意，可以 @ 提到它的名字。\n';
      }
    }

    return prompt;
  }

  /**
   * 获取所有 Agent 列表
   */
  getAllAgents(): Agent[] {
    return Array.from(this.agents.values());
  }

  /**
   * 获取群聊配置
   */
  getGroupChatConfig(): GroupChatConfig {
    return this.groupChatConfig;
  }
}
