#!/usr/bin/env bun
import { parseArgs } from 'util';
import { ConfigManager } from './config';
import { StateStorage } from './storage';
import { createRoutes } from './routes';
import { logger } from './logger';

// 解析命令行参数
const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    wechat: {
      type: 'string',
      short: 'w',
      default: './wechatapps.toml',
    },
    clients: {
      type: 'string',
      short: 'c',
      default: './clients.toml',
    },
    port: {
      type: 'string',
      short: 'p',
      default: '3000',
    },
  },
  strict: true,
  allowPositionals: false,
});

const PORT = parseInt(values.port || '3000', 10);
const WECHAT_CONFIG = values.wechat!;
const CLIENTS_CONFIG = values.clients!;

logger.info('WeChat OAuth Aggregator 启动中...');

try {
  // 加载配置
  const config = new ConfigManager(WECHAT_CONFIG, CLIENTS_CONFIG);
  
  // 初始化存储
  const storage = new StateStorage();
  
  // 创建路由
  const app = createRoutes(config, storage);

  // 启动服务器
  const server = Bun.serve({
    port: PORT,
    fetch: app.fetch,
  });

  logger.info({ 
    port: server.port,
    endpoints: {
      health: 'GET /health',
      authorize: 'GET /authorize',
      callback: 'GET /callback',
      token: 'POST /oidc/token',
      userinfo: 'GET /oidc/me'
    }
  }, '服务已启动');
  
  logger.info('提示: 在 state 参数中使用 "alias:state" 格式可强制指定微信应用');
} catch (error) {
  logger.fatal({ error: error instanceof Error ? error.message : String(error) }, '启动失败');
  process.exit(1);
}
