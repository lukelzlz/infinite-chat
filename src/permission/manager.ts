// ============ 权限管理系统 ============

/**
 * 用户权限级别
 */
export enum PermissionLevel {
  /** 访客 - 只能使用公开角色 */
  GUEST = 0,
  /** 普通用户 - 可以使用所有角色 */
  USER = 1,
  /** VIP 用户 - 可以创建角色 */
  VIP = 2,
  /** 管理员 - 可以管理角色和用户 */
  ADMIN = 3,
  /** 超级管理员 - 完全权限 */
  SUPER_ADMIN = 4,
}

/**
 * 权限类型
 */
export type Permission = 
  | 'chat'              // 聊天
  | 'use_character'     // 使用角色
  | 'create_character'  // 创建角色
  | 'edit_character'    // 编辑角色
  | 'delete_character'  // 删除角色
  | 'import_character'  // 导入角色
  | 'export_character'  // 导出角色
  | 'manage_users'      // 管理用户
  | 'manage_config'     // 管理配置
  | 'use_admin_cmds'    // 使用管理命令
  | 'view_logs'         // 查看日志
  | 'manage_plugins';   // 管理插件

/**
 * 角色权限配置
 */
export interface RolePermissions {
  level: PermissionLevel;
  permissions: Permission[];
  rateLimit?: {
    messagesPerMinute: number;
    messagesPerHour: number;
    messagesPerDay: number;
  };
}

/**
 * 预设角色权限
 */
export const DEFAULT_ROLE_PERMISSIONS: Record<string, RolePermissions> = {
  guest: {
    level: PermissionLevel.GUEST,
    permissions: ['chat', 'use_character'],
    rateLimit: {
      messagesPerMinute: 3,
      messagesPerHour: 30,
      messagesPerDay: 100,
    },
  },
  user: {
    level: PermissionLevel.USER,
    permissions: ['chat', 'use_character', 'export_character'],
    rateLimit: {
      messagesPerMinute: 10,
      messagesPerHour: 100,
      messagesPerDay: 500,
    },
  },
  vip: {
    level: PermissionLevel.VIP,
    permissions: ['chat', 'use_character', 'create_character', 'edit_character', 'import_character', 'export_character'],
    rateLimit: {
      messagesPerMinute: 30,
      messagesPerHour: 300,
      messagesPerDay: 2000,
    },
  },
  admin: {
    level: PermissionLevel.ADMIN,
    permissions: ['chat', 'use_character', 'create_character', 'edit_character', 'delete_character', 'import_character', 'export_character', 'manage_users', 'manage_config', 'use_admin_cmds', 'view_logs'],
    rateLimit: {
      messagesPerMinute: 60,
      messagesPerHour: 600,
      messagesPerDay: -1, // 无限制
    },
  },
  super_admin: {
    level: PermissionLevel.SUPER_ADMIN,
    permissions: ['chat', 'use_character', 'create_character', 'edit_character', 'delete_character', 'import_character', 'export_character', 'manage_users', 'manage_config', 'use_admin_cmds', 'view_logs', 'manage_plugins'],
    rateLimit: {
      messagesPerMinute: -1,
      messagesPerHour: -1,
      messagesPerDay: -1,
    },
  },
};

/**
 * 用户信息
 */
export interface UserInfo {
  id: string;
  platform: string;
  role: string;
  customPermissions?: Permission[];
  banned: boolean;
  banReason?: string;
  banExpiresAt?: number;
  createdAt: number;
  lastActiveAt: number;
  metadata?: Record<string, any>;
}

/**
 * 权限管理器
 */
export class PermissionManager {
  private users: Map<string, UserInfo> = new Map();
  private rolePermissions: Map<string, RolePermissions>;
  private messageCounts: Map<string, { minute: number; hour: number; day: number; lastReset: number }>;

  constructor() {
    this.rolePermissions = new Map(Object.entries(DEFAULT_ROLE_PERMISSIONS));
    this.messageCounts = new Map();
  }

