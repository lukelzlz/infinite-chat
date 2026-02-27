import { Client, GatewayIntentBits, Events, Message, TextChannel } from 'discord.js';
import { PlatformAdapter } from './base';
import { IncomingMessage, MessageAttachment } from '../core/types';
import { validateUrl } from '../utils/security';

export class DiscordAdapter extends PlatformAdapter {
  name = 'discord';
  private client: Client;
  private messageCallback?: (msg: IncomingMessage) => Promise<void>;

  constructor(private token: string) {
    super();
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
      ],
    });
  }

  async start(): Promise<void> {
    this.client.on(Events.MessageCreate, async (msg: Message) => {
      // 忽略机器人消息
      if (msg.author.bot) return;
      
      // 提取附件
      const attachments: MessageAttachment[] = [];
      
      if (msg.attachments.size > 0) {
        for (const [, attachment] of msg.attachments) {
          // 只处理文档类型
          const ext = attachment.name?.split('.').pop()?.toLowerCase();
          const docExts = ['txt', 'md', 'json', 'csv', 'log', 'js', 'ts', 'py', 'go', 'rs', 'html', 'css', 'xml', 'yaml', 'yml', 'sh'];
          
          if (ext && docExts.includes(ext)) {
            attachments.push({
              type: 'document',
              fileId: attachment.id,
              filename: attachment.name ?? undefined,
              mimeType: attachment.contentType ?? undefined,
              size: attachment.size,
              url: attachment.url,
            });
            console.log(`[Discord] Document received: ${attachment.name} (${attachment.size} bytes)`);
          }
        }
      }
      
      // 如果没有文本且没有可处理的附件，跳过
      if (!msg.content && attachments.length === 0) return;
      
      // 纯文档消息的 content 为空字符串
      const msgContent = msg.content || '';
      
      const incomingMsg: IncomingMessage = {
        sessionId: this.formatSessionId(
          'discord',
          msg.author.id,
          msg.guildId ?? undefined
        ),
        content: msgContent,
        sender: {
          id: msg.author.id,
          name: msg.author.username,
          isBot: msg.author.bot,
        },
        replyTo: msg.reference?.messageId,
        metadata: {
          messageId: msg.id,
          channelId: msg.channelId,
          guildId: msg.guildId,
          isDM: !msg.guildId,
        },
        attachments: attachments.length > 0 ? attachments : undefined,
      };
      
      if (this.messageCallback) {
        await this.messageCallback(incomingMsg);
      }
    });

    this.client.on(Events.Error, (error) => {
      // 安全地记录错误，避免泄露敏感信息
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[${this.name}] Client error:`, errorMsg);
    });

    await this.client.login(this.token);
    console.log(`[${this.name}] Bot started as ${this.client.user?.tag}`);
  }

  async stop(): Promise<void> {
    this.client.destroy();
    console.log(`[${this.name}] Bot stopped`);
  }

  async sendMessage(sessionId: string, message: string, options?: any): Promise<void> {
    // 解析 sessionId: discord:userId 或 discord:group:guildId:userId
    const parts = sessionId.split(':');
    const channelId = options?.channelId || parts[2];
    
    try {
      const channel = await this.client.channels.fetch(channelId);
      if (channel?.isTextBased()) {
        await (channel as TextChannel).send({
          content: message,
          ...options,
        });
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[${this.name}] Send failed:`, errorMsg);
      throw new Error(`Send message failed`);
    }
  }

  /**
   * 下载文件（通过 URL）
   */
  async downloadFile(url: string): Promise<{ content: Buffer; filename?: string }> {
    try {
      // 验证 URL 防止 SSRF 攻击
      const urlValidation = validateUrl(url, { allowPrivateIp: false });
      if (!urlValidation.valid) {
        throw new Error(`Invalid URL: ${urlValidation.error}`);
      }

      const response = await fetch(urlValidation.normalizedUrl!);
      if (!response.ok) {
        throw new Error(`Download failed: ${response.statusText}`);
      }

      const content = Buffer.from(await response.arrayBuffer());
      const filename = url.split('/').pop()?.split('?')[0];

      return { content, filename };
    } catch (error) {
      console.error('[Discord] Download file error:', error instanceof Error ? error.message : 'Unknown error');
      throw error;
    }
  }

  onMessage(callback: (msg: IncomingMessage) => Promise<void>): void {
    this.messageCallback = callback;
  }
}
