import * as Lark from '@larksuiteoapi/node-sdk';
import { PlatformAdapter } from './base';
import { IncomingMessage } from '../core/types';
import { safeJsonParse } from '../utils/security';

/**
 * 飞书适配器（长连接模式）
 *
 * 使用 @larksuiteoapi/node-sdk 的 WSClient 接收事件，
 * 无需公网 IP、SSL 证书或 Webhook 配置。
 *
 * 使用方式：
 * 1. 在飞书开放平台创建企业自建应用机器人
 * 2. 事件订阅方式选择「使用长连接接收事件」
 * 3. 添加事件 im.message.receive_v1
 * 4. 配置 appId 和 appSecret
 */
export class FeishuAdapter extends PlatformAdapter {
  name = 'feishu';
  private messageCallback?: (msg: IncomingMessage) => Promise<void>;
  private appId: string;
  private appSecret: string;
  private client: Lark.Client;
  private wsClient: Lark.WSClient;

  constructor(config: { appId: string; appSecret: string }) {
    super();
    this.appId = config.appId;
    this.appSecret = config.appSecret;

    this.client = new Lark.Client({
      appId: this.appId,
      appSecret: this.appSecret,
    });

    this.wsClient = new Lark.WSClient({
      appId: this.appId,
      appSecret: this.appSecret,
    });
  }

  async start(): Promise<void> {
    await this.wsClient.start({
      eventDispatcher: new Lark.EventDispatcher({}).register({
        'im.message.receive_v1': async (data: any) => {
          await this.handleMessageEvent(data);
        },
      }),
    });
    console.log(`[${this.name}] WSClient connected, app_id: ${this.appId}`);
  }

  async stop(): Promise<void> {
    // WSClient 没有 stop 方法，进程退出时自动断开
    console.log(`[${this.name}] Adapter stopped`);
  }

  /** 处理消息事件 */
  private async handleMessageEvent(data: any): Promise<void> {
    const message = data.message;
    const sender = data.sender;
    if (!message || !sender) return;

    // 忽略机器人自己发的消息
    if (sender.sender_type === 'app') return;

    const senderId = sender.sender_id?.open_id || sender.sender_id?.user_id || 'unknown';
    const chatType = message.chat_type; // 'p2p' | 'group'
    const groupId = chatType === 'group' ? message.chat_id : undefined;

    const sessionId = this.formatSessionId('feishu', senderId, groupId);
    const msgType = message.message_type;

    // 解析消息内容
    let content = '';
    const attachments: IncomingMessage['attachments'] = [];

    try {
      const parsed = safeJsonParse<Record<string, any>>(message.content, {});

      if (msgType === 'text') {
        content = parsed.text || '';
      } else if (msgType === 'post') {
        // 富文本：提取所有文本
        content = this.extractPostText(parsed);
      } else if (msgType === 'image') {
        attachments.push({
          type: 'image',
          fileId: parsed.image_key || '',
        });
      } else if (msgType === 'file') {
        attachments.push({
          type: 'document',
          fileId: parsed.file_key || '',
          filename: parsed.file_name,
          size: parsed.file_size,
        });
      }
    } catch {
      content = message.content || '';
    }

    // 群聊中去除 @机器人 的文本
    if (chatType === 'group' && data.message?.mentions) {
      for (const mention of data.message.mentions) {
        content = content.replace(`@${mention.name}`, '').trim();
      }
    }

    if (!content && attachments.length === 0) return;

    const incomingMsg: IncomingMessage = {
      sessionId,
      content,
      sender: {
        id: senderId,
        name: sender.sender_id?.union_id,
        isBot: sender.sender_type === 'app',
      },
      metadata: {
        messageId: message.message_id,
        chatType,
        messageType: msgType,
        createTime: message.create_time,
      },
      attachments: attachments.length > 0 ? attachments : undefined,
    };

    if (this.messageCallback) {
      await this.messageCallback(incomingMsg);
    }
  }

  /** 从富文本 post 中提取纯文本 */
  private extractPostText(post: Record<string, any>): string {
    const lines: string[] = [];
    const content = post.content;
    if (!Array.isArray(content)) return post.text || '';

    for (const line of content) {
      if (!Array.isArray(line)) continue;
      for (const element of line) {
        if (element.tag === 'text' && typeof element.text === 'string') {
          lines.push(element.text);
        } else if (element.tag === 'at') {
          // 跳过 @提及
        }
      }
    }
    return lines.join('');
  }

  /** 解析 sessionId 获取 receive_id 和 receive_id_type */
  private parseSessionId(sessionId: string): { receiveId: string; receiveIdType: 'open_id' | 'chat_id' } {
    const parts = sessionId.split(':');
    // feishu:open_id
    if (parts.length <= 2) {
      return { receiveId: parts[1], receiveIdType: 'open_id' };
    }
    // feishu:group:chat_id:open_id
    return { receiveId: parts[2], receiveIdType: 'chat_id' };
  }

  async sendMessage(sessionId: string, message: string, options?: any): Promise<void> {
    const { receiveId, receiveIdType } = this.parseSessionId(sessionId);

    try {
      await this.client.im.message.create({
        params: { receive_id_type: receiveIdType },
        data: {
          receive_id: receiveId,
          msg_type: 'text',
          content: JSON.stringify({ text: message }),
        },
      });
    } catch (error) {
      console.error(`[${this.name}] Send failed:`, error instanceof Error ? error.message : 'Unknown error');
      throw error;
    }
  }

  /** 发送富文本消息 */
  async sendRichMessage(
    sessionId: string,
    content: Record<string, any>,
    options?: any
  ): Promise<void> {
    const { receiveId, receiveIdType } = this.parseSessionId(sessionId);

    await this.client.im.message.create({
      params: { receive_id_type: receiveIdType },
      data: {
        receive_id: receiveId,
        msg_type: 'post',
        content: JSON.stringify(content),
      },
    });
  }

  /** 发送卡片消息 */
  async sendCardMessage(
    sessionId: string,
    card: Record<string, any>
  ): Promise<void> {
    const { receiveId, receiveIdType } = this.parseSessionId(sessionId);

    await this.client.im.message.create({
      params: { receive_id_type: receiveIdType },
      data: {
        receive_id: receiveId,
        msg_type: 'interactive',
        content: JSON.stringify(card),
      },
    });
  }

  onMessage(callback: (msg: IncomingMessage) => Promise<void>): void {
    this.messageCallback = callback;
  }
}
