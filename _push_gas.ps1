# =============================================================
#  My Trello - Apps Script 側をコマンドで反映する（コピペの代わり）
#  使い方: 右クリック →「PowerShell で実行」／ または  .\_push_gas.ps1
#
#  これは §2-B（script.google.com に4ファイルを貼り付ける作業）の自動化です。
#  アプリ版(PWA)の公開は別スクリプト  _publish.ps1  の方。
#
#  ★初回だけ準備が要ります。下の「初回セットアップ」を先に済ませてください。
# =============================================================
#
#  ── 初回セットアップ（1回だけ）───────────────────────────
#  1. clasp を入れる  ※2026-08-08 実施済み（clasp 3.3.0 / Node v22.17.1）
#       npm install -g @google/clasp
#  2. Google にログイン（ブラウザが開くので自分のアカウントを許可）
#       clasp login
#  3. Apps Script API を ON にする（1回だけ）
#       https://script.google.com/home/usersettings → 「Google Apps Script API」を オン
#  4. ★安全確認★ いまサーバー上にあるコードが、このフォルダの apps-script/ と
#     同じかどうかを必ず確かめる（下の「注意」参照）。
#  5. scriptId を控える
#       script.google.com で My Trello を開く → 「プロジェクトの設定」→ スクリプトID
#     このスクリプトを初回実行すると入力を求められ、.clasp.json に保存されます。
#
#  ── 注意（これだけは読んでください）──────────────────────
#  clasp push は「このフォルダの中身でサーバー側を上書き」します。
#  もし Apps Script のエディタで直接いじって、こちらに写していない変更があると
#  **それが消えます**。初回だけ、別フォルダに落として見比べてください：
#       mkdir C:\temp\gas-check ; cd C:\temp\gas-check
#       clasp clone-script <scriptId>
#     → 落ちてきた Code.gs 等が apps-script/ と同じなら安心して進められます。
# =============================================================

$ErrorActionPreference = 'Stop'
$Src = $PSScriptRoot

function Step($msg) { Write-Host "`n=== $msg ===" -ForegroundColor Cyan }

# ---- clasp があるか ----
if (-not (Get-Command clasp -ErrorAction SilentlyContinue)) {
  Write-Host 'clasp が入っていません。先に次を実行してください:' -ForegroundColor Red
  Write-Host '    npm install -g @google/clasp'
  Write-Host '    clasp login'
  Read-Host "`nEnter で閉じます"; exit 1
}

# ---- .clasp.json（無ければ作る）----
$claspJson = Join-Path $Src '.clasp.json'
if (-not (Test-Path $claspJson)) {
  Step '初回設定'
  Write-Host 'script.google.com で My Trello を開き、「プロジェクトの設定」→ スクリプトID をコピーしてください。'
  $sid = (Read-Host 'スクリプトID').Trim()
  if (-not $sid) { Write-Host '中止しました。' -ForegroundColor Yellow; exit 1 }
  @{ scriptId = $sid; rootDir = 'apps-script' } | ConvertTo-Json | Out-File $claspJson -Encoding utf8
  Write-Host ".clasp.json を作りました。" -ForegroundColor Green
}

# ---- ログイン済みか ----
if (-not (Test-Path "$env:USERPROFILE\.clasprc.json")) {
  Write-Host 'clasp にログインしていません。先に次を実行してください:' -ForegroundColor Red
  Write-Host '    clasp login'
  Read-Host "`nEnter で閉じます"; exit 1
}

# ---- 送るファイルの確認（clasp 自身に一覧させる）----
Step '送るファイル'
Push-Location $Src
try { clasp show-file-status } finally { Pop-Location }
Write-Host "`nこの内容で Apps Script 側を【上書き】します。" -ForegroundColor Yellow
Write-Host 'サーバー側で直接編集した未反映の変更があると消えます。' -ForegroundColor Yellow
if ((Read-Host "続けますか? (yes と入力)") -ne 'yes') { Write-Host '中止しました。'; exit 1 }

Step 'アップロード'
Push-Location $Src
try {
  clasp push --force
  if ($LASTEXITCODE -ne 0) { throw 'clasp push に失敗しました' }
} finally { Pop-Location }

# ---- デプロイ（URLを変えずに新バージョンへ差し替え）----
Step 'デプロイ'
Write-Host 'push しただけでは、開いているURLの中身はまだ古いままです。'
Write-Host '既存のデプロイを新バージョンに差し替えます（URLは変わりません）。'
Push-Location $Src
try {
  Write-Host "`n現在のデプロイ一覧:" -ForegroundColor DarkGray
  clasp list-deployments
  $dep = (Read-Host "`n差し替えるデプロイID（@HEAD ではない方。空Enterでスキップ）").Trim()
  if ($dep) {
    clasp update-deployment $dep
    if ($LASTEXITCODE -ne 0) { throw 'デプロイの更新に失敗しました' }
    Write-Host '差し替えました。' -ForegroundColor Green
  } else {
    Write-Host 'スキップしました。script.google.com の「デプロイを管理」→ 鉛筆 → 新バージョン でも同じことができます。' -ForegroundColor Yellow
  }
} finally { Pop-Location }

Write-Host "`n完了。ブラウザで Ctrl+Shift+R して確認してください。" -ForegroundColor Green
Write-Host '※ アプリ版(PWA)側の反映が必要なら _publish.ps1 も実行してください。'
Read-Host "`nEnter で閉じます"
