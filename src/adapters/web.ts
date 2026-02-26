import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { PlatformAdapter } from './base';
import { IncomingMessage } from '../core/types';
import path from 'path';
import { generateSecureId, safeJsonParse } from '../utils/security';

interface WebMessage {
  type: 'message' | 'config' | 'status' | 'ping';
  data: any;
}

interface ConnectedClient {
  ws: WebSocket;
  sessionId: string;
  userId: string;
  lastActivity: number;
}

/**
 * Web 平台适配器
 * 
 * 功能：
 * - 提供 Web UI 界面
 * - WebSocket 实时通信
 * - REST API 接口
 */
export class WebAdapter extends PlatformAdapter {
  name = 'web';

  private port: number;
  private app: express.Application;
  private server: ReturnType<typeof createServer> | null = null;
  private wss: WebSocketServer | null = null;
  private messageCallback: ((msg: IncomingMessage) => Promise<void>) | null = null;
  private clients: Map<string, ConnectedClient> = new Map();
  private engine: any = null;

  // 安全配置
  private readonly MAX_MESSAGE_SIZE = 1024 * 1024; // 1MB
  private readonly CLIENT_TIMEOUT = 5 * 60 * 1000; // 5 分鐘無活動超時
  private readonly MAX_CLIENTS = 1000; // 最大客戶端連接數
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(config: {
    port?: number;
    staticDir?: string;
  } = {}) {
    super();
    this.port = config.port || 3000;
    this.app = express();
    this.setupRoutes(config.staticDir);
  }

  /**
   * 设置 Express 路由
   */
  private setupRoutes(staticDir?: string): void {
    this.app.use(express.json({ limit: '1mb' })); // 限制 JSON 請求大小

    // 安全標頭
    this.app.use((req, res, next) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('X-XSS-Protection', '1; mode=block');
      next();
    });

    // 静态文件
    const webDir = staticDir || path.join(__dirname, '../webui');
    this.app.use(express.static(webDir));

    // API 路由
    this.app.get('/api/status', (req, res) => {
      res.json({
        status: 'ok',
        clients: this.clients.size,
        engine: this.engine?.getStatus() || null,
      });
    });

    this.app.get('/api/agents', (req, res) => {
      if (!this.engine) {
        res.json({ agents: [] });
        return;
      }
      const status = this.engine.getStatus();
      res.json({ agents: status.agents || [] });
    });

    // 配置 API
    this.app.get('/api/config', (req, res) => {
      if (!this.engine) {
        res.json({ error: 'Engine not initialized' });
        return;
      }
      const config = this.engine.getConfig?.() || {};
      // 隐藏敏感信息
      const safeConfig = this.sanitizeConfig(config);
      res.json(safeConfig);
    });

    this.app.post('/api/config', (req, res) => {
      if (!this.engine) {
        res.json({ error: 'Engine not initialized' });
        return;
      }
      
      try {
        this.engine.updateConfig?.(req.body);
        res.json({ success: true });
      } catch (e: any) {
        res.json({ error: e.message });
      }
    });

    this.app.post('/api/config/llm', (req, res) => {
      if (!this.engine) {
        res.json({ error: 'Engine not initialized' });
        return;
      }
      
      try {
        this.engine.updateLLMConfig?.(req.body);
        res.json({ success: true });
      } catch (e: any) {
        res.json({ error: e.message });
      }
    });

    // 获取预设模型列表
    this.app.get('/api/models/presets', (req, res) => {
      const presets = [
        { id: 'deepseek-chat', name: 'DeepSeek Chat', provider: 'deepseek' },
        { id: 'deepseek-reasoner', name: 'DeepSeek R1', provider: 'deepseek' },
        { id: 'moonshot-v1-8k', name: 'Kimi 8K', provider: 'moonshot' },
        { id: 'moonshot-v1-32k', name: 'Kimi 32K', provider: 'moonshot' },
        { id: 'moonshot-v1-128k', name: 'Kimi 128K', provider: 'moonshot' },
        { id: 'glm-4', name: 'GLM-4', provider: 'zhipu' },
        { id: 'glm-4-flash', name: 'GLM-4 Flash', provider: 'zhipu' },
        { id: 'qwen-turbo', name: '通义千问 Turbo', provider: 'alibaba' },
        { id: 'qwen-plus', name: '通义千问 Plus', provider: 'alibaba' },
        { id: 'qwen-max', name: '通义千问 Max', provider: 'alibaba' },
        { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai' },
        { id: 'claude-3-5-sonnet', name: 'Claude 3.5 Sonnet', provider: 'anthropic' },
      ];
      res.json({ presets });
    });

    // SPA 回退
    this.app.get('*', (req, res) => {
      res.sendFile(path.join(webDir, 'index.html'));
    });
  }

