import * as fs from 'fs';
import * as path from 'path';

/**
 * 轻量向量存储 — 纯 JSON 文件持久化
 * 
 * 不依赖 chromadb/qdrant 等外部服务
 * 用余弦相似度做语义检索
 */

export interface VectorRecord {
  id: string;
  content: string;
  userId: string;
  embedding: number[];
  metadata?: Record<string, any>;
  createdAt: number;
}

export interface VectorSearchResult {
  id: string;
  content: string;
  userId: string;
  score: number;
  metadata?: Record<string, any>;
  createdAt: number;
}

export class LocalVectorStore {
  private records: VectorRecord[] = [];
  private persistPath: string;
  private dirty = false;
  private flushTimer: NodeJS.Timeout | null = null;

  constructor(persistPath: string) {
    this.persistPath = persistPath;
    this.load();
    this.flushTimer = setInterval(() => this.flush(), 30_000);
  }

  /** 插入一条向量记录 */
  insert(record: VectorRecord): void {
    // 去重：相同 userId+content 不重复插
    const dup = this.records.find(
      r => r.userId === record.userId && r.content === record.content
    );
    if (dup) {
      // 更新 metadata
      dup.metadata = { ...dup.metadata, ...record.metadata };
      dup.embedding = record.embedding;
      this.dirty = true;
      return;
    }

    this.records.push(record);
    this.dirty = true;
  }

  /** 语义搜索：余弦相似度 top-k */
  search(queryEmbedding: number[], userId: string, topK = 5, minScore = 0.3): VectorSearchResult[] {
    const userRecords = this.records.filter(r => r.userId === userId);

    return userRecords
      .map(r => ({
        id: r.id,
        content: r.content,
        userId: r.userId,
        score: cosineSimilarity(queryEmbedding, r.embedding),
        metadata: r.metadata,
        createdAt: r.createdAt,
      }))
      .filter(r => r.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  /** 按内容前缀搜索（模糊匹配兜底） */
  searchByContent(keyword: string, userId: string, topK = 5): VectorSearchResult[] {
    const lower = keyword.toLowerCase();
    return this.records
      .filter(r => r.userId === userId && r.content.toLowerCase().includes(lower))
      .slice(0, topK)
      .map(r => ({
        id: r.id,
        content: r.content,
        userId: r.userId,
        score: 0.5, // 模糊匹配给个中等分数
        metadata: r.metadata,
        createdAt: r.createdAt,
      }));
  }

  /** 获取用户所有记录 */
  getAll(userId: string): VectorRecord[] {
    return this.records.filter(r => r.userId === userId);
  }

  /** 删除一条记录 */
  delete(id: string): boolean {
    const idx = this.records.findIndex(r => r.id === id);
    if (idx !== -1) {
      this.records.splice(idx, 1);
      this.dirty = true;
      return true;
    }
    return false;
  }

  /** 清理过期记录 */
  cleanup(maxAgeMs: number): number {
    const cutoff = Date.now() - maxAgeMs;
    const before = this.records.length;
    this.records = this.records.filter(r => r.createdAt > cutoff);
    const removed = before - this.records.length;
    if (removed > 0) this.dirty = true;
    return removed;
  }

  count(userId?: string): number {
    if (userId) return this.records.filter(r => r.userId === userId).length;
    return this.records.length;
  }

  dispose(): void {
    if (this.flushTimer) { clearInterval(this.flushTimer); this.flushTimer = null; }
    this.flush();
  }

  private load(): void {
    try {
      if (!fs.existsSync(this.persistPath)) return;
      const raw = fs.readFileSync(this.persistPath, 'utf-8');
      this.records = JSON.parse(raw);
      console.log(`[VectorStore] Loaded ${this.records.length} vectors from disk`);
    } catch (e) {
      console.warn('[VectorStore] Load failed:', (e as Error).message);
      this.records = [];
    }
  }

  private flush(): void {
    if (!this.dirty) return;
    try {
      const dir = path.dirname(this.persistPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.persistPath, JSON.stringify(this.records), 'utf-8');
      this.dirty = false;
    } catch (e) {
      console.warn('[VectorStore] Flush failed:', (e as Error).message);
    }
  }
}

/**
 * 余弦相似度
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}
