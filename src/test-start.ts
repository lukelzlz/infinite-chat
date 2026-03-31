// Docker/本地 启动脚本
import { ChatBotEngine, TelegramAdapter, WebAdapter, TiebaAdapter } from './index';
import { FrameworkConfig } from './core/types';

async function main() {
  console.log('🚀 Starting infinite-chat...\n');

  // 从环境变量读取配置
  const config: FrameworkConfig = {
    llm: {
      provider: 'custom',
      model: process.env.LLM_MODEL || 'gpt-4o',
      baseUrl: process.env.LLM_BASE_URL,
      apiKey: process.env.LLM_API_KEY,
      maxTokens: parseInt(process.env.LLM_MAX_TOKENS || '8192'),
      temperature: parseFloat(process.env.LLM_TEMPERATURE || '0.7'),
    },
    memory: {
      shortTermWindow: 20,
      compressThreshold: 50,
    },
    agents: {
      enabled: true,
      list: [
        {
          id: 'assistant',
          name: '小助手',
          description: '活泼友好的AI助手',
          systemPrompt: '你是一个活泼、友好的AI助手，叫小助手。你喜欢用颜文字表达情绪，回复简洁有趣。你会记住用户的偏好和重要信息。',
          isDefault: true,
        },
      ],
      groupChat: {
        enabled: false,
        agentInteraction: false,
        maxAgentChain: 2,
        chainThreshold: 0.5,
      },
    },
    adapters: [],
    auth: {
      enabled: !!process.env.ADMIN_PASSWORD,
      adminPassword: process.env.ADMIN_PASSWORD,
    },
  };

  const engine = new ChatBotEngine(config);

  // Telegram
  if (process.env.TELEGRAM_BOT_TOKEN) {
    const telegram = new TelegramAdapter(process.env.TELEGRAM_BOT_TOKEN);
    engine.registerAdapter(telegram);
    console.log('✅ Telegram adapter registered');
  }

  // Web
  const webPort = parseInt(process.env.PORT || '3000');
  const web = new WebAdapter({ 
    port: webPort,
    auth: {
      enabled: !!process.env.ADMIN_PASSWORD,
      adminPassword: process.env.ADMIN_PASSWORD,
    },
  });
  engine.registerAdapter(web);
  console.log(`✅ Web adapter registered (port ${webPort})`);

  // Tieba (抓虾吧)
  if (process.env.TB_TOKEN) {
    const tieba = new TiebaAdapter({
      token: process.env.TB_TOKEN,
      heartbeatIntervalMs: parseInt(process.env.TB_HEARTBEAT_MS || '14400000'), // 4h
      pollIntervalMs: parseInt(process.env.TB_POLL_MS || '300000'), // 5min
    });
    engine.registerAdapter(tieba);
    console.log('✅ Tieba (抓虾吧) adapter registered');
  }

  // 启动
  await engine.start();

  console.log('\n✅ infinite-chat started!');
  console.log(`🌐 Web UI: http://localhost:${webPort}`);
  if (process.env.TELEGRAM_BOT_TOKEN) {
    console.log('📱 Telegram bot is running');
  }
  console.log('');
}

main().catch(err => {
  console.error('❌ Failed to start:', err);
  process.exit(1);
});
