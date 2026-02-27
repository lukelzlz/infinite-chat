import { PlatformAdapter } from './base';
import { IncomingMessage } from '../core/types';
import { safeJsonParse, sanitizeHtml, validateUrl } from '../utils/security';

/**
 * Misskey 平台适配器
 *
 * 支持功能：
 * - 接收 note（帖子）和回复
 * - 群聊支持
 * - WebSocket 实时通信
 */
export class MisskeyAdapter extends PlatformAdapter {
  name = 'misskey';

  private instanceUrl: string;
  private token: string;
  private ws: WebSocket | null = null;
  private messageCallback: ((msg: IncomingMessage) => Promise<void>) | null = null;
  private reconnectInterval: NodeJS.Timeout | null = null;

  constructor(config: {
    instanceUrl: string;  // 如 https://misskey.io
    token: string;        // API Token
  }) {
    super();

    // SSRF 防护：验证 instanceUrl
    const urlValidation = validateUrl(config.instanceUrl, {
      allowPrivateIp: false,
      blockedHosts: ['localhost', '127.0.0.1', 'metadata.google.internal', '169.254.169.254'],
    });

    if (!urlValidation.valid) {
      throw new Error(`Invalid Misskey instance URL: ${urlValidation.error}`);
    }

    this.instanceUrl = urlValidation.normalizedUrl!.replace(/\/$/, '');
    this.token = config.token;
  }

  async start(): Promise<void> {
    console.log(`[Misskey] Connecting to ${this.instanceUrl}...`);
    
    // 连接 WebSocket
    await this.connectWebSocket();
    
    console.log('[Misskey] Connected');
  }

  async stop(): Promise<void> {
    if (this.reconnectInterval) {
      clearInterval(this.reconnectInterval);
      this.reconnectInterval = null;
    }
    
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    
    console.log('[Misskey] Disconnected');
  }

