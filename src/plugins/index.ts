import { Session } from '../core/types';

/**
 * 插件基类
 */
export interface Plugin {
  /** 插件名称 */
  name: string;
  
  /** 优先级（数字越小越优先） */
  priority: number;
  
  /** 插件描述 */
  description?: string;
  
  /**
   * 判断是否应该处理此消息
   * @returns true 表示此插件应该处理
   */
  shouldHandle(content: string, session: Session): boolean;
  
  /**
   * 处理消息
   * @returns 回复内容，返回 null 表示不回复
   */
  handle(content: string, session: Session): Promise<string | null>;
}

/**
 * 插件管理器
 */
export class PluginManager {
  private plugins: Plugin[] = [];

  /**
   * 注册插件
   */
  registerPlugin(plugin: Plugin): void {
    this.plugins.push(plugin);
    this.plugins.sort((a, b) => a.priority - b.priority);
  }

  /**
   * 批量加载插件
   */
  async loadPlugins(pluginNames: string[]): Promise<void> {
    for (const name of pluginNames) {
      try {
        // 动态加载插件
        const pluginModule = await import(`../plugins/${name}`);
        if (pluginModule.default) {
          this.registerPlugin(new pluginModule.default());
        }
      } catch (e) {
        console.error(`[PluginManager] Failed to load plugin ${name}:`, e);
      }
    }
  }

  /**
   * 获取所有插件
   */
  getPlugins(): Plugin[] {
    return [...this.plugins];
  }

  /**
   * 处理消息
   * 按优先级遍历插件，第一个匹配的插件处理
   */
  async processMessage(content: string, session: Session): Promise<string | null> {
    for (const plugin of this.plugins) {
      if (plugin.shouldHandle(content, session)) {
        try {
          const result = await plugin.handle(content, session);
          if (result !== null) {
            return result;
          }
        } catch (e) {
          console.error(`[PluginManager] Plugin ${plugin.name} error:`, e);
        }
      }
    }
    return null;
  }
}

/**
 * 示例插件：Echo
 * 回复用户发送的内容
 */
export class EchoPlugin implements Plugin {
  name = 'echo';
  priority = 100;
  description = 'Echo 插件，回复用户消息';

  shouldHandle(content: string): boolean {
    return content.startsWith('/echo ');
  }

  async handle(content: string): Promise<string> {
    return content.slice(6); // 移除 "/echo "
  }
}

/**
 * 示例插件：Help
 * 显示帮助信息
 */
export class HelpPlugin implements Plugin {
  name = 'help';
  priority = 99;
  description = '帮助插件';

  private commands = `
可用命令：
/echo <text> - 回复你发送的内容
/help - 显示此帮助
/stats - 显示会话统计
/clear - 清除会话上下文
`.trim();

  shouldHandle(content: string): boolean {
    return content === '/help' || content === '/start';
  }

  async handle(): Promise<string> {
    return this.commands;
  }
}

/**
 * 示例插件：Stats
 * 显示会话统计
 */
export class StatsPlugin implements Plugin {
  name = 'stats';
  priority = 98;
  
  private getStatsCallback: (sessionId: string) => any;

  constructor(getStatsCallback: (sessionId: string) => any) {
    this.getStatsCallback = getStatsCallback;
  }

  shouldHandle(content: string): boolean {
    return content === '/stats';
  }

  async handle(content: string, session: Session): Promise<string> {
    const stats = this.getStatsCallback(session.id);
    return `
📊 会话统计
平台: ${session.platform}
用户: ${session.userId}
消息数: ${stats?.context?.messages || 0}
摘要数: ${stats?.context?.summaries || 0}
创建于: ${new Date(session.createdAt).toLocaleString()}
`.trim();
  }
}
