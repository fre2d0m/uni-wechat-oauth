import { LRUCache } from 'lru-cache';
import type { InternalAuthState, AuthorizationState } from './types';

// 使用 LRU Cache 存储临时认证状态
export class StateStorage {
  // 存储授权阶段的状态映射（微信 state -> Logto 信息）
  private authStateCache: LRUCache<string, AuthorizationState>;
  
  // 存储认证完成后的用户信息（internal_code -> 用户信息）
  private userInfoCache: LRUCache<string, InternalAuthState>;

  constructor() {
    // 授权状态：短期存储（5分钟），用于授权流程
    this.authStateCache = new LRUCache<string, AuthorizationState>({
      max: 10000,
      ttl: 1000 * 60 * 5, // 5 分钟过期
    });

    // 用户信息：稍长存储（10分钟），用于 token 和 userinfo 端点
    this.userInfoCache = new LRUCache<string, InternalAuthState>({
      max: 10000,
      ttl: 1000 * 60 * 10, // 10 分钟过期
    });
  }

  // === 授权阶段的状态管理 ===
  
  // 生成微信 state（用于传给微信）
  generateWeChatState(): string {
    return `wx_${crypto.randomUUID()}`;
  }

  // 存储授权状态（微信 state -> Logto 信息）
  setAuthState(wechatState: string, state: AuthorizationState): void {
    this.authStateCache.set(wechatState, state);
  }

  // 获取授权状态
  getAuthState(wechatState: string): AuthorizationState | undefined {
    return this.authStateCache.get(wechatState);
  }

  // 删除授权状态（用完即删，防止重放攻击）
  deleteAuthState(wechatState: string): void {
    this.authStateCache.delete(wechatState);
  }

  // === 用户信息管理 ===
  
  // 生成内部 code（用于返回给 Logto）
  generateInternalCode(): string {
    return crypto.randomUUID();
  }

  // 存储用户信息
  setUserInfo(code: string, state: InternalAuthState): void {
    this.userInfoCache.set(code, state);
  }

  // 获取用户信息
  getUserInfo(code: string): InternalAuthState | undefined {
    return this.userInfoCache.get(code);
  }

  // 删除用户信息
  deleteUserInfo(code: string): void {
    this.userInfoCache.delete(code);
  }
}
