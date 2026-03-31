# infinite-chat

🤖 **无限上下文** · **多 Agent 群聊** · **多平台接入** · **插件系统**

一个类似 AstrBot 的聊天机器人框架，支持 Mem0 作为长期记忆层，支持多 Agent 协作。

**GitHub**: https://github.com/lukelzlz/infinite-chat

## 特性

- ✅ **无限上下文**: 短期滑动窗口 + Mem0 长期记忆 + 自动压缩
- ✅ **多 Agent 群聊**: 支持多个 AI Agent 协作，群聊中 Agent 可互相响应
- ✅ **多用户隔离**: 每个用户独立会话和上下文
- ✅ **多平台支持**: Telegram、Discord、飞书、**Misskey**、Web Chat
- ✅ **开箱即用适配器注册**: Telegram、Discord、飞书、Misskey、Web Chat 可直接通过配置启动
- ✅ **多 LLM 支持**: OpenAI、Anthropic、本地模型(Ollama)、SiliconFlow
- ✅ **插件系统**: 可扩展的插件架构
- ✅ **TypeScript**: 完整类型支持

## 架构

```
┌──────────────────────────────────────────────┐
│         infinite-chat Framework               │
├──────────────────────────────────────────────┤
│  📡 适配器层                                  │
│    Telegram | Discord | 飞书 | Misskey       │
├──────────────────────────────────────────────┤
│  🤖 多 Agent 层                               │
│    Agent 选择 | 群聊协作 | 链式响应           │
├──────────────────────────────────────────────┤
│  🧠 核心引擎                                   │
│    ├─ 无限上下文 (滑动窗口 + Mem0)           │
│    ├─ 多用户会话隔离                          │
│    └─ 消息路由                                │
├──────────────────────────────────────────────┤
│  🔌 LLM 层                                    │
│    OpenAI | Anthropic | Ollama | SiliconFlow │
├──────────────────────────────────────────────┤
│  🧩 插件系统                                  │
└──────────────────────────────────────────────┘
```

## 快速开始

### 方式一：Docker 部署 (推荐)

```bash
# 1. 克隆仓库
git clone https://github.com/lukelzlz/infinite-chat.git
cd infinite-chat

# 2. 创建环境变量文件
cp .env.example .env
# 编辑 .env 填入你的 API Key

# 3. 启动服务
docker compose up -d

# 4. 访问 Web UI
open http://localhost:3000
```

### 方式二：本地开发

#### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

```bash
# 复制示例配置
cp config/config.yaml.example config/config.yaml

# 设置环境变量
export OPENAI_API_KEY="your-api-key"
export TELEGRAM_BOT_TOKEN="your-telegram-token"
export MEM0_API_KEY="your-mem0-key"  # 可选
```

### 3. 启动

```typescript
import { quickStart } from 'chatbot-framework';

const engine = await quickStart();
console.log('Bot started!', engine.getStatus());
```

## 配置说明

### config.yaml

```yaml
# LLM 配置
llm:
  provider: openai  # openai | anthropic | local
  model: gpt-4o-mini
  apiKey: ${OPENAI_API_KEY}
  maxTokens: 4096
  temperature: 0.7

# 记忆配置
memory:
  shortTermWindow: 20    # 短期记忆保留消息数
  compressThreshold: 50  # 触发压缩的消息数

# 适配器
adapters:
  - type: telegram
    enabled: true
    config:
      token: ${TELEGRAM_BOT_TOKEN}

# 插件
plugins:
  enabled:
    - echo
    - help
```

## 核心概念

### 无限上下文

框架实现三层记忆架构：

1. **短期记忆**: 滑动窗口保留最近 N 条消息
2. **长期记忆**: Mem0 自动提取和存储重要信息
3. **压缩记忆**: 超过阈值自动压缩成摘要

```typescript
// 用户消息: "我叫张三，我喜欢编程"
// → Mem0 自动存储: 
//   - 用户名: 张三
//   - 兴趣: 编程

// 后续对话
// 用户: "给我推荐一些项目"
// → 检索相关记忆 → 结合上下文回复
```

### 多用户隔离

每个用户拥有独立会话：

```typescript
// Session ID 格式
"telegram:12345"          // 私聊
"telegram:group:-100123"  // 群聊
"discord:67890"           // Discord 用户
```

### 插件系统

创建自定义插件：

```typescript
import { Plugin, Session } from 'chatbot-framework';

class WeatherPlugin implements Plugin {
  name = 'weather';
  priority = 50;

  shouldHandle(content: string): boolean {
    return content.startsWith('/weather ');
  }

  async handle(content: string, session: Session): Promise<string | null> {
    const city = content.slice(9);
    // 获取天气信息...
    return `${city} 今天晴，25°C`;
  }
}

// 注册
engine.registerPlugin(new WeatherPlugin());
```

## API 文档

### ChatBotEngine

```typescript
// 创建引擎
const engine = new ChatBotEngine(config);

// 启动/停止
await engine.start();
await engine.stop();

// 注册适配器
engine.registerAdapter(new TelegramAdapter(token));

// 注册插件
engine.registerPlugin(new MyPlugin());

// 主动发送消息
await engine.sendMessage('telegram:12345', 'Hello!');

// 获取状态
const status = engine.getStatus();

// 清除会话
engine.clearSession('telegram:12345');
```

### 适配器

```typescript
// Telegram
import { TelegramAdapter } from 'chatbot-framework';
const telegram = new TelegramAdapter('BOT_TOKEN');

// 自定义适配器
class MyAdapter extends PlatformAdapter {
  name = 'my-platform';
  
  async start() { /* ... */ }
  async stop() { /* ... */ }
  async sendMessage(sessionId: string, message: string) { /* ... */ }
  onMessage(callback) { /* ... */ }
}
```

### Mem0 集成

```typescript
import { HybridMemoryManager } from 'chatbot-framework';

const memory = new HybridMemoryManager({
  apiKey: 'your-mem0-key',
  // 或使用本地模式
  localMode: true,
}, 20);

// 构建增强上下文
const { systemPrompt, relevantMemories } = await memory.buildContext(
  messages,
  userId,
  currentQuery
);
```

## 依赖

### 必需
- Node.js >= 18
- TypeScript >= 5.0

### 可选
- `openai` - OpenAI API
- `@anthropic-ai/sdk` - Anthropic API
- `grammy` - Telegram Bot
- `discord.js` - Discord Bot
- `mem0ai` - Mem0 SDK

## 示例项目

### 简单 Telegram Bot

```typescript
import { ChatBotEngine, TelegramAdapter } from 'chatbot-framework';

const engine = new ChatBotEngine({
  llm: {
    provider: 'openai',
    model: 'gpt-4o-mini',
    apiKey: process.env.OPENAI_API_KEY!,
  },
  memory: {
    shortTermWindow: 20,
    compressThreshold: 50,
  },
  adapters: [],
});

engine.registerAdapter(new TelegramAdapter(process.env.TELEGRAM_TOKEN!));
await engine.start();
```

### 本地模型 (Ollama)

```typescript
const engine = new ChatBotEngine({
  llm: {
    provider: 'local',
    model: 'llama3',
    baseUrl: 'http://localhost:11434',
  },
  // ...
});
```

## License

MIT
