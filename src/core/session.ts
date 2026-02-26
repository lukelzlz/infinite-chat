import { Session } from './types';
import { Redis } from 'ioredis';
import { safeJsonParse } from '../utils/security';

/**
 * 会话管理器
 * 
 * 管理多用户会话，支持 Redis 持久化
 */
export class SessionManager {
  private sessions: Map<string, Session> = new Map();
  private redis?: Redis;

  constructor(redisUrl?: string) {
    if (redisUrl) {
      this.redis = new Redis(redisUrl);
    }
  }

  /** 获取或创建会话 */
  async getOrCreate(sessionId: string, platform: string, userId: string, groupId?: string): Promise<Session> {
    // 先从内存中查找
    let session = this.sessions.get(sessionId);

    if (!session) {
      // 尝试从 Redis 加载（使用安全的 JSON 解析）
      if (this.redis) {
        const cached = await this.redis.get(`session:${sessionId}`);
        if (cached) {
          // 使用安全解析防止原型污染
          const parsed = safeJsonParse<Session | null>(cached, null);
          if (parsed && parsed.id) {
            session = parsed;
            this.sessions.set(sessionId, session);
          } else {
            console.warn(`[Session] Invalid session data for ${sessionId}`);
          }
        }
      }
    }

    if (!session) {
      // 创建新会话
      session = {
        id: sessionId,
        platform,
        userId,
        groupId,
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
      };
      this.sessions.set(sessionId, session);
      await this.saveSession(session);
    }

    // 更新活跃时间
    session.lastActiveAt = Date.now();

    return session;
  }

  /** 保存会话 */
  private async saveSession(session: Session): Promise<void> {
    if (this.redis) {
      await this.redis.set(
        `session:${session.id}`,
        JSON.stringify(session),
        'EX',
        86400 * 7 // 7 天过期
      );
    }
  }

  /** 获取所有活跃会话 */
  getActiveSessions(since: number): Session[] {
    return Array.from(this.sessions.values())
      .filter(s => s.lastActiveAt >= since);
  }

  /** 删除会话 */
  async deleteSession(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
    if (this.redis) {
      await this.redis.del(`session:${sessionId}`);
    }
  }
}
