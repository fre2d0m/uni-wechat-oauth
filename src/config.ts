import { readFileSync } from 'fs';
import TOML from '@iarna/toml';
import type { WeChatAppsConfig, ClientsConfig, WeChatApp, Client } from './types';
import { logger } from './logger';

export class ConfigManager {
  private wechatApps: Map<string, WeChatApp> = new Map();
  private clients: Map<string, Client> = new Map();

  constructor(wechatAppsPath: string, clientsPath: string) {
    this.loadWeChatApps(wechatAppsPath);
    this.loadClients(clientsPath);
  }

  private loadWeChatApps(path: string) {
    const content = readFileSync(path, 'utf-8');
    const config = TOML.parse(content) as unknown as WeChatAppsConfig;
    
    for (const app of config.apps) {
      this.wechatApps.set(app.alias, app);
    }
    
    logger.info({ count: this.wechatApps.size }, '加载微信应用配置');
  }

  private loadClients(path: string) {
    const content = readFileSync(path, 'utf-8');
    const config = TOML.parse(content) as unknown as ClientsConfig;
    
    for (const client of config.clients) {
      this.clients.set(client.clientid, client);
    }
    
    logger.info({ count: this.clients.size }, '加载客户端配置');
  }

  getWeChatApp(alias: string): WeChatApp | undefined {
    return this.wechatApps.get(alias);
  }

  getDefaultApps(): { oa: WeChatApp | undefined; op: WeChatApp | undefined } {
    let oa: WeChatApp | undefined;
    let op: WeChatApp | undefined;

    for (const app of this.wechatApps.values()) {
      if (app.type === 'official-account' && !oa) {
        oa = app;
      }
      if (app.type === 'open-platform' && !op) {
        op = app;
      }
    }

    return { oa, op };
  }

  getClient(clientId: string): Client | undefined {
    return this.clients.get(clientId);
  }

  validateClient(clientId: string, clientSecret: string): boolean {
    const client = this.clients.get(clientId);
    return client?.clientsecret === clientSecret;
  }
}
