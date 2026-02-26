// Docker 启动脚本
import { ChatBotEngine, TelegramAdapter, WebAdapter, createEngineFromConfig } from './index';
import { FrameworkConfig } from './core/types';
import * as path from 'path';

async function main() {
  console.log('🚀 Starting infinite-chat...\n');

  // 从配置文件加载
  const configPath = process.env.CONFIG_PATH || path.join(__dirname, '../config/config.yaml');
  
  try {
    const engine = await createEngineFromConfig(configPath);
    await engine.start();
    
    console.log('\n✅ infinite-chat started!');
    console.log('📱 Telegram bot is running');
    console.log('🌐 Web UI: http://localhost:3000\n');
  } catch (e) {
    console.error('Failed to start:', e);
    
    // 回退到环境变量配置
    console.log('\n尝试使用环境变量配置...');
    await startWithEnv();
  }
}

async function startWithEnv() {
  const config: FrameworkConfig = {
    llm: {
      provider: 'custom',
      model: process.env.LLM_MODEL || 'gpt-4o',
      baseUrl: process.env.LLM_BASE_URL,
      apiKey: process.env.LLM_API_KEY,
      maxTokens: parseInt(process.env.LLM_MAX_TOKENS || '4096'),
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
          systemPrompt: '你是一个活泼、友好的AI助手。喜欢用颜文字，回复简洁有趣。',
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
  const web = new WebAdapter({ port: webPort });
  engine.registerAdapter(web);
  console.log(`✅ Web adapter registered (port ${webPort})`);

  await engine.start();

  console.log('\n✅ infinite-chat started!');
  console.log(`🌐 Web UI: http://localhost:${webPort}\n`);
}

main().catch(console.error);
