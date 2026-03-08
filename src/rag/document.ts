import fs from 'fs';
import path from 'path';
import { generateSecureId, safeJsonParse, validateFilePath } from '../utils/security';

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
 * TF-IDF 相关性计算器（性能优化）
 */
class TFIDFCalculator {
  private documentFrequency: Map<string, number> = new Map();
  private totalDocuments: number = 0;

  /**
   * 添加文档更新 IDF
   */
  addDocument(tokens: Set<string>): void {
    this.totalDocuments++;
    for (const token of tokens) {
      this.documentFrequency.set(
        token,
        (this.documentFrequency.get(token) || 0) + 1
      );
    }
  }

  /**
   * 移除文档更新 IDF
   */
  removeDocument(tokens: Set<string>): void {
    this.totalDocuments = Math.max(0, this.totalDocuments - 1);
    for (const token of tokens) {
      const freq = this.documentFrequency.get(token) || 0;
      if (freq <= 1) {
        this.documentFrequency.delete(token);
      } else {
        this.documentFrequency.set(token, freq - 1);
      }
    }
  }

  /**
   * 计算 TF-IDF 分数
   */
  calculateScore(queryTokens: Set<string>, docTokens: Set<string>): number {
    let score = 0;
    
    for (const token of queryTokens) {
      if (docTokens.has(token)) {
        // TF: 1 (简化处理，假设每个词在文档中最多出现一次)
        const tf = 1;
        
        // IDF: log(N / df)
        const df = this.documentFrequency.get(token) || 1;
        const idf = Math.log(this.totalDocuments / df) + 1;
        
        score += tf * idf;
      }
    }
    
    return score;
  }

  /**
   * 获取统计信息
   */
  getStats(): { totalDocuments: number; vocabularySize: number } {
    return {
      totalDocuments: this.totalDocuments,
      vocabularySize: this.documentFrequency.size,
    };
  }
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
   * 生成 ID（使用加密安全的随机数）
   */
  private generateId(): string {
    return `doc-${Date.now()}-${generateSecureId(8)}`;
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
 * 简单向量存储（支持持久化 + TF-IDF 优化）
 */
export class SimpleVectorStore {
  private documents: Map<string, Document> = new Map();
  private chunkIndex: Map<string, DocumentChunk[]> = new Map(); // docId -> chunks
  private chunkTokens: Map<string, Set<string>> = new Map(); // chunkId -> tokens (缓存)
  private dataDir: string;
  private tfidf: TFIDFCalculator;

  constructor(dataDir: string = './data/rag') {
    // 安全检查：验证 dataDir 路径
    const resolvedDataDir = path.resolve(dataDir);

    // 确保路径不包含危险模式
    if (resolvedDataDir.includes('..') || resolvedDataDir.includes('\0')) {
      throw new Error('Invalid data directory path');
    }

    this.dataDir = resolvedDataDir;
    this.tfidf = new TFIDFCalculator();
  }

  /**
   * 初始化：从磁盘加载已有数据
   */
  async init(): Promise<void> {
    try {
      await fs.promises.mkdir(this.dataDir, { recursive: true });
      await this.load();
      
      // 重建 TF-IDF 索引
      for (const tokens of this.chunkTokens.values()) {
        this.tfidf.addDocument(tokens);
      }
      
      console.log(`[VectorStore] TF-IDF index rebuilt: ${this.tfidf.getStats().vocabularySize} terms`);
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
      chunkTokens: Array.from(this.chunkTokens.entries()).map(([id, tokens]) => [id, Array.from(tokens)]),
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
      const data = safeJsonParse<{
        documents: [string, Document][];
        chunkTokens?: [string, string[]][];
        savedAt: number;
      } | null>(content, null);

      if (!data) {
        console.error('[VectorStore] Invalid JSON in index file');
        return;
      }

      this.documents.clear();
      this.chunkIndex.clear();
      this.chunkTokens.clear();

      for (const [id, doc] of data.documents) {
        this.documents.set(id, doc);
        this.chunkIndex.set(id, doc.chunks);
      }

      // 加载缓存的 tokens
      if (data.chunkTokens) {
        for (const [id, tokens] of data.chunkTokens) {
          this.chunkTokens.set(id, new Set(tokens));
        }
      } else {
        // 旧数据格式，需要重建 tokens
        for (const chunks of this.chunkIndex.values()) {
          for (const chunk of chunks) {
            this.chunkTokens.set(chunk.id, this.tokenize(chunk.content));
          }
        }
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
    
    // 缓存 tokens 并更新 TF-IDF
    for (const chunk of doc.chunks) {
      const tokens = this.tokenize(chunk.content);
      this.chunkTokens.set(chunk.id, tokens);
      this.tfidf.addDocument(tokens);
    }
    
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
    
    // 从 TF-IDF 中移除
    const chunks = this.chunkIndex.get(docId);
    if (chunks) {
      for (const chunk of chunks) {
        const tokens = this.chunkTokens.get(chunk.id);
        if (tokens) {
          this.tfidf.removeDocument(tokens);
        }
        this.chunkTokens.delete(chunk.id);
      }
    }
    
    this.documents.delete(docId);
    this.chunkIndex.delete(docId);
    await this.save();
    return true;
  }

  /**
   * 搜索相关内容（TF-IDF 优化）
   */
  search(query: string, topK: number = 5): Array<{ chunk: DocumentChunk; score: number }> {
    const results: Array<{ chunk: DocumentChunk; score: number }> = [];
    const queryTokens = this.tokenize(query);

    for (const chunks of this.chunkIndex.values()) {
      for (const chunk of chunks) {
        // 使用缓存的 tokens
        const chunkTokens = this.chunkTokens.get(chunk.id) || this.tokenize(chunk.content);
        if (!this.chunkTokens.has(chunk.id)) {
          this.chunkTokens.set(chunk.id, chunkTokens);
        }
        
        const score = this.tfidf.calculateScore(queryTokens, chunkTokens);
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
   * 分词（中英文支持）
   */
  private tokenize(text: string): Set<string> {
    // 中英文分词
    const words = text
      .toLowerCase()
      .replace(/[^\w\u4e00-\u9fa5]/g, ' ')
      .split(/\s+/)
      .filter(w => {
        // 过滤停用词和短词
        if (w.length <= 1) return false;
        // 中文词至少2个字符
        if (/[\u4e00-\u9fa5]/.test(w) && w.length < 2) return false;
        return true;
      });
    
    return new Set(words);
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    documentCount: number;
    totalChunks: number;
    totalCharacters: number;
    tfidfStats: ReturnType<TFIDFCalculator['getStats']>;
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
      tfidfStats: this.tfidf.getStats(),
    };
  }
}
