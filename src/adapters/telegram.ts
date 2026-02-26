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
      
      const msg: IncomingMessage = {
        sessionId: this.formatSessionId('telegram', ctx.from.id.toString(), ctx.chat?.id?.toString()),
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
        },
      };
      
      if (this.messageCallback) {
        await this.messageCallback(msg);
      }
    });
    
    // 启动 bot (使用 polling 模式)
    try {
      // 先测试 bot token 是否有效
      const me = await this.bot.api.getMe();
      console.log(`[Telegram] Bot: @${me.username}`);
      
      // 开始 polling
      this.bot.start({
        onStart: () => console.log('[Telegram] Bot started'),
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
    } catch (error) {
      if (error instanceof GrammyError) {
        console.error(`[${this.name}] Send failed:`, error.description);
      }
      throw error;
    }
  }

  onMessage(callback: (msg: IncomingMessage) => Promise<void>): void {
    this.messageCallback = callback;
  }
}
