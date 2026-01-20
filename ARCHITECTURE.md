# 架构设计文档

## 嵌套 OAuth2 授权流程

本服务实现了标准的嵌套 OAuth2 授权流程，作为 Logto 和微信之间的适配层。

### 核心概念

存在两个级别的授权循环：

1. **应用层级**: 用户应用 ↔ Logto
2. **协议层级**: Logto ↔ 微信（通过本服务）

### 完整流程图

```
用户应用                Logto                本服务 (Wrapper)           微信
   │                     │                        │                      │
   │  1. signIn()        │                        │                      │
   ├──────────────────>  │                        │                      │
   │  redirect_uri=      │                        │                      │
   │  app.com/callback   │                        │                      │
   │                     │                        │                      │
   │                     │  2. /authorize         │                      │
   │                     │  state=LOGTO_STATE     │                      │
   │                     │  redirect_uri=         │                      │
   │                     │  logto.com/callback    │                      │
   │                     ├───────────────────────>│                      │
   │                     │                        │                      │
   │                     │                        │  3. 生成 WX_STATE    │
   │                     │                        │  存储映射:           │
   │                     │                        │  WX_STATE ->         │
   │                     │                        │    LOGTO_STATE       │
   │                     │                        │    logto.com/callback│
   │                     │                        │    clientId          │
   │                     │                        │    appAlias          │
   │                     │                        │                      │
   │                     │                        │  4. 检测是否需要     │
   │                     │                        │  用户手动授权        │
   │                     │                        │  (公众号+userinfo)   │
   │                     │                        │                      │
   │                     │  [如需手动授权]        │                      │
   │                     │  5a. 重定向到中转页面  │                      │
   │                     │  /consent?continue=... │                      │
   │                     │<───────────────────────┤                      │
   │                     │                        │                      │
   │                     │  用户点击"使用微信登录"│                      │
   │                     │                        │                      │
   │                     │  [直接授权或手动触发]  │                      │
   │                     │                        │  5b. 重定向到微信    │
   │                     │                        │  state=WX_STATE      │
   │                     │                        │  redirect_uri=       │
   │                     │                        │  wrapper.com/callback│
   │                     │                        ├─────────────────────>│
   │                     │                        │                      │
   │                     │                        │  6. 用户授权/扫码    │
   │                     │                        │                      │
   │                     │                        │  7. 回调             │
   │                     │                        │  code=WX_CODE        │
   │                     │                        │  state=WX_STATE      │
   │                     │                        │<─────────────────────┤
   │                     │                        │                      │
   │                     │                        │  8. 取回映射         │
   │                     │                        │  WX_STATE ->         │
   │                     │                        │    LOGTO_STATE       │
   │                     │                        │  用完即删（防重放）  │
   │                     │                        │                      │
   │                     │                        │  9. 换取 UnionID     │
   │                     │                        ├─────────────────────>│
   │                     │                        │<─────────────────────┤
   │                     │                        │  access_token        │
   │                     │                        │  unionid             │
   │                     │                        │                      │
   │                     │                        │  10. 获取用户信息    │
   │                     │                        ├─────────────────────>│
   │                     │                        │<─────────────────────┤
   │                     │                        │  nickname, avatar    │
   │                     │                        │                      │
   │                     │                        │  11. 生成 INTERNAL_CODE│
   │                     │                        │  存储:               │
   │                     │                        │  INTERNAL_CODE ->    │
   │                     │                        │    unionid           │
   │                     │                        │    nickname          │
   │                     │                        │    avatar            │
   │                     │                        │    LOGTO_STATE       │
   │                     │                        │    clientId          │
   │                     │                        │                      │
   │                     │  12. 重定向回 Logto    │                      │
   │                     │  code=INTERNAL_CODE    │                      │
   │                     │  state=LOGTO_STATE     │                      │
   │                     │<───────────────────────┤                      │
   │                     │                        │                      │
   │                     │  13. /oidc/token       │                      │
   │                     │  code=INTERNAL_CODE    │                      │
   │                     ├───────────────────────>│                      │
   │                     │<───────────────────────┤                      │
   │                     │  access_token          │                      │
   │                     │                        │                      │
   │                     │  14. /oidc/me          │                      │
   │                     │  Bearer access_token   │                      │
   │                     ├───────────────────────>│                      │
   │                     │<───────────────────────┤                      │
   │                     │  sub: unionid          │                      │
   │                     │  nickname, picture     │                      │
   │                     │                        │                      │
   │  15. 重定向回应用   │                        │                      │
   │  app.com/callback   │                        │                      │
   │<────────────────────┤                        │                      │
   │  Logto JWT Token    │                        │                      │
```

