@echo off
rem VidSnap 开机自启脚本：拉起 Next.js + cloudflared 隧道（静默最小化窗口）
rem 由 Windows 启动文件夹的 VidSnap-autostart.vbs 静默调用
cd /d "d:\learning\GitHub\vidSnap"

rem 1. 若 3000 端口已有服务在监听，跳过启动（避免重复拉起）
curl -s -o nul http://localhost:3000 && goto server_up

rem 2. 启动 Next.js 生产服务器（最小化窗口）
start "VidSnap-Server" /min cmd /c ""C:\Program Files\nodejs\node.exe" node_modules\next\dist\bin\next start -p 3000 -H 0.0.0.0"

rem 3. 轮询等待服务就绪（最多约 60 秒），冷启动慢时隧道不会提前拉起
set /a retry=0
:wait_server
timeout /t 2 /nobreak >nul
curl -s -o nul http://localhost:3000 && goto server_up
set /a retry+=1
if %retry% lss 30 goto wait_server

:server_up
rem 4. 启动 cloudflared 隧道（最小化窗口，绝对路径避免依赖 PATH）
start "VidSnap-Tunnel" /min cmd /c ""d:\learning\GitHub\vidSnap\cloudflared.exe" tunnel --config "d:\learning\GitHub\vidSnap\cloudflared-config.yml" run"

exit
