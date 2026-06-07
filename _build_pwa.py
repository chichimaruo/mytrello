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

# ---------- 1) style.css ----------
css = read(os.path.join(SRC, 'Stylesheet.html'))
css = css.strip()
assert css.startswith('<style>') and css.endswith('</style>'), 'Stylesheet wrapper mismatch'
css = css[len('<style>'):-len('</style>')].strip() + '\n'
write(os.path.join(OUT, 'style.css'), css)
print('style.css OK (%d bytes)' % len(css))

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

write(os.path.join(OUT, 'app.js'), js + '\n')
print('app.js OK (%d bytes)' % len(js))

# ---------- 3) icons ----------
src_icon = os.path.join(ROOT, 'myboard-icon.png')
img = Image.open(src_icon).convert('RGBA')
for name, size in [('icon-192.png', 192), ('icon-512.png', 512), ('apple-touch-icon.png', 180)]:
    img.resize((size, size), Image.LANCZOS).save(os.path.join(OUT, name))
    print(name, 'OK')

# ---------- 4) service-worker のキャッシュ版数を中身のハッシュで自動更新 ----------
# css+js の内容が変わると版数が変わり、各端末のキャッシュが自動で切り替わる。
# 中身が同じなら版数も同じ＝無駄なキャッシュ更新は起きない。
sw_path = os.path.join(OUT, 'service-worker.js')
h = hashlib.sha1((css + js).encode('utf-8')).hexdigest()[:10]
sw = read(sw_path)
new_sw, n = re.subn(r"const CACHE = '[^']*';", "const CACHE = 'mt-%s';" % h, sw, count=1)
assert n == 1, "service-worker.js の CACHE 行が見つからない"
write(sw_path, new_sw)
print('service-worker CACHE = mt-%s' % h)

print('ALL DONE')
