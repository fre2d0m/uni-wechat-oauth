// 配置类型定义

export interface WeChatApp {
  name: string;
  alias: string;
  type: 'official-account' | 'open-platform';
  appid: string;
  appsecret: string;
}

export interface Client {
  clientid: string;
  clientsecret: string;
  callbackUrl: string;
}

export interface WeChatAppsConfig {
  apps: WeChatApp[];
}

export interface ClientsConfig {
  clients: Client[];
}

// 微信 API 响应类型
export interface WeChatTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token: string;
  openid: string;
  scope: string;
  unionid?: string;
}

export interface WeChatUserInfo {
  openid: string;
  nickname: string;
  sex: number;
  province: string;
  city: string;
  country: string;
  headimgurl: string;
  privilege: string[];
  unionid: string;
}

// 授权阶段状态存储（Wrapper -> 微信）
export interface AuthorizationState {
  logtoState: string;        // Logto 传来的原始 state（必须原封不动返回）
  logtoRedirectUri: string;  // Logto 的回调地址
  clientId: string;          // 客户端 ID
  appAlias: string;          // 使用的微信应用别名
  timestamp: number;
}

// 认证完成后的用户信息存储（用于 Token 和 UserInfo 端点）
export interface InternalAuthState {
  unionid: string;
  openid: string;
  nickname: string;
  avatar: string;
  originalState: string;  // 保留，用于验证
  clientId: string;
  timestamp: number;
}

// OAuth2 响应类型
export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export interface UserInfoResponse {
  sub: string;
  name?: string;
  nickname?: string;
  picture?: string;
}
