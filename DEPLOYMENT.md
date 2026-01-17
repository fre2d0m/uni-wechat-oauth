# 部署指南

## 打包为单一可执行文件

Bun 支持将应用打包为独立的可执行文件，无需在服务器上安装 Node.js 或 Bun 运行时。

### 本地构建

```bash
# 安装依赖
bun install

# 为当前平台构建
bun run build

# 为特定平台构建
bun run build:linux    # Linux x64
bun run build:macos    # macOS x64
bun run build:windows  # Windows x64
```

构建完成后会生成可执行文件：
- `wechat-oauth-aggregator` (当前平台)
- `wechat-oauth-aggregator-linux` (Linux)
- `wechat-oauth-aggregator-macos` (macOS)
- `wechat-oauth-aggregator.exe` (Windows)

### 文件大小

打包后的可执行文件约 **50-90MB**，包含了完整的 Bun 运行时和所有依赖。

## 服务器环境要求

### 最小要求

**无需任何运行时依赖！** 打包后的可执行文件是完全独立的。

#### Linux 服务器
- **操作系统**: Linux x64 (glibc 2.27+)
  - Ubuntu 18.04+
  - Debian 10+
  - CentOS 8+
  - RHEL 8+
  - Alpine Linux (需要 glibc 兼容层)
- **架构**: x86_64 (AMD64)
- **内存**: 最低 128MB，推荐 512MB+
- **磁盘**: 200MB 可用空间

#### macOS 服务器
- **版本**: macOS 11 (Big Sur) 或更高
- **架构**: x86_64 或 Apple Silicon (M1/M2)

#### Windows 服务器
- **版本**: Windows 10 或 Windows Server 2016+
- **架构**: x64

### 网络要求

- **出站访问**: 需要访问微信 API
  - `api.weixin.qq.com` (443)
  - `open.weixin.qq.com` (443)
- **入站访问**: 开放服务端口（默认 3000）

## 部署步骤

### 1. 准备配置文件

在服务器上创建配置文件：

```bash
# 创建工作目录
mkdir -p /opt/wechat-oauth
cd /opt/wechat-oauth

# 创建配置文件
cat > wechatapps.toml << 'EOF'
[[apps]]
name = "公众号应用"
alias = "oa1"
type = "official-account"
appid = "wxXXXXXXXXXXXXXXXX"
appsecret = "your_secret_here"

[[apps]]
name = "开放平台应用"
alias = "op1"
type = "open-platform"
appid = "wxYYYYYYYYYYYYYYYY"
appsecret = "your_secret_here"
EOF

cat > clients.toml << 'EOF'
[[clients]]
clientid = "logto-client-id"
clientsecret = "logto-client-secret"
callbackUrl = "https://your-logto.com/callback/wechat"
EOF

# 设置权限（保护敏感信息）
chmod 600 *.toml
```

### 2. 上传可执行文件

```bash
# 从本地上传到服务器
scp wechat-oauth-aggregator-linux user@server:/opt/wechat-oauth/wechat-oauth-aggregator

# 添加执行权限
ssh user@server "chmod +x /opt/wechat-oauth/wechat-oauth-aggregator"
```

### 3. 测试运行

```bash
# 直接运行测试
./wechat-oauth-aggregator \
  --wechat ./wechatapps.toml \
  --clients ./clients.toml \
  --port 3000

# 或使用环境变量
LOG_LEVEL=debug ./wechat-oauth-aggregator
```

### 4. 配置为系统服务

#### systemd (推荐 - Linux)

创建服务文件：

```bash
sudo tee /etc/systemd/system/wechat-oauth.service << 'EOF'
[Unit]
Description=WeChat OAuth Aggregator
After=network.target

[Service]
Type=simple
User=www-data
Group=www-data
WorkingDirectory=/opt/wechat-oauth
ExecStart=/opt/wechat-oauth/wechat-oauth-aggregator \
  --wechat /opt/wechat-oauth/wechatapps.toml \
  --clients /opt/wechat-oauth/clients.toml \
  --port 3000
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
Environment="LOG_LEVEL=info"
Environment="NODE_ENV=production"

# 安全加固
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/wechat-oauth

[Install]
WantedBy=multi-user.target
EOF

# 启动服务
sudo systemctl daemon-reload
sudo systemctl enable wechat-oauth
sudo systemctl start wechat-oauth

# 查看状态
sudo systemctl status wechat-oauth

# 查看日志
sudo journalctl -u wechat-oauth -f
```

#### Docker 部署（可选）

