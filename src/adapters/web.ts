import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { PlatformAdapter } from './base';
import { IncomingMessage } from '../core/types';
import path from 'path';

interface WebMessage {
  type: 'message' | 'config' | 'status';
  data: any;
}

interface ConnectedClient {
  ws: WebSocket;
  sessionId: string;
  userId: string;
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
    this.app.use(express.json());
    
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
        
        // 创建 WebSocket 服务器
        this.wss = new WebSocketServer({ server: this.server });
        
        this.wss.on('connection', (ws, req) => {
          this.handleConnection(ws, req);
        });

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
    const clientId = this.generateClientId();
    const userId = `web-${clientId}`;
    const sessionId = this.formatSessionId('web', userId);

    console.log(`[Web] Client connected: ${clientId}`);

    // 保存客户端
    this.clients.set(clientId, {
      ws,
      sessionId,
      userId,
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
      console.error(`[Web] Client error: ${clientId}`, error);
      this.clients.delete(clientId);
    });
  }

  /**
   * 处理客户端消息
   */
  private async handleMessage(clientId: string, data: any): Promise<void> {
    const client = this.clients.get(clientId);
    if (!client || !this.messageCallback) return;

    try {
      const message: WebMessage = JSON.parse(data.toString());

      switch (message.type) {
        case 'message':
          // 处理聊天消息
          await this.messageCallback({
            sessionId: client.sessionId,
            content: message.data.content,
            sender: {
              id: client.userId,
              name: message.data.name || `User-${clientId.slice(0, 4)}`,
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
      console.error('[Web] Failed to handle message:', e);
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
   * 生成客户端 ID
   */
  private generateClientId(): string {
    return Math.random().toString(36).substring(2, 10);
  }

  /**
   * 获取连接数
   */
  getClientCount(): number {
    return this.clients.size;
  }
}
