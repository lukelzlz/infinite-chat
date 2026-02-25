import { Plugin } from './types';
import { Session } from '../core/types';

export class StatsPlugin implements Plugin {
  name = 'stats';
  priority = 98;
  description = '统计插件';
  
  private getStatsCallback: (sessionId: string) => any;

  constructor(getStatsCallback: (sessionId: string) => any) {
    this.getStatsCallback = getStatsCallback;
  }

  shouldHandle(content: string): boolean {
    return content === '/stats';
  }

  async handle(content: string, session: Session): Promise<string> {
    const stats = this.getStatsCallback(session.id);
    return `
📊 会话统计
平台: ${session.platform}
用户: ${session.userId}
消息数: ${stats?.context?.messages || 0}
摘要数: ${stats?.context?.summaries || 0}
创建于: ${new Date(session.createdAt).toLocaleString()}
`.trim();
  }
}
