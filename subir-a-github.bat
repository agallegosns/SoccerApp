@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
cd /d "%~dp0"
title Subir cambios a GitHub - SoccerApp

echo ==============================================
echo   Subir cambios a GitHub (SoccerApp)
echo ==============================================
echo.

where git >nul 2>nul
if errorlevel 1 (
  echo [ERROR] No se encuentra Git. Instala Git para Windows: https://git-scm.com/download/win
  goto :fin
)

git rev-parse --is-inside-work-tree >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Esta carpeta no es un repositorio de Git.
  goto :fin
)

set "REMOTE="
for /f "delims=" %%i in ('git remote get-url origin 2^>nul') do set "REMOTE=%%i"
echo Repositorio: !REMOTE!
echo !REMOTE! | findstr /i "SoccerApp" >nul
if errorlevel 1 (
  echo [ERROR] El repositorio "origin" no es SoccerApp. Por seguridad no subo nada.
  goto :fin
)

set "RAMA="
for /f "delims=" %%i in ('git branch --show-current') do set "RAMA=%%i"
echo Rama actual: !RAMA!
echo.
if "!RAMA!"=="" (
  echo [ERROR] No estas en ninguna rama. Cambia a una rama y vuelve a ejecutar.
  goto :fin
)
if /i "!RAMA!"=="main" goto :protegida
if /i "!RAMA!"=="claude/blissful-davinci-1xqg19" goto :protegida
goto :seguir

:protegida
echo [AVISO] La rama !RAMA! es la que publica la web. No se sube directamente.
echo Cambia a otra rama (por ejemplo en GitHub Desktop) y vuelve a ejecutar.
goto :fin

:seguir
git add -A
git diff --cached --quiet
if errorlevel 1 (
  set "FECHA=%date% %time:~0,5%"
  git commit -m "Cambios del !FECHA!"
  if errorlevel 1 (
    echo [ERROR] No se pudo crear el commit.
    goto :fin
  )
) else (
  echo No hay cambios nuevos que guardar. Se suben los commits pendientes.
)
echo.
echo Subiendo a GitHub...
git push -u origin "!RAMA!"
if errorlevel 1 (
  echo.
  echo [ERROR] No se pudo subir. Posibles causas:
  echo  - No has iniciado sesion en GitHub: abre GitHub Desktop, inicia sesion y vuelve a ejecutar.
  echo  - Sin internet.
  echo Alternativa: en GitHub Desktop pulsa "Push origin".
  goto :fin
)
echo.
echo [OK] Subido correctamente. Abriendo la pagina para crear/ver el Pull Request...
start "" "https://github.com/agallegosns/SoccerApp/compare/claude/blissful-davinci-1xqg19...!RAMA!?expand=1"
echo Cuando los tests salgan en verde, pulsa "Merge" para publicar la web.

:fin
echo.
pause
endlocal
