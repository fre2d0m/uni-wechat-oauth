# PowerShell 版本 - Windows 开发环境启动脚本
# 使用方法: .\scripts\dev-with-tunnel.ps1

# 配置区域 - 根据你使用的内网穿透工具修改
$TUNNEL_COMMAND = "cloudflared"
$TUNNEL_ARGS = @("tunnel", "--url", "http://localhost:3000")
# 其他常见的内网穿透工具示例：
# $TUNNEL_COMMAND = "ngrok"
# $TUNNEL_ARGS = @("http", "3000")

$TunnelProcess = $null
$DevProcess = $null

# 清理函数
function Cleanup {
    Write-Host "`n正在停止服务..." -ForegroundColor Yellow
    
    if ($DevProcess -and !$DevProcess.HasExited) {
        Write-Host "停止开发服务器 (PID: $($DevProcess.Id))" -ForegroundColor Blue
        Stop-Process -Id $DevProcess.Id -Force -ErrorAction SilentlyContinue
    }
    
    if ($TunnelProcess -and !$TunnelProcess.HasExited) {
        Write-Host "停止内网穿透服务 (PID: $($TunnelProcess.Id))" -ForegroundColor Blue
        Stop-Process -Id $TunnelProcess.Id -Force -ErrorAction SilentlyContinue
    }
    
    Write-Host "所有服务已停止" -ForegroundColor Green
    exit 0
}

# 注册清理事件
Register-EngineEvent -SourceIdentifier PowerShell.Exiting -Action { Cleanup }
$null = Register-ObjectEvent -InputObject ([Console]) -EventName CancelKeyPress -Action { Cleanup }

try {
    Write-Host "=== WeChat OAuth Aggregator 开发环境 ===" -ForegroundColor Green
    Write-Host ""

    # 1. 启动内网穿透服务
    Write-Host "启动内网穿透服务..." -ForegroundColor Blue
    Write-Host "命令: $TUNNEL_COMMAND $($TUNNEL_ARGS -join ' ')" -ForegroundColor Yellow
    
    $TunnelProcess = Start-Process -FilePath $TUNNEL_COMMAND -ArgumentList $TUNNEL_ARGS `
        -RedirectStandardOutput "tunnel.log" -RedirectStandardError "tunnel-error.log" `
        -NoNewWindow -PassThru
    
    Start-Sleep -Seconds 2
    
    if ($TunnelProcess.HasExited) {
        Write-Host "内网穿透服务启动失败！" -ForegroundColor Red
        Write-Host "查看日志: cat tunnel-error.log" -ForegroundColor Yellow
        exit 1
    }
    
    Write-Host "✓ 内网穿透服务已启动 (PID: $($TunnelProcess.Id))" -ForegroundColor Green
    Write-Host "查看内网穿透日志: Get-Content tunnel.log -Wait" -ForegroundColor Yellow
    Write-Host ""

    # 2. 启动开发服务器
    Write-Host "启动开发服务器..." -ForegroundColor Blue
    
    $DevProcess = Start-Process -FilePath "bun" -ArgumentList @("run", "--watch", "src/index.ts") `
        -NoNewWindow -PassThru
    
    Start-Sleep -Seconds 2
    
    if ($DevProcess.HasExited) {
        Write-Host "开发服务器启动失败！" -ForegroundColor Red
        Cleanup
        exit 1
    }
    
    Write-Host "✓ 开发服务器已启动 (PID: $($DevProcess.Id))" -ForegroundColor Green
    Write-Host ""

    Write-Host "=== 服务运行中 ===" -ForegroundColor Green
    Write-Host "本地地址: http://localhost:3000" -ForegroundColor Blue
    Write-Host "内网穿透日志: Get-Content tunnel.log -Wait" -ForegroundColor Yellow
    Write-Host "按 Ctrl+C 停止所有服务" -ForegroundColor Yellow
    Write-Host ""

    # 等待开发服务器进程
    $DevProcess.WaitForExit()
}
finally {
    Cleanup
}
