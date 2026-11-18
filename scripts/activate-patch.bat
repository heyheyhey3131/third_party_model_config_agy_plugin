@echo off
chcp 65001 >nul
title Antigravity Third-Party Model Patch

echo ======================================================================
echo        Antigravity Third-Party Model Patch (modelPatch) 管理工具
echo ======================================================================
echo.
echo  [1] 关闭 Antigravity 并应用/重新应用补丁，然后自动重启 (推荐)
echo  [2] 等待我手动关闭 Antigravity 后自动应用补丁并重启
echo  [3] 仅查看补丁状态 (只读)
echo  [4] 校验 app.asar 完整性与补丁标记 (只读)
echo  [5] 退出
echo.
set /p choice="请输入选项 [1/2/3/4/5] (默认回车选择 1): "

if "%choice%"=="" set choice=1
if "%choice%"=="1" goto opt1
if "%choice%"=="2" goto opt2
if "%choice%"=="3" goto opt3
if "%choice%"=="4" goto opt4
if "%choice%"=="5" goto end
goto opt1

:opt1
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0activate-patch.ps1" -ForceClose -AutoRestart
echo.
echo 补丁应用完成。
timeout /t 3 >nul
goto end

:opt2
echo.
echo 请现在手动关闭 Antigravity（托盘图标右键退出或关闭所有窗口）...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0activate-patch.ps1" -AutoRestart
echo.
echo 补丁应用完成。
pause
goto end

:opt3
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0activate-patch.ps1" -StatusOnly
echo.
pause
goto end

:opt4
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0activate-patch.ps1" -VerifyOnly
echo.
pause
goto end

:end
