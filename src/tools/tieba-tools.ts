/**
 * 贴吧工具注册
 * 从 index.ts 提取的 tieba 工具定义和注册逻辑
 */

export interface TiebaToolDeps {
  token: string;
}

/** 请求节流：最小间隔 */
const MIN_REQUEST_INTERVAL_MS = 3000; // 3秒
let lastRequestAt = 0;

async function throttle(): Promise<void> {
  const now = Date.now();
  const wait = lastRequestAt + MIN_REQUEST_INTERVAL_MS - now;
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastRequestAt = Date.now();
}

/** API 请求封装（带重试 + 节流 + 429 处理） */
async function tiebaFetch(url: string, options: RequestInit, retries = 2): Promise<Response> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    await throttle();
    try {
      const res = await fetch(url, options);
      if (res.status === 429) {
        // 解析 retry_after：API 可能返回秒数（如 10）或毫秒
        const body = await res.json().catch(() => ({})) as any;
        let waitSec = Number(body?.retry_after_seconds || body?.retry_after || 10);
        // 防御：如果值 > 300（5分钟），大概率是毫秒或异常值，兜底 15s
        if (isNaN(waitSec) || waitSec <= 0) waitSec = 10;
        if (waitSec > 300) waitSec = 15;
        console.warn(`[Tieba] 429 限频，等待 ${waitSec}s...`);
        await new Promise(r => setTimeout(r, waitSec * 1000));
        continue;
      }
      return res;
    } catch (e) {
      if (attempt === retries) throw e;
      console.warn(`[Tieba] 请求失败，重试 ${attempt + 1}/${retries}...`);
      await new Promise(r => setTimeout(r, 3000));
    }
  }
  throw new Error('unreachable');
}

/** 从内容数组中提取文本 */
function extractText(content?: Array<{ type: number | string; text: string }>): string {
  if (!content || !Array.isArray(content)) return '';
  return content.map(c => c.text || '').join('');
}

/** 已点赞帖子缓存（防止重复点赞） */
const likedThreads = new Set<number>();

export function registerTiebaTools(engine: any, token: string): void {
  const headers = { 'Authorization': token };
  const baseUrl = 'https://tieba.baidu.com';

  engine.registerTool({
    name: 'tieba_browse',
    description: '浏览贴吧帖子列表。返回最新的帖子标题、内容摘要、回复数、点赞数。',
    parameters: {
      type: 'object',
      properties: {
        sort: { type: 'string', description: '排序方式：0=最新, 1=最热', enum: ['0', '1'] },
      },
      required: [],
    },
  }, async (args: any) => {
    const sort = args.sort || '0';
    const res = await tiebaFetch(`${baseUrl}/c/f/frs/page_claw?sort_type=${sort}`, { headers });
    const data = await res.json() as any;
    const threads = data?.data?.thread_list || [];
    return threads.slice(0, 8).map((t: any) => {
      const abstract = extractText(t.abstract).slice(0, 150);
      return `[id:${t.id}] 「${t.title}」 回复:${t.reply_num || 0} 赞:${t.agree_num || 0}\n  ${abstract}`;
    }).join('\n\n') || '暂无帖子';
  });

  engine.registerTool({
    name: 'tieba_comment',
    description: '在帖子上发表评论。需要帖子ID和评论内容。每次心跳最多评论2条。',
    parameters: {
      type: 'object',
      properties: {
        thread_id: { type: 'number', description: '帖子ID' },
        content: { type: 'string', description: '评论内容（50字以内，不用emoji，可以用颜文字）' },
      },
      required: ['thread_id', 'content'],
    },
  }, async (args: any) => {
    const res = await tiebaFetch(`${baseUrl}/c/c/claw/addPost`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ content: args.content, thread_id: args.thread_id }),
    }, 1);
    const data = await res.json() as any;
    if (data.errno === 0) return `评论成功！post_id=${data.data?.post_id}`;
    return `评论失败: ${data.errmsg || data.error_msg || JSON.stringify(data)}`;
  });

  engine.registerTool({
    name: 'tieba_like',
    description: '给帖子点赞。每个帖子只能赞一次。',
    parameters: {
      type: 'object',
      properties: {
        thread_id: { type: 'number', description: '帖子ID' },
      },
      required: ['thread_id'],
    },
  }, async (args: any) => {
    if (likedThreads.has(args.thread_id)) {
      return '已经赞过了，跳过';
    }
    const res = await tiebaFetch(`${baseUrl}/c/c/claw/opAgree`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ thread_id: args.thread_id, obj_type: 3 }),
    }, 1);
    const data = await res.json() as any;
    if (data.errno === 0) {
      likedThreads.add(args.thread_id);
      return '点赞成功！';
    }
    return `点赞失败: ${data.errmsg}`;
  });

  engine.registerTool({
    name: 'tieba_post',
    description: '发布新帖子。有60秒冷却时间。每次心跳最多发1帖。',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '帖子标题（30字以内）' },
        content: { type: 'string', description: '帖子内容（100-200字，不用emoji，可以用颜文字）' },
      },
      required: ['title', 'content'],
    },
  }, async (args: any) => {
    const res = await tiebaFetch(`${baseUrl}/c/c/claw/addThread`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({
        title: args.title,
        content: [{ type: 'text', text: args.content }],
      }),
    }, 1);
    const data = await res.json() as any;
    if (data.errno === 0) return `发帖成功！thread_id=${data.data?.thread_id}`;
    return `发帖失败: ${data.errmsg || JSON.stringify(data)}`;
  });

  engine.registerTool({
    name: 'tieba_check_replies',
    description: '检查有没有人回复你的帖子或评论。',
    parameters: { type: 'object', properties: {}, required: [] },
  }, async () => {
    const res = await tiebaFetch(`${baseUrl}/mo/q/claw/replyme?pn=1`, { headers });
    const data = await res.json() as any;
    const replies = data?.data?.reply_list || [];
    if (replies.length === 0) return '暂无新回复';
    return replies.slice(0, 5).map((r: any) =>
      `[thread:${r.thread_id}] 「${(r.content || '').slice(0, 60)}」`
    ).join('\n');
  });

  engine.registerTool({
    name: 'tieba_read_thread',
    description: '读取帖子完整内容。',
    parameters: {
      type: 'object',
      properties: { thread_id: { type: 'number', description: '帖子ID' } },
      required: ['thread_id'],
    },
  }, async (args: any) => {
    // 直接调详情 API，不再先拉列表
    let title = '';
    let body = '';
    try {
      const detailRes = await tiebaFetch(
        `${baseUrl}/c/f/pb/page_claw?pn=1&kz=${args.thread_id}&r=0`,
        { headers },
      );
      const detailData = await detailRes.json() as any;
      if (detailData?.first_floor) {
        title = detailData.first_floor.title || '';
        body = extractText(detailData.first_floor.content);
      }
    } catch {
      // 详情 API 失败，回退到列表查摘要
      try {
        const listRes = await tiebaFetch(`${baseUrl}/c/f/frs/page_claw?sort_type=0`, { headers });
        const listData = await listRes.json() as any;
        const thread = (listData?.data?.thread_list || []).find((t: any) => t.id === args.thread_id);
        title = thread?.title || '';
        body = extractText(thread?.abstract);
      } catch {
        // 都失败
      }
    }

    if (!body) return '未找到该帖子内容';
    return `「${title}」\n${body.slice(0, 800)}`;
  });
}
