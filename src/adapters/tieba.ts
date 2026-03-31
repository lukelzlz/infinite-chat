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

/** 帖子列表项（实际 API 返回格式） */
interface ThreadItem {
  id: number;           // thread_id
  title: string;
  reply_num: number;
  view_num: number;
  agree_num: number;
  author?: {
    name: string;
  };
  abstract?: Array<{ text: string }>;
}

/** 帖子详情中的楼层 */
interface PostFloor {
  id: number;           // post_id
  content: Array<{ type: number; text: string }>;
  agree?: {
    agree_num: number;
    has_agree: number;
  };
  sub_post_list?: {
    sub_post_list: Array<{
      id: number;
      content: Array<{ type: number; text: string }>;
    }>;
  };
}

/** 帖子详情响应 */
interface ThreadDetail {
  error_code: number;
  page?: {
    current_page: number;
    total_page: number;
    has_more: number;
  };
  first_floor?: {
    id: number;
    title: string;
    content: Array<{ type: number; text: string }>;
    agree?: { agree_num: number; disagree_num: number };
  };
  post_list?: PostFloor[];
}

/** 回复通知项 */
interface ReplyItem {
  thread_id: number;
  post_id: number;
  title?: string;
  content: string;
  quote_content?: string;
  unread: number;
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
    this.heartbeatIntervalMs = config.heartbeatIntervalMs || 4 * 60 * 60 * 1000;
    this.pollIntervalMs = config.pollIntervalMs || 5 * 60 * 1000;
  }

  async start(): Promise<void> {
    console.log(`[Tieba] Starting adapter, polling every ${this.pollIntervalMs / 1000}s`);

    // 验证 token
    try {
      const threads = await this.getThreadList('time');
      console.log(`[Tieba] Token validated OK, ${threads.length} threads fetched`);
    } catch (e) {
      console.error('[Tieba] Token validation failed:', (e as Error).message);
    }

    this.startPolling();
    this.startHeartbeat();
    console.log('[Tieba] Adapter started');
  }

  async stop(): Promise<void> {
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
    console.log('[Tieba] Adapter stopped');
  }

  async sendMessage(sessionId: string, message: string, options?: {
    thread_id?: number;
    post_id?: number;
    title?: string;
    tab_id?: number;
  }): Promise<void> {
    if (options?.title) {
      await this.createThread(options.title, message, options.tab_id);
    } else if (options?.post_id) {
      await this.replyToPost(message, options.post_id);
    } else if (options?.thread_id) {
      await this.replyToThread(message, options.thread_id);
    } else {
      await this.createThread('消息', message);
    }
  }

  onMessage(callback: (msg: IncomingMessage) => Promise<void>): void {
    this.messageCallback = callback;
  }

  // ============ API 方法 ============

  /** 获取回复我的消息 */
  async getReplyMe(page = 1): Promise<ReplyItem[]> {
    const data = await this.apiGet('/mo/q/claw/replyme', { pn: String(page) });
    return data?.data?.reply_list || [];
  }

  /** 获取帖子列表 */
  async getThreadList(sortType: 'time' | 'hot' = 'time'): Promise<ThreadItem[]> {
    const data = await this.apiGet('/c/f/frs/page_claw', {
      sort_type: sortType === 'time' ? '0' : '3',
    });
    return data?.data?.thread_list || [];
  }

  /** 获取帖子详情 */
  async getThreadDetail(threadId: number, page = 1, order: 'asc' | 'desc' | 'hot' = 'asc'): Promise<ThreadDetail> {
    const orderMap = { asc: '0', desc: '1', hot: '2' };
    return this.apiGet('/c/f/pb/page_claw', {
      pn: String(page),
      kz: String(threadId),
      r: orderMap[order],
    });
  }

  /** 获取楼层详情（楼中楼） */
  async getFloorDetail(postId: number, threadId: number): Promise<any> {
    return this.apiGet('/c/f/pb/nestedFloor_claw', {
      post_id: String(postId),
      thread_id: String(threadId),
    });
  }

  /** 发帖 */
  async createThread(title: string, content: string, tabId?: number): Promise<{ thread_id: number; post_id: number }> {
    const body: Record<string, any> = {
      title,
      content: [{ type: 'text', content }],
    };
    if (tabId) {
      body.tab_id = tabId;
    }

    const data = await this.apiPost('/c/c/claw/addThread', body);
    if (data.errno !== 0 && data.error_code !== 0) {
      throw new Error(`发帖失败: ${data.errmsg || data.error_msg || 'unknown'} (errno=${data.errno})`);
    }

    const result = data.data || {};
    console.log(`[Tieba] 帖子发布成功: https://tieba.baidu.com/p/${result.thread_id}`);
    return result;
  }

  /** 回复主帖 */
  async replyToThread(content: string, threadId: number): Promise<{ thread_id: number; post_id: number }> {
    const data = await this.apiPost('/c/c/claw/addPost', { content, thread_id: threadId });
    if (data.errno !== 0 && data.error_code !== 0) {
      throw new Error(`回复失败: ${data.errmsg || data.error_msg || 'unknown'}`);
    }
    const result = data.data || {};
    console.log(`[Tieba] 回复成功: thread=${result.thread_id} post=${result.post_id}`);
    return result;
  }

  /** 回复楼层（楼中楼） */
  async replyToPost(content: string, postId: number): Promise<{ thread_id: number; post_id: number }> {
    const data = await this.apiPost('/c/c/claw/addPost', { content, post_id: postId });
    if (data.errno !== 0 && data.error_code !== 0) {
      throw new Error(`回复楼层失败: ${data.errmsg || data.error_msg || 'unknown'}`);
    }
    const result = data.data || {};
    console.log(`[Tieba] 楼层回复成功: post_id=${result.post_id}`);
    return result;
  }

  /** 点赞 */
  async agree(threadId: number, objType: 1 | 2 | 3, postId?: number, undo = false): Promise<boolean> {
    const body: Record<string, any> = {
      thread_id: threadId,
      obj_type: objType,
      op_type: undo ? 1 : 0,
    };
    if (postId) body.post_id = postId;

    const data = await this.apiPost('/c/c/claw/opAgree', body);
    const ok = (data.errno === 0 || data.error_code === 0);
    if (!ok) {
      console.warn(`[Tieba] 点赞失败: ${data.errmsg || data.error_msg}`);
    }
    return ok;
  }

  /** 删除帖子 */
  async deleteThread(threadId: number): Promise<void> {
    const data = await this.apiPost('/c/c/claw/delThread', { thread_id: threadId });
    if (data.errno !== 0 && data.error_code !== 0) {
      throw new Error(`删帖失败: ${data.errmsg || data.error_msg}`);
    }
  }

  /** 删除评论 */
  async deletePost(postId: number): Promise<void> {
    const data = await this.apiPost('/c/c/claw/delPost', { post_id: postId });
    if (data.errno !== 0 && data.error_code !== 0) {
      throw new Error(`删评失败: ${data.errmsg || data.error_msg}`);
    }
  }

  /** 修改昵称 */
  async modifyName(name: string): Promise<void> {
    const data = await this.apiPost('/c/c/claw/modifyName', { name });
    if (data.errno !== 0 && data.error_code !== 0) {
      throw new Error(`改名失败: ${data.errmsg || data.error_msg}`);
    }
    console.log(`[Tieba] 昵称修改成功: ${name}`);
  }

  /** 更新 token */
  updateToken(newToken: string): void {
    this.token = newToken;
    console.log('[Tieba] Token updated');
  }

  // ============ 内部方法 ============

  /** 从楼层内容数组中提取纯文本 */
  private extractText(content?: Array<{ type: number | string; text: string }>): string {
    if (!content || !Array.isArray(content)) return '';
    return content.map(c => c.text || '').join('');
  }

  /** GET 请求 */
  private async apiGet(path: string, params: Record<string, string> = {}): Promise<any> {
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
      if (res.status === 429) {
        const body = (await res.json().catch(() => ({}))) as Record<string, any>;
        const retryAfter = body.retry_after_seconds || 10;
        throw new Error(`Tieba API 限频: 请 ${retryAfter}s 后重试`);
      }
      throw new Error(`Tieba API GET ${path} failed: HTTP ${res.status}`);
    }

    return res.json();
  }

  /** POST 请求 */
  private async apiPost(path: string, body: Record<string, any>): Promise<any> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Authorization': this.token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      if (res.status === 429) {
        const rBody = (await res.json().catch(() => ({}))) as Record<string, any>;
        const retryAfter = rBody.retry_after_seconds || 10;
        throw new Error(`Tieba API 限频: 请 ${retryAfter}s 后重试`);
      }
      throw new Error(`Tieba API POST ${path} failed: HTTP ${res.status}`);
    }

    return res.json();
  }

  // ============ 轮询和心跳 ============

  private startPolling(): void {
    this.pollTimer = setInterval(async () => {
      try { await this.pollReplies(); }
      catch (e) { console.error('[Tieba] Poll error:', (e as Error).message); }
    }, this.pollIntervalMs);

    this.pollReplies().catch(e => {
      console.error('[Tieba] Initial poll error:', (e as Error).message);
    });
  }

  private async pollReplies(): Promise<void> {
    const replies = await this.getReplyMe();
    const unread = replies.filter(r => r.unread === 1);
    if (unread.length === 0) return;

    console.log(`[Tieba] ${unread.length} unread replies`);

    for (const reply of unread) {
      if (!this.messageCallback) break;

      const msg: IncomingMessage = {
        sessionId: `tieba:${reply.post_id}`,
        content: reply.content,
        sender: {
          id: '',
          name: 'tieba-user',
          isBot: true,
        },
        replyTo: String(reply.post_id),
        metadata: {
          threadId: reply.thread_id,
          postId: reply.post_id,
          title: reply.title,
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

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(async () => {
      try { await this.runHeartbeat(); }
      catch (e) { console.error('[Tieba] Heartbeat error:', (e as Error).message); }
    }, this.heartbeatIntervalMs);

    console.log(`[Tieba] Heartbeat every ${this.heartbeatIntervalMs / 1000}s`);
  }

  /**
   * 心跳流程：
   * 1. 检查未读回复 → 交给 messageCallback
   * 2. 浏览热帖 → 点赞互动
   */
  private async runHeartbeat(): Promise<void> {
    console.log('[Tieba] Heartbeat start');

    // 1. 处理未读回复
    await this.pollReplies();

    // 2. 浏览热帖并点赞
    const threads = await this.getThreadList('hot');
    let liked = 0;

    for (const thread of threads.slice(0, 5)) {
      try {
        // 点赞主帖
        if (thread.id && thread.agree_num >= 0) {
          const ok = await this.agree(thread.id, 3);
          if (ok) liked++;
        }

        // 浏览详情，给优质楼层点赞
        if (thread.id && liked < 5) {
          const detail = await this.getThreadDetail(thread.id);
          for (const floor of (detail.post_list || []).slice(0, 5)) {
            const agreeNum = floor.agree?.agree_num || 0;
            if (agreeNum > 5) {
              const ok = await this.agree(thread.id, 1, floor.id);
              if (ok) liked++;
              if (liked >= 5) break;
            }
          }
        }
      } catch (e) {
        // 继续处理下一个帖子
      }
    }

    console.log(`[Tieba] Heartbeat done: liked=${liked}`);
  }
}
