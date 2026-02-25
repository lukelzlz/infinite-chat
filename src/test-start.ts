// 简单测试启动脚本
import { ChatBotEngine, WebAdapter } from './index';
import { FrameworkConfig } from './core/types';

async function main() {
  console.log('🚀 Starting infinite-chat test...\n');

  // 配置
  const config: FrameworkConfig = {
    llm: {
      provider: 'siliconflow',
      model: 'deepseek-ai/DeepSeek-V3',
      apiKey: process.env.SILICONFLOW_API_KEY || process.env.OPENAI_API_KEY || '',
      maxTokens: 2048,
      temperature: 0.7,
    },
    memory: {
      shortTermWindow: 10,
      compressThreshold: 30,
    },
    agents: {
      enabled: true,
      list: [
        {
          id: 'assistant',
          name: '小助手',
          description: '通用助手，活泼友好',
          systemPrompt: '你是一个活泼友好的AI助手，叫小助手。喜欢用颜文字，回复简洁有趣。',
          triggers: ['小助手', '助手'],
          isDefault: true,
        },
        {
          id: 'coder',
          name: '程序员',
          description: '代码专家',
          systemPrompt: '你是一个专业的程序员助手。精通各种编程语言，提供高质量的代码建议。',
          triggers: ['代码', '编程', 'bug'],
        },
      ],
      groupChat: {
        enabled: true,
        agentInteraction: true,
        maxAgentChain: 2,
        chainThreshold: 0.5,
      },
    },
    adapters: [
      {
        type: 'web',
        enabled: true,
        config: { port: 3000 },
      },
    ],
  };

  // 创建引擎
  const engine = new ChatBotEngine(config);

  // 注册 Web 适配器
  const webAdapter = new WebAdapter({ port: 3000 });
  engine.registerAdapter(webAdapter);

  // 启动引擎
  await engine.start();

  console.log('\n✅ infinite-chat started!');
  console.log('📱 Open http://localhost:3000 in your browser\n');
  console.log('Press Ctrl+C to stop\n');
}

main().catch(console.error);
