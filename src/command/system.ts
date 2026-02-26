// ============ 指令系统 ============

import { UserInfo } from '../permission/manager';

/**
 * 指令定义
 */
export interface CommandDefinition {
  /** 指令名称 */
  name: string;
  /** 别名 */
  aliases?: string[];
  /** 描述 */
  description: string;
  /** 用法 */
  usage?: string;
  /** 示例 */
  examples?: string[];
  /** 所需权限 */
  permission?: string;
  /** 参数定义 */
  arguments?: CommandArgument[];
  /** 是否在帮助中隐藏 */
  hidden?: boolean;
  /** 分组 */
  group?: string;
}

/**
 * 指令参数定义
 */
export interface CommandArgument {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'user' | 'role' | 'character';
  required: boolean;
  description?: string;
  default?: any;
  choices?: { name: string; value: any }[];
}

/**
 * 指令上下文
 */
export interface CommandContext {
  platform: string;
  userId: string;
  sessionId: string;
  user: UserInfo;
  rawMessage: string;
  args: Record<string, any>;
  reply: (message: string) => Promise<void>;
}

/**
 * 指令处理器
 */
export type CommandHandler = (ctx: CommandContext) => Promise<string | void>;

/**
 * 指令系统
 */
export class CommandSystem {
  private commands: Map<string, CommandDefinition> = new Map();
  private handlers: Map<string, CommandHandler> = new Map();
  private prefix: string = '/';

  constructor(prefix: string = '/') {
    this.prefix = prefix;
    this.registerBuiltInCommands();
  }

  /**
   * 注册指令
   */
  register(definition: CommandDefinition, handler: CommandHandler): void {
    this.commands.set(definition.name, definition);
    this.handlers.set(definition.name, handler);
    
    // 注册别名
    if (definition.aliases) {
      for (const alias of definition.aliases) {
        this.commands.set(alias, definition);
        this.handlers.set(alias, handler);
      }
    }
  }

  /**
   * 解析并执行指令
   */
  async execute(
    message: string,
    context: Omit<CommandContext, 'args' | 'rawMessage'>
  ): Promise<string | null> {
    if (!message.startsWith(this.prefix)) return null;
    
    const parts = message.slice(this.prefix.length).trim().split(/\s+/);
    const commandName = parts[0]?.toLowerCase();
    
    if (!commandName) return null;
    
    const definition = this.commands.get(commandName);
    const handler = this.handlers.get(commandName);
    
    if (!definition || !handler) {
      return `未知指令: ${commandName}。输入 ${this.prefix}help 查看可用指令。`;
    }
    
    // 检查权限
    if (definition.permission) {
      const { getPermissionManager } = require('../permission/manager');
      const permManager = getPermissionManager();
      
      if (!permManager.hasPermission(context.user, definition.permission as any)) {
        return '你没有权限执行此指令。';
      }
    }
    
    // 解析参数
    const args = this.parseArguments(parts.slice(1), definition);
    
    // 执行指令
    try {
      const result = await handler({
        ...context,
        rawMessage: message,
        args,
      });
      
      return result || null;
    } catch (e: any) {
      console.error(`[CommandSystem] Error executing ${commandName}:`, e);
      return `执行指令时出错: ${e.message}`;
    }
  }

  /**
   * 解析参数
   */
  private parseArguments(parts: string[], definition: CommandDefinition): Record<string, any> {
    const args: Record<string, any> = {};
    
    if (!definition.arguments) {
      // 简单模式：所有参数合并为一个字符串
      if (parts.length > 0) {
        args._ = parts.join(' ');
        args._all = parts;
      }
      return args;
    }
    
    // 按位置解析
    for (let i = 0; i < definition.arguments.length; i++) {
      const argDef = definition.arguments[i];
      
      if (i < parts.length) {
        const value = parts[i];
        
        switch (argDef.type) {
          case 'number':
            args[argDef.name] = parseFloat(value) || argDef.default || 0;
            break;
          case 'boolean':
            args[argDef.name] = value.toLowerCase() === 'true' || value === '1';
            break;
          default:
            args[argDef.name] = value;
        }
      } else if (argDef.required && argDef.default === undefined) {
        args[argDef.name] = argDef.default;
      } else {
        args[argDef.name] = argDef.default;
      }
    }
    
    // 剩余参数
    if (parts.length > definition.arguments.length) {
      args._rest = parts.slice(definition.arguments.length).join(' ');
    }
    
    return args;
  }

