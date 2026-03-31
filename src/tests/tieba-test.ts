/**
 * 贴吧抓虾吧适配器快速测试
 */
import { TiebaAdapter } from '../adapters/tieba';

const TB_TOKEN = process.env.TB_TOKEN!;

async function main() {
  const adapter = new TiebaAdapter({
    token: TB_TOKEN,
    pollIntervalMs: 60000,
    heartbeatIntervalMs: 600000,
  });

  console.log('=== 1. Token 验证 + 帖子列表 ===');
  try {
    const threads = await adapter.getThreadList('hot');
    console.log(`✅ Token 有效，获取到 ${threads.length} 个热帖`);
    for (const t of threads.slice(0, 5)) {
      const abstract = t.abstract?.[0]?.text?.slice(0, 50) || '';
      console.log(`  [${t.id}] ${t.title} (${t.reply_num}回/${t.agree_num}赞) ${abstract}`);
    }
  } catch (e: any) {
    console.error(`❌ Token 验证失败: ${e.message}`);
    process.exit(1);
  }

  console.log('\n=== 2. 帖子详情 ===');
  try {
    const threads = await adapter.getThreadList('time');
    if (threads.length > 0 && threads[0].id) {
      const detail = await adapter.getThreadDetail(threads[0].id);
      const first = detail.first_floor;
      if (first) {
        const text = first.content?.map(c => c.text).join('') || '';
        console.log(`✅ 首楼: ${first.title}`);
        console.log(`   内容: ${text.slice(0, 100)}...`);
        console.log(`   ${first.agree?.agree_num || 0} 赞`);
      }
      const posts = detail.post_list || [];
      console.log(`   ${posts.length} 个楼层`);
      for (const p of posts.slice(0, 3)) {
        const pText = p.content?.map(c => c.text).join('') || '';
        console.log(`   - [id=${p.id}] ${pText.slice(0, 60)}... (${p.agree?.agree_num || 0}赞)`);
      }
    }
  } catch (e: any) {
    console.error(`❌ 帖子详情失败: ${e.message}`);
  }

  console.log('\n=== 3. 回复通知 ===');
  try {
    const replies = await adapter.getReplyMe();
    console.log(`✅ ${replies.length} 条回复通知`);
    for (const r of replies.slice(0, 3)) {
      console.log(`  - [thread=${r.thread_id}] ${r.content?.slice(0, 60)}`);
    }
  } catch (e: any) {
    console.error(`❌ 回复通知失败: ${e.message}`);
  }

  console.log('\n=== 4. 点赞测试 ===');
  try {
    const threads = await adapter.getThreadList('hot');
    if (threads.length > 0 && threads[0].id) {
      const ok = await adapter.agree(threads[0].id, 3);
      console.log(`${ok ? '✅' : '❌'} 点赞热帖 #1 (id=${threads[0].id}): ${ok ? '成功' : '失败'}`);
    }
  } catch (e: any) {
    console.error(`❌ 点赞失败: ${e.message}`);
  }

  console.log('\n=== 测试完成 ===');
  process.exit(0);
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
