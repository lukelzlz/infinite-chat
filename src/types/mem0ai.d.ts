declare module 'mem0ai' {
  export interface Mem0Options {
    apiKey?: string;
    organizationId?: string;
    projectId?: string;
  }

  export interface MemoryResult {
    id: string;
    memory: string;
    userId?: string;
    metadata?: Record<string, unknown>;
    createdAt?: string;
    updatedAt?: string;
  }

  export interface SearchOptions {
    query: string;
    userId?: string;
    limit?: number;
  }

  export class Mem0 {
    constructor(options?: Mem0Options);
    add(content: string, options?: { userId?: string; metadata?: Record<string, unknown> }): Promise<MemoryResult>;
    search(options: SearchOptions): Promise<MemoryResult[]>;
    getAll(options?: { userId?: string }): Promise<MemoryResult[]>;
    delete(memoryId: string): Promise<void>;
  }
}
