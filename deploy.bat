@echo off
cd /d D:\HI\1
git add data.js
git commit -m "update: data refresh"
git push origin main
echo.
echo ✓ 已推送上线！刷新 https://ddha6.github.io/portfolio 查看
pause
