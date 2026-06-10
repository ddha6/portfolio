@echo off
chcp 65001 >nul
cd /d D:\HI\1
echo.
echo ============================================
echo   作品集部署工具
echo ============================================
echo.
echo 请先在 admin.html 中编辑并点「保存」
echo 然后找到下载的 data.js 文件
echo.
set /p "src=将 data.js 文件拖入此窗口（或输入路径）: "
set "src=%src:"=%"
if not exist "%src%" (
    echo ❌ 文件不存在: %src%
    pause
    exit /b
)
copy /y "%src%" "D:\HI\1\data.js" >nul
echo ✓ data.js 已更新
echo.
git add data.js
git commit -m "update: data refresh"
git push origin main
echo.
echo ✓ 已推送上线！
echo 刷新 https://aixiaotan.xyz
echo.
pause
