import { Session } from '../core/types';
import { Plugin } from './types';

// 导出 Plugin 类型
export { Plugin } from './types';

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
        const pluginModule = await import(`./${name}`);
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
   * 夌理消息
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

// 重新导出内置插件（从各自文件导出，避免重复定义）
export { EchoPlugin } from './echo';
export { HelpPlugin } from './help';
export { StatsPlugin } from './stats';
export { BrowserPlugin } from './browser';
export { WebSearchPlugin } from './websearch';
