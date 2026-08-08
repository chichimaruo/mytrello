@echo off
chcp 65001 >nul
rem ---------------------------------------------------------------
rem  My Trello - Apps Script 側へ反映する（コピペの代わり）
rem  このファイルをダブルクリックしてください。
rem
rem  .ps1 を直接実行すると、Googleドライブが付ける「インターネット由来」の
rem  印(Zone.Identifier)と実行ポリシー RemoteSigned のせいで即座に閉じる。
rem  ここから -ExecutionPolicy Bypass で起動すればその問題は起きない。
rem  最後の pause で、途中でエラーが出ても画面が残る。
rem ---------------------------------------------------------------
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0_push_gas.ps1"
echo.
echo (終了コード %ERRORLEVEL%)
pause
