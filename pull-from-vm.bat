@echo off
setlocal

pushd "%~dp0" >nul || exit /b 1

for /f "delims=" %%i in ('git rev-parse --show-toplevel 2^>nul') do set "REPO_ROOT=%%i"
if not defined REPO_ROOT (
    echo Not inside a Git repo.
    popd
    exit /b 1
)

cd /d "%REPO_ROOT%"

set "VM_REMOTE=vm"
set "VM_URL=mc@uvd-claude1.uvd.local:~/code/taskmaster/.git"
set "BRANCH=%~1"
if not defined BRANCH set "BRANCH=main"

git remote get-url %VM_REMOTE% >nul 2>nul
if errorlevel 1 (
    git remote add %VM_REMOTE% %VM_URL% || goto :fail
) else (
    git remote set-url %VM_REMOTE% %VM_URL% || goto :fail
)

echo Pulling %BRANCH% from %VM_REMOTE%...
echo If prompted, enter your SSH key passphrase.
git pull %VM_REMOTE% %BRANCH%
set "EXITCODE=%ERRORLEVEL%"

popd >nul
exit /b %EXITCODE%

:fail
set "EXITCODE=%ERRORLEVEL%"
popd >nul
exit /b %EXITCODE%