## 关键设计原则

### 1. State 参数的透传

**Logto 的 state 必须原封不动返回**

- Logto 传来的 `state` 参数是 Logto 识别登录会话的唯一钥匙
- 本服务不需要理解 `state` 的内容
- 只需要像接力棒一样，在最后返回给 Logto

```typescript
// ✅ 正确做法
const logtoState = c.req.query('state');
// ... 处理流程 ...
callbackUrl.searchParams.set('state', logtoState);  // 原封不动返回
```

### 2. 安全隔离

**为微信生成独立的 state**

- 不直接把 Logto 的 state 传给微信
- 生成新的随机 `wechatState` 传给微信
- 建立映射关系：`wechatState -> logtoState`

```typescript
// ✅ 正确做法
const wechatState = storage.generateWeChatState();  // 生成新的随机 state
storage.setAuthState(wechatState, {
  logtoState,           // 保存 Logto 的 state
  logtoRedirectUri,     // 保存 Logto 的回调地址
  clientId,
  appAlias,
  timestamp: Date.now(),
});
```

**好处：**
- 防止 CSRF 攻击
- 避免敏感信息暴露在 URL 中
- 逻辑更清晰，职责分离

### 3. 用完即删

**防止重放攻击**

```typescript
// 获取授权状态
const authState = storage.getAuthState(wechatState);
if (!authState) {
  return c.json({ error: 'invalid_request' }, 400);
}

// ✅ 用完立即删除
storage.deleteAuthState(wechatState);
```

### 4. 双层缓存

**分离授权状态和用户信息**

```typescript
class StateStorage {
  // 授权阶段：短期存储（5分钟）
  private authStateCache: LRUCache<string, AuthorizationState>;
  
  // 用户信息：稍长存储（10分钟）
  private userInfoCache: LRUCache<string, InternalAuthState>;
}
```

**原因：**
- 授权状态只在授权流程中使用，用完即删
- 用户信息需要在 token 和 userinfo 端点中使用，保留时间稍长

## 数据流转

### 阶段 1: 授权请求 (Logto → Wrapper)

**输入：**
```
GET /authorize?
  client_id=logto-client
  &redirect_uri=https://logto.app/callback/wechat
  &state=LOGTO_STATE_AAA
```

**处理：**
1. 验证 `client_id`
2. 判断 User-Agent 或解析 state 前缀，选择微信应用
3. 根据应用类型自动设置 scope：
   - 开放平台：`snsapi_login`
   - 公众号：`snsapi_userinfo`
4. 生成 `wechatState = wx_uuid`
5. 存储映射：`wechatState -> { logtoState, logtoRedirectUri, clientId, appAlias }`
6. 检测是否需要用户手动授权（微信公众号 + snsapi_userinfo）

**输出（需要手动授权）：**
```
302 Redirect to:
https://wrapper.com/consent?
  continue=https%3A%2F%2Fopen.weixin.qq.com%2Fconnect%2Foauth2%2Fauthorize%3F...
```

**输出（直接授权 - 开放平台）：**
```
302 Redirect to:
https://open.weixin.qq.com/connect/qrconnect?
  appid=wxXXXXXX
  &redirect_uri=https://wrapper.com/callback
  &state=wx_uuid
  &scope=snsapi_login
```

### 阶段 2: 微信回调 (微信 → Wrapper)

**输入：**
```
GET /callback?
  code=WX_CODE_BBB
  &state=wx_uuid
```

**处理：**
1. 从缓存取回：`authState = storage.getAuthState(wx_uuid)`
2. 删除缓存：`storage.deleteAuthState(wx_uuid)` （防重放）
3. 用 `WX_CODE_BBB` 换取 `access_token` 和 `unionid`
4. 获取用户信息（nickname, avatar）
5. 生成 `internalCode = internal_uuid`
6. 存储用户信息：`internalCode -> { unionid, nickname, avatar, logtoState, clientId }`

