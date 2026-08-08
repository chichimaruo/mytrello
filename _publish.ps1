# =============================================================
#  My Trello - アプリ版(PWA)を公開する
#  使い方: このファイルを右クリック →「PowerShell で実行」
#          または PowerShell で  .\_publish.ps1
#
#  やること:
#   1. _build_pwa.py を実行して webapp/ を作り直す
#   2. このフォルダ(Googleドライブ=正)の中身を作業用リポジトリへコピー
#   3. GitHub へ push  → GitHub Actions が自動で Pages に公開
#
#  公開先: https://chichimaruo.github.io/mytrello/
# =============================================================

$ErrorActionPreference = 'Stop'

$Src  = $PSScriptRoot                        # ドライブ内のプロジェクト（＝正）
$Repo = 'C:\Users\cruis\repos\mytrello'      # 作業用リポジトリ（Gitはドライブ外に置く）
$RepoUrl = 'https://github.com/chichimaruo/mytrello.git'

function Step($msg) { Write-Host "`n=== $msg ===" -ForegroundColor Cyan }

# ---- 0. 作業用リポジトリが無ければ用意する ----
if (-not (Test-Path (Join-Path $Repo '.git'))) {
  Step '作業用リポジトリを取得'
  New-Item -ItemType Directory -Force (Split-Path $Repo) | Out-Null
  git clone $RepoUrl $Repo
}

# ---- 1. ビルド（style.css / index.html / app.js / アイコン / SW版数）----
Step 'ビルド'
Push-Location $Src
try { python _build_pwa.py } finally { Pop-Location }

# ---- 2. リポジトリへコピー ----
# ※ webapp/ も一緒に送るが、GitHub 側でもビルドし直すので結果は同じになる
Step 'リポジトリへコピー'
git -C $Repo pull --ff-only

$files = @('README.md', 'SETUP.md', 'HANDOVER.md', '_build_pwa.py', '_publish.ps1', 'myboard-icon.png')
foreach ($f in $files) {
  $p = Join-Path $Src $f
  if (Test-Path $p) { Copy-Item $p (Join-Path $Repo $f) -Force }
}
foreach ($d in @('apps-script', 'webapp', '.github')) {
  $s = Join-Path $Src $d
  $t = Join-Path $Repo $d
  New-Item -ItemType Directory -Force $t | Out-Null
  # (1) ドライブ側にあるものを全部コピー
  Get-ChildItem $s -Recurse -File | ForEach-Object {
    $dst = Join-Path $t $_.FullName.Substring($s.Length).TrimStart('\')
    New-Item -ItemType Directory -Force (Split-Path $dst) | Out-Null
    Copy-Item $_.FullName $dst -Force
  }
  # (2) ドライブ側で消したものはリポジトリ側からも消す
  Get-ChildItem $t -Recurse -File | ForEach-Object {
    $rel = $_.FullName.Substring($t.Length).TrimStart('\')
    if (-not (Test-Path (Join-Path $s $rel))) {
      Write-Host ("  削除: $d\" + $rel) -ForegroundColor DarkGray
      Remove-Item $_.FullName -Force
    }
  }
}

# ---- 3. commit & push ----
Step '変更内容'
git -C $Repo add -A
$changes = git -C $Repo status --porcelain
if (-not $changes) {
  Write-Host '変更はありません。公開済みの内容と同じです。' -ForegroundColor Yellow
  Read-Host "`nEnter で閉じます"
  exit 0
}
git -C $Repo status --short

$msg = Read-Host "`nコミットメッセージ（空Enterで日時のみ）"
if ([string]::IsNullOrWhiteSpace($msg)) { $msg = 'update ' + (Get-Date -Format 'yyyy-MM-dd HH:mm') }

$ok = Read-Host "この内容で GitHub に公開します。よろしいですか? (y/N)"
if ($ok -ne 'y') { Write-Host '中止しました（コピーは済んでいます）。' -ForegroundColor Yellow; exit 1 }

Step '公開'
git -C $Repo commit -m $msg
git -C $Repo push

Write-Host "`n公開しました。1〜2分で反映されます。" -ForegroundColor Green
Write-Host '  アプリ  : https://chichimaruo.github.io/mytrello/'
Write-Host '  進行状況: https://github.com/chichimaruo/mytrello/actions'
Write-Host "`n※ スマホで古い画面が出るときは、一度アプリを閉じてから開き直してください。"
Read-Host "`nEnter で閉じます"
