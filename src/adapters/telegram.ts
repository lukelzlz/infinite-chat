import { Bot, Context, GrammyError } from 'grammy';
import { PlatformAdapter } from './base';
import { IncomingMessage, MessageAttachment } from '../core/types';

export class TelegramAdapter extends PlatformAdapter {
  name = 'telegram';
  private bot: Bot;
  private messageCallback?: (msg: IncomingMessage) => Promise<void>;

  constructor(private token: string) {
    super();
    this.bot = new Bot(token);
  }

  async start(): Promise<void> {
    // 注册文本消息处理器
    this.bot.on('message:text', async (ctx: Context) => {
      await this.handleMessage(ctx);
    });
    
    // 注册文档消息处理器
    this.bot.on('message:document', async (ctx: Context) => {
      await this.handleMessage(ctx);
    });
    
    // 注册图片消息处理器（带 caption）
    this.bot.on('message:photo', async (ctx: Context) => {
      if (ctx.message?.caption) {
        await this.handleMessage(ctx);
      }
    });
    
    // 启动 bot (使用 polling 模式)
    try {
      // 先测试 bot token 是否有效
      const me = await this.bot.api.getMe();
      console.log(`[Telegram] Bot: @${me.username}`);
      
      // 开始 polling
      this.bot.start({
        onStart: () => console.log('[Telegram] Bot started (polling mode)'),
      });
    } catch (error) {
      console.error('[Telegram] Failed to start bot:', error);
      throw error;
    }
  }

  /**
   * 统一消息处理
   */
  private async handleMessage(ctx: Context): Promise<void> {
    if (!ctx.from) return;
    
    const message = ctx.message;
    if (!message) return;
    
    const chatId = ctx.chat?.id;
    const text = message.text || message.caption || '';
    
    // 提取附件
    const attachments: MessageAttachment[] = [];
    
    if (message.document) {
      attachments.push({
        type: 'document',
        fileId: message.document.file_id,
        filename: message.document.file_name,
        mimeType: message.document.mime_type,
        size: message.document.file_size,
      });
      console.log(`[Telegram] Document received: ${message.document.file_name} (${message.document.file_size} bytes)`);
    }
    
    if (message.photo && message.photo.length > 0) {
      // 获取最大尺寸的图片
      const photo = message.photo[message.photo.length - 1];
      attachments.push({
        type: 'image',
        fileId: photo.file_id,
        size: photo.file_size,
      });
    }
    
    // 如果没有文本且没有可处理的附件，跳过
    if (!text && attachments.length === 0) return;
    if (!text && attachments.some(a => a.type !== 'document')) return;
    
    const msg: IncomingMessage = {
      sessionId: this.formatSessionId('telegram', ctx.from.id.toString(), chatId?.toString()),
      content: text || '[文档]',
      sender: {
        id: ctx.from.id.toString(),
        name: ctx.from.first_name,
        isBot: ctx.from.is_bot,
      },
      replyTo: message.reply_to_message?.message_id?.toString(),
      metadata: {
        messageId: message.message_id,
        chatType: ctx.chat?.type,
        chatId,
      },
      attachments: attachments.length > 0 ? attachments : undefined,
    };
    
    console.log(`[Telegram] Received message from ${ctx.from.id}: ${text.slice(0, 50)}...`);
    
    if (this.messageCallback) {
      try {
        await this.messageCallback(msg);
      } catch (e) {
        console.error('[Telegram] Message callback error:', e);
        await ctx.reply('处理消息时出错，请稍后重试');
      }
    }
  }

  async stop(): Promise<void> {
    await this.bot.stop();
    console.log(`[${this.name}] Bot stopped`);
  }

  async sendMessage(sessionId: string, message: string, options?: any): Promise<void> {
    // 解析 sessionId 获取 chatId
    const parts = sessionId.split(':');
    const chatId = parts.length > 2 ? parts[2] : parts[1];
    
    try {
      await this.bot.api.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
        ...options,
      });
      console.log(`[Telegram] Sent message to ${chatId}`);
    } catch (error) {
      if (error instanceof GrammyError) {
        console.error(`[${this.name}] Send failed:`, error.description);
        
        // 如果 Markdown 解析失败，尝试纯文本
        if (error.description.includes('parse')) {
          try {
            await this.bot.api.sendMessage(chatId, message, options);
            return;
          } catch (e) {
            console.error(`[${this.name}] Plain text also failed:`, e);
          }
        }
      }
      throw error;
    }
  }

  /**
   * 发送打字状态
   */
  async sendTyping(sessionId: string): Promise<void> {
    const parts = sessionId.split(':');
    const chatId = parts.length > 2 ? parts[2] : parts[1];
    
    try {
      await this.bot.api.sendChatAction(chatId, 'typing');
    } catch (e) {
      // 忽略 typing 错误
    }
  }

  /**
   * 发送上传照片状态
   */
  async sendUploadingPhoto(sessionId: string): Promise<void> {
    const parts = sessionId.split(':');
    const chatId = parts.length > 2 ? parts[2] : parts[1];
    
    try {
      await this.bot.api.sendChatAction(chatId, 'upload_photo');
    } catch (e) {
      // 忽略错误
    }
  }

  onMessage(callback: (msg: IncomingMessage) => Promise<void>): void {
    this.messageCallback = callback;
  }

  /**
   * 下载文件
   */
  async downloadFile(fileId: string): Promise<{ content: Buffer; filename?: string; mimeType?: string }> {
    try {
      // 获取文件信息
      const file = await this.bot.api.getFile(fileId);
      
      if (!file.file_path) {
        throw new Error('File path not available');
      }
      
      // 构建下载 URL
      const downloadUrl = `https://api.telegram.org/file/bot${this.token}/${file.file_path}`;
      
      // 下载文件
      const response = await fetch(downloadUrl);
      if (!response.ok) {
        throw new Error(`Download failed: ${response.statusText}`);
      }
      
      const content = Buffer.from(await response.arrayBuffer());
      
      return {
        content,
        filename: file.file_path.split('/').pop(),
        mimeType: undefined, // Telegram 不提供 mime type
      };
    } catch (error) {
      console.error('[Telegram] Download file error:', error);
      throw error;
    }
  }
}
