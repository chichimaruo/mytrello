# -*- coding: utf-8 -*-
"""Apps Script の Stylesheet/JavaScript を PWA 用の style.css / app.js に変換し、
アイコンも生成するビルドスクリプト。何度でも実行できる。"""
import os, sys, re, hashlib
from PIL import Image

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(ROOT, 'apps-script')
OUT = os.path.join(ROOT, 'webapp')
os.makedirs(OUT, exist_ok=True)

def read(p):
    # utf-8-sig にすると BOM 付き/なし どちらでも正しく読める
    with open(p, 'r', encoding='utf-8-sig') as f:
        return f.read()

def write(p, s):
    with open(p, 'w', encoding='utf-8', newline='\n') as f:
        f.write(s)

# 生成物の先頭に必ず入れる注意書き（手で編集されるのを防ぐ）
def banner(src_name, style):
    msg = ('このファイルは _build_pwa.py が apps-script/%s から自動生成しています。\n'
           '   手で編集しても次のビルドで上書きされます。直すのは apps-script/%s の方。' % (src_name, src_name))
    if style == 'html':
        return '<!-- ' + msg + ' -->\n'
    return '/* ' + msg + ' */\n'

# ---------- 1) style.css ----------
css = read(os.path.join(SRC, 'Stylesheet.html'))
css = css.strip()
assert css.startswith('<style>') and css.endswith('</style>'), 'Stylesheet wrapper mismatch'
css = css[len('<style>'):-len('</style>')].strip() + '\n'
write(os.path.join(OUT, 'style.css'), banner('Stylesheet.html', 'css') + css)
print('style.css OK (%d bytes)' % len(css))

# ---------- 1.5) index.html ----------
# apps-script/Index.html を「唯一の正」として PWA 用 index.html を生成する。
# （以前は webapp/index.html を手作業でコピー保守していたため、Index.html に
#   オーバーレイ等を足しても PWA 版に反映され忘れる事故が起きやすかった）
html = read(os.path.join(SRC, 'Index.html')).strip()

HEAD_OLD = """<html>
<head>
  <base target="_top">
  <?!= include('Stylesheet'); ?>
</head>"""

HEAD_NEW = """<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover">
  <title>My Trello</title>
  <link rel="manifest" href="manifest.json">
  <meta name="theme-color" content="#0079bf">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="apple-mobile-web-app-title" content="MT">
  <link rel="apple-touch-icon" href="apple-touch-icon.png">
  <link rel="icon" href="icon-192.png">
  <link rel="stylesheet" href="style.css">
</head>"""

# 設定オーバーレイの末尾（背景検索結果の直後）に「接続設定」ブロックを差し込む
SET_OLD = """      <div id="bgResults" class="bg-grid"></div>"""

SET_NEW = """      <div id="bgResults" class="bg-grid"></div>

      <h3 class="arch-head">🔌 接続設定（アプリ版）</h3>
      <p class="set-note">データの保存先（Apps Script）の接続情報です。変更や再設定はここから。</p>
      <div class="set-row">
        <button id="apiConfigBtn" class="ghost-btn small dark">接続情報を変更</button>
      </div>"""

TAIL_OLD = """  <?!= include('JavaScript'); ?>
</body>"""

TAIL_NEW = """  <script src="app.js"></script>
  <script>
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('service-worker.js').catch(function () {});
      });
    }
    // 設定画面「接続情報を変更」ボタン（configureApi は app.js で定義）
    window.addEventListener('load', function () {
      var b = document.getElementById('apiConfigBtn');
      if (b) b.addEventListener('click', function () { if (configureApi()) location.reload(); });
    });
  </script>
</body>"""

for old, new, label in [(HEAD_OLD, HEAD_NEW, 'head'), (SET_OLD, SET_NEW, '接続設定'), (TAIL_OLD, TAIL_NEW, 'script読込')]:
    assert html.count(old) == 1, 'Index.html: %s の差し替え箇所が1個ではない (%d個)' % (label, html.count(old))
    html = html.replace(old, new)

