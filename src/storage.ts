import { LRUCache } from 'lru-cache';
import type { InternalAuthState } from './types';

// 使用 LRU Cache 存储临时认证状态
export class StateStorage {
  private cache: LRUCache<string, InternalAuthState>;

  constructor() {
    this.cache = new LRUCache<string, InternalAuthState>({
      max: 10000,
      ttl: 1000 * 60 * 10, // 10 分钟过期
    });
  }

  set(code: string, state: InternalAuthState): void {
    this.cache.set(code, state);
  }

  get(code: string): InternalAuthState | undefined {
    return this.cache.get(code);
  }

  delete(code: string): void {
    this.cache.delete(code);
  }

  generateCode(): string {
    return crypto.randomUUID();
  }
}