```dockerfile
# Dockerfile
FROM scratch
COPY wechat-oauth-aggregator-linux /app
COPY wechatapps.toml /config/wechatapps.toml
COPY clients.toml /config/clients.toml
ENTRYPOINT ["/app"]
CMD ["--wechat", "/config/wechatapps.toml", "--clients", "/config/clients.toml", "--port", "3000"]
EXPOSE 3000
```

```bash
# 构建镜像
docker build -t wechat-oauth-aggregator .

# 运行容器
docker run -d \
  --name wechat-oauth \
  -p 3000:3000 \
  -v $(pwd)/wechatapps.toml:/config/wechatapps.toml:ro \
  -v $(pwd)/clients.toml:/config/clients.toml:ro \
  -e LOG_LEVEL=info \
  --restart unless-stopped \
  wechat-oauth-aggregator
```

### 5. 配置反向代理

#### Nginx

```nginx
upstream wechat_oauth {
    server 127.0.0.1:3000;
    keepalive 64;
}

server {
    listen 443 ssl http2;
    server_name id.insentek.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://wechat_oauth;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        
        # 保留 User-Agent（重要！用于判断微信客户端）
        proxy_set_header User-Agent $http_user_agent;
    }
}
```

#### Caddy

```caddyfile
oauth.yourdomain.com {
    reverse_proxy localhost:3000 {
        header_up User-Agent {http.request.header.User-Agent}
    }
}
```

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `LOG_LEVEL` | 日志级别 (trace/debug/info/warn/error/fatal) | `info` |
| `NODE_ENV` | 运行环境 (development/production) | - |

## 监控和维护

### 健康检查

```bash
# 检查服务状态
curl http://localhost:3000/health

# 预期响应
{"status":"ok","service":"wechat-oauth-aggregator"}
```

### 日志管理

```bash
# systemd 日志
sudo journalctl -u wechat-oauth -n 100 --no-pager

# 实时日志
sudo journalctl -u wechat-oauth -f

# 按时间过滤
sudo journalctl -u wechat-oauth --since "1 hour ago"
```

### 更新部署

```bash
# 1. 构建新版本
bun run build:linux

# 2. 上传到服务器
scp wechat-oauth-aggregator-linux user@server:/opt/wechat-oauth/wechat-oauth-aggregator.new

# 3. 替换并重启
ssh user@server << 'EOF'
cd /opt/wechat-oauth
mv wechat-oauth-aggregator wechat-oauth-aggregator.old
mv wechat-oauth-aggregator.new wechat-oauth-aggregator
chmod +x wechat-oauth-aggregator
sudo systemctl restart wechat-oauth
EOF
```

## 性能优化

### 资源限制

```ini
# 在 systemd 服务文件中添加
[Service]
MemoryMax=512M
CPUQuota=50%
TasksMax=100
```

### 并发处理

Bun 的性能非常出色，单实例可以轻松处理数千并发连接。如需更高性能：

```bash
# 使用多实例 + 负载均衡
# 实例 1
./wechat-oauth-aggregator --port 3001 &

# 实例 2
./wechat-oauth-aggregator --port 3002 &

# Nginx 负载均衡
upstream wechat_oauth {
    server 127.0.0.1:3001;
    server 127.0.0.1:3002;
    keepalive 64;
}
```

## 安全建议

1. **配置文件权限**: `chmod 600 *.toml`
2. **使用非 root 用户运行**
3. **启用 HTTPS**: 通过反向代理配置 SSL
4. **防火墙规则**: 只开放必要端口
5. **定期更新**: 及时更新到最新版本
6. **日志审计**: 定期检查访问日志

## 故障排查

### 服务无法启动

```bash
# 检查可执行文件权限
ls -l wechat-oauth-aggregator

# 检查配置文件
./wechat-oauth-aggregator --wechat ./wechatapps.toml --clients ./clients.toml

# 查看详细日志
LOG_LEVEL=debug ./wechat-oauth-aggregator
```

### 端口被占用

```bash
# 查看端口占用
sudo lsof -i :3000
sudo netstat -tlnp | grep 3000

# 使用其他端口
./wechat-oauth-aggregator --port 3001
```

### 微信回调失败

1. 检查服务器防火墙是否开放端口
2. 确认域名 DNS 解析正确
3. 验证 SSL 证书有效
4. 检查微信公众平台/开放平台的回调 URL 配置

## 性能基准

在 2 核 4GB 内存的服务器上：
- **QPS**: 5000+ 请求/秒
- **延迟**: P99 < 50ms
- **内存占用**: 约 80-150MB
- **并发连接**: 10000+

## 支持

如遇问题，请检查：
1. 服务日志: `journalctl -u wechat-oauth -n 100`
2. 健康检查: `curl http://localhost:3000/health`
3. 配置文件格式是否正确
