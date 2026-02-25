import { Session } from '../core/types';
import { Plugin } from './types';

export class HelpPlugin implements Plugin {
  name = 'help';
  priority = 99;
  description = '帮助插件';

  private commands = `
可用命令：
/echo <text> - 回复你发送的内容
/help - 显示此帮助
/stats - 显示会话统计
/clear - 清除会话上下文
/browse <URL> - 浏览网页
/screenshot <URL> - 截图网页
/search <关键词> - 搜索网页
`.trim();

  shouldHandle(content: string): boolean {
    return content === '/help' || content === '/start';
  }

  async handle(): Promise<string> {
    return this.commands;
  }
}
