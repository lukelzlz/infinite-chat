import fs from 'fs';
import path from 'path';
import yaml from 'yaml';
import { FrameworkConfig, ConfigChangeEvent } from './types';

type ConfigChangeListener = (event: ConfigChangeEvent) => void;

/**
 * 配置管理器
 * 
 * 功能：
 * - 加载/保存配置
 * - 热加载监听
 * - 配置变更通知
 */
export class ConfigManager {
  private configPath: string;
  private config: FrameworkConfig;
  private listeners: ConfigChangeListener[] = [];
  private watcher: fs.FSWatcher | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;
  private debounceMs: number;

  constructor(configPath: string) {
    this.configPath = configPath;
    this.config = this.load();
    this.debounceMs = this.config.hotReload?.debounceMs || 1000;
  }

  /**
   * 加载配置
   */
  load(): FrameworkConfig {
    const content = fs.readFileSync(this.configPath, 'utf-8');
    
    // 替换环境变量
    const processedContent = this.replaceEnvVars(content);
    
    const config = yaml.parse(processedContent) as FrameworkConfig;
    this.config = config;
    
    return config;
  }

  /**
   * 保存配置
   */
  save(config: Partial<FrameworkConfig>): void {
    const newConfig = { ...this.config, ...config };
    const content = yaml.stringify(newConfig);
    fs.writeFileSync(this.configPath, content, 'utf-8');
    
    // 触发变更事件
    this.notifyListeners({
      type: 'all',
      oldConfig: this.config,
      newConfig,
      timestamp: Date.now(),
    });
    
    this.config = newConfig;
  }

  /**
   * 更新部分配置
   */
  update(partial: Partial<FrameworkConfig>): void {
    this.save(partial);
  }

  /**
   * 更新 LLM 配置
   */
  updateLLM(llmConfig: Partial<FrameworkConfig['llm']>): void {
    const oldLLM = { ...this.config.llm };
    this.config.llm = { ...this.config.llm, ...llmConfig };
    
    this.save(this.config);
    
    this.notifyListeners({
      type: 'llm',
      oldConfig: { llm: oldLLM },
      newConfig: { llm: this.config.llm },
      timestamp: Date.now(),
    });
  }

  /**
   * 更新 Agent 配置
   */
  updateAgents(agents: FrameworkConfig['agents']): void {
    const oldAgents = this.config.agents ? { ...this.config.agents } : undefined;
    this.config.agents = agents;
    
    this.save(this.config);
    
    this.notifyListeners({
      type: 'agents',
      oldConfig: { agents: oldAgents },
      newConfig: { agents },
      timestamp: Date.now(),
    });
  }

  /**
   * 获取当前配置
   */
  getConfig(): FrameworkConfig {
    return this.config;
  }

  /**
   * 启动热加载监听
   */
  startHotReload(): void {
    if (this.watcher) return;

    const watchPath = this.config.hotReload?.watchPath || path.dirname(this.configPath);
    
    this.watcher = fs.watch(watchPath, (eventType, filename) => {
      if (filename && (filename.endsWith('.yaml') || filename.endsWith('.yml'))) {
        this.debouncedReload();
      }
    });

    console.log(`[ConfigManager] Hot reload enabled, watching: ${watchPath}`);
  }

  /**
   * 停止热加载监听
   */
  stopHotReload(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  /**
   * 添加配置变更监听器
   */
  onChange(listener: ConfigChangeListener): () => void {
    this.listeners.push(listener);
    
    // 返回取消监听函数
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index !== -1) {
        this.listeners.splice(index, 1);
      }
    };
  }

  /**
   * 替换环境变量
   */
  private replaceEnvVars(content: string): string {
    // ${VAR_NAME} 或 $VAR_NAME
    return content.replace(/\$\{([^}]+)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (match, braced, unbraced) => {
      const varName = braced || unbraced;
      const value = process.env[varName];
      
      if (value === undefined) {
        console.warn(`[ConfigManager] Environment variable not found: ${varName}`);
        return match;
      }
      
      return value;
    });
  }

  /**
   * 防抖重载
   */
  private debouncedReload(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    
    this.debounceTimer = setTimeout(() => {
      console.log('[ConfigManager] Reloading config...');
      
      try {
        const oldConfig = { ...this.config };
        this.load();
        
        this.notifyListeners({
          type: 'all',
          oldConfig,
          newConfig: this.config,
          timestamp: Date.now(),
        });
        
        console.log('[ConfigManager] Config reloaded successfully');
      } catch (e) {
        console.error('[ConfigManager] Failed to reload config:', e);
      }
      
      this.debounceTimer = null;
    }, this.debounceMs);
  }

  /**
   * 通知监听器
   */
  private notifyListeners(event: ConfigChangeEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (e) {
        console.error('[ConfigManager] Listener error:', e);
      }
    }
  }
}

// 创建全局配置管理器
let globalConfigManager: ConfigManager | null = null;

export function getConfigManager(configPath?: string): ConfigManager {
  if (!globalConfigManager && configPath) {
    globalConfigManager = new ConfigManager(configPath);
  }
  return globalConfigManager!;
}

export function initConfigManager(configPath: string): ConfigManager {
  globalConfigManager = new ConfigManager(configPath);
  return globalConfigManager;
}