**输出：**
```
302 Redirect to:
https://logto.app/callback/wechat?
  code=internal_uuid
  &state=LOGTO_STATE_AAA  ← 原封不动返回
```

### 阶段 3: Token 交换 (Logto → Wrapper)

**输入：**
```
POST /oidc/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code
&code=internal_uuid
&client_id=logto-client
&client_secret=secret
```

**处理：**
1. 验证 `client_id` 和 `client_secret`
2. 从缓存取回：`userInfo = storage.getUserInfo(internal_uuid)`
3. 验证 `clientId` 匹配

**输出：**
```json
{
  "access_token": "internal_uuid",
  "token_type": "Bearer",
  "expires_in": 600
}
```

### 阶段 4: 用户信息 (Logto → Wrapper)

**输入：**
```
GET /oidc/me
Authorization: Bearer internal_uuid
```

**处理：**
1. 从缓存取回：`userInfo = storage.getUserInfo(internal_uuid)`

**输出（微信原始字段）：**
```json
{
  "unionid": "o6_bmasdasdsad6_2sgVt7hMZOPfL",
  "openid": "oLVPpjqs9BhvzwPj5A-vTYAX3GLc",
  "nickname": "用户昵称",
  "sex": 1,
  "province": "广东",
  "city": "深圳",
  "country": "中国",
  "headimgurl": "https://thirdwx.qlogo.cn/...",
  "privilege": []
}
```

## 安全考虑

### 1. CSRF 防护

- 每个授权请求生成唯一的 `wechatState`
- 回调时验证 state 存在且有效
- 用完即删，防止重放

### 2. 时间窗口

- 授权状态：5 分钟过期
- 用户信息：10 分钟过期
- 超时自动清理

### 3. 客户端验证

- 验证 `client_id` 和 `client_secret`
- 验证 `clientId` 在整个流程中保持一致

### 4. 日志脱敏

```typescript
logger.info({ 
  wechatState: wechatState.substring(0, 16) + '...',  // 只记录前缀
  logtoState: logtoState.substring(0, 16) + '...'
}, '授权分流');
```

## 配置说明

### 强制指定微信应用

在 Logto 的 state 参数中使用 `alias:original_state` 格式：

```
state=oa1:LOGTO_STATE_AAA  → 强制使用 alias 为 oa1 的公众号
state=op1:LOGTO_STATE_AAA  → 强制使用 alias 为 op1 的开放平台
state=LOGTO_STATE_AAA      → 根据 User-Agent 自动选择
```

### User-Agent 判断

```typescript
const isWeChat = /MicroMessenger/i.test(userAgent);
// true  → 使用公众号应用
// false → 使用开放平台应用
```

## 故障排查

### State 无效或已过期

**原因：**
- 用户在授权页面停留超过 5 分钟
- 重复使用同一个回调 URL（重放攻击）
- 缓存被清空

**解决：**
- 引导用户重新发起登录
- 检查服务器时间同步

### UnionID 为空

**原因：**
- 微信应用未绑定到开放平台
- 使用了测试号（测试号不支持 UnionID）

**解决：**
- 在微信开放平台绑定应用
- 使用正式的公众号/开放平台应用

### Client ID 不匹配

**原因：**
- 多个 Logto 实例使用同一个 Wrapper
- 缓存数据损坏

**解决：**
- 为每个 Logto 实例配置独立的 `client_id`
- 检查 `clients.toml` 配置

## 性能优化

### 1. 缓存策略

- 使用 LRU Cache，自动淘汰旧数据
- 分离授权状态和用户信息缓存
- 不同的过期时间

### 2. 并发处理

- Bun 原生支持高并发
- 无阻塞的异步处理
- 单实例可处理数千并发

### 3. 日志优化

- 使用结构化日志（pino）
- 生产环境使用 JSON 格式
- 开发环境使用 pretty 格式

## 总结

本服务的核心职责是：

1. **接收** Logto 的授权请求（带 `logtoState`）
2. **生成** 新的 `wechatState` 并建立映射
3. **转发** 到微信授权页面
4. **接收** 微信回调，换取 UnionID
5. **返回** 给 Logto（原封不动返回 `logtoState`）

**关键原则：**
- 透传 Logto 的 state
- 安全隔离微信的 state
- 用完即删，防止重放
- 双层缓存，职责分离

这样的设计确保了安全性、可维护性和可扩展性。