  /**
   * 设置引擎引用（用于获取状态）
   */
  setEngine(engine: any): void {
    this.engine = engine;
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        // 创建 HTTP 服务器
        this.server = createServer(this.app);

        // 创建 WebSocket 服务器（添加大小限制）
        this.wss = new WebSocketServer({
          server: this.server,
          maxPayload: this.MAX_MESSAGE_SIZE, // 限制消息大小
        });

        this.wss.on('connection', (ws, req) => {
          this.handleConnection(ws, req);
        });

        // 啟動清理定時器
        this.startCleanupTimer();

        this.server.listen(this.port, () => {
          console.log(`[Web] Server started at http://localhost:${this.port}`);
          resolve();
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      // 停止清理定時器
      if (this.cleanupInterval) {
        clearInterval(this.cleanupInterval);
        this.cleanupInterval = null;
      }

      // 关闭所有客户端连接
      for (const [id, client] of this.clients) {
        client.ws.close();
      }
      this.clients.clear();

      // 关闭 WebSocket 服务器
      if (this.wss) {
        this.wss.close();
        this.wss = null;
      }

      // 关闭 HTTP 服务器
      if (this.server) {
        this.server.close(() => {
          console.log('[Web] Server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * 处理 WebSocket 连接
   */
  private handleConnection(ws: WebSocket, req: any): void {
    // 檢查最大連接數
    if (this.clients.size >= this.MAX_CLIENTS) {
      console.warn('[Web] Maximum clients reached, rejecting connection');
      ws.close(1013, 'Server busy');
      return;
    }

    // 使用加密安全的隨機 ID
    const clientId = generateSecureId(16);
    const userId = `web-${clientId}`;
    const sessionId = this.formatSessionId('web', userId);

    console.log(`[Web] Client connected: ${clientId}`);

    // 保存客户端
    this.clients.set(clientId, {
      ws,
      sessionId,
      userId,
      lastActivity: Date.now(),
    });

    // 发送欢迎消息
    this.sendToClient(ws, {
      type: 'status',
      data: {
        connected: true,
        clientId,
        sessionId,
      },
    });

    // 处理消息
    ws.on('message', (data) => {
      this.handleMessage(clientId, data);
    });

    // 处理断开
    ws.on('close', () => {
      console.log(`[Web] Client disconnected: ${clientId}`);
      this.clients.delete(clientId);
    });

    // 处理错误
    ws.on('error', (error) => {
      console.error(`[Web] Client error: ${clientId}`, error.message);
      this.clients.delete(clientId);
    });
  }

  /**
   * 处理客户端消息
   */
  private async handleMessage(clientId: string, data: any): Promise<void> {
    const client = this.clients.get(clientId);
    if (!client || !this.messageCallback) return;

    // 更新活動時間
    client.lastActivity = Date.now();

    try {
      // 使用安全的 JSON 解析
      const parsed = safeJsonParse<Partial<WebMessage> | null>(
        data.toString(),
        null
      );

      if (!parsed || !parsed.type) {
        console.warn(`[Web] Invalid JSON from client ${clientId}`);
        return;
      }

      const message = parsed as WebMessage;

      // 驗證消息類型
      if (!['message', 'config', 'status', 'ping'].includes(message.type)) {
        console.warn(`[Web] Unknown message type from client ${clientId}: ${message.type}`);
        return;
      }

      // 處理 ping 心跳
      if (message.type === 'ping') {
        this.sendToClient(client.ws, { type: 'status', data: { pong: true } });
        return;
      }

      switch (message.type) {
        case 'message':
          // 驗證消息內容
          if (!message.data || typeof message.data.content !== 'string') {
            console.warn(`[Web] Invalid message content from client ${clientId}`);
            return;
          }

          // 限制消息長度
          const maxContentLength = 10000;
          const content = message.data.content.slice(0, maxContentLength);

          // 处理聊天消息
          await this.messageCallback({
            sessionId: client.sessionId,
            content,
            sender: {
              id: client.userId,
              name: (typeof message.data.name === 'string' ? message.data.name.slice(0, 50) : `User-${clientId.slice(0, 4)}`),
              isBot: false,
            },
            metadata: {
              clientId,
            },
          });
          break;

        case 'config':
          // 处理配置更新
          console.log(`[Web] Config update from ${clientId}`);
          break;
      }
    } catch (e) {
      console.error('[Web] Failed to handle message:', (e as Error).message);
    }
  }

  async sendMessage(sessionId: string, message: string, options?: any): Promise<void> {
    // 找到对应的客户端
    const userId = sessionId.split(':').pop();
    let targetClient: ConnectedClient | null = null;

    for (const client of this.clients.values()) {
      if (client.sessionId === sessionId || client.userId === userId) {
        targetClient = client;
        break;
      }
    }

    if (targetClient) {
      this.sendToClient(targetClient.ws, {
        type: 'message',
        data: {
          content: message,
          agent: options?.agentId,
          timestamp: Date.now(),
        },
      });
    }
  }

  onMessage(callback: (msg: IncomingMessage) => Promise<void>): void {
    this.messageCallback = callback;
  }

  /**
   * 发送消息到客户端
   */
  private sendToClient(ws: WebSocket, message: WebMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  /**
   * 广播消息到所有客户端
   */
  broadcast(message: WebMessage): void {
    for (const client of this.clients.values()) {
      this.sendToClient(client.ws, message);
    }
  }

  /**
   * 启动清理定时器（清理超时客户端）
   */
  private startCleanupTimer(): void {
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [id, client] of this.clients) {
        if (now - client.lastActivity > this.CLIENT_TIMEOUT) {
          console.log(`[Web] Client timeout: ${id}`);
          client.ws.close(1001, 'Timeout');
          this.clients.delete(id);
        }
      }
    }, 60000); // 每分鐘檢查一次
  }

  /**
   * 获取连接数
   */
  getClientCount(): number {
    return this.clients.size;
  }

  /**
   * 清理配置中的敏感信息
   */
  private sanitizeConfig(config: any): any {
    const safe = { ...config };
    
    if (safe.llm) {
      safe.llm = { ...safe.llm };
      if (safe.llm.apiKey) {
        safe.llm.apiKey = '***' + safe.llm.apiKey.slice(-4);
      }
    }
    
    if (safe.adapters) {
      safe.adapters = safe.adapters.map((adapter: any) => {
        const a = { ...adapter };
        if (a.config) {
          a.config = { ...a.config };
          if (a.config.token) a.config.token = '***';
          if (a.config.apiKey) a.config.apiKey = '***';
          if (a.config.secret) a.config.secret = '***';
        }
        return a;
      });
    }
    
    return safe;
  }
}
