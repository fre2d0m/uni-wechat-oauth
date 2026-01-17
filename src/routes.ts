import { Hono } from 'hono';
import type { ConfigManager } from './config';
import type { StateStorage } from './storage';
import { WeChatAPI } from './wechat';
import type { WeChatApp } from './types';
import { logger } from './logger';

export function createRoutes(config: ConfigManager, storage: StateStorage) {
  const app = new Hono();

  // 健康检查
  app.get('/health', (c) => {
    return c.json({ status: 'ok', service: 'wechat-oauth-aggregator' });
  });

  // 授权端点
  app.get('/authorize', (c) => {
    const clientId = c.req.query('client_id');
    const redirectUri = c.req.query('redirect_uri');
    const state = c.req.query('state') || '';
    const scope = c.req.query('scope') || 'snsapi_userinfo';

    if (!clientId || !redirectUri) {
      return c.json({ error: 'invalid_request', error_description: '缺少必要参数' }, 400);
    }

    // 验证客户端
    const client = config.getClient(clientId);
    if (!client) {
      return c.json({ error: 'invalid_client', error_description: '无效的客户端' }, 401);
    }

    // 解析 state 参数，检查是否强制指定应用
    let targetApp: WeChatApp | undefined;
    let originalState = state;

    if (state.includes(':')) {
      const [alias, restState] = state.split(':', 2);
      targetApp = config.getWeChatApp(alias);
      originalState = restState;
      
      if (!targetApp) {
        return c.json({ error: 'invalid_request', error_description: `未找到别名为 ${alias} 的微信应用` }, 400);
      }
    } else {
      // 根据 User-Agent 自动选择
      const userAgent = c.req.header('user-agent') || '';
      const isWeChat = WeChatAPI.isWeChatBrowser(userAgent);
      
      const defaultApps = config.getDefaultApps();
      targetApp = isWeChat ? defaultApps.oa : defaultApps.op;

      if (!targetApp) {
        return c.json({ 
          error: 'server_error', 
          error_description: `未配置${isWeChat ? '公众号' : '开放平台'}应用` 
        }, 500);
      }
    }

    // 构造回调 URL（指向本服务）
    // 考虑反向代理的路径前缀
    const forwardedPrefix = c.req.header('x-forwarded-prefix') || '';
    const callbackPath = `${forwardedPrefix}/callback`;
    const callbackUrl = new URL(callbackPath, c.req.url).toString();
    
    // 在 state 中编码必要信息
    const internalState = JSON.stringify({
      originalState,
      clientId,
      redirectUri,
      appAlias: targetApp.alias,
    });
    const encodedState = Buffer.from(internalState).toString('base64url');

    // 重定向到微信授权页面
    const authUrl = WeChatAPI.getAuthUrl(targetApp, callbackUrl, encodedState, scope);
    
    logger.info({ 
      type: targetApp.type, 
      alias: targetApp.alias,
      clientId 
    }, '授权分流');
    return c.redirect(authUrl);
  });

  // 微信回调端点
  app.get('/callback', async (c) => {
    const code = c.req.query('code');
    const encodedState = c.req.query('state');

    if (!code || !encodedState) {
      return c.json({ error: 'invalid_request', error_description: '缺少 code 或 state' }, 400);
    }

    try {
      // 解码 state
      const stateJson = Buffer.from(encodedState, 'base64url').toString('utf-8');
      const { originalState, clientId, redirectUri, appAlias } = JSON.parse(stateJson);

      // 获取对应的微信应用配置
      const app = config.getWeChatApp(appAlias);
      if (!app) {
        logger.error({ appAlias }, '应用配置丢失');
        return c.json({ error: 'server_error', error_description: '应用配置丢失' }, 500);
      }

      logger.info({ alias: app.alias, clientId }, '微信回调');

      // 用 code 换取 access_token 和 unionid
      const tokenData = await WeChatAPI.getAccessToken(app, code);
      
      if (!tokenData.unionid) {
        logger.error({ appAlias: app.alias }, '未获取到 UnionID');
        return c.json({ 
          error: 'server_error', 
          error_description: '未获取到 UnionID，请确保应用已绑定到开放平台' 
        }, 500);
      }

      // 获取用户信息
      const userInfo = await WeChatAPI.getUserInfo(tokenData.access_token, tokenData.openid);

      // 生成内部 code
      const internalCode = storage.generateCode();
      
      // 存储用户信息
      storage.set(internalCode, {
        unionid: userInfo.unionid,
        openid: userInfo.openid,
        nickname: userInfo.nickname,
        avatar: userInfo.headimgurl,
        originalState,
        clientId,
        timestamp: Date.now(),
      });

      logger.info({ 
        unionid: userInfo.unionid,
        nickname: userInfo.nickname,
        appAlias: app.alias 
      }, '用户认证成功');

      // 重定向回 Logto
      const callbackUrl = new URL(redirectUri);
      callbackUrl.searchParams.set('code', internalCode);
      callbackUrl.searchParams.set('state', originalState);

      return c.redirect(callbackUrl.toString());
    } catch (error) {
      logger.error({ error: error instanceof Error ? error.message : String(error) }, '回调处理失败');
      return c.json({ 
        error: 'server_error', 
        error_description: error instanceof Error ? error.message : '未知错误' 
      }, 500);
    }
  });

  // Token 端点
  app.post('/oidc/token', async (c) => {
    const body = await c.req.parseBody();
    
    const grantType = body.grant_type;
    const code = body.code as string;
    const clientId = body.client_id as string;
    const clientSecret = body.client_secret as string;

    if (grantType !== 'authorization_code') {
      return c.json({ error: 'unsupported_grant_type' }, 400);
    }

    if (!code || !clientId || !clientSecret) {
      return c.json({ error: 'invalid_request', error_description: '缺少必要参数' }, 400);
    }

    // 验证客户端
    if (!config.validateClient(clientId, clientSecret)) {
      return c.json({ error: 'invalid_client' }, 401);
    }

    // 获取存储的用户信息
    const authState = storage.get(code);
    if (!authState) {
      return c.json({ error: 'invalid_grant', error_description: 'code 无效或已过期' }, 400);
    }

    // 验证客户端匹配
    if (authState.clientId !== clientId) {
      return c.json({ error: 'invalid_grant', error_description: 'client_id 不匹配' }, 400);
    }

    logger.info({ unionid: authState.unionid, clientId }, '颁发 Token');

    // 返回标准 OAuth2 Token 响应
    // 这里简化处理，直接用 code 作为 access_token（因为我们的 /oidc/me 会用它查询）
    return c.json({
      access_token: code,
      token_type: 'Bearer',
      expires_in: 600, // 10 分钟
    });
  });

  // 用户信息端点
  app.get('/oidc/me', (c) => {
    const authHeader = c.req.header('authorization');
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return c.json({ error: 'invalid_token' }, 401);
    }

    const token = authHeader.substring(7);
    
    // 从存储中获取用户信息
    const authState = storage.get(token);
    if (!authState) {
      return c.json({ error: 'invalid_token', error_description: 'token 无效或已过期' }, 401);
    }

    logger.info({ unionid: authState.unionid }, '返回用户信息');

    // 返回标准 OIDC UserInfo 响应
    return c.json({
      sub: authState.unionid,
      name: authState.nickname,
      nickname: authState.nickname,
      picture: authState.avatar,
    });
  });

  return app;
}
