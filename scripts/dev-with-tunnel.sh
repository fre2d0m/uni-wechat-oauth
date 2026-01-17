#!/bin/bash

# 开发环境启动脚本 - 带内网穿透
# 使用方法: ./scripts/dev-with-tunnel.sh

set -e

# 颜色输出
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# 配置区域 - 根据你使用的内网穿透工具修改
TUNNEL_COMMAND="cloudflared tunnel --url http://localhost:3000"
# 其他常见的内网穿透工具示例：
# TUNNEL_COMMAND="ngrok http 3000"
# TUNNEL_COMMAND="bore local 3000 --to bore.pub"
# TUNNEL_COMMAND="localtunnel --port 3000"

TUNNEL_PID=""
DEV_PID=""

# 清理函数
cleanup() {
    echo -e "\n${YELLOW}正在停止服务...${NC}"
    
    # 停止开发服务器
    if [ ! -z "$DEV_PID" ]; then
        echo -e "${BLUE}停止开发服务器 (PID: $DEV_PID)${NC}"
        kill -TERM $DEV_PID 2>/dev/null || true
        wait $DEV_PID 2>/dev/null || true
    fi
    
    # 停止内网穿透
    if [ ! -z "$TUNNEL_PID" ]; then
        echo -e "${BLUE}停止内网穿透服务 (PID: $TUNNEL_PID)${NC}"
        kill -TERM $TUNNEL_PID 2>/dev/null || true
        wait $TUNNEL_PID 2>/dev/null || true
    fi
    
    echo -e "${GREEN}所有服务已停止${NC}"
    exit 0
}

# 捕获退出信号
trap cleanup SIGINT SIGTERM EXIT

echo -e "${GREEN}=== WeChat OAuth Aggregator 开发环境 ===${NC}\n"

# 1. 启动内网穿透服务
echo -e "${BLUE}启动内网穿透服务...${NC}"
echo -e "${YELLOW}命令: $TUNNEL_COMMAND${NC}"
$TUNNEL_COMMAND > tunnel.log 2>&1 &
TUNNEL_PID=$!

# 等待内网穿透服务启动
sleep 2

# 检查内网穿透是否成功启动
if ! kill -0 $TUNNEL_PID 2>/dev/null; then
    echo -e "${RED}内网穿透服务启动失败！${NC}"
    echo -e "${YELLOW}查看日志: cat tunnel.log${NC}"
    exit 1
fi

echo -e "${GREEN}✓ 内网穿透服务已启动 (PID: $TUNNEL_PID)${NC}"
echo -e "${YELLOW}查看内网穿透日志: tail -f tunnel.log${NC}\n"

# 2. 启动开发服务器
echo -e "${BLUE}启动开发服务器...${NC}"
bun run --watch src/index.ts &
DEV_PID=$!

# 等待开发服务器启动
sleep 2

# 检查开发服务器是否成功启动
if ! kill -0 $DEV_PID 2>/dev/null; then
    echo -e "${RED}开发服务器启动失败！${NC}"
    cleanup
    exit 1
fi

echo -e "${GREEN}✓ 开发服务器已启动 (PID: $DEV_PID)${NC}\n"

echo -e "${GREEN}=== 服务运行中 ===${NC}"
echo -e "${BLUE}本地地址: http://localhost:3000${NC}"
echo -e "${YELLOW}内网穿透日志: tail -f tunnel.log${NC}"
echo -e "${YELLOW}按 Ctrl+C 停止所有服务${NC}\n"

# 等待开发服务器进程
wait $DEV_PID
