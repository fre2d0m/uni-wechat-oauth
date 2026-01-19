import { Hono } from 'hono';
import type { ConfigManager } from './config';
import type { StateStorage } from './storage';
import { WeChatAPI } from './wechat';
import type { WeChatApp } from './types';
import { logger } from './logger';

export function createRoutes(config: ConfigManager, storage: StateStorage) {
  const app = new Hono();

  // 路由前缀
  const BASE_PATH = '/uni-wechat-oauth-service';

  // 健康检查
  app.get(`${BASE_PATH}/health`, (c) => {
    return c.json({ status: 'ok', service: 'wechat-oauth-aggregator' });
  });

  // 授权端点
  app.get(`${BASE_PATH}/authorize`, (c) => {
    const clientId = c.req.query('client_id');
    const redirectUri = c.req.query('redirect_uri');
    const logtoState = c.req.query('state') || '';  // Logto 传来的 state，必须原封不动返回
    const scope = c.req.query('scope') || 'snsapi_userinfo';
    const userAgent = c.req.header('user-agent') || '';

    logger.info({
      endpoint: '/authorize',
      clientId,
      redirectUri,
      scope,
      hasState: !!logtoState,
      userAgent: userAgent.substring(0, 100)  // 截断避免过长
    }, '收到授权请求');

    if (!clientId || !redirectUri) {
      logger.warn({ clientId, redirectUri }, '授权请求缺少必要参数');
      return c.json({ error: 'invalid_request', error_description: '缺少必要参数' }, 400);
    }

    // 验证客户端
    const client = config.getClient(clientId);
    if (!client) {
      logger.warn({ clientId }, '无效的客户端 ID');
      return c.json({ error: 'invalid_client', error_description: '无效的客户端' }, 401);
    }

    // 解析 state 参数，检查是否强制指定应用
    let targetApp: WeChatApp | undefined;
    let actualLogtoState = logtoState;
    let forcedAlias: string | undefined;

    // 支持通过 state 参数强制指定应用：格式为 "alias:original_state"
    if (logtoState.includes(':')) {
      const [alias, restState] = logtoState.split(':', 2);
      targetApp = config.getWeChatApp(alias);
      actualLogtoState = restState;
      forcedAlias = alias;
      
      if (!targetApp) {
        logger.warn({ alias, clientId }, '未找到指定的微信应用');
        return c.json({ error: 'invalid_request', error_description: `未找到别名为 ${alias} 的微信应用` }, 400);
      }
      
      logger.info({ alias, clientId }, '强制使用指定的微信应用');
    } else {
      // 根据 User-Agent 自动选择
      const isWeChat = WeChatAPI.isWeChatBrowser(userAgent);
      
      const defaultApps = config.getDefaultApps();
      targetApp = isWeChat ? defaultApps.oa : defaultApps.op;

      if (!targetApp) {
        logger.error({ 
          isWeChat, 
          hasOA: !!defaultApps.oa, 
          hasOP: !!defaultApps.op 
        }, '未配置对应的微信应用');
        return c.json({ 
          error: 'server_error', 
          error_description: `未配置${isWeChat ? '公众号' : '开放平台'}应用` 
        }, 500);
      }
      
      logger.info({ 
        isWeChat, 
        selectedType: targetApp.type,
        userAgent: userAgent.substring(0, 50)
      }, 'User-Agent 自动选择微信应用');
    }

    // 构造回调 URL（指向本服务）
    // 注意：不需要再考虑 x-forwarded-prefix，因为我们已经有了固定的 BASE_PATH
    const callbackPath = `${BASE_PATH}/callback`;
    const callbackUrl = new URL(callbackPath, c.req.url).toString();
    
    // 【关键】生成一个新的随机 state 传给微信（安全隔离）
    const wechatState = storage.generateWeChatState();
    
    // 【关键】建立映射：微信 state -> Logto 信息
    storage.setAuthState(wechatState, {
      logtoState: actualLogtoState,      // Logto 的原始 state（必须原封不动返回）
      logtoRedirectUri: redirectUri,     // Logto 的回调地址
      clientId,                          // 客户端 ID
      appAlias: targetApp.alias,         // 使用的微信应用
      timestamp: Date.now(),
    });

    // 重定向到微信授权页面，使用我们生成的 wechatState
    const authUrl = WeChatAPI.getAuthUrl(targetApp, callbackUrl, wechatState, scope);
    
    logger.info({ 
      clientId,
      appType: targetApp.type,
      appAlias: targetApp.alias,
      appName: targetApp.name,
      wechatStatePrefix: wechatState.substring(0, 16),
      logtoStatePrefix: actualLogtoState.substring(0, 16),
      callbackUrl,
      scope,
      forcedAlias,
      redirectTo: authUrl.substring(0, 100) + '...'
    }, '授权分流成功，重定向到微信');
    
    return c.redirect(authUrl);
  });

  // 微信回调端点
  app.get(`${BASE_PATH}/callback`, async (c) => {
    const wechatCode = c.req.query('code');
    const wechatState = c.req.query('state');

    logger.info({
      endpoint: '/callback',
      hasCode: !!wechatCode,
      hasState: !!wechatState,
      wechatStatePrefix: wechatState?.substring(0, 16)
    }, '收到微信回调');

    if (!wechatCode || !wechatState) {
      logger.warn({ 
        hasCode: !!wechatCode, 
        hasState: !!wechatState 
      }, '微信回调缺少必要参数');
      return c.json({ error: 'invalid_request', error_description: '缺少 code 或 state' }, 400);
    }

    try {
      // 【关键】从缓存中取回 Logto 的信息
      const authState = storage.getAuthState(wechatState);
      if (!authState) {
        logger.error({ 
          wechatStatePrefix: wechatState.substring(0, 16) 
        }, 'state 无效或已过期，可能是重放攻击');
        return c.json({ 
          error: 'invalid_request', 
          error_description: 'state 无效或已过期，可能是 CSRF 攻击' 
        }, 400);
      }

      logger.info({
        wechatStatePrefix: wechatState.substring(0, 16),
        logtoStatePrefix: authState.logtoState.substring(0, 16),
        clientId: authState.clientId,
        appAlias: authState.appAlias,
        stateAge: Date.now() - authState.timestamp
      }, '成功取回授权状态');

      // 【安全】用完即删，防止重放攻击
      storage.deleteAuthState(wechatState);
      logger.debug({ wechatStatePrefix: wechatState.substring(0, 16) }, '已删除授权状态（防重放）');

      const { logtoState, logtoRedirectUri, clientId, appAlias } = authState;

      // 获取对应的微信应用配置
      const app = config.getWeChatApp(appAlias);
      if (!app) {
        logger.error({ appAlias, clientId }, '应用配置丢失');
        return c.json({ error: 'server_error', error_description: '应用配置丢失' }, 500);
      }

      logger.info({ 
        appAlias: app.alias,
        appName: app.name,
        appType: app.type,
        clientId 
      }, '开始用微信 code 换取 token');

      // 用微信 code 换取 access_token 和 unionid
      const tokenData = await WeChatAPI.getAccessToken(app, wechatCode);
      
      logger.info({
        appAlias: app.alias,
        hasAccessToken: !!tokenData.access_token,
        hasUnionId: !!tokenData.unionid,
        hasOpenId: !!tokenData.openid,
        expiresIn: tokenData.expires_in,
        scope: tokenData.scope
      }, '成功获取微信 access_token');
      
      if (!tokenData.unionid) {
        logger.error({ 
          appAlias: app.alias,
          appType: app.type,
          hasOpenId: !!tokenData.openid 
        }, '未获取到 UnionID，应用可能未绑定到开放平台');
        return c.json({ 
          error: 'server_error', 
          error_description: '未获取到 UnionID，请确保应用已绑定到开放平台' 
        }, 500);
      }

      // 获取用户信息
      logger.debug({ 
        openid: tokenData.openid.substring(0, 8) + '...',
        unionid: tokenData.unionid.substring(0, 8) + '...'
      }, '开始获取用户信息');
      
      const userInfo = await WeChatAPI.getUserInfo(tokenData.access_token, tokenData.openid);

      logger.info({
        unionid: userInfo.unionid.substring(0, 8) + '...',
        openid: userInfo.openid.substring(0, 8) + '...',
        nickname: userInfo.nickname,
        hasAvatar: !!userInfo.headimgurl,
        sex: userInfo.sex,
        province: userInfo.province,
        city: userInfo.city
      }, '成功获取用户信息');

      // 【关键】生成内部 code（返回给 Logto）
      const internalCode = storage.generateInternalCode();
      
      // 存储用户信息（供后续 token 和 userinfo 端点使用）
      storage.setUserInfo(internalCode, {
        unionid: userInfo.unionid,
        openid: userInfo.openid,
        nickname: userInfo.nickname,
        avatar: userInfo.headimgurl,
        originalState: logtoState,  // 保存 Logto 的 state 用于验证
        clientId,
        timestamp: Date.now(),
      });

      logger.info({ 
        unionid: userInfo.unionid.substring(0, 8) + '...',
        nickname: userInfo.nickname,
        appAlias: app.alias,
        appType: app.type,
        internalCodePrefix: internalCode.substring(0, 16)
      }, '用户认证成功，已生成 internal_code');

      // 【关键】重定向回 Logto，原封不动地返回 Logto 的 state
      const logtoCallbackUrl = new URL(logtoRedirectUri);
      logtoCallbackUrl.searchParams.set('code', internalCode);
      logtoCallbackUrl.searchParams.set('state', logtoState);  // 原封不动返回

      logger.info({
        redirectTo: logtoCallbackUrl.origin + logtoCallbackUrl.pathname,
        logtoStatePrefix: logtoState.substring(0, 16),
        internalCodePrefix: internalCode.substring(0, 16),
        clientId
      }, '重定向回 Logto');

      return c.redirect(logtoCallbackUrl.toString());
    } catch (error) {
      logger.error({ 
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        wechatStatePrefix: wechatState?.substring(0, 16)
      }, '回调处理失败');
      return c.json({ 
        error: 'server_error', 
        error_description: error instanceof Error ? error.message : '未知错误' 
      }, 500);
    }
  });

  // Token 端点 (RFC 6749)
  app.post(`${BASE_PATH}/oidc/token`, async (c) => {
    // OAuth2 支持两种客户端认证方式：
    // 1. Request Body: client_id + client_secret
    // 2. Authorization Header: Basic base64(client_id:client_secret)
    
    const body = await c.req.parseBody();
    const grantType = body.grant_type as string;
    const code = body.code as string;
    const redirectUri = body.redirect_uri as string;  // OAuth2 标准要求验证 redirect_uri
    
    let clientId: string | undefined;
    let clientSecret: string | undefined;
    let authMethod: 'body' | 'basic' | 'none' = 'none';
    
    // 方式 1: 从 Request Body 获取
    clientId = body.client_id as string;
    clientSecret = body.client_secret as string;
    if (clientId && clientSecret) {
      authMethod = 'body';
    }
    
    // 方式 2: 从 Authorization Header 获取（Basic Auth）
    if (!clientId || !clientSecret) {
      const authHeader = c.req.header('authorization');
      if (authHeader && authHeader.startsWith('Basic ')) {
        try {
          const base64Credentials = authHeader.substring(6);
          const credentials = Buffer.from(base64Credentials, 'base64').toString('utf-8');
          const [id, secret] = credentials.split(':', 2);
          clientId = id;
          clientSecret = secret;
          authMethod = 'basic';
        } catch (error) {
          logger.error({ error }, 'Basic Auth 解析失败');
        }
      }
    }

    logger.info({
      endpoint: '/oidc/token',
      grantType,
      hasCode: !!code,
      clientId,
      authMethod,
      hasRedirectUri: !!redirectUri
    }, '收到 token 请求');

    // 验证必要参数
    if (grantType !== 'authorization_code') {
      logger.warn({ grantType }, '不支持的 grant_type');
      return c.json({ 
        error: 'unsupported_grant_type',
        error_description: '仅支持 authorization_code grant type'
      }, 400);
    }

    if (!code) {
      logger.warn('缺少 code 参数');
      return c.json({ 
        error: 'invalid_request', 
        error_description: '缺少 code 参数' 
      }, 400);
    }

    if (!clientId || !clientSecret) {
      logger.warn({ 
        hasClientId: !!clientId, 
        hasClientSecret: !!clientSecret,
        authMethod 
      }, '缺少客户端认证信息');
      return c.json({ 
        error: 'invalid_request', 
        error_description: '缺少客户端认证信息' 
      }, 400);
    }

    // 验证客户端
    if (!config.validateClient(clientId, clientSecret)) {
      logger.warn({ clientId, authMethod }, '客户端认证失败');
      return c.json({ 
        error: 'invalid_client',
        error_description: '客户端认证失败'
      }, 401);
    }

    logger.debug({ clientId, authMethod }, '客户端认证成功');

    // 获取存储的用户信息
    const userInfo = storage.getUserInfo(code);
    if (!userInfo) {
      logger.warn({ 
        codePrefix: code.substring(0, 16),
        clientId 
      }, 'authorization code 无效或已过期');
      return c.json({ 
        error: 'invalid_grant', 
        error_description: 'authorization code 无效或已过期' 
      }, 400);
    }

    logger.debug({
      codePrefix: code.substring(0, 16),
      unionidPrefix: userInfo.unionid.substring(0, 8),
      codeAge: Date.now() - userInfo.timestamp
    }, '成功取回用户信息');

    // 验证客户端匹配
    if (userInfo.clientId !== clientId) {
      logger.error({ 
        expectedClientId: userInfo.clientId,
        actualClientId: clientId,
        codePrefix: code.substring(0, 16)
      }, 'authorization code 不属于此客户端');
      return c.json({ 
        error: 'invalid_grant', 
        error_description: 'authorization code 不属于此客户端' 
      }, 400);
    }

    logger.info({ 
      unionidPrefix: userInfo.unionid.substring(0, 8),
      nickname: userInfo.nickname,
      clientId,
      authMethod 
    }, '颁发 access_token');

    // 返回标准 OAuth2 Token 响应 (RFC 6749 Section 5.1)
    // 注意：这里简化处理，直接用 code 作为 access_token
    // 生产环境建议生成新的 JWT token
    return c.json({
      access_token: code,
      token_type: 'Bearer',
      expires_in: 600, // 10 分钟
      // scope: 'openid profile',  // 可选：返回授权的 scope
    });
  });

  // 用户信息端点
  app.get(`${BASE_PATH}/oidc/me`, (c) => {
    // OAuth2 标准支持两种方式传递 access_token：
    // 1. Authorization Header: Authorization: Bearer ACCESS_TOKEN
    // 2. Query String: ?access_token=ACCESS_TOKEN
    
    let token: string | undefined;
    let tokenSource: 'header' | 'query' | 'none' = 'none';
    
    // 方式 1: 从 Authorization Header 获取
    const authHeader = c.req.header('authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
      tokenSource = 'header';
    }
    
    // 方式 2: 从 Query String 获取（Logto OAuth2 连接器使用此方式）
    if (!token) {
      token = c.req.query('access_token');
      if (token) {
        tokenSource = 'query';
      }
    }

    logger.info({
      endpoint: '/oidc/me',
      hasToken: !!token,
      tokenSource,
      tokenPrefix: token?.substring(0, 16)
    }, '收到用户信息请求');
    
    if (!token) {
      logger.warn({ tokenSource }, '缺少 access_token');
      return c.json({ 
        error: 'invalid_request', 
        error_description: '缺少 access_token，请通过 Authorization Header 或 Query String 传递' 
      }, 401);
    }
    
    // 从存储中获取用户信息
    const userInfo = storage.getUserInfo(token);
    if (!userInfo) {
      logger.warn({ 
        tokenPrefix: token.substring(0, 16),
        tokenSource 
      }, 'access_token 无效或已过期');
      return c.json({ error: 'invalid_token', error_description: 'token 无效或已过期' }, 401);
    }

    logger.info({ 
      unionidPrefix: userInfo.unionid.substring(0, 8),
      nickname: userInfo.nickname,
      clientId: userInfo.clientId,
      tokenSource,
      tokenAge: Date.now() - userInfo.timestamp
    }, '返回用户信息');

    // 返回标准 OIDC UserInfo 响应
    return c.json({
      sub: userInfo.unionid,
      name: userInfo.nickname,
      nickname: userInfo.nickname,
      picture: userInfo.avatar,
    });
  });

  return app;
}
