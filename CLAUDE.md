# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

**infinite-chat** 是一个 TypeScript 多平台聊天机器人框架，核心特性：
- 无限上下文：短期滑动窗口 + Mem0 长期记忆 + 自动压缩
- 多 Agent 群聊协作
- 多平台支持：Telegram、Discord、飞书、Misskey、Web Chat
- 可扩展插件系统

## 常用命令

```bash
# 开发
npm run dev          # 使用 ts-node 直接运行 src/index.ts
npm run build        # 编译 TypeScript 到 dist/
npm run start        # 运行编译后的代码

# 测试
npm test             # 运行所有测试 (vitest run)
npm run test:watch   # 监视模式运行测试

# 运行单个测试文件
npx vitest run tests/context.test.ts
npx vitest run tests/plugins.test.ts -t "plugin name"  # 运行特定测试

# Docker
docker compose up -d
```

## 架构概览

```
src/
├── core/           # 核心引擎
│   ├── engine.ts   # ChatBotEngine - 主编排器，管理所有子系统
│   ├── types.ts    # 类型定义
│   ├── memory.ts   # HybridMemoryManager + Mem0Manager
│   ├── context.ts  # ContextManager (滑动窗口)
│   ├── agents.ts   # AgentManager (多 Agent)
│   └── session.ts  # SessionManager (用户会话)
├── adapters/       # 平台适配器 (继承 PlatformAdapter 基类)
├── llm/            # LLM 提供者 (OpenAI, Anthropic, Ollama, SiliconFlow)
├── plugins/        # 插件系统 (实现 Plugin 接口)
└── tools/          # 外部工具 (browser, websearch)
```

### 消息处理流程

1. 适配器接收消息 → 创建 `IncomingMessage`
2. `PluginManager` 优先处理（可实现早期退出）
3. 未处理则路由到 `AgentManager` 选择 Agent
4. Agent 通过 `LLMProvider` 生成响应，使用 `HybridMemoryManager` 的上下文
5. 响应通过适配器返回
6. 消息存储到 `ContextManager` (滑动窗口) + `Mem0Manager` (长期记忆)

## 关键设计模式

- **Strategy Pattern**: LLM providers、adapters、plugins 都采用策略模式
- **Factory Pattern**: `createLLMProvider()`, `createEngineFromConfig()`
- **Manager Pattern**: AgentManager, PluginManager, SessionManager

## 开发注意事项

### 添加新平台适配器
继承 `PlatformAdapter` 基类 (`src/adapters/base.ts`)，实现：
- `name`: 适配器名称
- `start()`: 启动适配器
- `stop()`: 停止适配器
- `sendMessage(sessionId, message)`: 发送消息
- `onMessage(callback)`: 注册消息回调

### 添加新插件
实现 `Plugin` 接口 (`src/plugins/types.ts`)：
- `name`: 插件名称
- `priority`: 优先级（数值越小优先级越高）
- `shouldHandle(content)`: 判断是否处理
- `handle(content, session)`: 处理逻辑

### 添加新 LLM 提供者
在 `src/llm/index.ts` 中添加新的 provider 类，实现 `LLMProvider` 接口，并在 `createLLMProvider()` 工厂函数中注册。

### Session ID 格式
```
"telegram:12345"           # 私聊
"telegram:group:-100123"   # 群聊
"discord:67890"            # Discord 用户
```

## 配置

- 主配置文件: `config/config.yaml` (从 `config/config.example.yaml` 复制)
- 环境变量: `.env` (从 `.env.example` 复制)
- 配置支持环境变量插值: `apiKey: ${OPENAI_API_KEY}`

## 可选依赖

- `mem0ai`: Mem0 SDK (未安装时自动使用本地模式)
- `chromadb`: 向量数据库
- `ioredis`: Redis 客户端

## 安全工具模組

項目包含 `src/utils/security.ts` 安全工具模組，提供以下功能：

### URL 驗證（SSRF 防護）
```typescript
import { validateUrl } from './utils/security';

const result = validateUrl(url, {
  allowPrivateIp: false,  // 是否允許訪問私有 IP
  allowedHosts: [],       // 域名白名單
  blockedHosts: [],       // 域名黑名單
});
```

### 安全 JSON 解析（防止原型污染）
```typescript
import { safeJsonParse } from './utils/security';

const data = safeJsonParse<MyType>(jsonString, defaultValue);
```

### 加密安全的隨機 ID
```typescript
import { generateSecureId, generateUuid } from './utils/security';

const id = generateSecureId(16);  // 16 字符隨機 ID
const uuid = generateUuid();       // UUID v4
```

### 路徑驗證（防止路徑遍歷）
```typescript
import { validateFilePath } from './utils/security';

const result = validateFilePath(filePath, ['/allowed/dir']);
```

### HTML 清理
```typescript
import { sanitizeHtml } from './utils/security';

const cleanText = sanitizeHtml(htmlString);
```

### 使用注意事項
- 所有 JSON 解析應使用 `safeJsonParse` 而非 `JSON.parse`
- URL 應在傳遞給外部服務前使用 `validateUrl` 驗證
- 生成 ID 時使用 `generateSecureId` 而非 `Math.random()`

