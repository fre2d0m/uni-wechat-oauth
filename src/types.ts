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

// 内部状态存储
export interface InternalAuthState {
  unionid: string;
  openid: string;
  nickname: string;
  avatar: string;
  originalState: string;
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
