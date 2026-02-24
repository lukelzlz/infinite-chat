import { PlatformAdapter } from './base';
import { IncomingMessage } from '../core/types';

/**
 * 飞书适配器
 * 
 * 支持：
 * - 机器人消息（通过 Webhook/长连接）
 * - 用户私聊
 * - 群聊消息
 * 
 * 使用方式：
 * 1. 在飞书开放平台创建机器人应用
 * 2. 配置事件订阅（im.message.receive_v1）
 * 3. 设置 Webhook 或使用长连接接收消息
 */
export class FeishuAdapter extends PlatformAdapter {
  name = 'feishu';
  private messageCallback?: (msg: IncomingMessage) => Promise<void>;
  private appId: string;
  private appSecret: string;
  private tenantAccessToken?: string;
  private tokenExpireAt?: number;

  constructor(config: { appId: string; appSecret: string }) {
    super();
    this.appId = config.appId;
    this.appSecret = config.appSecret;
  }

  async start(): Promise<void> {
    // 获取 tenant_access_token
    await this.refreshToken();
    console.log(`[${this.name}] Adapter started, app_id: ${this.appId}`);
    
    // 注意：实际的 HTTP 服务器启动应该在主入口处理
    // 这里只负责初始化适配器状态
  }

  async stop(): Promise<void> {
    this.tenantAccessToken = undefined;
    console.log(`[${this.name}] Adapter stopped`);
  }

  /** 刷新 tenant_access_token */
  private async refreshToken(): Promise<void> {
    const res = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        app_id: this.appId,
        app_secret: this.appSecret,
      }),
    });
    
    const data = await res.json() as any;
    if (data.code !== 0) {
      throw new Error(`[${this.name}] Failed to get token: ${data.msg}`);
    }
    
    this.tenantAccessToken = data.tenant_access_token;
    this.tokenExpireAt = Date.now() + (data.expire - 60) * 1000; // 提前 60 秒刷新
  }

  /** 确保 token 有效 */
  private async ensureToken(): Promise<string> {
    if (!this.tenantAccessToken || (this.tokenExpireAt && Date.now() >= this.tokenExpireAt)) {
      await this.refreshToken();
    }
    return this.tenantAccessToken!;
  }

  /** 处理飞书事件推送（供外部 HTTP handler 调用） */
  async handleEvent(event: any): Promise<void> {
    // 处理 URL 验证
    if (event.type === 'url_verification') {
      return; // 由 HTTP handler 返回 challenge
    }

    // 处理消息事件
    if (event.header?.event_type === 'im.message.receive_v1') {
      const message = event.event?.message;
      const sender = event.event?.sender;
      
      if (!message || !sender) return;
      
      // 只处理文本消息
      if (message.message_type !== 'text') return;
      
      let content = '';
      try {
        const contentJson = JSON.parse(message.content);
        content = contentJson.text || '';
      } catch {
        content = message.content;
      }
      
      const incomingMsg: IncomingMessage = {
        sessionId: this.formatSessionId(
          'feishu',
          sender.sender_id?.open_id || sender.sender_id?.user_id,
          message.chat_id
        ),
        content,
        sender: {
          id: sender.sender_id?.open_id || sender.sender_id?.user_id,
          name: sender.sender_id?.union_id,
          isBot: false,
        },
        metadata: {
          messageId: message.message_id,
          chatType: message.chat_type,
          messageType: message.message_type,
          createTime: message.create_time,
        },
      };
      
      if (this.messageCallback) {
        await this.messageCallback(incomingMsg);
      }
    }
  }

  async sendMessage(sessionId: string, message: string, options?: any): Promise<void> {
    const token = await this.ensureToken();
    
    // 解析 sessionId 获取 open_id
    const parts = sessionId.split(':');
    const receiveId = parts[1];
    const chatType = parts.length > 2 && parts[0] === 'group' ? 'group' : 'p2p';
    
    try {
      const res = await fetch('https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          receive_id: receiveId,
          msg_type: 'text',
          content: JSON.stringify({ text: message }),
        }),
      });
      
      const data = await res.json() as any;
      if (data.code !== 0) {
        throw new Error(`[${this.name}] Send failed: ${data.msg}`);
      }
    } catch (error) {
      console.error(`[${this.name}] Send failed:`, error);
      throw error;
    }
  }

  /** 发送富文本消息 */
  async sendRichMessage(
    sessionId: string, 
    content: Record<string, any>,
    options?: any
  ): Promise<void> {
    const token = await this.ensureToken();
    const parts = sessionId.split(':');
    const receiveId = parts[1];
    
    const res = await fetch('https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        receive_id: receiveId,
        msg_type: 'post',
        content: JSON.stringify(content),
      }),
    });
    
    const data = await res.json() as any;
    if (data.code !== 0) {
      throw new Error(`[${this.name}] Send rich message failed: ${data.msg}`);
    }
  }

  /** 发送卡片消息 */
  async sendCardMessage(
    sessionId: string,
    card: Record<string, any>
  ): Promise<void> {
    const token = await this.ensureToken();
    const parts = sessionId.split(':');
    const receiveId = parts[1];
    
    const res = await fetch('https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        receive_id: receiveId,
        msg_type: 'interactive',
        content: JSON.stringify(card),
      }),
    });
    
    const data = await res.json() as any;
    if (data.code !== 0) {
      throw new Error(`[${this.name}] Send card failed: ${data.msg}`);
    }
  }

  onMessage(callback: (msg: IncomingMessage) => Promise<void>): void {
    this.messageCallback = callback;
  }
}
