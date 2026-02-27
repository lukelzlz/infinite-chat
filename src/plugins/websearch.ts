import { Plugin } from './types';
import { BrowserTool } from '../tools/browser';
import { Session } from '../core/types';
import { validateInputLength } from '../utils/security';

/**
 * 网页搜索插件
 */
export class WebSearchPlugin implements Plugin {
  name = 'websearch';
  priority = 50;
  description = '搜索网页';

  // 最大搜索查询长度
  private maxQueryLength = 200;

  private browser: BrowserTool;

  constructor(config?: { serverUrl?: string; authToken?: string }) {
    this.browser = new BrowserTool(config);
  }

  shouldHandle(content: string, session: Session): boolean {
    return content.startsWith('/search ') ||
           content.startsWith('/bing ') ||
           content.startsWith('/baidu ');
  }

  async handle(content: string, session: Session): Promise<string> {
    const trimmed = content.trim();

    let query = '';
    let searchFn: (q: string) => Promise<string>;

    if (trimmed.startsWith('/search ')) {
      query = trimmed.slice(8).trim();
      searchFn = this.bingSearch.bind(this);
    } else if (trimmed.startsWith('/bing ')) {
      query = trimmed.slice(6).trim();
      searchFn = this.bingSearch.bind(this);
    } else if (trimmed.startsWith('/baidu ')) {
      query = trimmed.slice(7).trim();
      searchFn = this.baiduSearch.bind(this);
    } else {
      return '未知命令';
    }

    // 验证查询长度
    const lengthCheck = validateInputLength(query, this.maxQueryLength, '搜索关键词');
    if (!lengthCheck.valid) {
      return `❌ ${lengthCheck.error}`;
    }

    return searchFn(query);
  }

  /**
   * Bing 搜索
   */
  private async bingSearch(query: string): Promise<string> {
    const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}`;
    const content = await this.browser.extractUrl(url, '#b_results');

    if (!content) {
      return '搜索失败，请稍后重试';
    }

    const cleaned = this.cleanSearchResults(content);
    return `Bing 搜索结果:\n${cleaned}`;
  }

  /**
   * 百度搜索
   */
  private async baiduSearch(query: string): Promise<string> {
    const url = `https://www.baidu.com/s?wd=${encodeURIComponent(query)}`;
    const content = await this.browser.extractUrl(url, '#content_left');

    if (!content) {
      return '搜索失败，请稍后重试';
    }

    const cleaned = this.cleanSearchResults(content);
    return `百度搜索结果:\n${cleaned}`;
  }

  /**
   * 清理搜索结果
   */
  private cleanSearchResults(content: string): string {
    let cleaned = content
      .replace(/\s+/g, ' ')
      .replace(/\n\s*\n/g, '\n')
      .trim();

    const maxLength = 1500;
    if (cleaned.length > maxLength) {
      cleaned = cleaned.slice(0, maxLength) + '...';
    }

    return cleaned;
  }

  getHelp(): string {
    return `
搜索插件命令:
/search <关键词> - 搜索网页
/bing <关键词> - Bing 搜索
/baidu <关键词> - 百度搜索
    `.trim();
  }
}
