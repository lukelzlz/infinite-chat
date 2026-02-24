import { Client, GatewayIntentBits, Events, Message, TextChannel } from 'discord.js';
import { PlatformAdapter } from './base';
import { IncomingMessage } from '../core/types';

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
      
      const incomingMsg: IncomingMessage = {
        sessionId: this.formatSessionId(
          'discord',
          msg.author.id,
          msg.guildId ?? undefined
        ),
        content: msg.content,
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
      };
      
      if (this.messageCallback) {
        await this.messageCallback(incomingMsg);
      }
    });

    this.client.on(Events.Error, (error) => {
      console.error(`[${this.name}] Client error:`, error);
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
      console.error(`[${this.name}] Send failed:`, error);
      throw error;
    }
  }

  onMessage(callback: (msg: IncomingMessage) => Promise<void>): void {
    this.messageCallback = callback;
  }
}
