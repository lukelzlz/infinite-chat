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
