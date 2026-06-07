/* My Trello PWA - Service Worker
   アプリの「ガワ」（HTML/CSS/JS/アイコン）を端末にキャッシュして、
   起動を速く・再読み込みされても一瞬で表示・電波が弱くても画面だけは開けるようにする。
   ※ データ通信（Apps Scriptへのfetch=別オリジンのPOST）はキャッシュせず常に最新を取りに行く。
   コードを更新したら下の CACHE の数字を上げる（v1→v2…）と確実に切り替わる。 */
const CACHE = 'mt-v1';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
  'https://cdn.jsdelivr.net/npm/sortablejs@1.15.2/Sortable.min.js'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) { return c.addAll(ASSETS); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.filter(function (k) { return k !== CACHE; })
          .map(function (k) { return caches.delete(k); }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return; // データ更新(POST)はそのまま通す
  var url = new URL(req.url);
  var isShell = (url.origin === self.location.origin) || url.href.indexOf('jsdelivr') !== -1;
  if (!isShell) return; // Apps Script等の外部GETは触らない
  e.respondWith(
    caches.match(req).then(function (hit) {
      var net = fetch(req).then(function (res) {
        if (res && res.status === 200) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () { return hit; });
      return hit || net;
    })
  );
});
