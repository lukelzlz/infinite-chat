import { Plugin } from './types';

export class EchoPlugin implements Plugin {
  name = 'echo';
  priority = 100;
  description = 'Echo 插件，回复用户消息';

  shouldHandle(content: string): boolean {
    return content.startsWith('/echo ');
  }

  async handle(content: string): Promise<string> {
    return content.slice(6); // 移除 "/echo "
  }
}
