// ============ 角色卡系统 ============

/**
 * SillyTavern 兼容的角色卡格式
 */
export interface CharacterCard {
  // 基本信息
  name: string;
  description: string;
  personality: string;
  scenario: string;
  first_mes: string;
  mes_example: string;
  
  // 扩展字段
  creator_notes?: string;
  system_prompt?: string;
  post_history_instructions?: string;
  alternate_greetings?: string[];
  character_book?: CharacterBook;
  tags?: string[];
  
  // 元数据
  spec: 'chara_card_v2' | 'chara_card_v3';
  spec_version: string;
  data: {
    name: string;
    description: string;
    personality: string;
    scenario: string;
    first_mes: string;
    mes_example: string;
    creator_notes?: string;
    system_prompt?: string;
    post_history_instructions?: string;
    alternate_greetings?: string[];
    character_book?: CharacterBook;
    tags?: string[];
    extensions?: Record<string, any>;
  };
  
  // 自定义扩展
  extensions?: {
    talkativeness?: number;
    fav?: boolean;
    world?: string;
    depth_prompt?: {
      prompt: string;
      depth: number;
    };
    [key: string]: any;
  };
  
  // infinite-chat 扩展
  infinite_chat?: {
    /** 关联的 Agent ID */
    agentId?: string;
    /** 触发关键词 */
    triggers?: string[];
    /** 头像 URL */
    avatarUrl?: string;
    /** 背景图 URL */
    backgroundUrl?: string;
    /** 创建时间 */
    createdAt?: number;
    /** 更新时间 */
    updatedAt?: number;
    /** 创建者 */
    creator?: string;
    /** 是否公开 */
    isPublic?: boolean;
    /** 导入来源 */
    importSource?: {
      type: 'sillytavern' | 'twitter' | 'discord' | 'characterai' | 'custom';
      url?: string;
      importedAt?: number;
    };
  };
}

/**
 * 角色书 (Character Book / World Info)
 */
export interface CharacterBook {
  entries: CharacterBookEntry[];
  name?: string;
  description?: string;
  scan_depth?: number;
  token_budget?: number;
  recursive_scanning?: boolean;
  extensions?: Record<string, any>;
}

export interface CharacterBookEntry {
  keys: string[];
  content: string;
  extensions?: Record<string, any>;
  enabled: boolean;
  insertion_order: number;
  case_sensitive?: boolean;
  name?: string;
  priority?: number;
  id?: number;
  comment?: string;
  selective?: boolean;
  secondary_keys?: string[];
  constant?: boolean;
  position?: 'before_char' | 'after_char' | 'before_example' | 'after_example';
}

/**
 * 角色卡导入结果
 */
export interface CharacterImportResult {
  success: boolean;
  character?: CharacterCard;
  error?: string;
  warnings?: string[];
}

/**
 * 角色卡导出选项
 */
export interface CharacterExportOptions {
  format: 'chara_card_v2' | 'chara_card_v3' | 'tavernpng';
  includeExtensions?: boolean;
  includeCharacterBook?: boolean;
  imageSize?: number;
}
