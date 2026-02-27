import { Plugin } from './types';
import { validateInputLength, sanitizeHtml } from '../utils/security';

export class EchoPlugin implements Plugin {
  name = 'echo';
  priority = 100;
  description = 'Echo 插件，回复用户消息';

  // 最大输出长度
  private maxOutputLength = 4000;

  shouldHandle(content: string): boolean {
    return content.startsWith('/echo ');
  }

  async handle(content: string): Promise<string> {
    let output = content.slice(6); // 移除 "/echo "

    // 验证输入长度
    const lengthCheck = validateInputLength(output, this.maxOutputLength, '消息');
    if (!lengthCheck.valid) {
      return `❌ ${lengthCheck.error}`;
    }

    // 清理 HTML 防止 XSS
    output = sanitizeHtml(output);

    return output;
  }
}
