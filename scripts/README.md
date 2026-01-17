# 开发脚本说明

## dev-with-tunnel - 带内网穿透的开发环境

这个脚本会在启动开发服务器前自动启动内网穿透服务，并在开发服务器停止时自动清理。

### 使用方法

#### macOS / Linux

```bash
# 1. 添加执行权限（首次使用）
chmod +x scripts/dev-with-tunnel.sh

# 2. 运行
bun run dev:tunnel
# 或直接执行
./scripts/dev-with-tunnel.sh
```

#### Windows

```powershell
# PowerShell 中运行
bun run dev:tunnel:win
# 或直接执行
powershell -ExecutionPolicy Bypass -File .\scripts\dev-with-tunnel.ps1
```

### 配置内网穿透工具

编辑脚本文件，修改 `TUNNEL_COMMAND` 变量：

#### Cloudflare Tunnel (推荐)

```bash
# 安装
brew install cloudflare/cloudflare/cloudflared  # macOS
# 或访问 https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/

# 配置
TUNNEL_COMMAND="cloudflared tunnel --url http://localhost:3000"
```

#### ngrok

```bash
# 安装
brew install ngrok  # macOS
# 或访问 https://ngrok.com/download

# 配置
TUNNEL_COMMAND="ngrok http 3000"
```

#### bore

```bash
# 安装
cargo install bore-cli
# 或下载二进制文件 https://github.com/ekzhang/bore

# 配置
TUNNEL_COMMAND="bore local 3000 --to bore.pub"
```

#### localtunnel

```bash
# 安装
npm install -g localtunnel

# 配置
TUNNEL_COMMAND="lt --port 3000"
```

#### frp (自建)

```bash
# 需要自己部署 frp 服务器
# 配置
TUNNEL_COMMAND="frpc -c frpc.ini"
```

### 工作原理

1. **启动内网穿透服务**（后台运行）
   - 输出重定向到 `tunnel.log`
   - 不会阻塞后续命令

2. **启动开发服务器**（前台运行）
   - 支持热重载
   - 可以看到实时日志

3. **信号处理**
   - 按 `Ctrl+C` 时会同时停止两个服务
   - 确保资源正确清理

### 查看内网穿透日志

```bash
# 实时查看
tail -f tunnel.log

# 查看全部
cat tunnel.log
```

### 常见问题

#### 1. 权限错误（macOS/Linux）

```bash
chmod +x scripts/dev-with-tunnel.sh
```

#### 2. 内网穿透工具未安装

根据你选择的工具，按照上面的安装说明进行安装。

#### 3. 端口被占用

确保 3000 端口没有被其他程序占用：

```bash
# macOS/Linux
lsof -i :3000

# Windows
netstat -ano | findstr :3000
```

#### 4. 内网穿透服务启动失败

查看错误日志：

```bash
cat tunnel.log
# Windows
Get-Content tunnel.log
```

### 推荐工具对比

| 工具 | 优点 | 缺点 | 适用场景 |
|------|------|------|----------|
| **Cloudflare Tunnel** | 免费、稳定、快速、无需注册 | 需要安装客户端 | 推荐用于开发测试 |
| **ngrok** | 功能强大、有 Web UI | 免费版有限制、需要注册 | 需要固定域名时 |
| **bore** | 开源、简单、无需注册 | 稳定性一般 | 临时测试 |
| **localtunnel** | 简单、npm 安装 | 不太稳定 | 快速测试 |
| **frp** | 完全自主控制 | 需要自己部署服务器 | 生产环境或长期使用 |

### 微信开发注意事项

使用内网穿透进行微信开发时：

1. **域名配置**：将内网穿透提供的域名配置到微信公众平台/开放平台
2. **HTTPS 要求**：大多数内网穿透工具默认提供 HTTPS
3. **域名稳定性**：
   - Cloudflare Tunnel: 每次启动域名会变化
   - ngrok 付费版: 可以固定域名
   - frp 自建: 完全自主控制

4. **开发流程**：
   ```bash
   # 1. 启动服务
   bun run dev:tunnel
   
   # 2. 从日志中获取公网 URL
   tail -f tunnel.log
   
   # 3. 配置到微信平台
   # 例如: https://abc123.trycloudflare.com
   
   # 4. 开始开发和测试
   ```
