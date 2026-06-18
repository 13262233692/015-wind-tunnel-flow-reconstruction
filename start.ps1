$ErrorActionPreference = "Continue"
$ProgressPreference = "SilentlyContinue"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host "================================================" -ForegroundColor Cyan
Write-Host "   风洞流场重建系统 - 启动脚本" -ForegroundColor Cyan
Write-Host "   Wind Tunnel Flow Reconstruction System" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "[1/3] 启动 CFD 计算服务 (Python)..." -ForegroundColor Yellow
Set-Location "$RootDir\compute"
if (-not (Test-Path "venv")) {
    Write-Host "  创建 Python 虚拟环境..." -ForegroundColor Gray
    python -m venv venv 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  使用 python3 重试..." -ForegroundColor Gray
        python3 -m venv venv
    }
}
if (Test-Path "venv\Scripts\python.exe") {
    $PyExe = "venv\Scripts\python.exe"
} else {
    $PyExe = "python"
}
& $PyExe -m pip install -q -r requirements.txt 2>$null
$CFDProcess = Start-Process -FilePath $PyExe -ArgumentList "app.py" -PassThru -NoNewWindow
Write-Host "  CFD 服务 PID: $($CFDProcess.Id)" -ForegroundColor Green
Start-Sleep -Seconds 3

Write-Host ""
Write-Host "[2/3] 启动 WebSocket 数据中台 (Go)..." -ForegroundColor Yellow
Set-Location "$RootDir\backend"
go mod tidy 2>$null | Out-Null
$GoProcess = Start-Process -FilePath "go" -ArgumentList "run","main.go" -PassThru -NoNewWindow
Write-Host "  中台服务 PID: $($GoProcess.Id)" -ForegroundColor Green
Start-Sleep -Seconds 5

Write-Host ""
Write-Host "[3/3] 打开浏览器访问前端..." -ForegroundColor Yellow
Start-Process "http://localhost:8080/"

Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "   服务地址:" -ForegroundColor Cyan
Write-Host "   - 前端界面: http://localhost:8080/" -ForegroundColor White
Write-Host "   - WebSocket: ws://localhost:8080/api/ws" -ForegroundColor White
Write-Host "   - CFD API:  http://localhost:5001/api/health" -ForegroundColor White
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "提示: 关闭此窗口将终止所有服务进程" -ForegroundColor Yellow
Write-Host "按 Ctrl+C 停止所有服务..." -ForegroundColor Gray

try {
    while ($true) {
        if (-not $CFDProcess.HasExited -and -not $GoProcess.HasExited) {
            Start-Sleep -Seconds 2
        } else {
            Write-Host ""
            Write-Host "检测到服务进程退出..." -ForegroundColor Red
            break
        }
    }
} finally {
    Write-Host ""
    Write-Host "正在停止所有服务..." -ForegroundColor Yellow
    if (-not $CFDProcess.HasExited) { Stop-Process -Id $CFDProcess.Id -Force -ErrorAction SilentlyContinue; Write-Host "  CFD 服务已停止" -ForegroundColor Gray }
    if (-not $GoProcess.HasExited) { Stop-Process -Id $GoProcess.Id -Force -ErrorAction SilentlyContinue; Write-Host "  中台服务已停止" -ForegroundColor Gray }
    Write-Host "所有服务已终止" -ForegroundColor Green
}
