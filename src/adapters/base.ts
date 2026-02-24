import { IncomingMessage } from '../core/types';

/** 适配器基类 */
export abstract class PlatformAdapter {
  abstract name: string;
  
  /** 启动适配器 */
  abstract start(): Promise<void>;
  
  /** 停止适配器 */
  abstract stop(): Promise<void>;
  
  /** 发送消息 */
  abstract sendMessage(sessionId: string, message: string, options?: any): Promise<void>;
  
  /** 注册消息回调 */
  abstract onMessage(callback: (msg: IncomingMessage) => Promise<void>): void;
  
  /** 生成会话 ID */
  protected formatSessionId(platform: string, userId: string, groupId?: string): string {
    if (groupId) {
      return `${platform}:group:${groupId}:${userId}`;
    }
    return `${platform}:${userId}`;
  }
}
