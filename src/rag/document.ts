import fs from 'fs';
import path from 'path';

/**
 * 文档块
 */
export interface DocumentChunk {
  id: string;
  content: string;
  metadata: {
    source: string;
    chunkIndex: number;
    totalChunks: number;
    startChar: number;
    endChar: number;
  };
}

/**
 * 文档
 */
export interface Document {
  id: string;
  filename: string;
  content: string;
  chunks: DocumentChunk[];
  metadata: {
    size: number;
    uploadedAt: number;
    type: string;
  };
}

/**
 * 文档处理器
 */
export class DocumentProcessor {
  private chunkSize: number;
  private chunkOverlap: number;

  constructor(options: { chunkSize?: number; chunkOverlap?: number } = {}) {
    this.chunkSize = options.chunkSize || 1000; // 每块字符数
    this.chunkOverlap = options.chunkOverlap || 200; // 重叠字符数
  }

  /**
   * 处理文本文件
   */
  async processText(content: string, filename: string): Promise<Document> {
    const id = this.generateId();
    
    // 清理文本
    const cleanedContent = this.cleanText(content);
    
    // 分块
    const chunks = this.chunkText(cleanedContent, id, filename);
    
    return {
      id,
      filename,
      content: cleanedContent,
      chunks,
      metadata: {
        size: cleanedContent.length,
        uploadedAt: Date.now(),
        type: this.getFileType(filename),
      },
    };
  }

  /**
   * 从文件路径加载
   */
  async loadFile(filePath: string): Promise<Document> {
    const content = await fs.promises.readFile(filePath, 'utf-8');
    const filename = path.basename(filePath);
    return this.processText(content, filename);
  }

  /**
   * 清理文本
   */
  private cleanText(text: string): string {
    return text
      .replace(/\r\n/g, '\n')  // 统一换行
      .replace(/\n{3,}/g, '\n\n')  // 多个空行变成两个
      .replace(/[ \t]+/g, ' ')  // 多个空格变成一个
      .trim();
  }

  /**
   * 分块文本
   */
  private chunkText(text: string, docId: string, source: string): DocumentChunk[] {
    const chunks: DocumentChunk[] = [];
    
    // 按段落分割
    const paragraphs = text.split(/\n\n+/);
    
    let currentChunk = '';
    let chunkIndex = 0;
    let startChar = 0;
    
    for (const para of paragraphs) {
      // 如果当前块加上这个段落不超过限制
      if (currentChunk.length + para.length + 2 <= this.chunkSize) {
        currentChunk += (currentChunk ? '\n\n' : '') + para;
      } else {
        // 保存当前块
        if (currentChunk) {
          chunks.push(this.createChunk(
            docId,
            chunkIndex,
            currentChunk,
            source,
            startChar,
            startChar + currentChunk.length
          ));
          chunkIndex++;
          startChar += currentChunk.length;
          
          // 保留部分重叠
          const overlapText = this.getOverlapText(currentChunk);
          currentChunk = overlapText + para;
        } else {
          // 段落太长，强制分割
          const subChunks = this.splitLongParagraph(para, docId, source, chunkIndex, startChar);
          chunks.push(...subChunks.chunks);
          chunkIndex = subChunks.chunkIndex;
          startChar = subChunks.startChar;
          currentChunk = '';
        }
      }
    }
    
    // 保存最后一块
    if (currentChunk) {
      chunks.push(this.createChunk(
        docId,
        chunkIndex,
        currentChunk,
        source,
        startChar,
        startChar + currentChunk.length
      ));
    }

    // 更新 totalChunks
    const totalChunks = chunks.length;
    for (const chunk of chunks) {
      chunk.metadata.totalChunks = totalChunks;
    }

    return chunks;
  }

  /**
   * 创建块
   */
  private createChunk(
    docId: string,
    index: number,
    content: string,
    source: string,
    startChar: number,
    endChar: number
  ): DocumentChunk {
    return {
      id: `${docId}-chunk-${index}`,
      content,
      metadata: {
        source,
        chunkIndex: index,
        totalChunks: 0, // 稍后更新
        startChar,
        endChar,
      },
    };
  }

  /**
   * 获取重叠文本
   */
  private getOverlapText(text: string): string {
    if (text.length <= this.chunkOverlap) return '';
    
    // 从最后一个句号或换行处截断
    const lastSentence = text.lastIndexOf('。', this.chunkOverlap);
    const lastNewline = text.lastIndexOf('\n', this.chunkOverlap);
    const cutPoint = Math.max(lastSentence, lastNewline);
    
    if (cutPoint > 0) {
      return text.slice(cutPoint + 1).trim();
    }
    
    return text.slice(-this.chunkOverlap);
  }

