@echo off
chcp 65001 >nul
echo ================================================
echo    风洞流场重建系统 - 一键启动脚本
echo    Wind Tunnel Flow Reconstruction System
echo ================================================
echo.

echo [1/3] 启动 CFD 计算服务 (Python)...
cd compute
if not exist "venv" (
    echo 创建 Python 虚拟环境...
    python -m venv venv
)
call venv\Scripts\activate.bat
pip install -q -r requirements.txt
start "CFD Compute Service" cmd /k "cd /d %~dp0compute && call venv\Scripts\activate.bat && python app.py"
cd ..
echo CFD 服务启动中...
timeout /t 3 /nobreak >nul

echo.
echo [2/3] 启动 WebSocket 数据中台 (Go)...
cd backend
go mod tidy
start "Wind Tunnel Backend" cmd /k "cd /d %~dp0backend && go run main.go"
cd ..
echo 中台服务启动中...
timeout /t 5 /nobreak >nul

echo.
echo [3/3] 打开浏览器访问前端...
echo ================================================
echo    服务地址:
echo    - 前端界面: http://localhost:8080/
echo    - WebSocket: ws://localhost:8080/api/ws
echo    - CFD API:  http://localhost:5001/api/health
echo ================================================
echo.
start http://localhost:8080/
echo 系统已启动！按任意键退出此窗口（服务将继续运行）。
pause >nul