  async sendMessage(sessionId: string, message: string, options?: {
    replyTo?: string;
    visibility?: 'public' | 'home' | 'followers' | 'specified';
    localOnly?: boolean;
  }): Promise<void> {
    const [platform, scope, groupIdOrUserId, userId] = this.parseSessionId(sessionId);
    
    // 构建 note 数据
    const noteData: Record<string, any> = {
      text: message,
      visibility: options?.visibility || (scope === 'group' ? 'specified' : 'public'),
      localOnly: options?.localOnly,
    };

    // 如果是回复
    if (options?.replyTo) {
      noteData.replyId = options.replyTo;
    }

    // 如果是群聊
    if (scope === 'group' && groupIdOrUserId) {
      noteData.visibility = 'specified';
      noteData.visibleUserIds = [groupIdOrUserId];
    }

    try {
      const response = await fetch(`${this.instanceUrl}/api/notes/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.token}`,
        },
        body: JSON.stringify(noteData),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to send note: ${error}`);
      }

      console.log(`[Misskey] Note sent to ${sessionId}`);
    } catch (e) {
      console.error('[Misskey] Failed to send message:', e);
      throw e;
    }
  }

  onMessage(callback: (msg: IncomingMessage) => Promise<void>): void {
    this.messageCallback = callback;
  }

  private parseSessionId(sessionId: string): [string, string?, string?, string?] {
    const parts = sessionId.split(':');
    if (parts.length === 4 && parts[1] === 'group') {
      return [parts[0], parts[1], parts[2], parts[3]];
    }
    return [parts[0], undefined, undefined, parts[1]];
  }

  private async connectWebSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        // 获取 WebSocket URL
        const wsUrl = this.instanceUrl.replace('https://', 'wss://').replace('http://', 'ws://');
        
        this.ws = new WebSocket(`${wsUrl}/streaming?i=${this.token}`);

        this.ws.onopen = () => {
          console.log('[Misskey] WebSocket connected');
          
          // 订阅主页时间线（接收提及和回复）
          this.subscribeChannel('main');
          
          // 订阅全局时间线（可选）
          // this.subscribeChannel('homeTimeline');
          
          resolve();
        };

        this.ws.onmessage = (event) => {
          this.handleWebSocketMessage(event.data);
        };

        this.ws.onerror = (error) => {
          console.error('[Misskey] WebSocket error:', error);
        };

        this.ws.onclose = () => {
          console.log('[Misskey] WebSocket closed, reconnecting...');
          this.scheduleReconnect();
        };
      } catch (e) {
        reject(e);
      }
    });
  }

  private subscribeChannel(channel: string): void {
    if (!this.ws) return;
    
    const subscribeMsg = {
      type: 'connect',
      body: {
        channel,
        id: `channel-${channel}`,
      },
    };
    
    this.ws.send(JSON.stringify(subscribeMsg));
    console.log(`[Misskey] Subscribed to channel: ${channel}`);
  }

  private handleWebSocketMessage(data: string): void {
    try {
      // 使用安全的 JSON 解析
      const msg = safeJsonParse<{ type?: string; body?: any }>(data, {});

      if (msg.type !== 'channel') return;

      const body = msg.body;

      // 处理不同类型的事件
      switch (body?.type) {
        case 'mention':
          this.handleMention(body.body);
          break;
        case 'reply':
          this.handleReply(body.body);
          break;
        case 'messagingMessage':
          this.handleDirectMessage(body.body);
          break;
        case 'note':
          // 时间线上的 note，可以用于群聊监听
          this.handleTimelineNote(body.body);
          break;
      }
    } catch (e) {
      console.error('[Misskey] Failed to parse message:', (e as Error).message);
    }
  }

  private handleMention(note: any): void {
    if (!this.messageCallback) return;
    
    const incoming: IncomingMessage = {
      sessionId: this.formatSessionId('misskey', note.user.id),
      content: this.stripHtml(note.text || ''),
      sender: {
        id: note.user.id,
        name: note.user.name || note.user.username,
        isBot: note.user.isBot,
      },
      replyTo: note.reply?.id,
      metadata: {
        noteId: note.id,
        visibility: note.visibility,
        raw: note,
      },
    };
    
    this.messageCallback(incoming);
  }

  private handleReply(note: any): void {
    // 和 mention 类似处理
    this.handleMention(note);
  }

  private handleDirectMessage(message: any): void {
    if (!this.messageCallback) return;
    
    const incoming: IncomingMessage = {
      sessionId: this.formatSessionId('misskey', message.userId),
      content: this.stripHtml(message.text || ''),
      sender: {
        id: message.user.id,
        name: message.user.name || message.user.username,
        isBot: message.user.isBot,
      },
      metadata: {
        messageId: message.id,
        isDirect: true,
        raw: message,
      },
    };
    
    this.messageCallback(incoming);
  }

  private handleTimelineNote(note: any): void {
    // 只处理群聊中的消息
    if (!note.visibility || note.visibility !== 'specified') return;
    if (!this.messageCallback) return;
    
    // 检查是否提到了机器人
    const hasMention = note.text?.includes('@') || false;
    if (!hasMention) return;
    
    const incoming: IncomingMessage = {
      sessionId: this.formatSessionId('misskey', note.user.id),
      content: this.stripHtml(note.text || ''),
      sender: {
        id: note.user.id,
        name: note.user.name || note.user.username,
        isBot: note.user.isBot,
      },
      replyTo: note.reply?.id,
      metadata: {
        noteId: note.id,
        visibility: note.visibility,
        isGroup: true,
        raw: note,
      },
    };
    
    this.messageCallback(incoming);
  }

  private stripHtml(text: string): string {
    return sanitizeHtml(text);
  }

  private scheduleReconnect(): void {
    if (this.reconnectInterval) return;
    
    this.reconnectInterval = setTimeout(() => {
      this.reconnectInterval = null;
      this.connectWebSocket().catch(e => {
        console.error('[Misskey] Reconnect failed:', e);
        this.scheduleReconnect();
      });
    }, 5000);
  }
}
