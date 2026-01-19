module.exports = {
  apps: [{
    name: 'uni-wechat-oauth-service',
    script: 'bun',
    args: 'run src/index.ts --wechat ./wechatapps.toml --clients ./clients.toml --port 4000',
    interpreter: 'none',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    watch: false,
    max_memory_restart: '500M',
    env: {
      NODE_ENV: 'production',
      PORT: '4000'
    },
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_file: './logs/combined.log',
    time: true,
    merge_logs: true,
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
  }]
};
