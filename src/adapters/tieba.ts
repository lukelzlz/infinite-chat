import { PlatformAdapter } from './base';
import { IncomingMessage } from '../core/types';

/**
 * 百度贴吧（抓虾吧）适配器
 *
 * 支持功能：
 * - 接收回复通知（轮询 /mo/q/claw/replyme）
 * - 发帖 / 评论 / 点赞
 * - 定时心跳自动互动
 *
 * 配置示例 (config.yaml):
 *   adapters:
 *     - type: tieba
 *       enabled: true
 *       config:
 *         token: ${TB_TOKEN}
 *         heartbeatIntervalMs: 14400000  # 4小时
 */

/** 贴吧 API 响应格式 */
interface TiebaResponse<T = any> {
  errno: number;
  errmsg: string;
  data?: T;
}

/** 回复通知项 */
interface ReplyItem {
  post_id: string;
  thread_id: string;
  content: string;
  quote_content?: string;
  unread: number;
  author?: {
    id: string;
    name: string;
  };
  create_time?: number;
}

/** 帖子列表项 */
interface ThreadItem {
  thread_id: string;
  title: string;
  content: string;
  author?: {
    id: string;
    name: string;
    is_bot?: boolean;
  };
  reply_num?: number;
  agree_num?: number;
  create_time?: number;
  tab_id?: string;
  tab_name?: string;
}

/** 帖子详情中的楼层 */
interface PostFloor {
  post_id: string;
  thread_id: string;
  content: string;
  author?: {
    id: string;
    name: string;
    is_bot?: boolean;
  };
  agree_num?: number;
  create_time?: number;
}

/** 适配器配置 */
export interface TiebaAdapterConfig {
  /** TB_TOKEN 认证密钥 */
  token: string;
  /** 心跳间隔（毫秒），默认 4 小时 */
  heartbeatIntervalMs?: number;
  /** 轮询回复间隔（毫秒），默认 5 分钟 */
  pollIntervalMs?: number;
}

export class TiebaAdapter extends PlatformAdapter {
  name = 'tieba';

  private token: string;
  private baseUrl = 'https://tieba.baidu.com';
  private heartbeatIntervalMs: number;
  private pollIntervalMs: number;

  private messageCallback: ((msg: IncomingMessage) => Promise<void>) | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor(config: TiebaAdapterConfig) {
    super();
    this.token = config.token;
    this.heartbeatIntervalMs = config.heartbeatIntervalMs || 4 * 60 * 60 * 1000; // 4h
    this.pollIntervalMs = config.pollIntervalMs || 5 * 60 * 1000; // 5min
  }

  async start(): Promise<void> {
    console.log(`[Tieba] Starting adapter, polling every ${this.pollIntervalMs / 1000}s`);

    // 验证 token 有效性
    try {
      const res = await this.apiGet('/mo/q/claw/replyme', { pn: '1' });
      if (res.errno !== 0) {
        console.warn(`[Tieba] Token validation warning: errno=${res.errno} msg=${res.errmsg}`);
      } else {
        console.log('[Tieba] Token validated OK');
      }
    } catch (e) {
      console.error('[Tieba] Token validation failed:', (e as Error).message);
    }

    // 启动回复轮询
    this.startPolling();

    // 启动心跳
    this.startHeartbeat();

    console.log('[Tieba] Adapter started');
  }

  async stop(): Promise<void> {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    console.log('[Tieba] Adapter stopped');
  }

  async sendMessage(sessionId: string, message: string, options?: {
    thread_id?: string;
    post_id?: string;
    title?: string;
    tab_id?: string;
  }): Promise<void> {
    if (options?.title) {
      // 发帖
      await this.createThread(options.title, message, options.tab_id);
    } else if (options?.post_id) {
      // 回复楼层
      await this.replyToPost(message, options.post_id);
    } else if (options?.thread_id) {
      // 回复主帖
      await this.replyToThread(message, options.thread_id);
    } else {
      // 默认：发帖到广场
      await this.createThread('消息', message, '0');
    }
  }

  onMessage(callback: (msg: IncomingMessage) => Promise<void>): void {
    this.messageCallback = callback;
  }

  // ============ API 方法 ============

  /** 获取回复我的消息 */
  async getReplyMe(page = 1): Promise<ReplyItem[]> {
    const res = await this.apiGet<TiebaResponse<{ reply_list: ReplyItem[] }>>(
      '/mo/q/claw/replyme',
      { pn: String(page) }
    );
    return res.data?.reply_list || [];
  }

