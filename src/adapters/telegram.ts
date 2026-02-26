import { Bot, Context, GrammyError } from 'grammy';
import { PlatformAdapter } from './base';
import { IncomingMessage } from '../core/types';

export class TelegramAdapter extends PlatformAdapter {
  name = 'telegram';
  private bot: Bot;
  private messageCallback?: (msg: IncomingMessage) => Promise<void>;

  constructor(private token: string) {
    super();
    this.bot = new Bot(token);
  }

  async start(): Promise<void> {
    // 注册消息处理器
    this.bot.on('message:text', async (ctx: Context) => {
      if (!ctx.message?.text || !ctx.from) return;
      
      const chatId = ctx.chat?.id;
      const msg: IncomingMessage = {
        sessionId: this.formatSessionId('telegram', ctx.from.id.toString(), chatId?.toString()),
        content: ctx.message.text,
        sender: {
          id: ctx.from.id.toString(),
          name: ctx.from.first_name,
          isBot: ctx.from.is_bot,
        },
        replyTo: ctx.message.reply_to_message?.message_id?.toString(),
        metadata: {
          messageId: ctx.message.message_id,
          chatType: ctx.chat?.type,
          chatId,
        },
      };
      
      console.log(`[Telegram] Received message from ${ctx.from.id}: ${ctx.message.text.slice(0, 50)}...`);
      
      if (this.messageCallback) {
        try {
          await this.messageCallback(msg);
        } catch (e) {
          console.error('[Telegram] Message callback error:', e);
          // 发送错误提示
          await ctx.reply('处理消息时出错，请稍后重试');
        }
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
}
