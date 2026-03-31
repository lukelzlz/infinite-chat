import { ChatBotEngine } from './core/engine';
import { TelegramAdapter } from './adapters/telegram';
import { DiscordAdapter } from './adapters/discord';
import { FeishuAdapter } from './adapters/feishu';
import { MisskeyAdapter } from './adapters/misskey';
import { TiebaAdapter } from './adapters/tieba';
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
export { TiebaAdapter } from './adapters/tieba';
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
      case 'discord':
        engine.registerAdapter(new DiscordAdapter(adapterConfig.config.token));
        break;
      case 'feishu':
        engine.registerAdapter(new FeishuAdapter({
          appId: adapterConfig.config.appId,
          appSecret: adapterConfig.config.appSecret,
        }));
        break;
      case 'misskey':
        engine.registerAdapter(new MisskeyAdapter({
          instanceUrl: adapterConfig.config.instanceUrl,
          token: adapterConfig.config.token,
        }));
        break;
      case 'feishu':
        engine.registerAdapter(new FeishuAdapter({
          appId: adapterConfig.config.appId,
          appSecret: adapterConfig.config.appSecret,
        }));
        break;
      case 'web':
        const { WebAdapter } = await import('./adapters/web');
        engine.registerAdapter(new WebAdapter({
          port: adapterConfig.config.port || 3000,
        }));
        break;
      case 'tieba': {
        const tiebaToken = adapterConfig.config.token || process.env.TB_TOKEN || '';
        const tiebaAdapter = new TiebaAdapter({
          token: tiebaToken,
          heartbeatIntervalMs: adapterConfig.config.heartbeatIntervalMs,
          pollIntervalMs: adapterConfig.config.pollIntervalMs,
        });
        engine.registerAdapter(tiebaAdapter);

        // 注册贴吧工具
        const tbHeaders = { 'Authorization': tiebaToken };

        engine.registerTool({
          name: 'tieba_browse',
          description: '浏览贴吧帖子列表，查看最新的帖子标题和内容摘要。返回帖子列表，包含 id、标题、内容摘要、回复数、点赞数。',
          parameters: {
            type: 'object',
            properties: {
              sort: { type: 'string', description: '排序方式：0=最新, 1=最热', enum: ['0', '1'] },
            },
            required: [],
          },
        }, async (args) => {
          const sort = args.sort || '0';
          const res = await fetch(`https://tieba.baidu.com/c/f/frs/page_claw?sort_type=${sort}`, { headers: tbHeaders });
          const data = await res.json() as any;
          const threads = data?.data?.thread_list || [];
          return threads.slice(0, 8).map((t: any) => {
            const abstract = (t.abstract || []).map((c: any) => c.text || '').join('').slice(0, 150);
            return `[id:${t.id}] 「${t.title}」 回复:${t.reply_num || 0} 赞:${t.agree_num || 0}\n  ${abstract}`;
          }).join('\n\n') || '暂无帖子';
        });

        engine.registerTool({
          name: 'tieba_comment',
          description: '在贴吧帖子上发表评论。需要提供帖子ID和评论内容。',
          parameters: {
            type: 'object',
            properties: {
              thread_id: { type: 'number', description: '帖子ID' },
              content: { type: 'string', description: '评论内容（50字以内，不用emoji，可以用颜文字）' },
            },
            required: ['thread_id', 'content'],
          },
        }, async (args) => {
          const res = await fetch('https://tieba.baidu.com/c/c/claw/addPost', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...tbHeaders },
            body: JSON.stringify({ content: args.content, thread_id: args.thread_id }),
          });
          const data = await res.json() as any;
          if (data.errno === 0) return `评论成功！post_id=${data.data?.post_id}`;
          return `评论失败: ${data.errmsg || data.error_msg || JSON.stringify(data)}`;
        });

        engine.registerTool({
          name: 'tieba_like',
          description: '给贴吧帖子点赞。',
          parameters: {
            type: 'object',
            properties: {
              thread_id: { type: 'number', description: '帖子ID' },
            },
            required: ['thread_id'],
          },
        }, async (args) => {
          const res = await fetch('https://tieba.baidu.com/c/c/claw/opAgree', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...tbHeaders },
            body: JSON.stringify({ thread_id: args.thread_id, obj_type: 3 }),
          });
          const data = await res.json() as any;
          if (data.errno === 0) return '点赞成功！';
          return `点赞失败: ${data.errmsg}`;
        });

        engine.registerTool({
          name: 'tieba_post',
          description: '在贴吧发布新帖子。',
          parameters: {
            type: 'object',
            properties: {
              title: { type: 'string', description: '帖子标题（30字以内）' },
              content: { type: 'string', description: '帖子内容（100-200字，不用emoji，可以用颜文字）' },
            },
            required: ['title', 'content'],
          },
        }, async (args) => {
          const res = await fetch('https://tieba.baidu.com/c/c/claw/addThread', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...tbHeaders },
            body: JSON.stringify({
              title: args.title,
              content: [{ type: 'text', text: args.content }],
            }),
          });
          const data = await res.json() as any;
          if (data.errno === 0) return `发帖成功！thread_id=${data.data?.thread_id}`;
          return `发帖失败: ${data.errmsg || JSON.stringify(data)}`;
        });

        engine.registerTool({
          name: 'tieba_check_replies',
          description: '检查有没有人回复了你的帖子或评论。',
          parameters: { type: 'object', properties: {}, required: [] },
        }, async () => {
          const res = await fetch('https://tieba.baidu.com/mo/q/claw/replyme?pn=1', { headers: tbHeaders });
          const data = await res.json() as any;
          const replies = data?.data?.reply_list || [];
          if (replies.length === 0) return '暂无新回复';
          return replies.slice(0, 5).map((r: any) =>
            `[thread:${r.thread_id}] 「${(r.content || '').slice(0, 60)}」`
          ).join('\n');
        });

        engine.registerTool({
          name: 'tieba_read_thread',
          description: '读取帖子详情。',
          parameters: {
            type: 'object',
            properties: { thread_id: { type: 'number', description: '帖子ID' } },
            required: ['thread_id'],
          },
        }, async (args) => {
          const listRes = await fetch('https://tieba.baidu.com/c/f/frs/page_claw?sort_type=0', { headers: tbHeaders });
          const listData = await listRes.json() as any;
          const thread = (listData?.data?.thread_list || []).find((t: any) => t.id === args.thread_id);
          if (thread) {
            const abstract = (thread.abstract || []).map((c: any) => c.text || '').join('');
            return `「${thread.title}」\n${abstract.slice(0, 500)}\n回复:${thread.reply_num} 赞:${thread.agree_num}`;
          }
          return '未找到该帖子';
        });

        break;
      }
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
