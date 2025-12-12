@echo off
REM Verify project structure

echo Checking project structure...
echo.

if not exist "src\" (
    echo [ERROR] src directory is missing!
    echo Creating src directory...
    mkdir src
    echo [CREATED] src directory
) else (
    echo [OK] src directory exists
)

if not exist "src\index.ts" (
    echo [ERROR] src\index.ts is missing!
    echo This file needs to be created. See below for instructions.
) else (
    echo [OK] src\index.ts exists
    dir src\index.ts
)

echo.
echo Checking other files...
if exist "package.json" (echo [OK] package.json) else (echo [ERROR] package.json missing)
if exist "tsconfig.json" (echo [OK] tsconfig.json) else (echo [ERROR] tsconfig.json missing)
if exist "README.md" (echo [OK] README.md) else (echo [ERROR] README.md missing)

echo.
echo Current directory contents:
dir /b

echo.
echo If src\index.ts is missing, you need to copy it from the outputs folder
echo or recreate it from the project files.