  /**
   * 获取指令列表
   */
  getCommands(group?: string): CommandDefinition[] {
    const commands: CommandDefinition[] = [];
    const seen = new Set<string>();
    
    for (const [name, def] of this.commands) {
      if (seen.has(def.name)) continue;
      if (def.hidden) continue;
      if (group && def.group !== group) continue;
      
      seen.add(def.name);
      commands.push(def);
    }
    
    return commands;
  }

  /**
   * 获取帮助文本
   */
  getHelp(commandName?: string): string {
    if (commandName) {
      const def = this.commands.get(commandName);
      if (!def) return `指令 ${commandName} 不存在`;
      
      let help = `**${this.prefix}${def.name}**\n${def.description}`;
      
      if (def.usage) {
        help += `\n\n用法: ${this.prefix}${def.name} ${def.usage}`;
      }
      
      if (def.examples?.length) {
        help += '\n\n示例:\n' + def.examples.map(e => `  ${this.prefix}${def.name} ${e}`).join('\n');
      }
      
      return help;
    }
    
    // 显示所有指令
    const groups: Record<string, CommandDefinition[]> = {};
    
    for (const def of this.getCommands()) {
      const group = def.group || 'general';
      if (!groups[group]) groups[group] = [];
      groups[group].push(def);
    }
    
    let help = '**可用指令**\n\n';
    
    for (const [group, commands] of Object.entries(groups)) {
      help += `**${group}**\n`;
      for (const cmd of commands) {
        const aliases = cmd.aliases ? ` (${cmd.aliases.join(', ')})` : '';
        help += `  ${this.prefix}${cmd.name}${aliases} - ${cmd.description}\n`;
      }
      help += '\n';
    }
    
    help += `输入 ${this.prefix}help <指令> 查看详细帮助`;
    
    return help;
  }

