import { Plugin } from './types';
import { BrowserTool } from '../tools/browser';
import { Session } from '../core/types';
import { validateUrl, UrlValidationResult } from '../utils/security';

/**
 * 浏览器插件
 * 
 * 为 Agent 提供网页浏览能力
 */
export class BrowserPlugin implements Plugin {
  name = 'browser';
  priority = 50;
  description = '浏览网页、截图、提取内容';
  
  private browser: BrowserTool;

  constructor(config?: { serverUrl?: string; authToken?: string }) {
    this.browser = new BrowserTool(config);
  }

  shouldHandle(content: string, session: Session): boolean {
    return content.startsWith('/browse ') || 
           content.startsWith('/screenshot ') || 
           content.startsWith('/title ');
  }

  async handle(message: string, session: Session): Promise<string | null> {
    const trimmed = message.trim();
    
    if (trimmed.startsWith('/browse ')) {
      const url = trimmed.slice(8).trim();
      return this.browse(url);
    }

    if (trimmed.startsWith('/screenshot ')) {
      const url = trimmed.slice(12).trim();
      return this.takeScreenshot(url);
    }

    if (trimmed.startsWith('/title ')) {
      const url = trimmed.slice(7).trim();
      return this.getTitle(url);
    }

    return null;
  }

  /**
   * 验证并规范化 URL
   */
  private validateAndNormalizeUrl(url: string): { valid: boolean; url?: string; error?: string } {
    const validation = validateUrl(url, {
      allowPrivateIp: false, // 默認不允許訪問私有 IP
    });

    if (!validation.valid) {
      return { valid: false, error: validation.error };
    }

    return { valid: true, url: validation.normalizedUrl };
  }

  /**
   * /browse <url> - 浏览网页并提取内容
   */
  private async browse(url: string): Promise<string> {
    if (!url) {
      return '用法: /browse <URL>';
    }

    // 安全驗證 URL（SSRF 防護）
    const validation = this.validateAndNormalizeUrl(url);
    if (!validation.valid) {
      return `URL 驗證失敗: ${validation.error}`;
    }

    const content = await this.browser.extractUrl(validation.url!);

    if (!content) {
      return '无法访问该网页';
    }

    // 限制长度
    const maxLength = 2000;
    if (content.length > maxLength) {
      return `网页内容:\n${content.slice(0, maxLength)}...\n\n(内容已截断)`;
    }

    return `网页内容:\n${content}`;
  }

  /**
   * /screenshot <url> - 截图网页
   */
  private async takeScreenshot(url: string): Promise<string> {
    if (!url) {
      return '用法: /screenshot <URL>';
    }

    // 安全驗證 URL（SSRF 防護）
    const validation = this.validateAndNormalizeUrl(url);
    if (!validation.valid) {
      return `URL 驗證失敗: ${validation.error}`;
    }

    const screenshot = await this.browser.screenshot(validation.url!);

    if (!screenshot) {
      return '截图失败';
    }

    // 返回 base64 图片（可以发送到支持的聊天平台）
    return `[截图成功] data:image/png;base64,${screenshot.slice(0, 100)}...`;
  }

  /**
   * /title <url> - 获取网页标题
   */
  private async getTitle(url: string): Promise<string> {
    if (!url) {
      return '用法: /title <URL>';
    }

    // 安全驗證 URL（SSRF 防護）
    const validation = this.validateAndNormalizeUrl(url);
    if (!validation.valid) {
      return `URL 驗證失敗: ${validation.error}`;
    }

    const title = await this.browser.getTitle(validation.url!);

    if (!title) {
      return '无法获取标题';
    }

    return `标题: ${title}`;
  }

  /**
   * 获取帮助信息
   */
  getHelp(): string {
    return `
浏览器插件命令:
/browse <URL> - 浏览网页并提取内容
/screenshot <URL> - 截图网页
/title <URL> - 获取网页标题
    `.trim();
  }
}
