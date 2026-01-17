import type { WeChatApp, WeChatTokenResponse, WeChatUserInfo } from './types';

export class WeChatAPI {
  // 获取授权 URL
  static getAuthUrl(app: WeChatApp, redirectUri: string, state: string, scope: string = 'snsapi_userinfo'): string {
    if (app.type === 'official-account') {
      // 公众号授权
      const params = new URLSearchParams({
        appid: app.appid,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope,
        state,
      });
      return `https://open.weixin.qq.com/connect/oauth2/authorize?${params.toString()}#wechat_redirect`;
    } else {
      // 开放平台扫码授权
      const params = new URLSearchParams({
        appid: app.appid,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'snsapi_login',
        state,
      });
      return `https://open.weixin.qq.com/connect/qrconnect?${params.toString()}#wechat_redirect`;
    }
  }

  // 用 code 换取 access_token
  static async getAccessToken(app: WeChatApp, code: string): Promise<WeChatTokenResponse> {
    const url = `https://api.weixin.qq.com/sns/oauth2/access_token?appid=${app.appid}&secret=${app.appsecret}&code=${code}&grant_type=authorization_code`;
    
    const response = await fetch(url);
    const data = await response.json() as any;

    if (data.errcode) {
      throw new Error(`微信 API 错误: ${data.errcode} - ${data.errmsg}`);
    }

    return data as WeChatTokenResponse;
  }

  // 获取用户信息
  static async getUserInfo(accessToken: string, openid: string): Promise<WeChatUserInfo> {
    const url = `https://api.weixin.qq.com/sns/userinfo?access_token=${accessToken}&openid=${openid}&lang=zh_CN`;
    
    const response = await fetch(url);
    const data = await response.json() as any;

    if (data.errcode) {
      throw new Error(`微信 API 错误: ${data.errcode} - ${data.errmsg}`);
    }

    return data as WeChatUserInfo;
  }

  // 检测是否为微信客户端
  static isWeChatBrowser(userAgent: string): boolean {
    return /MicroMessenger/i.test(userAgent);
  }
}