  /**
   * 注册内置指令
   */
  private registerBuiltInCommands(): void {
    // 帮助指令
    this.register({
      name: 'help',
      aliases: ['h', '?'],
      description: '显示帮助信息',
      usage: '[指令名]',
      group: 'general',
    }, async (ctx) => {
      return this.getHelp(ctx.args._ as string);
    });

    // 状态指令
    this.register({
      name: 'status',
      aliases: ['stat'],
      description: '显示当前状态',
      group: 'general',
    }, async (ctx) => {
      const user = ctx.user;
      return `用户: ${user.id}\n角色: ${user.role}\n注册时间: ${new Date(user.createdAt).toLocaleDateString()}`;
    });

    // 角色列表
    this.register({
      name: 'characters',
      aliases: ['chars', '角色'],
      description: '列出所有可用角色',
      group: 'character',
    }, async (ctx) => {
      const { getCharacterManager } = require('../character/manager');
      const charManager = getCharacterManager();
      
      if (!charManager) {
        return '角色系统未初始化';
      }
      
      const characters = charManager.getAllCharacters();
      if (characters.length === 0) {
        return '暂无可用角色';
      }
      
      const list = characters.map((c: any) => `- ${c.name}`).join('\n');
      return `可用角色:\n${list}`;
    });

    // 切换角色
    this.register({
      name: 'switch',
      aliases: ['char', '角色'],
      description: '切换到指定角色',
      usage: '<角色名>',
      arguments: [
        { name: 'character', type: 'string', required: true, description: '角色名称' },
      ],
      group: 'character',
    }, async (ctx) => {
      const charName = ctx.args._rest || ctx.args.character;
      if (!charName) {
        return '请指定角色名称';
      }
      
      // TODO: 实际切换逻辑
      return `已切换到角色: ${charName}`;
    });

    // === 管理指令 ===

    // 封禁用户
    this.register({
      name: 'ban',
      description: '封禁指定用户',
      usage: '<用户ID> [原因]',
      permission: 'manage_users',
      group: 'admin',
      hidden: true,
    }, async (ctx) => {
      const { getPermissionManager } = require('../permission/manager');
      const permManager = getPermissionManager();
      
      const parts = (ctx.args._ as string).split(' ');
      const targetId = parts[0];
      const reason = parts.slice(1).join(' ') || '无原因';
      
      if (!targetId) {
        return '请指定用户ID';
      }
      
      permManager.banUser(ctx.platform, targetId, reason);
      return `已封禁用户 ${targetId}`;
    });

    // 解封用户
    this.register({
      name: 'unban',
      description: '解封指定用户',
      usage: '<用户ID>',
      permission: 'manage_users',
      group: 'admin',
      hidden: true,
    }, async (ctx) => {
      const { getPermissionManager } = require('../permission/manager');
      const permManager = getPermissionManager();
      
      const targetId = ctx.args._ as string;
      if (!targetId) {
        return '请指定用户ID';
      }
      
      permManager.unbanUser(ctx.platform, targetId);
      return `已解封用户 ${targetId}`;
    });

    // 设置角色
    this.register({
      name: 'setrole',
      description: '设置用户角色',
      usage: '<用户ID> <角色>',
      permission: 'manage_users',
      group: 'admin',
      hidden: true,
    }, async (ctx) => {
      const { getPermissionManager } = require('../permission/manager');
      const permManager = getPermissionManager();
      
      const parts = (ctx.args._ as string).split(' ');
      const targetId = parts[0];
      const role = parts[1];
      
      if (!targetId || !role) {
        return '用法: /setrole <用户ID> <角色>';
      }
      
      if (permManager.setUserRole(ctx.platform, targetId, role)) {
        return `已将用户 ${targetId} 的角色设置为 ${role}`;
      }
      
      return `无效的角色: ${role}`;
    });

    // 导入角色
    this.register({
      name: 'import',
      description: '导入角色卡',
      usage: '<URL 或 JSON>',
      permission: 'import_character',
      group: 'character',
    }, async (ctx) => {
      const { getCharacterManager } = require('../character/manager');
      const charManager = getCharacterManager();
      
      if (!charManager) {
        return '角色系统未初始化';
      }
      
      const input = ctx.args._ as string;
      
      if (input.startsWith('http')) {
        const result = await charManager.importFromURL(input);
        if (result.success) {
          return `角色导入成功: ${result.character!.name}`;
        }
        return `导入失败: ${result.error}`;
      }
      
      const result = await charManager.importFromJSON(input);
      if (result.success) {
        return `角色导入成功: ${result.character!.name}`;
      }
      return `导入失败: ${result.error}`;
    });

    // 配置
    this.register({
      name: 'config',
      description: '查看或修改配置',
      usage: '[key] [value]',
      permission: 'manage_config',
      group: 'admin',
      hidden: true,
    }, async (ctx) => {
      const input = ctx.args._ as string;
      
      if (!input) {
        // TODO: 显示当前配置
        return '配置管理功能开发中';
      }
      
      // TODO: 实现配置修改
      return '配置已更新';
    });
  }
}

// 全局实例
let globalCommandSystem: CommandSystem | null = null;

export function getCommandSystem(): CommandSystem {
  if (!globalCommandSystem) {
    globalCommandSystem = new CommandSystem();
  }
  return globalCommandSystem;
}

export function initCommandSystem(prefix: string = '/'): CommandSystem {
  globalCommandSystem = new CommandSystem(prefix);
  return globalCommandSystem;
}