  /** 获取帖子列表 */
  async getThreadList(sortType: 'time' | 'hot' = 'time'): Promise<ThreadItem[]> {
    const res = await this.apiGet<TiebaResponse<{ thread_list: ThreadItem[] }>>(
      '/c/f/frs/page_claw',
      { sort_type: sortType === 'time' ? '0' : '3' }
    );
    return res.data?.thread_list || [];
  }

  /** 获取帖子详情 */
  async getThreadDetail(threadId: string, page = 1, order: 'asc' | 'desc' | 'hot' = 'asc'): Promise<{
    thread: any;
    post_list: PostFloor[];
  }> {
    const orderMap = { asc: '0', desc: '1', hot: '2' };
    const res = await this.apiGet<TiebaResponse>(`/c/f/pb/page_claw`, {
      pn: String(page),
      kz: threadId,
      r: orderMap[order],
    });
    return {
      thread: res.data?.thread || res.data,
      post_list: res.data?.post_list || [],
    };
  }

  /** 获取楼层详情（楼中楼） */
  async getFloorDetail(postId: string, threadId: string): Promise<any> {
    const res = await this.apiGet('/c/f/pb/nestedFloor_claw', {
      post_id: postId,
      thread_id: threadId,
    });
    return res.data;
  }

  /** 发帖 */
  async createThread(title: string, content: string, tabId = '0'): Promise<{ thread_id: string; post_id: string }> {
    const res = await this.apiPost<TiebaResponse<{ thread_id: string; post_id: string }>>(
      '/c/c/claw/addThread',
      {
        title,
        content: [{ type: 'text', content }],
        tab_id: Number(tabId) || 0,
      }
    );

    if (res.errno !== 0) {
      throw new Error(`发帖失败: ${res.errmsg} (errno=${res.errno})`);
    }

    console.log(`[Tieba] 帖子发布成功: https://tieba.baidu.com/p/${res.data!.thread_id}`);
    return res.data!;
  }

  /** 回复主帖 */
  async replyToThread(content: string, threadId: string): Promise<{ thread_id: string; post_id: string }> {
    const res = await this.apiPost<TiebaResponse<{ thread_id: string; post_id: string }>>(
      '/c/c/claw/addPost',
      { content, thread_id: Number(threadId) }
    );

    if (res.errno !== 0) {
      throw new Error(`回复失败: ${res.errmsg} (errno=${res.errno})`);
    }

    console.log(`[Tieba] 回复成功: https://tieba.baidu.com/p/${res.data!.thread_id}?pid=${res.data!.post_id}`);
    return res.data!;
  }

  /** 回复楼层（楼中楼） */
  async replyToPost(content: string, postId: string): Promise<{ thread_id: string; post_id: string }> {
    const res = await this.apiPost<TiebaResponse<{ thread_id: string; post_id: string }>>(
      '/c/c/claw/addPost',
      { content, post_id: Number(postId) }
    );

    if (res.errno !== 0) {
      throw new Error(`回复楼层失败: ${res.errmsg} (errno=${res.errno})`);
    }

    console.log(`[Tieba] 楼层回复成功: post_id=${res.data!.post_id}`);
    return res.data!;
  }

  /** 点赞 */
  async agree(threadId: string, objType: 1 | 2 | 3, postId?: string, undo = false): Promise<void> {
    const body: Record<string, any> = {
      thread_id: Number(threadId),
      obj_type: objType,  // 1=楼层, 2=楼中楼, 3=主帖
      op_type: undo ? 1 : 0,  // 0=点赞, 1=取消
    };
    if (postId) body.post_id = Number(postId);

    const res = await this.apiPost<TiebaResponse>('/c/c/claw/opAgree', body);

    if (res.errno !== 0) {
      console.warn(`[Tieba] 点赞失败: ${res.errmsg}`);
    } else {
      console.log(`[Tieba] 点赞成功: thread=${threadId} post=${postId || '-'} type=${objType}`);
    }
  }

  /** 删除帖子 */
  async deleteThread(threadId: string): Promise<void> {
    const res = await this.apiPost<TiebaResponse>('/c/c/claw/delThread', {
      thread_id: Number(threadId),
    });
    if (res.errno !== 0) {
      throw new Error(`删帖失败: ${res.errmsg}`);
    }
  }

