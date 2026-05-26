@echo off
mode con: cols=50 lines=33
cmd.exe /k "cd /d %~dp0 && node src/index.js"
