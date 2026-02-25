/**
 * 浏览器工具集成
 * 
 * 使用 OpenClaw 内置的 browserless 服务
 */

export interface BrowserConfig {
  /** browserless 服务地址 */
  serverUrl?: string;
  /** 认证 token（如果需要） */
  authToken?: string;
  /** 默认超时（毫秒） */
  timeout?: number;
}

export interface BrowserAction {
  type: 'navigate' | 'screenshot' | 'click' | 'type' | 'evaluate' | 'extract';
  selector?: string;
  value?: string;
  script?: string;
}

export interface BrowserResult {
  success: boolean;
  data?: any;
  error?: string;
  screenshot?: string; // base64
}

/**
 * 浏览器工具类
 * 
 * 支持通过 browserless 服务控制浏览器
 */
export class BrowserTool {
  private config: BrowserConfig;

  constructor(config: BrowserConfig = {}) {
    this.config = {
      serverUrl: config.serverUrl || process.env.BROWSERLESS_URL || 'http://localhost:43242',
      authToken: config.authToken || process.env.BROWSERLESS_TOKEN,
      timeout: config.timeout || 30000,
    };
  }

  /**
   * 执行浏览器操作序列
   */
  async execute(actions: BrowserAction[]): Promise<BrowserResult> {
    try {
      // 使用 browserless 的 API
      const results: any[] = [];

      for (const action of actions) {
        const result = await this.executeAction(action);
        results.push(result);
      }

      return {
        success: true,
        data: results,
      };
    } catch (e: any) {
      return {
        success: false,
        error: e.message,
      };
    }
  }

  private async executeAction(action: BrowserAction): Promise<any> {
    switch (action.type) {
      case 'navigate':
        return await this.navigate(action.value!);

      case 'screenshot':
        return await this.takeScreenshot();

      case 'click':
        return await this.click(action.selector!);

      case 'type':
        return await this.type(action.selector!, action.value!);

      case 'evaluate':
        return await this.evaluate(action.script!);

      case 'extract':
        return await this.extract(action.selector);

      default:
        return { error: `Unknown action: ${(action as any).type}` };
    }
  }

  /**
   * 导航到 URL
   */
  private async navigate(url: string): Promise<{ navigated: string }> {
    // 通过 browserless API 导航
    const response = await fetch(`${this.config.serverUrl}/json/new?${encodeURIComponent(url)}`, {
      headers: this.getHeaders(),
    });
    
    if (!response.ok) {
      throw new Error(`Navigate failed: ${response.statusText}`);
    }

    return { navigated: url };
  }

  /**
   * 截图
   */
  private async takeScreenshot(): Promise<{ screenshot: string }> {
    // 使用 browserless 的 screenshot API
    const response = await fetch(`${this.config.serverUrl}/screenshot`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        options: {
          fullPage: true,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Screenshot failed: ${response.statusText}`);
    }

    const buffer = await response.arrayBuffer();
    return { screenshot: Buffer.from(buffer).toString('base64') };
  }

  /**
   * 点击元素
   */
  private async click(selector: string): Promise<{ clicked: string }> {
    // 使用 browserless 的 evaluate API 执行点击
    const response = await fetch(`${this.config.serverUrl}/evaluate`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        expression: `document.querySelector('${selector}')?.click()`,
      }),
    });

    if (!response.ok) {
      throw new Error(`Click failed: ${response.statusText}`);
    }

    return { clicked: selector };
  }

  /**
   * 输入文本
   */
  private async type(selector: string, text: string): Promise<{ typed: string }> {
    const response = await fetch(`${this.config.serverUrl}/evaluate`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        expression: `
          const el = document.querySelector('${selector}');
          if (el) { el.value = '${text.replace(/'/g, "\\'")}'; el.dispatchEvent(new Event('input')); }
        `,
      }),
    });

    if (!response.ok) {
      throw new Error(`Type failed: ${response.statusText}`);
    }

    return { typed: text };
  }

  /**
   * 执行 JavaScript
   */
  private async evaluate(script: string): Promise<{ result: any }> {
    const response = await fetch(`${this.config.serverUrl}/evaluate`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        expression: script,
      }),
    });

    if (!response.ok) {
      throw new Error(`Evaluate failed: ${response.statusText}`);
    }

    const data = await response.json();
    return { result: data };
  }

  /**
   * 提取页面内容
   */
  private async extract(selector?: string): Promise<{ content: string }> {
    const expression = selector
      ? `document.querySelector('${selector}')?.textContent || ''`
      : `document.body.textContent || ''`;

    const response = await fetch(`${this.config.serverUrl}/evaluate`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ expression }),
    });

    if (!response.ok) {
      throw new Error(`Extract failed: ${response.statusText}`);
    }

    const data: any = await response.json();
    return { content: data.value || data || '' };
  }

  /**
   * 获取请求头
   */
  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.config.authToken) {
      headers['Authorization'] = `Bearer ${this.config.authToken}`;
    }

    return headers;
  }

  // ============ 快捷方法 ============

  /**
   * 快捷方法：截图
   */
  async screenshot(url: string): Promise<string | null> {
    const result = await this.execute([
      { type: 'navigate', value: url },
      { type: 'screenshot' },
    ]);

    if (result.success && result.data) {
      return result.data[1]?.screenshot || null;
    }
    return null;
  }

  /**
   * 快捷方法：提取网页内容
   */
  async extractUrl(url: string, selector?: string): Promise<string | null> {
    const result = await this.execute([
      { type: 'navigate', value: url },
      { type: 'extract', selector },
    ]);

    if (result.success && result.data) {
      return result.data[1]?.content || null;
    }
    return null;
  }

  /**
   * 快捷方法：获取页面标题
   */
  async getTitle(url: string): Promise<string | null> {
    const result = await this.execute([
      { type: 'navigate', value: url },
      { type: 'evaluate', script: 'document.title' },
    ]);

    if (result.success && result.data) {
      return result.data[1]?.result || null;
    }
    return null;
  }
}
