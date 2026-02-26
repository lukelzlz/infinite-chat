import { DocumentProcessor, SimpleVectorStore, Document } from './document';
import { Message } from '../core/types';
import { LLMProvider } from '../llm';

/**
 * RAG 服务配置
 */
export interface RAGServiceOptions {
  chunkSize?: number;
  chunkOverlap?: number;
  dataDir?: string;
}

/**
 * RAG 服务
 */
export class RAGService {
  private processor: DocumentProcessor;
  private store: SimpleVectorStore;
  private initialized = false;

  constructor(options: RAGServiceOptions = {}) {
    this.processor = new DocumentProcessor({
      chunkSize: options.chunkSize,
      chunkOverlap: options.chunkOverlap,
    });
    this.store = new SimpleVectorStore(options.dataDir);
  }

  /**
   * 初始化服务（加载持久化数据）
   */
  async init(): Promise<void> {
    if (this.initialized) return;
    await this.store.init();
    this.initialized = true;
    console.log('[RAG] Service initialized');
  }

  /**
   * 上传文档
   */
  async uploadDocument(content: string, filename: string): Promise<Document> {
    await this.init();
    const doc = await this.processor.processText(content, filename);
    await this.store.addDocument(doc);
    console.log(`[RAG] Document uploaded: ${filename} (${doc.chunks.length} chunks)`);
    return doc;
  }

  /**
   * 从文件上传
   */
  async uploadFile(filePath: string): Promise<Document> {
    await this.init();
    const doc = await this.processor.loadFile(filePath);
    await this.store.addDocument(doc);
    console.log(`[RAG] File uploaded: ${doc.filename}`);
    return doc;
  }

  /**
   * 删除文档
   */
  async deleteDocument(docId: string): Promise<boolean> {
    await this.init();
    return this.store.deleteDocument(docId);
  }

  /**
   * 列出文档
   */
  async listDocuments(): Promise<Document[]> {
    await this.init();
    return this.store.listDocuments();
  }

  /**
   * 搜索相关内容
   */
  async search(query: string, topK: number = 5): Promise<Array<{ content: string; source: string; score: number }>> {
    await this.init();
    const results = this.store.search(query, topK);
    
    return results.map(r => ({
      content: r.chunk.content,
      source: r.chunk.metadata.source,
      score: r.score,
    }));
  }

  /**
   * 同步搜索（用于引擎内部调用）
   */
  searchSync(query: string, topK: number = 5): Array<{ content: string; source: string; score: number }> {
    // 如果未初始化，返回空结果（避免阻塞）
    if (!this.initialized) {
      return [];
    }
    const results = this.store.search(query, topK);
    return results.map(r => ({
      content: r.chunk.content,
      source: r.chunk.metadata.source,
      score: r.score,
    }));
  }

  /**
   * 构建带上下文的 Prompt
   */
  async buildContextPrompt(query: string, topK: number = 5): Promise<string> {
    const results = await this.search(query, topK);
    
    if (results.length === 0) {
      return query;
    }

    const context = results
      .map((r, i) => `[${i + 1}] ${r.content}`)
      .join('\n\n');

    return `以下是与问题相关的参考资料：

${context}

---

基于以上资料，请回答：${query}`;
  }

  /**
   * 获取统计信息
   */
  async getStats(): Promise<{
    documentCount: number;
    totalChunks: number;
    totalCharacters: number;
  }> {
    await this.init();
    return this.store.getStats();
  }

  /**
   * 带 RAG 的对话
   */
  async chatWithRAG(
    messages: Message[],
    query: string,
    llm: LLMProvider,
    options?: { topK?: number; systemPrompt?: string }
  ): Promise<string> {
    // 搜索相关内容
    const results = await this.search(query, options?.topK || 5);

    if (results.length === 0) {
      // 没有相关内容，直接对话
      return llm.chat(messages, { systemPrompt: options?.systemPrompt });
    }

    // 构建带上下文的消息
    const context = results
      .map((r, i) => `【参考资料${i + 1}】\n${r.content}`)
      .join('\n\n');

    const enhancedMessages = [...messages];
    
    // 添加系统消息
    const systemPrompt = (options?.systemPrompt || '') + `

你有一个知识库可以参考。当用户问问题时，我会提供相关的参考资料。请基于这些资料回答问题，如果资料中没有相关信息，请诚实地说明。

参考资料：
${context}`;

    return llm.chat(enhancedMessages, { systemPrompt });
  }
}

// 全局实例
let globalRAGService: RAGService | null = null;

export function getRAGService(): RAGService {
  if (!globalRAGService) {
    globalRAGService = new RAGService();
  }
  return globalRAGService;
}

export async function initRAGService(options?: RAGServiceOptions): Promise<RAGService> {
  globalRAGService = new RAGService(options);
  await globalRAGService.init();
  return globalRAGService;
}
