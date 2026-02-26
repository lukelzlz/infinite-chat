import fs from 'fs';
import path from 'path';
import { CharacterCard, CharacterImportResult, CharacterExportOptions } from './types';

type CharacterChangeListener = (event: {
  type: 'add' | 'update' | 'delete';
  character: CharacterCard;
}) => void;

/**
 * 角色卡管理器
 * 
 * 功能：
 * - 加载/保存角色卡
 * - 热加载监听
 * - 导入/导出
 * - 社交媒体导入
 */
export class CharacterManager {
  private charactersDir: string;
  private characters: Map<string, CharacterCard> = new Map();
  private listeners: CharacterChangeListener[] = [];
  private watcher: fs.FSWatcher | null = null;

  constructor(charactersDir: string) {
    this.charactersDir = charactersDir;
    this.ensureDir();
    this.loadAll();
  }

  /**
   * 确保目录存在
   */
  private ensureDir(): void {
    if (!fs.existsSync(this.charactersDir)) {
      fs.mkdirSync(this.charactersDir, { recursive: true });
    }
  }

  /**
   * 加载所有角色卡
   */
  loadAll(): void {
    const files = fs.readdirSync(this.charactersDir);
    
    for (const file of files) {
      if (file.endsWith('.json')) {
        try {
          const filePath = path.join(this.charactersDir, file);
          const content = fs.readFileSync(filePath, 'utf-8');
          const character = JSON.parse(content) as CharacterCard;
          
          const id = this.getCharacterId(character);
          this.characters.set(id, character);
          
          console.log(`[CharacterManager] Loaded: ${character.name}`);
        } catch (e) {
          console.error(`[CharacterManager] Failed to load ${file}:`, e);
        }
      }
    }
    
    console.log(`[CharacterManager] Loaded ${this.characters.size} characters`);
  }

  /**
   * 启动热加载
   */
  startHotReload(): void {
    if (this.watcher) return;

    this.watcher = fs.watch(this.charactersDir, (eventType, filename) => {
      if (filename && filename.endsWith('.json')) {
        const filePath = path.join(this.charactersDir, filename);
        
        setTimeout(() => {
          if (fs.existsSync(filePath)) {
            try {
              const content = fs.readFileSync(filePath, 'utf-8');
              const character = JSON.parse(content) as CharacterCard;
              const id = this.getCharacterId(character);
              
              const existing = this.characters.get(id);
              this.characters.set(id, character);
              
              this.notifyListeners({
                type: existing ? 'update' : 'add',
                character,
              });
              
              console.log(`[CharacterManager] Hot reload: ${character.name}`);
            } catch (e) {
              console.error(`[CharacterManager] Hot reload failed:`, e);
            }
          } else {
            // 文件被删除
            for (const [id, char] of this.characters) {
              if (this.getCharacterFilename(char) === filename) {
                this.characters.delete(id);
                this.notifyListeners({ type: 'delete', character: char });
                break;
              }
            }
          }
        }, 100);
      }
    });

    console.log(`[CharacterManager] Hot reload enabled`);
  }

  /**
   * 停止热加载
   */
  stopHotReload(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }

  /**
   * 获取角色卡
   */
  getCharacter(id: string): CharacterCard | undefined {
    return this.characters.get(id);
  }

  /**
   * 获取所有角色卡
   */
  getAllCharacters(): CharacterCard[] {
    return Array.from(this.characters.values());
  }

  /**
   * 保存角色卡
   */
  saveCharacter(character: CharacterCard): void {
    const id = this.getCharacterId(character);
    const filename = this.getCharacterFilename(character);
    const filePath = path.join(this.charactersDir, filename);
    
    // 更新时间戳
    if (!character.infinite_chat) {
      character.infinite_chat = {};
    }
    character.infinite_chat.updatedAt = Date.now();
    if (!character.infinite_chat.createdAt) {
      character.infinite_chat.createdAt = Date.now();
    }
    
    fs.writeFileSync(filePath, JSON.stringify(character, null, 2), 'utf-8');
    this.characters.set(id, character);
    
    console.log(`[CharacterManager] Saved: ${character.name}`);
  }

  /**
   * 删除角色卡
   */
  deleteCharacter(id: string): boolean {
    const character = this.characters.get(id);
    if (!character) return false;
    
    const filename = this.getCharacterFilename(character);
    const filePath = path.join(this.charactersDir, filename);
    
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    
    this.characters.delete(id);
    this.notifyListeners({ type: 'delete', character });
    
    return true;
  }