html = html.replace('<!DOCTYPE html>\n', '<!DOCTYPE html>\n' + banner('Index.html', 'html'), 1)
write(os.path.join(OUT, 'index.html'), html + '\n')
print('index.html OK (%d bytes)' % len(html))

# ---------- 2) app.js ----------
js = read(os.path.join(SRC, 'JavaScript.html'))
js = js.strip()
assert js.startswith('<script>') and js.endswith('</script>'), 'JavaScript wrapper mismatch'
js = js[len('<script>'):-len('</script>')].strip()

OLD_API = """const api = new Proxy({}, {
  get: function (_t, fn) {
    return function (...args) {
      return new Promise(function (resolve, reject) {
        google.script.run
          .withSuccessHandler(resolve)
          .withFailureHandler(reject)
          [fn].apply(null, args);
      });
    };
  }
});"""

NEW_API = """/* === アプリ版(PWA): Apps Script を fetch で呼ぶ窓口 === */
function getApiUrl() { return localStorage.getItem('apiUrl') || ''; }
function getApiToken() { return localStorage.getItem('apiToken') || ''; }
function configureApi() {
  var u = prompt('Apps Script のアプリURL（/exec で終わるもの）を入力してください', getApiUrl());
  if (u === null) return false;
  var t = prompt('秘密トークンを入力してください', getApiToken());
  if (t === null) return false;
  localStorage.setItem('apiUrl', (u || '').trim());
  localStorage.setItem('apiToken', (t || '').trim());
  return true;
}
const api = new Proxy({}, {
  get: function (_t, fn) {
    if (typeof fn !== 'string') return undefined;
    return function (...args) {
      return fetch(getApiUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ fn: fn, args: args, token: getApiToken() })
      }).then(function (res) { return res.json(); })
        .then(function (data) {
          if (data && data.ok) return data.result;
          throw new Error((data && data.error) || 'APIエラー');
        });
    };
  }
});"""

assert js.count(OLD_API) == 1, 'api Proxy block not found exactly once (%d)' % js.count(OLD_API)
js = js.replace(OLD_API, NEW_API)

OLD_START = "bindUI();\ninit();"
NEW_START = """bindUI();
if (!getApiUrl() || !getApiToken()) { configureApi(); }
init();"""
assert js.count(OLD_START) == 1, 'start block not found exactly once (%d)' % js.count(OLD_START)
js = js.replace(OLD_START, NEW_START)

write(os.path.join(OUT, 'app.js'), banner('JavaScript.html', 'js') + js + '\n')
print('app.js OK (%d bytes)' % len(js))

# ---------- 3) icons ----------
src_icon = os.path.join(ROOT, 'myboard-icon.png')
img = Image.open(src_icon).convert('RGBA')
for name, size in [('icon-192.png', 192), ('icon-512.png', 512), ('apple-touch-icon.png', 180)]:
    img.resize((size, size), Image.LANCZOS).save(os.path.join(OUT, name))
    print(name, 'OK')

# ---------- 4) service-worker のキャッシュ版数を中身のハッシュで自動更新 ----------
# html+css+js の内容が変わると版数が変わり、各端末のキャッシュが自動で切り替わる。
# 中身が同じなら版数も同じ＝無駄なキャッシュ更新は起きない。
sw_path = os.path.join(OUT, 'service-worker.js')
h = hashlib.sha1((html + css + js).encode('utf-8')).hexdigest()[:10]
sw = read(sw_path)
new_sw, n = re.subn(r"const CACHE = '[^']*';", "const CACHE = 'mt-%s';" % h, sw, count=1)
assert n == 1, "service-worker.js の CACHE 行が見つからない"
write(sw_path, new_sw)
print('service-worker CACHE = mt-%s' % h)

print('ALL DONE')
