import { HybridMemoryManager } from '../core/memory';

/**
 * 记忆节点
 */
export interface MemoryNode {
  id: string;
  type: 'user' | 'preference' | 'fact' | 'event' | 'emotion';
  content: string;
  importance: number;  // 0-1
  createdAt: number;
  lastAccessed: number;
  accessCount: number;
  connections: string[];  // 关联节点 ID
  metadata?: Record<string, any>;
}

/**
 * 记忆边（关联）
 */
export interface MemoryEdge {
  id: string;
  source: string;
  target: string;
  type: 'related' | 'caused' | 'follows' | 'contradicts';
  strength: number;  // 0-1
}

/**
 * 记忆图谱
 */
export interface MemoryGraph {
  nodes: MemoryNode[];
  edges: MemoryEdge[];
  stats: {
    totalMemories: number;
    byType: Record<string, number>;
    oldestMemory: number;
    newestMemory: number;
    avgImportance: number;
  };
}

/**
 * 记忆可视化服务
 */
export class MemoryVisualizationService {
  private memoryManager: HybridMemoryManager;

  constructor(memoryManager: HybridMemoryManager) {
    this.memoryManager = memoryManager;
  }

  /**
   * 获取用户记忆图谱
   */
  async getMemoryGraph(userId: string): Promise<MemoryGraph> {
    const memories = await this.memoryManager.getMem0().getAllMemories(userId);
    
    const nodes: MemoryNode[] = [];
    const edges: MemoryEdge[] = [];
    const stats = {
      totalMemories: memories.length,
      byType: {} as Record<string, number>,
      oldestMemory: Date.now(),
      newestMemory: 0,
      avgImportance: 0,
    };

    for (const memory of memories) {
      // 分析记忆类型
      const type = this.analyzeMemoryType(memory.content);
      
      // 计算重要性
      const importance = this.calculateImportance(memory);
      
      // 创建节点
      const node: MemoryNode = {
        id: memory.id,
        type,
        content: memory.content,
        importance,
        createdAt: memory.createdAt,
        lastAccessed: memory.updatedAt,
        accessCount: 1,
        connections: [],
        metadata: memory.metadata,
      };
      
      nodes.push(node);
      
      // 更新统计
      stats.byType[type] = (stats.byType[type] || 0) + 1;
      stats.oldestMemory = Math.min(stats.oldestMemory, memory.createdAt);
      stats.newestMemory = Math.max(stats.newestMemory, memory.createdAt);
      stats.avgImportance += importance;
    }

    // 计算平均重要性
    if (nodes.length > 0) {
      stats.avgImportance /= nodes.length;
    }

    // 查找记忆关联
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const similarity = this.calculateSimilarity(nodes[i].content, nodes[j].content);
        
        if (similarity > 0.3) {
          const edge: MemoryEdge = {
            id: `edge-${i}-${j}`,
            source: nodes[i].id,
            target: nodes[j].id,
            type: 'related',
            strength: similarity,
          };
          
          edges.push(edge);
          nodes[i].connections.push(nodes[j].id);
          nodes[j].connections.push(nodes[i].id);
        }
      }
    }

    return { nodes, edges, stats };
  }

  /**
   * 获取记忆时间线
   */
  async getMemoryTimeline(userId: string): Promise<{
    date: string;
    count: number;
    types: Record<string, number>;
    memories: { id: string; content: string; type: string }[];
  }[]> {
    const memories = await this.memoryManager.getMem0().getAllMemories(userId);
    
    // 按日期分组
    const byDate: Record<string, { id: string; content: string; type: string }[]> = {};
    
    for (const memory of memories) {
      const date = new Date(memory.createdAt).toISOString().split('T')[0];
      
      if (!byDate[date]) {
        byDate[date] = [];
      }
      
      byDate[date].push({
        id: memory.id,
        content: memory.content,
        type: this.analyzeMemoryType(memory.content),
      });
    }

    // 转换为数组并添加统计
    const timeline = Object.entries(byDate).map(([date, mems]) => {
      const types: Record<string, number> = {};
      
      for (const mem of mems) {
        types[mem.type] = (types[mem.type] || 0) + 1;
      }
      
      return {
        date,
        count: mems.length,
        types,
        memories: mems,
      };
    });

    // 按日期排序
    timeline.sort((a, b) => a.date.localeCompare(b.date));

    return timeline;
  }

  /**
   * 获取记忆热力图数据
   */
  async getMemoryHeatmap(userId: string): Promise<{
    hour: number;
    day: number;
    count: number;
  }[]> {
    const memories = await this.memoryManager.getMem0().getAllMemories(userId);
    
    // 按小时和星期分组
    const heatmap: Map<string, number> = new Map();
    
    for (const memory of memories) {
      const date = new Date(memory.createdAt);
      const hour = date.getHours();
      const day = date.getDay();
      const key = `${hour}-${day}`;
      
      heatmap.set(key, (heatmap.get(key) || 0) + 1);
    }

    // 转换为数组
    const result: { hour: number; day: number; count: number }[] = [];
    
    for (let hour = 0; hour < 24; hour++) {
      for (let day = 0; day < 7; day++) {
        const key = `${hour}-${day}`;
        result.push({
          hour,
          day,
          count: heatmap.get(key) || 0,
        });
      }
    }

    return result;
  }

  /**
   * 获取记忆词云数据
   */
  async getMemoryWordCloud(userId: string): Promise<{
    word: string;
    count: number;
    importance: number;
  }[]> {
    const memories = await this.memoryManager.getMem0().getAllMemories(userId);
    
    // 合并所有内容
    const allContent = memories.map(m => m.content).join(' ');
    
    // 分词（简单实现）
    const words = this.tokenize(allContent);
    
    // 统计词频
    const wordCount: Map<string, number> = new Map();
    
    for (const word of words) {
      if (word.length >= 2) {  // 过滤单字
        wordCount.set(word, (wordCount.get(word) || 0) + 1);
      }
    }

    // 转换并排序
    const result = Array.from(wordCount.entries())
      .map(([word, count]) => ({
        word,
        count,
        importance: Math.min(count / 10, 1),  // 归一化
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 100);  // 取前 100 个

    return result;
  }

  /**
   * 分析记忆类型
   */
  private analyzeMemoryType(content: string): MemoryNode['type'] {
    const lower = content.toLowerCase();
    
    // 偏好
    if (/喜欢|讨厌|偏好|最爱| hate | love | prefer/i.test(content)) {
      return 'preference';
    }
    
    // 情绪
    if (/开心|难过|生气|焦虑|害怕| happy | sad | angry | anxious/i.test(content)) {
      return 'emotion';
    }
    
    // 事件
    if (/今天|昨天|明天|上周|下周|周末| yesterday | tomorrow | last week/i.test(content)) {
      return 'event';
    }
    
    // 事实
    if (/是|有|在|工作|住|叫| i am | i have | i work | i live/i.test(content)) {
      return 'fact';
    }
    
    return 'user';
  }

  /**
   * 计算记忆重要性
   */
  private calculateImportance(memory: any): number {
    let importance = 0.5;
    
    // 根据类型调整
    const type = this.analyzeMemoryType(memory.content);
    switch (type) {
      case 'preference':
        importance += 0.2;
        break;
      case 'fact':
        importance += 0.15;
        break;
      case 'emotion':
        importance += 0.1;
        break;
    }
    
    // 根据访问次数调整
    const accessCount = memory.accessCount || 1;
    importance += Math.min(accessCount * 0.05, 0.2);
    
    // 根据时效性调整
    const age = Date.now() - memory.createdAt;
    const daysOld = age / (1000 * 60 * 60 * 24);
    importance -= Math.min(daysOld * 0.01, 0.2);
    
    return Math.max(0, Math.min(1, importance));
  }

  /**
   * 计算文本相似度（简单实现）
   */
  private calculateSimilarity(text1: string, text2: string): number {
    const words1 = new Set(this.tokenize(text1));
    const words2 = new Set(this.tokenize(text2));
    
    const intersection = new Set([...words1].filter(x => words2.has(x)));
    const union = new Set([...words1, ...words2]);
    
    if (union.size === 0) return 0;
    
    return intersection.size / union.size;
  }

  /**
   * 简单分词
   */
  private tokenize(text: string): string[] {
    // 简单实现：按空格和标点分割
    return text
      .toLowerCase()
      .replace(/[^\w\u4e00-\u9fa5]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 0);
  }

  /**
   * 搜索记忆
   */
  async searchMemories(userId: string, query: string): Promise<MemoryNode[]> {
    const graph = await this.getMemoryGraph(userId);
    const queryWords = new Set(this.tokenize(query));
    
    const results = graph.nodes
      .map(node => {
        const nodeWords = new Set(this.tokenize(node.content));
        const intersection = new Set([...queryWords].filter(x => nodeWords.has(x)));
        const score = intersection.size / queryWords.size;
        
        return { node, score };
      })
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 20)
      .map(r => r.node);

    return results;
  }
}