  /**
   * 分割长段落
   */
  private splitLongParagraph(
    para: string,
    docId: string,
    source: string,
    chunkIndex: number,
    startChar: number
  ): { chunks: DocumentChunk[]; chunkIndex: number; startChar: number } {
    const chunks: DocumentChunk[] = [];
    let current = startChar;
    
    for (let i = 0; i < para.length; i += this.chunkSize) {
      const end = Math.min(i + this.chunkSize, para.length);
      const content = para.slice(i, end);
      
      chunks.push(this.createChunk(docId, chunkIndex, content, source, current, current + content.length));
      
      chunkIndex++;
      current += content.length;
    }

    return { chunks, chunkIndex, startChar: current };
  }

  /**
   * 生成 ID
   */
  private generateId(): string {
    return `doc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  /**
   * 获取文件类型
   */
  private getFileType(filename: string): string {
    const ext = path.extname(filename).toLowerCase();
    const types: Record<string, string> = {
      '.txt': 'text/plain',
      '.md': 'text/markdown',
      '.json': 'application/json',
      '.csv': 'text/csv',
    };
    return types[ext] || 'application/octet-stream';
  }
}

/**
 * 简单向量存储（支持持久化）
 */
export class SimpleVectorStore {
  private documents: Map<string, Document> = new Map();
  private chunkIndex: Map<string, DocumentChunk[]> = new Map(); // docId -> chunks
  private dataDir: string;

  constructor(dataDir: string = './data/rag') {
    this.dataDir = dataDir;
  }

  /**
   * 初始化：从磁盘加载已有数据
   */
  async init(): Promise<void> {
    try {
      await fs.promises.mkdir(this.dataDir, { recursive: true });
      await this.load();
    } catch (error) {
      console.error('[VectorStore] Init error:', error);
    }
  }

  /**
   * 保存到磁盘
   */
  async save(): Promise<void> {
    const indexPath = path.join(this.dataDir, 'index.json');
    const data = {
      documents: Array.from(this.documents.entries()),
      savedAt: Date.now(),
    };
    await fs.promises.writeFile(indexPath, JSON.stringify(data, null, 2), 'utf-8');
  }

  /**
   * 从磁盘加载
   */
  async load(): Promise<void> {
    const indexPath = path.join(this.dataDir, 'index.json');
    try {
      const content = await fs.promises.readFile(indexPath, 'utf-8');
      const data = JSON.parse(content);
      
      this.documents.clear();
      this.chunkIndex.clear();
      
      for (const [id, doc] of data.documents) {
        this.documents.set(id, doc);
        this.chunkIndex.set(id, doc.chunks);
      }
      
      console.log(`[VectorStore] Loaded ${this.documents.size} documents from disk`);
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        console.error('[VectorStore] Load error:', error);
      }
    }
  }

  /**
   * 添加文档
   */
  async addDocument(doc: Document): Promise<void> {
    this.documents.set(doc.id, doc);
    this.chunkIndex.set(doc.id, doc.chunks);
    await this.save();
  }

  /**
   * 获取文档
   */
  getDocument(docId: string): Document | undefined {
    return this.documents.get(docId);
  }

  /**
   * 列出所有文档
   */
  listDocuments(): Document[] {
    return Array.from(this.documents.values());
  }

  /**
   * 删除文档
   */
  async deleteDocument(docId: string): Promise<boolean> {
    if (!this.documents.has(docId)) return false;
    this.documents.delete(docId);
    this.chunkIndex.delete(docId);
    await this.save();
    return true;
  }

  /**
   * 搜索相关内容（简单关键词匹配）
   */
  search(query: string, topK: number = 5): Array<{ chunk: DocumentChunk; score: number }> {
    const results: Array<{ chunk: DocumentChunk; score: number }> = [];
    const queryWords = this.tokenize(query);

    for (const chunks of this.chunkIndex.values()) {
      for (const chunk of chunks) {
        const score = this.calculateSimilarity(queryWords, chunk.content);
        if (score > 0) {
          results.push({ chunk, score });
        }
      }
    }

    // 按分数排序
    results.sort((a, b) => b.score - a.score);
    
    return results.slice(0, topK);
  }

  /**
   * 分词
   */
  private tokenize(text: string): Set<string> {
    // 简单实现：按空格和标点分割
    const words = text
      .toLowerCase()
      .replace(/[^\w\u4e00-\u9fa5]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 1);
    
    return new Set(words);
  }

  /**
   * 计算相似度
   */
  private calculateSimilarity(queryWords: Set<string>, text: string): number {
    const textWords = this.tokenize(text);
    
    let matches = 0;
    for (const word of queryWords) {
      if (textWords.has(word)) {
        matches++;
      }
    }

    return queryWords.size > 0 ? matches / queryWords.size : 0;
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    documentCount: number;
    totalChunks: number;
    totalCharacters: number;
  } {
    let totalChunks = 0;
    let totalCharacters = 0;

    for (const doc of this.documents.values()) {
      totalChunks += doc.chunks.length;
      totalCharacters += doc.content.length;
    }

    return {
      documentCount: this.documents.size,
      totalChunks,
      totalCharacters,
    };
  }
}