  /**
   * 获取或创建用户
   */
  getOrCreateUser(platform: string, userId: string): UserInfo {
    const key = `${platform}:${userId}`;
    
    if (!this.users.has(key)) {
      this.users.set(key, {
        id: userId,
        platform,
        role: 'user',
        banned: false,
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
      });
    }
    
    const user = this.users.get(key)!;
    user.lastActiveAt = Date.now();
    
    return user;
  }

  /**
   * 检查权限
   */
  hasPermission(user: UserInfo, permission: Permission): boolean {
    if (user.banned) return false;
    
    // 自定义权限
    if (user.customPermissions?.includes(permission)) return true;
    
    // 角色权限
    const rolePerms = this.rolePermissions.get(user.role);
    if (!rolePerms) return false;
    
    return rolePerms.permissions.includes(permission);
  }

  /**
   * 检查频率限制
   */
  checkRateLimit(user: UserInfo): { allowed: boolean; retryAfter?: number; reason?: string } {
    const rolePerms = this.rolePermissions.get(user.role);
    if (!rolePerms?.rateLimit) return { allowed: true };
    
    const key = `${user.platform}:${user.id}`;
    const now = Date.now();
    
    // 获取或初始化计数
    let counts = this.messageCounts.get(key);
    if (!counts || now - counts.lastReset > 60000) {
      counts = { minute: 0, hour: 0, day: 0, lastReset: now };
      this.messageCounts.set(key, counts);
    }
    
    // 检查分钟限制
    if (rolePerms.rateLimit.messagesPerMinute > 0 && counts.minute >= rolePerms.rateLimit.messagesPerMinute) {
      return {
        allowed: false,
        retryAfter: 60 - Math.floor((now - counts.lastReset) / 1000),
        reason: '每分钟消息数已达上限',
      };
    }
    
    // 检查小时限制
    if (rolePerms.rateLimit.messagesPerHour > 0 && counts.hour >= rolePerms.rateLimit.messagesPerHour) {
      return {
        allowed: false,
        retryAfter: 3600 - Math.floor((now - counts.lastReset) / 1000),
        reason: '每小时消息数已达上限',
      };
    }
    
    // 检查每日限制
    if (rolePerms.rateLimit.messagesPerDay > 0 && counts.day >= rolePerms.rateLimit.messagesPerDay) {
      return {
        allowed: false,
        retryAfter: 86400 - Math.floor((now - counts.lastReset) / 1000),
        reason: '每日消息数已达上限',
      };
    }
    
    // 增加计数
    counts.minute++;
    counts.hour++;
    counts.day++;
    
    return { allowed: true };
  }

  /**
   * 设置用户角色
   */
  setUserRole(platform: string, userId: string, role: string): boolean {
    if (!this.rolePermissions.has(role)) return false;
    
    const user = this.getOrCreateUser(platform, userId);
    user.role = role;
    
    return true;
  }

  /**
   * 封禁用户
   */
  banUser(platform: string, userId: string, reason: string, expiresAt?: number): void {
    const user = this.getOrCreateUser(platform, userId);
    user.banned = true;
    user.banReason = reason;
    user.banExpiresAt = expiresAt;
  }

  /**
   * 解封用户
   */
  unbanUser(platform: string, userId: string): void {
    const user = this.getOrCreateUser(platform, userId);
    user.banned = false;
    user.banReason = undefined;
    user.banExpiresAt = undefined;
  }

  /**
   * 获取所有用户
   */
  getAllUsers(): UserInfo[] {
    return Array.from(this.users.values());
  }

  /**
   * 添加自定义角色
   */
  addRole(name: string, permissions: RolePermissions): void {
    this.rolePermissions.set(name, permissions);
  }

  /**
   * 获取所有角色
   */
  getRoles(): string[] {
    return Array.from(this.rolePermissions.keys());
  }
}

// 全局实例
let globalPermissionManager: PermissionManager | null = null;

export function getPermissionManager(): PermissionManager {
  if (!globalPermissionManager) {
    globalPermissionManager = new PermissionManager();
  }
  return globalPermissionManager;
}