  /** 删除评论 */
  async deletePost(postId: string): Promise<void> {
    const res = await this.apiPost<TiebaResponse>('/c/c/claw/delPost', {
      post_id: Number(postId),
    });
    if (res.errno !== 0) {
      throw new Error(`删评失败: ${res.errmsg}`);
    }
  }

  // ============ 内部方法 ============

  /** GET 请求 */
  private async apiGet<T = any>(path: string, params: Record<string, string> = {}): Promise<T> {
    const url = new URL(path, this.baseUrl);
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }

    const res = await fetch(url.toString(), {
      headers: {
        'Authorization': this.token,
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      },
    });

    if (!res.ok) {
      throw new Error(`Tieba API GET ${path} failed: HTTP ${res.status}`);
    }

    return res.json() as Promise<T>;
  }

  /** POST 请求 */
  private async apiPost<T = any>(path: string, body: Record<string, any>): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Authorization': this.token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`Tieba API POST ${path} failed: HTTP ${res.status}`);
    }

    return res.json() as Promise<T>;
  }

  /** 启动回复轮询 */
  private startPolling(): void {
    this.pollTimer = setInterval(async () => {
      try {
        await this.pollReplies();
      } catch (e) {
        console.error('[Tieba] Poll error:', (e as Error).message);
      }
    }, this.pollIntervalMs);

    // 启动时立即执行一次
    this.pollReplies().catch(e => {
      console.error('[Tieba] Initial poll error:', (e as Error).message);
    });
  }

  /** 轮询回复 */
  private async pollReplies(): Promise<void> {
    const replies = await this.getReplyMe();
    const unread = replies.filter(r => r.unread === 1);

    if (unread.length === 0) return;

    console.log(`[Tieba] ${unread.length} unread replies`);

    for (const reply of unread) {
      if (!this.messageCallback) break;

      const msg: IncomingMessage = {
        sessionId: this.formatSessionId('tieba', reply.author?.id || 'unknown'),
        content: reply.content,
        sender: {
          id: reply.author?.id || '',
          name: reply.author?.name || 'unknown',
          isBot: true,
        },
        replyTo: reply.post_id,
        metadata: {
          threadId: reply.thread_id,
          postId: reply.post_id,
          quoteContent: reply.quote_content,
          platform: 'tieba',
        },
      };

      try {
        await this.messageCallback(msg);
      } catch (e) {
        console.error(`[Tieba] Reply callback error for ${reply.post_id}:`, (e as Error).message);
      }
    }
  }

  /** 启动心跳 */
  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(async () => {
      try {
        await this.runHeartbeat();
      } catch (e) {
        console.error('[Tieba] Heartbeat error:', (e as Error).message);
      }
    }, this.heartbeatIntervalMs);

    console.log(`[Tieba] Heartbeat every ${this.heartbeatIntervalMs / 1000}s`);
  }

  /**
   * 心跳流程：
   * 1. 检查未读回复 → 交给 messageCallback（engine 处理回复）
   * 2. 浏览帖子列表 → 点赞 + 评论
   * 3. 发布新帖（可选）
   */
  private async runHeartbeat(): Promise<void> {
    console.log('[Tieba] Heartbeat start');

    // 1. 处理未读回复
    await this.pollReplies();

    // 2. 浏览帖子列表并互动
    const threads = await this.getThreadList('hot');
    let liked = 0;
    let commented = 0;

    for (const thread of threads.slice(0, 5)) {
      try {
        // 点赞主帖
        if (thread.thread_id) {
          await this.agree(thread.thread_id, 3);
          liked++;
        }

        // 浏览详情，给好的楼层点赞
        if (thread.thread_id && liked < 3) {
          const detail = await this.getThreadDetail(thread.thread_id);
          for (const floor of (detail.post_list || []).slice(0, 3)) {
            if (floor.agree_num && floor.agree_num > 0) {
              await this.agree(thread.thread_id, 1, floor.post_id);
              liked++;
              if (liked >= 3) break;
            }
          }
        }
      } catch (e) {
        // 继续处理下一个帖子
      }
    }

    console.log(`[Tieba] Heartbeat done: liked=${liked} commented=${commented}`);
  }

  /** 更新 token（用于 token 刷新） */
  updateToken(newToken: string): void {
    this.token = newToken;
    console.log('[Tieba] Token updated');
  }
}
