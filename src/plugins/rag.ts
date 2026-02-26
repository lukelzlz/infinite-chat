import { Plugin } from './types';
import { Session } from '../core/types';
import { getRAGService } from '../rag';

/**
 * RAG 文档管理插件
 * 
 * 命令：
 * - /rag upload <文件名> <内容> - 上传文档
 * - /rag import - 回复消息导入（回复某条消息，将其导入知识库）
 * - /rag list - 列出所有文档
 * - /rag search <关键词> - 搜索文档
 * - /rag delete <文档ID> - 删除文档
 * - /rag stats - 查看统计信息
 */
export class RAGPlugin implements Plugin {
  name = 'rag';
  priority = 50;
  description = 'RAG 文档管理和检索';

  shouldHandle(content: string, session: Session): boolean {
    return content.startsWith('/rag') || content === '/import';
  }

  async handle(content: string, session: Session): Promise<string | null> {
    const rag = getRAGService();
    
    // 简化命令: /import
    if (content === '/import') {
      return this.handleImport(session);
    }
    
    const args = content.slice(4).trim().split(/\s+/);
    const command = args[0]?.toLowerCase();

    try {
      switch (command) {
        case 'upload':
          return await this.handleUpload(args, rag);
        case 'import':
          return this.handleImport(session);
        case 'list':
        case 'ls':
          return await this.handleList(rag);
        case 'search':
        case 'find':
          return await this.handleSearch(args, rag);
        case 'delete':
        case 'rm':
          return await this.handleDelete(args, rag);
        case 'stats':
          return await this.handleStats(rag);
        default:
          return this.getHelp();
      }
    } catch (error) {
      console.error('[RAGPlugin] Error:', error);
      return `❌ 操作失败: ${error instanceof Error ? error.message : '未知错误'}`;
    }
  }

  /**
   * 导入当前消息或回复的消息
   */
  private handleImport(session: Session): string {
    // 检查是否有回复的消息
    const replyContent = session.metadata?.replyToContent;
    const originalContent = session.metadata?.originalContent;
    
    if (!replyContent && !originalContent) {
      return `💡 使用方法：
1. 回复一条消息，然后发送 /import
2. 或者直接发送: /rag import <内容>

示例: 回复一条长消息后，发送 /import 即可导入`;
    }

    // TODO: 这里需要适配器支持获取回复消息的内容
    // 目前先返回提示
    return `⚠️ 回复导入功能需要适配器支持获取原消息内容。

临时方案：直接复制消息内容，使用：
/rag upload 消息标题 <消息内容>`;
  }

  private async handleUpload(args: string[], rag: ReturnType<typeof getRAGService>): Promise<string> {
    // /rag upload filename.md <content...>
    if (args.length < 3) {
      return '用法: /rag upload <文件名> <内容>\n示例: /rag upload notes.md 这是我的笔记内容...';
    }

    const filename = args[1];
    const docContent = args.slice(2).join(' ');

    const doc = await rag.uploadDocument(docContent, filename);
    
    return `✅ 文档上传成功！

📄 文件名: ${doc.filename}
🆔 文档ID: ${doc.id}
📊 大小: ${doc.metadata.size} 字符
📦 分块数: ${doc.chunks.length}`;
  }

  private async handleList(rag: ReturnType<typeof getRAGService>): Promise<string> {
    const docs = await rag.listDocuments();

    if (docs.length === 0) {
      return '📭 知识库为空\n使用 /rag upload 上传文档';
    }

    const lines = docs.map(doc => {
      const time = new Date(doc.metadata.uploadedAt).toLocaleString('zh-CN');
      return `📄 ${doc.filename}
   ID: ${doc.id}
   大小: ${doc.metadata.size} 字符 | 分块: ${doc.chunks.length}
   上传时间: ${time}`;
    });

    return `📚 知识库文档 (${docs.length} 个)\n\n${lines.join('\n\n')}`;
  }

  private async handleSearch(args: string[], rag: ReturnType<typeof getRAGService>): Promise<string> {
    if (args.length < 2) {
      return '用法: /rag search <关键词>\n示例: /rag search 配置方法';
    }

    const query = args.slice(1).join(' ');
    const results = await rag.search(query, 5);

    if (results.length === 0) {
      return `🔍 没有找到与 "${query}" 相关的内容`;
    }

    const lines = results.map((r, i) => {
      const preview = r.content.length > 200 
        ? r.content.slice(0, 200) + '...' 
        : r.content;
      return `【${i + 1}】相关度: ${(r.score * 100).toFixed(1)}%
📄 来源: ${r.source}
${preview}`;
    });

    return `🔍 搜索结果: "${query}"\n\n${lines.join('\n\n---\n\n')}`;
  }

  private async handleDelete(args: string[], rag: ReturnType<typeof getRAGService>): Promise<string> {
    if (args.length < 2) {
      return '用法: /rag delete <文档ID>\n先用 /rag list 查看文档ID';
    }

    const docId = args[1];
    const success = await rag.deleteDocument(docId);

    if (success) {
      return `✅ 文档已删除: ${docId}`;
    } else {
      return `❌ 文档不存在: ${docId}`;
    }
  }

  private async handleStats(rag: ReturnType<typeof getRAGService>): Promise<string> {
    const stats = await rag.getStats();

    return `📊 知识库统计

📄 文档数: ${stats.documentCount}
📦 总分块数: ${stats.totalChunks}
📝 总字符数: ${stats.totalCharacters.toLocaleString()}`;
  }

  private getHelp(): string {
    return `📖 RAG 文档管理插件

命令列表:
/rag upload <文件名> <内容> - 上传文档
/rag import - 回复消息导入（开发中）
/rag list - 列出所有文档
/rag search <关键词> - 搜索文档
/rag delete <文档ID> - 删除文档
/rag stats - 查看统计信息

💡 提示:
- 直接发送 txt/md/json/csv 等文档文件，会自动导入
- 支持的格式: txt, md, json, csv, log, js, ts, py, go, rs 等
- 最大文件大小: 5MB`;
  }
}
