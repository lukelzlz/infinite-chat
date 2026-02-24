import { ChatBotEngine } from './core/engine';
import { TelegramAdapter } from './adapters/telegram';
import { FrameworkConfig } from './core/types';
import yaml from 'yaml';
import fs from 'fs';
import path from 'path';

export { ChatBotEngine } from './core/engine';
export { PlatformAdapter } from './adapters/base';
export { TelegramAdapter } from './adapters/telegram';
export { LLMProvider, OpenAIProvider, AnthropicProvider, LocalModelProvider } from './llm';
export { Plugin, PluginManager, EchoPlugin, HelpPlugin, StatsPlugin } from './plugins';
export { ContextManager } from './core/context';
export { HybridMemoryManager, Mem0Manager } from './core/memory';
export type { FrameworkConfig, Message, IncomingMessage, Session } from './core/types';

/**
 * 从配置文件创建引擎
 */
export async function createEngineFromConfig(configPath: string): Promise<ChatBotEngine> {
  const configContent = fs.readFileSync(configPath, 'utf-8');
  const config: FrameworkConfig = yaml.parse(configContent);

  // 替换环境变量
  const resolvedConfig = resolveEnvVars(config);

  const engine = new ChatBotEngine(resolvedConfig);

  // 注册适配器
  for (const adapterConfig of resolvedConfig.adapters) {
    if (!adapterConfig.enabled) continue;

    switch (adapterConfig.type) {
      case 'telegram':
        engine.registerAdapter(new TelegramAdapter(adapterConfig.config.token));
        break;
      // 添加更多适配器...
    }
  }

  return engine;
}

/**
 * 递归替换环境变量
 */
function resolveEnvVars(obj: any): any {
  if (typeof obj === 'string') {
    // 匹配 ${VAR_NAME} 格式
    return obj.replace(/\$\{([^}]+)\}/g, (_, varName) => {
      return process.env[varName] || '';
    });
  }
  
  if (Array.isArray(obj)) {
    return obj.map(resolveEnvVars);
  }
  
  if (typeof obj === 'object' && obj !== null) {
    const result: any = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = resolveEnvVars(value);
    }
    return result;
  }
  
  return obj;
}

/**
 * 快速启动函数
 */
export async function quickStart(configPath?: string): Promise<ChatBotEngine> {
  const config = configPath || path.join(__dirname, '../config/config.yaml');
  const engine = await createEngineFromConfig(config);
  await engine.start();
  return engine;
}
