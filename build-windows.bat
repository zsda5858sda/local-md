@echo off
setlocal

cd /d "%~dp0"

if not defined CI set "CI=true"

echo [Local MD] Checking build tools...

where node >nul 2>&1
if errorlevel 1 (
  if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" (
    set "PATH=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\override;%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback;%PATH%"
    echo [Local MD] Using the Node.js runtime bundled with Codex.
  )
)

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js was not found.
  echo Install the Node.js LTS release from https://nodejs.org/ and reopen this terminal.
  exit /b 1
)

where pnpm >nul 2>&1
if errorlevel 1 (
  echo [ERROR] pnpm was not found in PATH.
  echo Install it with: npm install --global pnpm
  exit /b 1
)

where cargo >nul 2>&1
if errorlevel 1 (
  if exist "%USERPROFILE%\.cargo\bin\cargo.exe" (
    set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"
    echo [Local MD] Using Cargo from the current user profile.
  )
)

where cargo >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Rust/Cargo was not found.
  echo Install Rust from https://rustup.rs/ and reopen this terminal.
  exit /b 1
)

echo [Local MD] Building Windows release packages...
echo.

call pnpm tauri build %*
if errorlevel 1 (
  echo.
  echo [ERROR] Build failed. Review the messages above for details.
  exit /b 1
)

echo.
echo [SUCCESS] Local MD build completed.
echo.
echo Application:
echo   %~dp0src-tauri\target\release\local-md.exe
echo.
echo NSIS installer:
for %%F in ("%~dp0src-tauri\target\release\bundle\nsis\*.exe") do if exist "%%~fF" echo   %%~fF
echo.
echo MSI installer:
for %%F in ("%~dp0src-tauri\target\release\bundle\msi\*.msi") do if exist "%%~fF" echo   %%~fF

exit /b 0
