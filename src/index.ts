import { ChatBotEngine } from './core/engine';
import { TelegramAdapter } from './adapters/telegram';
import { MisskeyAdapter } from './adapters/misskey';
import { FrameworkConfig } from './core/types';
import yaml from 'yaml';
import fs from 'fs';
import path from 'path';
import { validateFilePath } from './utils/security';

export { ChatBotEngine, AgentManager } from './core/engine';
export { PlatformAdapter } from './adapters/base';
export { TelegramAdapter } from './adapters/telegram';
export { DiscordAdapter } from './adapters/discord';
export { FeishuAdapter } from './adapters/feishu';
export { MisskeyAdapter } from './adapters/misskey';
export { WebAdapter } from './adapters/web';
export { LLMProvider, OpenAIProvider, AnthropicProvider, LocalModelProvider } from './llm';
export { Plugin, PluginManager, EchoPlugin, HelpPlugin, StatsPlugin } from './plugins';
export { ContextManager } from './core/context';
export { HybridMemoryManager, Mem0Manager } from './core/memory';
export { ConfigManager, getConfigManager, initConfigManager } from './core/config';
export type { FrameworkConfig, Message, IncomingMessage, Session, Agent, GroupChatConfig, LLMAdvancedParams, ConfigChangeEvent } from './core/types';

// 角色卡系统
export { CharacterManager, getCharacterManager, initCharacterManager } from './character';
export type { CharacterCard, CharacterBook, CharacterBookEntry, CharacterImportResult, CharacterExportOptions } from './character';

// 权限管理
export { PermissionManager, getPermissionManager, PermissionLevel, DEFAULT_ROLE_PERMISSIONS } from './permission';
export type { Permission, RolePermissions, UserInfo } from './permission';

// 指令系统
export { CommandSystem, getCommandSystem, initCommandSystem } from './command';
export type { CommandDefinition, CommandArgument, CommandContext, CommandHandler } from './command';

/**
 * 从配置文件创建引擎
 */
export async function createEngineFromConfig(configPath: string): Promise<ChatBotEngine> {
  // 驗證配置文件路徑（防止路徑遍歷）
  const allowedConfigDirs = [
    path.join(__dirname, '../config'),
    path.join(__dirname, '../../config'),
    process.cwd(), // 允許當前工作目錄
  ];

  const pathValidation = validateFilePath(configPath, allowedConfigDirs);
  if (!pathValidation.valid) {
    throw new Error(`配置文件路徑無效: ${pathValidation.error}`);
  }

  // 檢查文件是否存在
  if (!fs.existsSync(pathValidation.normalizedPath!)) {
    throw new Error(`配置文件不存在: ${configPath}`);
  }

  const configContent = fs.readFileSync(pathValidation.normalizedPath!, 'utf-8');
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
      case 'misskey':
        engine.registerAdapter(new MisskeyAdapter({
          instanceUrl: adapterConfig.config.instanceUrl,
          token: adapterConfig.config.token,
        }));
        break;
      case 'web':
        const { WebAdapter } = await import('./adapters/web');
        engine.registerAdapter(new WebAdapter({
          port: adapterConfig.config.port || 3000,
        }));
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

// 主入口：当直接运行时启动
if (require.main === module) {
  quickStart().catch((err) => {
    console.error('Failed to start:', err);
    process.exit(1);
  });
}
