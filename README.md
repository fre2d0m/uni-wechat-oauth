# Uni WeChat OAuth 

基于 Bun 的微信认证聚合服务，智能切换公众号/开放平台认证，可作为 Logto 的社交连接器。

## 核心特性

- 🔀 **智能分流**: 根据 User-Agent 自动选择公众号或开放平台认证
- 🎯 **强制指定**: 通过 state 参数可强制使用特定微信应用
- 🔐 **UnionID 聚合**: 统一用户身份，无论从哪个入口登录
- ⚡ **高性能**: 基于 Bun 运行时，极致性能
- 🔌 **标准协议**: 实现标准 OAuth2/OIDC 接口

## 架构设计

```
用户 → Logto → WeChat Wrapper (本服务) → 微信接口
                    ↓
            根据 UA 分流
                    ↓
        公众号 or 开放平台
```

## 快速开始

### 安装依赖

```bash
bun install
```

### 配置文件

创建 `wechatapps.toml`:

```toml
[[apps]]
name = "公众号应用"
alias = "oa1"
type = "official-account"
appid = "wx..."
appsecret = "..."

[[apps]]
name = "开放平台应用"
alias = "op1"
type = "open-platform"
appid = "wx..."
appsecret = "..."
```

创建 `clients.toml`:

```toml
[[clients]]
clientid = "logto-client-id"
clientsecret = "logto-client-secret"
callbackUrl = "https://your-logto.com/callback/wechat"
```

### 启动服务

```bash
bun run src/index.ts --wechat ./wechatapps.toml --clients ./clients.toml
```

## API 端点

### 1. 授权端点 (Authorization Endpoint)
```
GET /authorize?client_id=xxx&redirect_uri=xxx&state=xxx&scope=xxx
```

**参数：**
- `client_id`: 客户端 ID（配置在 clients.toml）
- `redirect_uri`: 回调地址（Logto 的回调地址）
- `state`: 状态参数（Logto 传来的，会原封不动返回）
- `scope`: 权限范围（可选，默认 `snsapi_userinfo`）

**特殊功能：** 在 state 中指定应用 `oa1:<original_state>`

### 2. 回调端点 (Callback Endpoint)
```
GET /callback?code=xxx&state=xxx
```

微信授权后的回调地址（内部使用）

### 3. Token 端点 (Token Endpoint)
```
POST /oidc/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code&code=xxx&client_id=xxx&client_secret=xxx
```

**支持两种客户端认证方式：**
- Request Body: `client_id` + `client_secret`
- Basic Auth: `Authorization: Basic base64(client_id:client_secret)`

**响应：**
```json
{
  "access_token": "xxx",
  "token_type": "Bearer",
  "expires_in": 600
}
```

### 4. 用户信息端点 (UserInfo Endpoint)
```
GET /oidc/me
```

**支持两种 token 传递方式：**
- Authorization Header: `Authorization: Bearer ACCESS_TOKEN`
- Query String: `?access_token=ACCESS_TOKEN`

**响应：**
```json
{
  "sub": "unionid",
  "name": "用户名",
  "nickname": "昵称",
  "picture": "头像URL"
}
```

## Logto 配置

在 Logto 中创建自定义社交连接器：

### 带路径前缀部署（推荐）

如果使用 Nginx 路径前缀 `/uni-wechat-oauth`：

- **Authorization Endpoint**: `https://oauth.yourdomain.com/uni-wechat-oauth/authorize`
- **Token Endpoint**: `https://oauth.yourdomain.com/uni-wechat-oauth/oidc/token`
- **Userinfo Endpoint**: `https://oauth.yourdomain.com/uni-wechat-oauth/oidc/me`
- **Client ID**: 配置在 clients.toml 中的 clientid
- **Client Secret**: 配置在 clients.toml 中的 clientsecret

### 根路径部署

如果直接部署在域名根路径：

- **Authorization Endpoint**: `https://oauth.yourdomain.com/authorize`
- **Token Endpoint**: `https://oauth.yourdomain.com/oidc/token`
- **Userinfo Endpoint**: `https://oauth.yourdomain.com/oidc/me`
- **Client ID**: 配置在 clients.toml 中的 clientid
- **Client Secret**: 配置在 clients.toml 中的 clientsecret

## 工作流程

1. 用户点击 Logto 的"微信登录"
2. Logto 重定向到本服务的 `/authorize`
3. 本服务判断 User-Agent 或 state 参数，选择微信应用
4. 重定向到对应的微信认证页面
5. 用户授权后，微信回调到 `/callback`
6. 本服务用微信 code 换取 UnionID，生成 internal_code
7. 重定向回 Logto 的回调地址
8. Logto 调用 `/oidc/token` 和 `/oidc/me` 获取用户信息
9. 登录完成

## 技术栈

- **Runtime**: Bun
- **Framework**: Hono
- **Logger**: Pino
- **Storage**: 内存 LRU Cache
- **Config**: TOML
- **规范**: OAuth2 (RFC 6749) + OpenID Connect

## OAuth2 规范

本服务完全遵循 OAuth2 和 OpenID Connect 规范，详见 [OAUTH2_COMPLIANCE.md](./OAUTH2_COMPLIANCE.md)

**支持的特性：**
- ✅ 标准授权码流程 (Authorization Code Flow)
- ✅ 多种客户端认证方式（Body / Basic Auth）
- ✅ 多种 token 传递方式（Header / Query String）
- ✅ OIDC UserInfo 端点
- ✅ 标准错误响应

## 打包部署

### 构建单一可执行文件

```bash
# 为当前平台构建
bun run build

# 为 Linux 服务器构建
bun run build:linux

# 为 macOS 构建
bun run build:macos

# 为 Windows 构建
bun run build:windows
```

### 服务器要求

**无需任何运行时依赖！** 打包后的可执行文件完全独立。

- **Linux**: Ubuntu 18.04+, Debian 10+, CentOS 8+
- **内存**: 最低 128MB，推荐 512MB+
- **磁盘**: 200MB 可用空间

详细部署指南请查看 [DEPLOYMENT.md](./DEPLOYMENT.md)

## License

MIT
