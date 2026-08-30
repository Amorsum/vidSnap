@echo off
rem VidSnap 开机自启脚本：拉起 Next.js + cloudflared 隧道（静默最小化窗口）
rem 由 Windows 启动文件夹的 VidSnap-autostart.vbs 静默调用
cd /d "d:\learning\GitHub\vidSnap"

rem 1. 启动 Next.js 生产服务器（最小化窗口）
start "VidSnap-Server" /min cmd /c ""C:\Program Files\nodejs\node.exe" node_modules\next\dist\bin\next start -p 3000 -H 0.0.0.0"

rem 2. 等待 Next.js 就绪
timeout /t 8 /nobreak >nul

rem 3. 启动 cloudflared 隧道（最小化窗口）
start "VidSnap-Tunnel" /min cmd /c "cloudflared.exe tunnel --config cloudflared-config.yml run"

exit