  /**
   * 导入角色卡 (SillyTavern 格式)
   */
  async importFromJSON(jsonContent: string): Promise<CharacterImportResult> {
    try {
      const data = JSON.parse(jsonContent);
      
      // 检测格式
      let character: CharacterCard;
      
      if (data.spec === 'chara_card_v2' || data.spec === 'chara_card_v3') {
        // V2/V3 格式
        character = this.normalizeCharacter(data);
      } else if (data.name) {
        // 简单格式
        character = this.normalizeCharacter({
          spec: 'chara_card_v2',
          spec_version: '2.0',
          data: data,
        });
      } else {
        return { success: false, error: 'Unknown character format' };
      }
      
      // 验证必要字段
      if (!character.name) {
        return { success: false, error: 'Character name is required' };
      }
      
      // 设置导入信息
      if (!character.infinite_chat) {
        character.infinite_chat = {};
      }
      character.infinite_chat.importSource = {
        type: 'sillytavern',
        importedAt: Date.now(),
      };
      
      this.saveCharacter(character);
      
      return { success: true, character };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }

  /**
   * 从 URL 导入角色卡
   */
  async importFromURL(url: string): Promise<CharacterImportResult> {
    try {
      const response = await fetch(url);
      const content = await response.text();
      
      // 检测内容类型
      const contentType = response.headers.get('content-type') || '';
      
      if (contentType.includes('application/json') || url.endsWith('.json')) {
        return this.importFromJSON(content);
      }
      
      // TODO: 支持 PNG 格式（嵌入的 JSON）
      
      return { success: false, error: 'Unsupported content type' };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }

  /**
   * 从 Twitter 导入角色
   */
  async importFromTwitter(username: string): Promise<CharacterImportResult> {
    // TODO: 实现 Twitter API 导入
    // 需要配置 Twitter API 凭证
    
    return {
      success: false,
      error: 'Twitter import not implemented yet',
    };
  }

  /**
   * 导出角色卡
   */
  exportCharacter(id: string, options: CharacterExportOptions): string | null {
    const character = this.characters.get(id);
    if (!character) return null;
    
    const exportData = { ...character };
    
    if (!options.includeExtensions) {
      delete exportData.extensions;
      if (exportData.data) {
        delete exportData.data.extensions;
      }
    }
    
    if (!options.includeCharacterBook) {
      delete exportData.character_book;
      if (exportData.data) {
        delete exportData.data.character_book;
      }
    }
    
    exportData.spec = options.format === 'tavernpng' ? 'chara_card_v2' : options.format;
    exportData.spec_version = options.format === 'chara_card_v3' ? '3.0' : '2.0';
    
    return JSON.stringify(exportData, null, 2);
  }

  /**
   * 添加变更监听器
   */
  onChange(listener: CharacterChangeListener): () => void {
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index !== -1) {
        this.listeners.splice(index, 1);
      }
    };
  }

  /**
   * 通知监听器
   */
  private notifyListeners(event: { type: 'add' | 'update' | 'delete'; character: CharacterCard }): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (e) {
        console.error('[CharacterManager] Listener error:', e);
      }
    }
  }

  /**
   * 获取角色 ID
   */
  private getCharacterId(character: CharacterCard): string {
    return character.name.toLowerCase().replace(/[^a-z0-9]/g, '-');
  }

  /**
   * 获取角色文件名
   */
  private getCharacterFilename(character: CharacterCard): string {
    const id = this.getCharacterId(character);
    return `${id}.json`;
  }

  /**
   * 标准化角色卡格式
   */
  private normalizeCharacter(data: any): CharacterCard {
    const charData = data.data || data;
    
    return {
      name: charData.name || 'Unnamed',
      description: charData.description || '',
      personality: charData.personality || '',
      scenario: charData.scenario || '',
      first_mes: charData.first_mes || '',
      mes_example: charData.mes_example || '',
      creator_notes: charData.creator_notes,
      system_prompt: charData.system_prompt,
      post_history_instructions: charData.post_history_instructions,
      alternate_greetings: charData.alternate_greetings,
      character_book: charData.character_book,
      tags: charData.tags,
      spec: data.spec || 'chara_card_v2',
      spec_version: data.spec_version || '2.0',
      data: charData,
      extensions: charData.extensions,
      infinite_chat: charData.infinite_chat,
    };
  }
}

// 全局实例
let globalCharacterManager: CharacterManager | null = null;

export function getCharacterManager(): CharacterManager | null {
  return globalCharacterManager;
}

export function initCharacterManager(charactersDir: string): CharacterManager {
  globalCharacterManager = new CharacterManager(charactersDir);
  return globalCharacterManager;
}
