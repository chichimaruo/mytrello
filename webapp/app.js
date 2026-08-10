/* このファイルは _build_pwa.py が apps-script/JavaScript.html から自動生成しています。
   手で編集しても次のビルドで上書きされます。直すのは apps-script/JavaScript.html の方。 */
/* ============================================================
   My Trello - Frontend
   サーバー呼び出しは google.script.run を Promise でラップ
   ============================================================ */

/* === アプリ版(PWA): Apps Script を fetch で呼ぶ窓口 === */
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
});

let STATE = { boards: [], lists: [], cards: [], labels: [], fields: [], views: [], automations: [], recurring: [] };
let openCardId = null;
let hoverCardId = null; // マウスが乗っているカード（Trello風ショートカット用）
let hoverListId = null; // マウスが乗っているリスト
let currentBoardId = null;

function loadCurrentBoard() { try { return localStorage.getItem('curBoard'); } catch (e) { return null; } }
function saveCurrentBoard(id) { try { localStorage.setItem('curBoard', id); } catch (e) {} }

/* --- 直前に開いていたカード・スクロール位置の記憶（Safari再読込からの復元用） --- */
function saveOpenCard(id) { try { id ? localStorage.setItem('openCard', id) : localStorage.removeItem('openCard'); } catch (e) {} }
function loadOpenCard() { try { return localStorage.getItem('openCard'); } catch (e) { return null; } }
function saveBoardScroll() {
  try {
    const el = document.getElementById('board');
    if (el) localStorage.setItem('boardScroll', el.scrollLeft + ',' + el.scrollTop);
  } catch (e) {}
}
function restoreBoardScroll() {
  try {
    const v = localStorage.getItem('boardScroll'); if (!v) return;
    const p = v.split(','); const el = document.getElementById('board');
    if (el) { el.scrollLeft = parseFloat(p[0]) || 0; el.scrollTop = parseFloat(p[1]) || 0; }
  } catch (e) {}
}

function ensureCurrentBoard() {
  const ids = STATE.boards.map(function (b) { return b.id; });
  if (currentBoardId && ids.indexOf(currentBoardId) >= 0) return;
  const saved = loadCurrentBoard();
  currentBoardId = (saved && ids.indexOf(saved) >= 0)
    ? saved
    : (STATE.boards[0] ? STATE.boards[0].id : null);
}

function updateBoardName() {
  const b = STATE.boards.find(function (x) { return x.id === currentBoardId; });
  const node = document.getElementById('currentBoardName');
  if (node) node.textContent = b ? b.title : '（ボードが選ばれていません）';
  // 横断ビューと同じ色分けを添えて、名前を読まなくても違いが分かるようにする
  const dot = document.getElementById('boardBarDot');
  if (dot) dot.style.background = b ? boardColor(b.id) : 'transparent';
  document.title = b ? (b.title + ' — My Trello') : 'My Trello';
}

// 現在のボードの背景を適用（画像があれば画像、なければ標準グラデ）
function applyBackground() {
  const b = STATE.boards.find(function (x) { return x.id === currentBoardId; });
  const bg = b && b.background;
  if (bg) {
    document.body.style.background = 'url("' + bg + '") center center / cover no-repeat';
  } else {
    document.body.style.background = 'linear-gradient(135deg, #0079bf 0%, #5e4db2 100%)';
  }
}

/* ----------------------- ボード一覧（ホーム） ----------------------- */
const TILE_COLORS = ['#0079bf', '#d29034', '#519839', '#b04632', '#89609e', '#cd5a91', '#4bbf6b', '#00aecc', '#838c91'];

async function showHome() {
  setStatus('読み込み中...');
  try { await ensureAllCards(); } catch (e) {}
  setStatus('');
  renderBoardHome();
  document.getElementById('boardHome').classList.remove('hidden');
}
function hideHome() { document.getElementById('boardHome').classList.add('hidden'); }

function renderBoardHome() {
  const grid = document.getElementById('boardGrid');
  grid.innerHTML = '';
  STATE.boards
    .filter(function (b) { return !b.archived; })
    .sort(function (a, b) { return a.position - b.position; })
    .forEach(function (b, i) {
      const tile = el('div', 'board-tile');

      const thumb = el('div', 'bt-thumb');
      if (b.background) {
        thumb.style.background = 'url("' + b.background + '") center center / cover no-repeat';
      } else {
        thumb.style.background = 'linear-gradient(135deg,' + TILE_COLORS[i % TILE_COLORS.length] + ',#5e4db2)';
      }
      tile.appendChild(thumb);

      const listCount = STATE.lists.filter(function (l) { return !l.archived && l.boardId === b.id; }).length;
      const cardCount = STATE.cards.filter(function (c) {
        return !c.archived && STATE.lists.some(function (l) { return l.id === c.listId && l.boardId === b.id; });
      }).length;

      const body = el('div', 'bt-body');
      body.appendChild(el('div', 'bt-name', esc(b.title)));
      body.appendChild(el('div', 'bt-meta', listCount + ' リスト ・ ' + cardCount + ' カード'));
      tile.appendChild(body);

      const actions = el('div', 'bt-actions');
      const ren = el('button', '', '✏️'); ren.title = '名前変更';
      ren.addEventListener('click', async function (e) {
        e.stopPropagation();
        const name = prompt('ボード名を変更:', b.title);
        if (!name) return;
        await api.renameBoard(b.id, name);
        b.title = name; renderBoardHome(); updateBoardName();
      });
      const del = el('button', '', '🗑'); del.title = '削除';
      del.addEventListener('click', async function (e) {
        e.stopPropagation();
        if (STATE.boards.filter(function (x) { return !x.archived; }).length <= 1) {
          alert('最後のボードは削除できません。'); return;
        }
        if (!confirm('ボード「' + b.title + '」と、その中のリスト・カードをすべて削除します。よろしいですか?')) return;
        await api.deleteBoard(b.id);
        if (currentBoardId === b.id) currentBoardId = null;
        STATE = await api.getState();
        markAllLoaded();
        renderBoardHome(); render();
      });
      const arch = el('button', '', '📥'); arch.title = 'アーカイブ';
      arch.addEventListener('click', function (e) {
        e.stopPropagation();
        if (STATE.boards.filter(function (x) { return !x.archived; }).length <= 1) {
          alert('最後のボードはアーカイブできません。'); return;
        }
        archiveBoardUI(b);
      });
      const dup = el('button', '', '📄'); dup.title = 'このボードを複製';
      dup.addEventListener('click', async function (e) {
        e.stopPropagation();
        const name = prompt('複製後のボード名:', b.title + ' のコピー');
        if (!name) return;
        setStatus('複製中...');
        const nb = await api.copyBoard(b.id, name);
        if (!nb) { setStatus(''); alert('複製できませんでした。'); return; }
        // ラベル・フィールド・リストが増えるのでメタを取り直す
        const meta = await api.getMeta();
        STATE.boards = meta.boards; STATE.lists = meta.lists;
        STATE.labels = meta.labels; STATE.fields = meta.fields;
        STATE.views = meta.views; STATE.automations = meta.automations; STATE.recurring = meta.recurring;
        invalidateAllCards();
        renderBoardHome();
        setStatus('「' + name + '」を作りました');
      });

      actions.appendChild(ren); actions.appendChild(dup); actions.appendChild(arch); actions.appendChild(del);
      tile.appendChild(actions);

      tile.addEventListener('click', function () {
        currentBoardId = b.id; saveCurrentBoard(b.id); hideHome(); render();
      });
      grid.appendChild(tile);
    });

  const add = el('div', 'board-tile new', '＋ 新しいボード');
  add.addEventListener('click', async function () {
    const name = prompt('新しいボード名:');
    if (!name) return;
    const board = await api.addBoard(name);
    STATE.boards.push(board);
    currentBoardId = board.id; saveCurrentBoard(board.id);
    hideHome(); render();
  });
  grid.appendChild(add);

  renderArchivedBoards();
}

/* --------------------------- カレンダー --------------------------- */
let calRef = new Date();
function pad2(n) { return n < 10 ? '0' + n : '' + n; }
function ymd(dt) { return dt.getFullYear() + '-' + pad2(dt.getMonth() + 1) + '-' + pad2(dt.getDate()); }

async function showCalendar() {
  setStatus('読み込み中...');
  try { await ensureAllCards(); } catch (e) {}
  setStatus('');
  calRef = new Date();
  renderCalendar();
  document.getElementById('calendar').classList.remove('hidden');
}
function hideCalendar() { document.getElementById('calendar').classList.add('hidden'); }

let calHidden = {}; // 非表示にするボードid

function activeBoardsSorted() {
  return STATE.boards.filter(function (b) { return !b.archived; })
    .sort(function (a, b) { return a.position - b.position; });
}
function boardColor(id) {
  const list = activeBoardsSorted();
  let idx = -1;
  list.forEach(function (b, i) { if (b.id === id) idx = i; });
  return TILE_COLORS[(idx < 0 ? 0 : idx) % TILE_COLORS.length];
}
function renderCalLegend() {
  const cont = $('#calLegend');
  if (!cont) return;
  cont.innerHTML = '';
  activeBoardsSorted().forEach(function (b) {
    const chip = el('button', 'cal-legend-chip' + (calHidden[b.id] ? ' off' : ''), esc(b.title));
    chip.style.borderLeftColor = boardColor(b.id);
    chip.addEventListener('click', function () {
      if (calHidden[b.id]) delete calHidden[b.id]; else calHidden[b.id] = true;
      renderCalendar();
    });
    cont.appendChild(chip);
  });
}

function renderCalendar() {
  const y = calRef.getFullYear(), m = calRef.getMonth();
  document.getElementById('calTitle').textContent = y + '年 ' + (m + 1) + '月';
  renderCalLegend();

  const grid = document.getElementById('calGrid');
  grid.innerHTML = '';
  ['日', '月', '火', '水', '木', '金', '土'].forEach(function (d) {
    grid.appendChild(el('div', 'cal-dow', d));
  });

  const startDow = new Date(y, m, 1).getDay();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const todayStr = ymd(new Date());

  const listMap = {}; STATE.lists.forEach(function (l) { listMap[l.id] = l; });
  const boardMap = {}; STATE.boards.forEach(function (b) { boardMap[b.id] = b; });

  const byDate = {};
  function addEntry(dateStr, entry) { (byDate[dateStr] = byDate[dateStr] || []).push(entry); }

  STATE.cards.forEach(function (c) {
    if (c.archived) return;
    const list = listMap[c.listId]; if (!list || list.archived) return;
    const board = boardMap[list.boardId]; if (!board || board.archived) return;
    if (calHidden[board.id]) return;

    // カードの期間
    if (c.start || c.due) {
      const s = c.start || c.due, e = c.due || c.start;
      let sd = new Date(s + 'T00:00:00'), ed = new Date(e + 'T00:00:00');
      if (ed < sd) ed = sd;
      for (let d = new Date(sd); d <= ed; d.setDate(d.getDate() + 1)) {
        addEntry(ymd(d), { card: c, board: board, label: c.title, done: c.done, isCheck: false });
      }
    }
    // チェックリスト項目の期限
    (c.checklist || []).forEach(function (item) {
      if (item && item.due) {
        addEntry(item.due, { card: c, board: board, label: '☑ ' + item.text, done: item.done, isCheck: true });
      }
    });
  });

  for (let i = 0; i < startDow; i++) grid.appendChild(el('div', 'cal-cell other'));

  for (let d = 1; d <= daysInMonth; d++) {
    const cell = el('div', 'cal-cell');
    const ds = y + '-' + pad2(m + 1) + '-' + pad2(d);
    if (ds === todayStr) cell.classList.add('today');
    cell.appendChild(el('div', 'cal-date', String(d)));
    (byDate[ds] || []).forEach(function (e) {
      const cc = el('div', 'cal-card' + (e.done ? ' done' : '') + (e.isCheck ? ' check' : ''), esc(e.label));
      cc.title = (e.board ? e.board.title + ' / ' : '') + (e.isCheck ? '☑ ' : '') + e.card.title;
      if (e.board) cc.style.borderLeftColor = boardColor(e.board.id);
      cc.addEventListener('click', function () { hideCalendar(); openCardFromTable(e.card); });
      cell.appendChild(cc);
    });
    grid.appendChild(cell);
  }
}

/* ------------------------- Trello インポート ------------------------- */
function showImporter() {
  $('#impStatus').textContent = '';
  $('#impFile').value = '';
  $('#importer').classList.remove('hidden');
}
function hideImporter() { $('#importer').classList.add('hidden'); }

function runImport() {
  const f = $('#impFile').files[0];
  if (!f) { $('#impStatus').textContent = '先に .json ファイルを選んでください。'; return; }
  $('#impStatus').textContent = '読み込み中...';
  const reader = new FileReader();
  reader.onload = async function () {
    try {
      const raw = JSON.parse(String(reader.result));
      // 送信量を減らすため必要な部分だけ抽出（履歴アクションはコメントのみ）
      const trimmed = {
        name: raw.name,
        labels: raw.labels || [],
        lists: raw.lists || [],
        checklists: raw.checklists || [],
        cards: (raw.cards || []).map(function (c) {
          return {
            id: c.id, name: c.name, desc: c.desc, idList: c.idList,
            due: c.due, start: c.start, dueComplete: c.dueComplete,
            pos: c.pos, closed: c.closed, idLabels: c.idLabels
          };
        }),
        actions: (raw.actions || [])
          .filter(function (a) { return a.type === 'commentCard' && a.data && a.data.card; })
          .map(function (a) {
            return { type: a.type, date: a.date, data: { card: { id: a.data.card.id }, text: a.data.text } };
          })
      };
      $('#impStatus').textContent = '取り込み中...（少し時間がかかります）';
      const res = await api.importTrelloBoard(JSON.stringify(trimmed));
      $('#impStatus').textContent =
        '完了！ ボード「' + res.board + '」 … ' + res.lists + ' リスト / ' +
        res.cards + ' カード / ' + res.labels + ' ラベル を取り込みました。';
      STATE = await api.getState();
      markAllLoaded();
      renderBoardHome();
    } catch (e) {
      $('#impStatus').textContent = '失敗しました: ' + e +
        '（Trello の JSON ファイルか確認してください）';
    }
  };
  reader.readAsText(f);
}

/* ------------------------- 背景設定（画像検索） ------------------------- */
function showSettings() {
  document.getElementById('bgResults').innerHTML = '';
  document.getElementById('bgSearch').value = '';
  populateRemHours();
  loadReminderStatus();
  hideAutoForm();
  renderAutoList();
  hideRecurForm();
  renderRecurList();
  loadShareSection();
  loadBackupStatus();
  refreshGmailStatus();
  loadClasses().then(function (ks) { $('#classList').value = ks.join('、'); });
  document.getElementById('settings').classList.remove('hidden');
}
function hideSettings() { document.getElementById('settings').classList.add('hidden'); }

async function searchBg() {
  const q = $('#bgSearch').value.trim();
  if (!q) return;
  const grid = $('#bgResults');
  grid.innerHTML = '<div class="set-note">検索中...</div>';
  try {
    const results = await api.searchWikimedia(q);
    grid.innerHTML = '';
    if (!results.length) {
      grid.innerHTML = '<div class="set-note">見つかりませんでした。別の語句でお試しください。</div>';
      return;
    }
    results.forEach(function (r) {
      const item = el('div', 'bg-item');
      const img = document.createElement('img');
      img.src = r.thumb; img.loading = 'lazy'; img.alt = r.title;
      img.onerror = function () { item.remove(); };
      item.appendChild(img);
      item.title = r.title;
      item.addEventListener('click', async function () {
        const b = STATE.boards.find(function (x) { return x.id === currentBoardId; });
        if (b) b.background = r.full;
        await api.setBoardBackground(currentBoardId, r.full);
        applyBackground();
        setStatus('背景を変更しました');
        hideSettings();
      });
      grid.appendChild(item);
    });
  } catch (e) {
    grid.innerHTML = '<div class="set-note">検索に失敗しました: ' + esc(String(e)) + '</div>';
  }
}

/* ----------------------- 並べ替えポップメニュー ----------------------- */
function closePopmenu() { const m = document.querySelector('.popmenu'); if (m) m.remove(); }

function openListMenu(list, anchor) {
  closePopmenu();
  const listId = list.id;
  const menu = el('div', 'popmenu');

  function act(label, fn) {
    const b = el('button', '', label);
    b.addEventListener('click', function () { closePopmenu(); fn(); });
    menu.appendChild(b);
  }

  act('➕ カードを追加', function () {
    const node = document.querySelector('.list[data-list-id="' + listId + '"] .add-card');
    if (node) node.click();
  });

  menu.appendChild(el('div', 'pm-divider'));
  // 並べ替え
  menu.appendChild(el('div', 'pm-title', '並べ替え'));
  [['期限が近い順', 'due'], ['作成が新しい順', 'newest'], ['作成が古い順', 'oldest'], ['カード名順', 'name'], ['🏷 ラベル順', 'label']]
    .forEach(function (o) { act(o[0], function () { sortListCards(listId, o[1]); }); });
  fieldsOfBoard().forEach(function (f) {
    act('🔼 ' + f.name + ' 順', function () { sortListCards(listId, 'field:' + f.id); });
  });

  menu.appendChild(el('div', 'pm-divider'));
  // リスト操作
  act('◀ リストを折りたたむ', function () { toggleCollapse(list, true); });
  act('🔢 WIP上限を設定', function () {
    const cur = list.wip ? String(list.wip) : '';
    const v = prompt('このリストのカード上限（0または空で無制限）:', cur);
    if (v === null) return;
    const n = parseInt(v, 10) || 0;
    list.wip = n;
    api.setListWip(list.id, n);
    render();
  });
  act('📋 リストを複製', function () { copyListUI(list); });
  act('📥 全カードをアーカイブ', function () {
    if (confirm('「' + list.title + '」内のカードを全部アーカイブしますか?')) archiveAllInList(list);
  });
  act('🗄 リストをアーカイブ', function () {
    api.archiveList(list.id, true);
    list.archived = true;
    render();
    setStatus('リストをアーカイブしました');
  });
  act('🗑 リストを削除', function () { deleteListUI(list); });

  document.body.appendChild(menu);
  const r = anchor.getBoundingClientRect();
  menu.style.top = (r.bottom + window.scrollY + 4) + 'px';
  menu.style.left = Math.min(r.left + window.scrollX, window.innerWidth - 200) + 'px';
  setTimeout(function () { document.addEventListener('click', closePopmenu, { once: true }); }, 0);
}

async function copyListUI(list) {
  setStatus('複製中...');
  await api.copyList(list.id);
  STATE = await api.getState();
  markAllLoaded();
  render();
  setStatus('リストを複製しました');
}
async function archiveAllInList(list) {
  await api.archiveAllCards(list.id);
  STATE.cards.forEach(function (c) { if (c.listId === list.id) c.archived = true; });
  render();
  setStatus('全カードをアーカイブしました');
}
function deleteListUI(list) {
  if (!confirm('リスト「' + list.title + '」と中のカードを削除しますか?')) return;
  api.deleteList(list.id).then(function () {
    STATE.lists = STATE.lists.filter(function (l) { return l.id !== list.id; });
    STATE.cards = STATE.cards.filter(function (c) { return c.listId !== list.id; });
    render();
  });
}

async function sortListCards(listId, mode) {
  const arr = cardsOfList(listId).slice();
  if (mode === 'due') {
    // 実質の期日 = 終わり、無ければスタート。過ぎた(小さい日付)ほど上、遠いほど下、無しは最下部
    const eff = function (c) { return c.due || c.start || ''; };
    arr.sort(function (a, b) {
      const ea = eff(a), eb = eff(b);
      if (!ea && !eb) return 0;
      if (!ea) return 1;
      if (!eb) return -1;
      return ea < eb ? -1 : (ea > eb ? 1 : 0);
    });
  } else if (mode === 'newest') {
    arr.sort(function (a, b) { return String(b.createdAt || '').localeCompare(String(a.createdAt || '')); });
  } else if (mode === 'oldest') {
    arr.sort(function (a, b) { return String(a.createdAt || '').localeCompare(String(b.createdAt || '')); });
  } else if (mode === 'name') {
    arr.sort(function (a, b) { return String(a.title).localeCompare(String(b.title), 'ja'); });
  } else if (mode === 'label') {
    const boardLabels = STATE.labels.filter(function (l) { return l.boardId === '' || l.boardId === currentBoardId; });
    const rank = function (c) {
      const cl = c.labels || [];
      let min = 99999;
      cl.forEach(function (id) {
        const idx = boardLabels.findIndex(function (l) { return l.id === id; });
        if (idx >= 0 && idx < min) min = idx;
      });
      return min; // ラベル無しは最後
    };
    arr.sort(function (a, b) { return rank(a) - rank(b); });
  } else if (mode.indexOf('field:') === 0) {
    const fid = mode.slice(6);
    const f = fieldById(fid);
    arr.sort(function (a, b) {
      return compareFieldValues(f, a.fields && a.fields[fid], b.fields && b.fields[fid]);
    });
  }
  const orderedIds = arr.map(function (c) { return c.id; });
  orderedIds.forEach(function (id, idx) {
    const c = STATE.cards.find(function (x) { return x.id === id; });
    if (c) c.position = idx;
  });
  render();
  setStatus('並べ替えました');
  await api.saveCardOrder(orderedIds);
}

const $ = function (sel) { return document.querySelector(sel); };
const el = function (tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};
const esc = function (s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
};
// 背景色に対して読みやすい文字色(黒 or 白)を返す
const textOn = function (bg) {
  const c = String(bg || '#000000').replace('#', '');
  if (c.length < 6) return '#fff';
  const r = parseInt(c.substr(0, 2), 16), g = parseInt(c.substr(2, 2), 16), b = parseInt(c.substr(4, 2), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? '#172b4d' : '#ffffff';
};
const isImage = function (mime) { return /^image\//.test(mime || ''); };
// サーバーから返ったカードは配列/オブジェクトが文字列のことがあるので整形（開く時のエラー防止）
function normalizeCard(c) {
  c.labels = Array.isArray(c.labels) ? c.labels : [];
  c.checklist = Array.isArray(c.checklist) ? c.checklist : [];
  c.comments = Array.isArray(c.comments) ? c.comments : [];
  c.attachments = Array.isArray(c.attachments) ? c.attachments : [];
  c.links = Array.isArray(c.links) ? c.links : [];
  c.places = Array.isArray(c.places) ? c.places : [];
  if (!c.fields || typeof c.fields !== 'object') c.fields = {};
  if (!c.sync || typeof c.sync !== 'object') c.sync = {};
  if (c.cover && typeof c.cover !== 'object') c.cover = null;
  return c;
}

// テキストエリアを中身の量に合わせて自動で高さ調整（中スクロールをなくす）
function autoGrow(t) {
  if (!t) return;
  t.style.height = 'auto';
  t.style.height = (t.scrollHeight + 2) + 'px';
}

// ボード上のカード表示を最新の状態に差し替える
function refreshCardNode(card) {
  const node = document.querySelector('.card[data-card-id="' + card.id + '"]');
  if (node) node.replaceWith(renderCard(card));
}
function setStatus(t) {
  $('#status').textContent = t || '';
  if (t) setTimeout(function () { $('#status').textContent = ''; }, 1500);
}

/* ----------------------------- 起動 ----------------------------- */
/* --------------------------- 元に戻す（Ctrl+Z） --------------------------- */
let undoStack = [];
function pushUndo(label, undoFn) {
  undoStack.push({ label: label, undoFn: undoFn });
  if (undoStack.length > 30) undoStack.shift();
}
async function doUndo() {
  const u = undoStack.pop();
  if (!u) { setStatus('元に戻せる操作はありません'); return; }
  try { await u.undoFn(); render(); setStatus('元に戻しました：' + u.label); }
  catch (e) { setStatus('元に戻せませんでした'); }
}

/* --------------------------- 段階ロード（遅延ロード） --------------------------- */
let allCardsLoaded = false;
let allCardsPromise = null;

function markAllLoaded() { allCardsLoaded = true; allCardsPromise = Promise.resolve(); }

// 「全カード揃っている」状態を取り消す（ボード複製など、サーバー側でカードが増えたとき）。
// 次に横断ビューを開いたときに取り直される。
function invalidateAllCards() { allCardsLoaded = false; allCardsPromise = null; }

// 既存カードはそのまま、未取得のカードだけ追加（編集中のものを壊さない）
function mergeCards(newCards) {
  const have = {};
  STATE.cards.forEach(function (c) { have[c.id] = true; });
  newCards.forEach(function (c) { if (!have[c.id]) STATE.cards.push(c); });
}

// 全カードが揃うのを保証（横断ビュー/ボード切替の前に呼ぶ）
function ensureAllCards() {
  if (allCardsLoaded) return Promise.resolve();
  if (allCardsPromise) return allCardsPromise;
  allCardsPromise = api.getAllCards().then(function (all) {
    mergeCards(all);
    allCardsLoaded = true;
  }).catch(function (e) { allCardsPromise = null; throw e; });
  return allCardsPromise;
}

async function init() {
  setStatus('読み込み中...');
  try {
    const saved = loadCurrentBoard();
    STATE = await api.getInitial(saved || '');   // メタ＋今の板のカードを1往復で
    STATE.cards = STATE.cards || [];
    if (STATE.initialBoard) { currentBoardId = STATE.initialBoard; saveCurrentBoard(currentBoardId); }
    $('#loadError').classList.add('hidden');
    render();
    setStatus('準備完了');

    // スマホの「共有」から開かれた場合は、そのままカード追加へ（通常起動では何も起きない）
    let fromShare = false;
    try { fromShare = await handleShareTarget(); } catch (e) {}

    // Safari等で再読込された場合、直前の状態（スクロール位置・開いていたカード）を復元
    restoreBoardScroll();
    const lastCard = loadOpenCard();
    if (!fromShare && lastCard && STATE.cards.some(function (c) { return c.id === lastCard && !c.archived; })) {
      openModal(lastCard);
    }
    // スクロール位置を保存（負荷軽減のため間引き）
    const boardEl = document.getElementById('board');
    if (boardEl && !boardEl.dataset.scrollHooked) {
      boardEl.dataset.scrollHooked = '1';
      let st;
      boardEl.addEventListener('scroll', function () { clearTimeout(st); st = setTimeout(saveBoardScroll, 200); });
    }
    // 残りの全カードは「横断ビュー/ボード一覧」を開いたときに初めて読み込む（完全オンデマンド＝より軽い）
  } catch (e) {
    $('#loadErrorMsg').textContent = '読み込みに失敗しました: ' + e + '（再試行してください）';
    $('#loadError').classList.remove('hidden');
    setStatus('');
  }
}

// 最新データに更新（PC↔スマホのズレ解消・手動リフレッシュ）
async function reloadData() {
  setStatus('更新中...');
  try {
    STATE = await api.getState();
    markAllLoaded();
    $('#loadError').classList.add('hidden');
    render();
    if (openCardId) renderModal();
    setStatus('最新に更新しました');
  } catch (e) {
    setStatus('更新に失敗しました');
  }
}

/* --------------------------- 自動バックアップ --------------------------- */
async function loadBackupStatus() {
  try {
    const s = await api.backupStatus();
    const el2 = $('#backupStatus');
    el2.textContent = (s.freq ? ('✅ 自動バックアップ：' + (s.freq === 'weekly' ? '毎週' : '毎日') + '（深夜2時）') : '⛔ 自動バックアップ：オフ')
      + (s.last ? ' ／ 最終: ' + s.last : '');
    if (s.freq) $('#backupFreq').value = s.freq;
    $('#backupOpen').dataset.url = s.folderUrl || '';
  } catch (e) {}
}

/* ----------------------------- 描画 ----------------------------- */
function cardsOfList(listId) {
  return STATE.cards
    .filter(function (c) { return c.listId === listId && !c.archived; })
    .sort(function (a, b) { return a.position - b.position; });
}
function labelById(id) {
  return STATE.labels.find(function (l) { return l.id === id; });
}

function render() {
  ensureCurrentBoard();
  updateBoardName();
  applyBackground();
  updateCollapseAllBtn();

  const board = $('#board');
  board.innerHTML = '';

  STATE.lists
    .filter(function (l) { return !l.archived && l.boardId === currentBoardId; })
    .sort(function (a, b) { return a.position - b.position; })
    .forEach(function (list) { board.appendChild(renderList(list)); });

  enableSorting();
}

function toggleCollapse(list, collapsed) {
  list.collapsed = collapsed;
  api.setListCollapsed(list.id, collapsed);
  render();
}

function boardLists() {
  return STATE.lists.filter(function (l) { return !l.archived && l.boardId === currentBoardId; });
}
function updateCollapseAllBtn() {
  const b = $('#collapseAllBtn'); if (!b) return;
  const anyExpanded = boardLists().some(function (l) { return !l.collapsed; });
  b.textContent = anyExpanded ? '⊟ 全部畳む' : '⊞ 全部開く';
}
function toggleCollapseAll() {
  const lists = boardLists();
  const collapse = lists.some(function (l) { return !l.collapsed; }); // 1つでも開いていれば全部畳む
  lists.forEach(function (l) { l.collapsed = collapse; });
  api.setAllListsCollapsed(currentBoardId, collapse);
  render();
}

function renderList(list) {
  // 折りたたみ表示（縦書きタイトル＋枚数）
  if (list.collapsed) {
    const w = el('div', 'list collapsed');
    w.dataset.listId = list.id;
    w.title = list.title + '（クリックで展開）';
    // フィルター適用時は該当カードの枚数を表示（未適用時は matchesFilter が全件trueなので総数になる）
    w.appendChild(el('div', 'collapsed-count', String(cardsOfList(list.id).filter(matchesFilter).length)));
    w.appendChild(el('div', 'collapsed-title', esc(list.title)));
    w.addEventListener('click', function () { toggleCollapse(list, false); });
    return w;
  }

  const wrap = el('div', 'list');
  wrap.dataset.listId = list.id;

  const header = el('div', 'list-header');
  const title = el('input', 'list-title');
  title.value = list.title;
  title.addEventListener('change', function () {
    api.renameList(list.id, title.value);
  });
  const menuBtn = el('button', 'list-menu', '⋯');
  menuBtn.title = 'リストのメニュー';
  menuBtn.addEventListener('click', function (e) { e.stopPropagation(); openListMenu(list, menuBtn); });

  const items = cardsOfList(list.id).filter(matchesFilter);
  const allCount = cardsOfList(list.id).length;
  const wip = Number(list.wip) || 0;
  const count = el('span', 'list-count' + (wip && allCount > wip ? ' over' : ''),
    wip ? (allCount + '/' + wip) : String(items.length));
  if (wip && allCount > wip) count.title = 'WIP上限を超えています';
  header.appendChild(title);
  header.appendChild(count);
  header.appendChild(menuBtn);

  const cards = el('div', 'cards');
  cards.dataset.listId = list.id;
  items.forEach(function (c) { cards.appendChild(renderCard(c)); });

  // カード追加
  const addBtn = el('div', 'add-card', '＋ カードを追加');
  addBtn.addEventListener('click', function () { showAddCard(wrap, list.id, addBtn); });

  wrap.appendChild(header);
  wrap.appendChild(cards);
  wrap.appendChild(addBtn);
  return wrap;
}

function renderCard(card) {
  const c = el('div', 'card' + (card.done ? ' is-done' : ''));
  c.dataset.cardId = card.id;

  if (card.cover) {
    const cov = el('div', 'card-cover');
    if (card.cover.type === 'color') {
      cov.style.background = card.cover.value;
    } else if (card.cover.type === 'image' && card.cover.fileId) {
      cov.classList.add('img');
      const img = document.createElement('img');
      img.loading = 'lazy';
      img.src = 'https://drive.google.com/thumbnail?id=' + card.cover.fileId + '&sz=w400';
      cov.appendChild(img);
    }
    c.appendChild(cov);
  }

  if (card.labels && card.labels.length) {
    const lab = el('div', 'card-labels');
    card.labels.forEach(function (id) {
      const l = labelById(id);
      if (l) {
        const chip = el('span', 'card-label-chip', esc(l.name));
        chip.style.background = l.color;
        chip.style.color = textOn(l.color);
        chip.title = l.name;
        lab.appendChild(chip);
      }
    });
    c.appendChild(lab);
  }

  // タイトル行（完了チェック＋タイトル）
  const titleRow = el('div', 'card-title-row');
  const check = el('button', 'card-check' + (card.done ? ' done' : ''), card.done ? '✓' : '');
  check.title = card.done ? '完了（クリックで未完了に）' : '未完了（クリックで完了に）';
  check.addEventListener('click', function (e) { e.stopPropagation(); toggleDone(card); });
  titleRow.appendChild(check);
  titleRow.appendChild(el('span', 'card-title-text', esc(card.title)));
  c.appendChild(titleRow);

  const badges = el('div', 'card-badges');
  const db = dateBadge(card);
  if (db) badges.appendChild(db);
  const checks = card.checklist || [];
  if (checks.length) {
    const done = checks.filter(function (i) { return i.done; }).length;
    badges.appendChild(el('span', 'badge', '☑ ' + done + '/' + checks.length));
  }
  if (card.desc) badges.appendChild(el('span', 'badge', '≡'));
  if (card.attachments && card.attachments.length) {
    badges.appendChild(el('span', 'badge', '📎 ' + card.attachments.length));
  }
  if (card.comments && card.comments.length) {
    badges.appendChild(el('span', 'badge', '💬 ' + card.comments.length));
  }
  if (card.fields) {
    fieldsOfBoard().forEach(function (f) {
      if (!f.showFront) return;
      const txt = formatFieldValue(f, card.fields[f.id]);
      if (txt) badges.appendChild(el('span', 'badge rating', txt));
    });
  }
  if (card.template) badges.appendChild(el('span', 'badge', '📋 テンプレ'));
  if (Array.isArray(card.links) && card.links.length) {
    const hasYt = card.links.some(function (u) { return youtubeId(u); });
    badges.appendChild(el('span', 'badge', (hasYt ? '▶ ' : '🔗 ') + card.links.length));
  }
  if (Array.isArray(card.places) && card.places.length) {
    badges.appendChild(el('span', 'badge', '🗺 ' + card.places.length));
  }
  if (badges.children.length) c.appendChild(badges);

  // ホバーで出る「鉛筆」＝開かずにクイック編集
  const editBtn = el('button', 'card-edit-btn', '✎');
  editBtn.title = '開かずに編集';
  editBtn.addEventListener('click', function (e) { e.stopPropagation(); openQuickEdit(card, c); });
  c.appendChild(editBtn);

  c.addEventListener('click', function () { openModal(card.id); });
  return c;
}

// カードの完了/未完了をトグル
function toggleDone(card) {
  const prev = card.done;
  card.done = !card.done;
  api.updateCard(card.id, { done: card.done });
  pushUndo('完了の切替', function () {
    card.done = prev; api.updateCard(card.id, { done: prev });
    refreshCardNode(card); if (openCardId === card.id) updateModalDoneBtn(card);
  });
  refreshCardNode(card);
  if (openCardId === card.id) updateModalDoneBtn(card);
}

/* --------------------------- アーカイブ --------------------------- */
function archiveCard(card) {
  card.archived = true;
  api.updateCard(card.id, { archived: true });
  pushUndo('アーカイブ', function () { card.archived = false; api.updateCard(card.id, { archived: false }); });
  render();
  setStatus('アーカイブしました（Ctrl+Zで戻す）');
}
function restoreCard(card) {
  const lists = STATE.lists.filter(function (l) { return !l.archived && l.boardId === currentBoardId; });
  const hasList = lists.some(function (l) { return l.id === card.listId; });
  if (!hasList && lists.length) {
    card.listId = lists[0].id;
    api.moveCard(card.id, lists[0].id, [card.id]);
  }
  card.archived = false;
  api.updateCard(card.id, { archived: false });
  renderArchive();
  render();
  setStatus('リストに戻しました');
}

function showArchive() { renderArchive(); renderTrash(); $('#archive').classList.remove('hidden'); }
function hideArchive() { $('#archive').classList.add('hidden'); }

function renderArchive() {
  const cont = $('#archList');
  cont.innerHTML = '';

  // アーカイブ済みリスト
  const archLists = STATE.lists.filter(function (l) { return l.archived && l.boardId === currentBoardId; });
  if (archLists.length) {
    cont.appendChild(el('h3', 'arch-head', 'アーカイブ済みリスト'));
    archLists.forEach(function (l) {
      const row = el('div', 'arch-row');
      row.appendChild(el('span', 'arch-title', '🗄 ' + esc(l.title)));
      const restore = el('button', 'ghost-btn small dark', '戻す');
      restore.addEventListener('click', function () {
        api.archiveList(l.id, false); l.archived = false; renderArchive(); render();
      });
      const del = el('button', 'danger-btn arch-del', '削除');
      del.addEventListener('click', function () {
        if (confirm('リスト「' + l.title + '」と中のカードを完全に削除しますか?')) {
          api.deleteList(l.id).then(function () {
            STATE.lists = STATE.lists.filter(function (x) { return x.id !== l.id; });
            STATE.cards = STATE.cards.filter(function (c) { return c.listId !== l.id; });
            renderArchive();
          });
        }
      });
      row.appendChild(restore); row.appendChild(del);
      cont.appendChild(row);
    });
  }

  const listIds = STATE.lists
    .filter(function (l) { return l.boardId === currentBoardId; })
    .map(function (l) { return l.id; });
  const archived = STATE.cards.filter(function (c) {
    return c.archived && listIds.indexOf(c.listId) >= 0;
  });
  if (archLists.length) cont.appendChild(el('h3', 'arch-head', 'アーカイブ済みカード'));
  if (!archived.length) {
    cont.appendChild(el('div', 'set-note', 'アーカイブされたカードはありません。'));
    return;
  }
  archived.forEach(function (card) {
    const row = el('div', 'arch-row');
    row.appendChild(el('span', 'arch-title', esc(card.title)));
    const restore = el('button', 'ghost-btn small dark', 'リストに戻す');
    restore.addEventListener('click', function () { restoreCard(card); });
    const del = el('button', 'danger-btn arch-del', '削除');
    del.addEventListener('click', function () {
      if (confirm('このカードを完全に削除しますか?')) {
        api.deleteCard(card.id).then(function () {
          STATE.cards = STATE.cards.filter(function (c) { return c.id !== card.id; });
          renderArchive();
        });
      }
    });
    row.appendChild(restore);
    row.appendChild(del);
    cont.appendChild(row);
  });
}

/* ボードのアーカイブ */
function archiveBoardUI(board) {
  api.archiveBoard(board.id, true);
  board.archived = true;
  if (currentBoardId === board.id) {
    const next = STATE.boards.filter(function (b) { return !b.archived; })[0];
    currentBoardId = next ? next.id : null;
    if (currentBoardId) saveCurrentBoard(currentBoardId);
  }
  renderBoardHome();
  render();
}
function restoreBoard(board) {
  api.archiveBoard(board.id, false);
  board.archived = false;
  renderBoardHome();
}

function renderArchivedBoards() {
  const cont = document.getElementById('archivedBoards');
  if (!cont) return;
  cont.innerHTML = '';
  const archived = STATE.boards.filter(function (b) { return b.archived; });
  if (!archived.length) return;
  cont.appendChild(el('h3', 'arch-head', 'アーカイブ済みボード'));
  archived.forEach(function (b) {
    const row = el('div', 'arch-row');
    row.appendChild(el('span', 'arch-title', esc(b.title)));
    const restore = el('button', 'ghost-btn small dark', '復元');
    restore.addEventListener('click', function () { restoreBoard(b); });
    const del = el('button', 'danger-btn arch-del', '削除');
    del.addEventListener('click', function () {
      if (confirm('ボード「' + b.title + '」と中のリスト・カードを完全に削除しますか?')) {
        api.deleteBoard(b.id).then(function () {
          STATE.boards = STATE.boards.filter(function (x) { return x.id !== b.id; });
          STATE.lists = STATE.lists.filter(function (l) { return l.boardId !== b.id; });
          renderBoardHome();
        });
      }
    });
    row.appendChild(restore);
    row.appendChild(del);
    cont.appendChild(row);
  });
}

/* --------------------- クイック編集（カードを開かずに編集） --------------------- */
let qeCard = null;

function closeQuickEdit() {
  const o = document.getElementById('qe-overlay');
  if (o) o.remove();
  qeCard = null;
}

function saveQuickTitle() {
  const ta = document.querySelector('.qe-title');
  if (!ta || !qeCard) return;
  const v = ta.value.trim();
  if (v && v !== qeCard.title) {
    qeCard.title = v;
    api.updateCard(qeCard.id, { title: v });
    refreshCardNode(qeCard);
  }
}

function openQuickEdit(card, cardNode) {
  closeQuickEdit();
  qeCard = card;
  const rect = cardNode.getBoundingClientRect();

  const overlay = el('div', 'qe-overlay');
  overlay.id = 'qe-overlay';
  overlay.addEventListener('mousedown', function (e) {
    if (e.target === overlay) { saveQuickTitle(); closeQuickEdit(); }
  });

  // タイトル編集エリア（カードの位置に重ねる）
  const editor = el('div', 'qe-editor');
  editor.style.top = rect.top + 'px';
  editor.style.left = rect.left + 'px';
  editor.style.width = rect.width + 'px';
  const ta = el('textarea', 'qe-title');
  ta.value = card.title;
  ta.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveQuickTitle(); closeQuickEdit(); }
    if (e.key === 'Escape') closeQuickEdit();
  });
  const save = el('button', 'primary-btn qe-save', '保存');
  save.addEventListener('click', function () { saveQuickTitle(); closeQuickEdit(); });
  editor.appendChild(ta);
  editor.appendChild(save);

  // クイックメニュー（カードの右、無ければ左）
  const menuW = 200;
  const menu = el('div', 'qe-menu');
  const left = (rect.right + menuW + 12 < window.innerWidth)
    ? (rect.right + 8) : Math.max(8, rect.left - menuW - 8);
  menu.style.top = rect.top + 'px';
  menu.style.left = left + 'px';
  menu.style.width = (menuW - 10) + 'px';
  qeBuildMenu(menu, card);

  overlay.appendChild(editor);
  overlay.appendChild(menu);
  document.body.appendChild(overlay);
  ta.focus();
  ta.select();
}

function qeBuildMenu(menu, card) {
  menu.innerHTML = '';
  function item(label, fn) {
    const b = el('button', '', label);
    b.addEventListener('click', fn);
    menu.appendChild(b);
  }
  item('📂 カードを開く', function () { closeQuickEdit(); openModal(card.id); });
  item(card.done ? '⭕ 未完了に戻す' : '✅ 完了にする', function () { toggleDone(card); closeQuickEdit(); });
  item('🏷 ラベルを編集', function () { qeShowLabels(menu, card); });
  item('🕐 日付を編集', function () { qeShowDate(menu, card); });
  item('📋 複製', function () { closeQuickEdit(); duplicateCard(card); });
  item('📥 アーカイブ', function () { archiveCard(card); closeQuickEdit(); });
  item('🗑 カードを削除', function () {
    if (confirm('このカードを削除しますか?')) {
      api.deleteCard(card.id).then(function () {
        STATE.cards = STATE.cards.filter(function (c) { return c.id !== card.id; });
        closeQuickEdit();
        render();
      });
    }
  });
}

function qeBackBtn(menu, card) {
  const back = el('button', 'qe-back', '← 戻る');
  back.addEventListener('click', function () { qeBuildMenu(menu, card); });
  return back;
}

function qeShowLabels(menu, card) {
  menu.innerHTML = '';
  menu.appendChild(qeBackBtn(menu, card));
  const panel = el('div', 'qe-sub');
  STATE.labels.forEach(function (l) {
    const on = (card.labels || []).indexOf(l.id) >= 0;
    const t = el('div', 'label-toggle' + (on ? ' on' : ''), esc(l.name));
    t.style.background = l.color;
    t.style.color = textOn(l.color);
    t.style.margin = '3px';
    t.addEventListener('click', function () {
      let labels = card.labels || [];
      labels = labels.indexOf(l.id) >= 0
        ? labels.filter(function (x) { return x !== l.id; })
        : labels.concat([l.id]);
      card.labels = labels;
      api.updateCard(card.id, { labels: labels });
      refreshCardNode(card);
      qeShowLabels(menu, card);
    });
    panel.appendChild(t);
  });
  menu.appendChild(panel);
}

function qeShowDate(menu, card) {
  menu.innerHTML = '';
  menu.appendChild(qeBackBtn(menu, card));
  const panel = el('div', 'qe-sub');

  panel.appendChild(el('div', 'qe-sub-label', 'スタート'));
  const s = el('input'); s.type = 'date'; s.value = card.start || '';
  s.addEventListener('change', function () {
    card.start = s.value; api.updateCard(card.id, { start: s.value }); refreshCardNode(card);
  });
  panel.appendChild(s);

  panel.appendChild(el('div', 'qe-sub-label', '終わり'));
  const e = el('input'); e.type = 'date'; e.value = card.due || '';
  e.addEventListener('change', function () {
    card.due = e.value; api.updateCard(card.id, { due: e.value }); refreshCardNode(card);
  });
  panel.appendChild(e);

  menu.appendChild(panel);
}

function dateBadge(card) {
  const s = card.start || card.due || '';
  const e = card.due || card.start || '';
  if (!s && !e) return null;

  const endStr = e || s;
  const todayStr = ymd(new Date());
  const days = Math.round(
    (new Date(endStr + 'T00:00:00') - new Date(todayStr + 'T00:00:00')) / 86400000);

  let cls = 'badge';
  if (card.done) cls += ' due-done';        // 完了 = 緑
  else if (days <= 0) cls += ' due-over';    // 当日 or 過ぎ = 赤
  else if (days <= 3) cls += ' due-soon';    // 近い(3日以内) = 黄
  // それ以外は通常色

  function md(ds) { const d = new Date(ds + 'T00:00:00'); return (d.getMonth() + 1) + '/' + d.getDate(); }
  const text = (s && e && s !== e) ? (md(s) + '→' + md(e)) : md(endStr);
  return el('span', cls, '🕑 ' + text);
}

/* ------------------------- カード追加フォーム ------------------------- */
function showAddCard(listWrap, listId, addBtn) {
  addBtn.classList.add('hidden');
  const form = el('div', 'add-card-form');
  const ta = el('textarea');
  ta.placeholder = 'カードのタイトルを入力...';
  ta.addEventListener('input', function () { autoGrow(this); });
  const row = el('div', 'row');
  const ok = el('button', 'primary-btn', '追加');
  const cancel = el('button', 'ghost-btn small', 'キャンセル');
  cancel.style.color = '#5e6c84';
  cancel.style.background = '#091e4214';
  row.appendChild(ok); row.appendChild(cancel);
  form.appendChild(ta); form.appendChild(row);
  listWrap.appendChild(form);
  ta.focus();

  function close() { form.remove(); addBtn.classList.remove('hidden'); }
  async function submit() {
    const t = ta.value.trim();
    if (!t) { close(); return; }
    const card = await api.addCard(listId, t);
    normalizeCard(card); // 配列/オブジェクトのフィールドを整形（これが無いと開けない）
    STATE.cards.push(card);
    pushUndo('カードの追加', function () {
      STATE.cards = STATE.cards.filter(function (c) { return c.id !== card.id; });
      api.deleteCard(card.id);
    });
    render();
  }
  ok.addEventListener('click', submit);
  cancel.addEventListener('click', close);
  ta.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
    if (e.key === 'Escape') close();
  });
}

/* --------------------------- 並べ替え(D&D) --------------------------- */
let SORTABLES = [];
function enableSorting() {
  // 前回の並べ替えインスタンスを破棄（溜まって重くなるのを防ぐ）
  SORTABLES.forEach(function (s) { try { s.destroy(); } catch (e) {} });
  SORTABLES = [];
  // カード
  document.querySelectorAll('.cards').forEach(function (container) {
    SORTABLES.push(new Sortable(container, {
      group: 'cards', animation: 150, ghostClass: 'sortable-ghost',
      // スマホ: 長押し(180ms)してから動かすと移動。普通のスワイプはスクロール
      delay: 180, delayOnTouchOnly: true, touchStartThreshold: 6,
      onEnd: function (evt) {
        const cardId = evt.item.dataset.cardId;
        const toListId = evt.to.dataset.listId;
        const orderedIds = Array.from(evt.to.children).map(function (n) { return n.dataset.cardId; });
        // ローカル状態を更新
        const card = STATE.cards.find(function (c) { return c.id === cardId; });
        const oldListId = card ? card.listId : null;
        if (oldListId && oldListId !== toListId) {
          pushUndo('カードの移動', function () { card.listId = oldListId; api.moveCardToList(cardId, oldListId); });
        }
        if (card) card.listId = toListId;
        orderedIds.forEach(function (id, idx) {
          const c = STATE.cards.find(function (x) { return x.id === id; });
          if (c) c.position = idx;
        });
        api.moveCard(cardId, toListId, orderedIds).then(function () { setStatus('保存しました'); });
        if (card) applyAutomations(card, toListId);
      }
    }));
  });
  // リスト
  SORTABLES.push(new Sortable($('#board'), {
    animation: 150, draggable: '.list', handle: '.list-header',
    delay: 180, delayOnTouchOnly: true, touchStartThreshold: 6,
    onEnd: function () {
      const ids = Array.from(document.querySelectorAll('.list')).map(function (n) { return n.dataset.listId; });
      ids.forEach(function (id, idx) {
        const l = STATE.lists.find(function (x) { return x.id === id; });
        if (l) l.position = idx;
      });
      api.saveListOrder(ids).then(function () { setStatus('保存しました'); });
    }
  }));
}

/* ----------------------------- モーダル ----------------------------- */
function openModal(cardId) {
  openCardId = cardId;
  saveOpenCard(cardId);
  hideLabelForm();
  hideFieldForm();
  $('#m-move-panel').classList.add('hidden');
  resetDescPreview();      // 前のカードのプレビュー表示を持ち越さない
  hideDistPanel();         // 展開パネルも畳んでおく
  renderModal();
  $('#modal').classList.remove('hidden');
  autoGrow($('#m-desc')); // 表示後に高さを中身へ合わせる
}
function closeModal() {
  openCardId = null;
  saveOpenCard(null);
  $('#modal').classList.add('hidden');
  $('#m-links').innerHTML = ''; // 再生中のYouTubeを止めて解放
  $('#m-places').innerHTML = ''; // 地図iframeを解放
  if (!$('#table').classList.contains('hidden')) renderTable(); // テーブルから開いていたら更新
}
function currentCard() {
  return STATE.cards.find(function (c) { return c.id === openCardId; });
}

function updateModalDoneBtn(card) {
  const b = $('#m-done');
  if (!b) return;
  b.className = 'done-btn' + (card.done ? ' done' : '');
  b.innerHTML = card.done ? '✓ 完了済み' : '完了にする';
}

function updateModalTemplateBtn(card) {
  const b = $('#m-template');
  if (!b) return;
  b.textContent = card.template ? '📋 テンプレ解除' : '📋 テンプレートにする';
}
function toggleTemplate() {
  const card = currentCard();
  if (!card) return;
  card.template = !card.template;
  api.updateCard(card.id, { template: card.template });
  updateModalTemplateBtn(card);
  refreshCardNode(card);
  setStatus(card.template ? 'テンプレートにしました' : 'テンプレートを解除しました');
}

function renderModal() {
  const card = currentCard();
  if (!card) return;

  $('#m-title').value = card.title;
  $('#m-desc').value = card.desc || '';
  $('#m-start').value = card.start || '';
  $('#m-end').value = card.due || '';
  $('#m-allday').checked = card.allDay !== false;
  updateModalDoneBtn(card);
  updateModalTemplateBtn(card);
  $('#m-gcal').checked = !!(card.sync && card.sync.gcal);
  $('#m-gtask').checked = !!(card.sync && card.sync.gtask);
  $('#m-sync-status').textContent = '';
  renderKlassPeriod(card);
  $('#m-history').innerHTML = '';   // 開くたび畳んでおく（重いので押されたときだけ読む）
  renderCover(card);

  // ラベル（このボードのもの＋全ボード共通）
  const lc = $('#m-labels');
  lc.innerHTML = '';
  STATE.labels
    .filter(function (l) { return l.boardId === '' || l.boardId === currentBoardId; })
    .forEach(function (l) {
      const on = (card.labels || []).indexOf(l.id) >= 0;
      const t = el('div', 'label-toggle' + (on ? ' on' : ''));
      t.style.background = l.color;
      t.style.color = textOn(l.color);
      t.appendChild(el('span', 'lbl-text', esc(l.name)));
      t.addEventListener('click', function () {
        let labels = card.labels || [];
        labels = labels.indexOf(l.id) >= 0
          ? labels.filter(function (x) { return x !== l.id; })
          : labels.concat([l.id]);
        card.labels = labels;
        saveField({ labels: labels });
        renderModal();
      });
      const x = el('span', 'lbl-del', '✕');
      x.title = 'このラベルを削除';
      x.addEventListener('click', function (e) {
        e.stopPropagation();
        if (confirm('ラベル「' + l.name + '」を削除しますか?（全カードから外れます）')) {
          api.deleteLabel(l.id).then(function () {
            STATE.labels = STATE.labels.filter(function (x2) { return x2.id !== l.id; });
            renderModal();
            render();
          });
        }
      });
      t.appendChild(x);
      lc.appendChild(t);
    });

  renderFields(card);
  renderAttachments(card);
  renderLinks(card);
  renderPlaces(card);
  renderChecklist(card);
  renderComments(card);
}

/* ----------------------- ラベルの追加（色選択つき） ----------------------- */
const LABEL_PALETTE = ['#61bd4f', '#f2d600', '#ff9f1a', '#eb5a46', '#c377e0',
  '#0079bf', '#00c2e0', '#51e898', '#ff78cb', '#344563', '#8993a4', '#b04632'];
let selectedLabelColor = LABEL_PALETTE[0];

function renderLabelColors() {
  const cont = $('#m-label-colors');
  if (!cont) return;
  cont.innerHTML = '';
  LABEL_PALETTE.forEach(function (col) {
    const sw = el('div', 'label-swatch' + (col === selectedLabelColor ? ' sel' : ''));
    sw.style.background = col;
    sw.title = col;
    sw.addEventListener('click', function () {
      selectedLabelColor = col;
      $('#m-label-color').value = col;
      renderLabelColors();
    });
    cont.appendChild(sw);
  });
}

function showLabelForm() {
  $('#m-label-name').value = '';
  selectedLabelColor = LABEL_PALETTE[0];
  $('#m-label-color').value = selectedLabelColor;
  renderLabelColors();
  $('#m-label-form').classList.remove('hidden');
  $('#m-label-name').focus();
}
function hideLabelForm() {
  const f = $('#m-label-form');
  if (f) f.classList.add('hidden');
}

async function saveNewLabel() {
  const name = $('#m-label-name').value.trim();
  if (!name) { $('#m-label-name').focus(); return; }
  const color = $('#m-label-color').value || selectedLabelColor;
  const label = await api.addLabel(currentBoardId, name, color);
  STATE.labels.push(label);
  hideLabelForm();
  renderModal();           // 追加したラベルをトグル一覧に反映
  setStatus('ラベルを追加しました');
}

/* ----------------------- カスタムフィールド（ボードごと） ----------------------- */
function fieldsOfBoard() {
  return STATE.fields
    .filter(function (f) { return f.boardId === currentBoardId; })
    .sort(function (a, b) { return a.position - b.position; });
}
function fieldById(id) { return STATE.fields.find(function (f) { return f.id === id; }); }

function formatFieldValue(f, v) {
  if (v === undefined || v === null || v === '') return '';
  if (f.type === 'checkbox') return v ? (f.name + ' ✓') : '';
  if (f.type === 'rating') {
    const style = (f.config && f.config.style) || 'star';
    if (style === 'star') return f.name + ' ★' + v;
    if (style === 'level') return f.name + ' Lv' + v;
    return f.name + ' ' + v;
  }
  if (f.type === 'date') return f.name + ' ' + v;
  return f.name + ': ' + v;
}

function renderFields(card) {
  const cont = $('#m-fields');
  if (!cont) return;
  cont.innerHTML = '';
  const fs = fieldsOfBoard();
  if (!fs.length) {
    cont.appendChild(el('div', 'rating-empty', 'このボードにはまだフィールドがありません。下のボタンで作れます。'));
    return;
  }
  const values = card.fields || {};
  fs.forEach(function (f) {
    const row = el('div', 'rating-row');
    const head = el('div', 'rating-head');
    head.appendChild(el('span', 'rating-name', esc(f.name)));
    const edit = el('button', 'rating-del', '✏️');
    edit.title = 'このフィールドを編集（名前・選択肢など）';
    edit.addEventListener('click', function () { showFieldForm(f); });
    head.appendChild(edit);
    const del = el('button', 'rating-del', '🗑');
    del.title = 'フィールドを削除';
    del.addEventListener('click', function () {
      if (confirm('フィールド「' + f.name + '」を削除しますか?（各カードの値も表示されなくなります）')) {
        api.deleteField(f.id).then(function () {
          STATE.fields = STATE.fields.filter(function (x) { return x.id !== f.id; });
          renderFields(card); refreshCardNode(card);
        });
      }
    });
    head.appendChild(del);
    row.appendChild(head);
    row.appendChild(fieldEditor(card, f, values[f.id]));
    cont.appendChild(row);
  });
}

function fieldEditor(card, f, value) {
  const wrap = el('div', 'field-editor');
  if (f.type === 'text') {
    const inp = el('input', 'field-input'); inp.type = 'text'; inp.value = value || '';
    inp.addEventListener('change', function () { setFieldValue(card, f.id, inp.value); });
    wrap.appendChild(inp);
  } else if (f.type === 'number') {
    const inp = el('input', 'field-input'); inp.type = 'number';
    inp.value = (value === undefined || value === null) ? '' : value;
    inp.addEventListener('change', function () { setFieldValue(card, f.id, inp.value === '' ? '' : Number(inp.value)); });
    wrap.appendChild(inp);
  } else if (f.type === 'date') {
    const inp = el('input'); inp.type = 'date'; inp.value = value || '';
    inp.addEventListener('change', function () { setFieldValue(card, f.id, inp.value); });
    wrap.appendChild(inp);
  } else if (f.type === 'checkbox') {
    const cb = el('input'); cb.type = 'checkbox'; cb.checked = !!value;
    cb.addEventListener('change', function () { setFieldValue(card, f.id, cb.checked); });
    wrap.appendChild(cb);
  } else if (f.type === 'select') {
    const sel = el('select', 'field-input');
    const blank = document.createElement('option'); blank.value = ''; blank.textContent = '（未選択）';
    sel.appendChild(blank);
    ((f.config && f.config.options) || []).forEach(function (o) {
      const op = document.createElement('option'); op.value = o; op.textContent = o;
      if (o === value) op.selected = true;
      sel.appendChild(op);
    });
    sel.addEventListener('change', function () { setFieldValue(card, f.id, sel.value); });
    wrap.appendChild(sel);
  } else if (f.type === 'rating') {
    const style = (f.config && f.config.style) || 'star';
    const max = (f.config && Number(f.config.max)) || 5;
    const cur = value ? Number(value) : 0;
    const cells = el('div', 'rating-cells');
    for (let i = 1; i <= max; i++) {
      const cell = el('button', 'rating-cell style-' + style + (i <= cur ? ' on' : ''));
      cell.textContent = (style === 'star') ? (i <= cur ? '★' : '☆') : i;
      (function (val) {
        cell.addEventListener('click', function () { setFieldValue(card, f.id, cur === val ? '' : val); });
      })(i);
      cells.appendChild(cell);
    }
    if (cur > 0) {
      const clr = el('button', 'rating-clear', 'クリア');
      clr.addEventListener('click', function () { setFieldValue(card, f.id, ''); });
      cells.appendChild(clr);
    }
    wrap.appendChild(cells);
  }
  return wrap;
}

function setFieldValue(card, fieldId, value) {
  card.fields = card.fields || {};
  if (value === '' || value === false || value === null || value === undefined) delete card.fields[fieldId];
  else card.fields[fieldId] = value;
  api.updateCard(card.id, { fields: card.fields });
  renderFields(card);
  refreshCardNode(card);
}

/* フィールド追加フォーム */
// このフィールドの値が、いま何枚のカードで使われているかを数える
function fieldValueUsage(fieldId) {
  const counts = {};
  STATE.cards.forEach(function (c) {
    if (c.archived) return;
    const v = c.fields && c.fields[fieldId];
    if (v === undefined || v === null || v === '') return;
    counts[v] = (counts[v] || 0) + 1;
  });
  return counts;
}

// field を渡すと「編集」、渡さないと「新規追加」の設定欄になる
function renderFieldConfig(field) {
  const cont = $('#m-field-config');
  cont.innerHTML = '';
  const type = $('#m-field-type').value;
  if (field) {
    cont.appendChild(el('div', 'set-note',
      '種類（' + esc(field.type) + '）は後から変えられません。'
      + '変えたい場合は、新しく作り直してください。'));
  }
  if (type === 'select') {
    cont.appendChild(el('div', 'qe-sub-label', '選択肢（カンマ区切り）'));
    const inp = el('input', 'field-input'); inp.id = 'm-field-options';
    inp.placeholder = '例: 浅煎り, 中煎り, 深煎り';
    if (field) inp.value = ((field.config && field.config.options) || []).join(', ');
    cont.appendChild(inp);
    if (field) {
      // いま使われている値を見せておくと、うっかり消してしまう事故が減る
      const counts = fieldValueUsage(field.id);
      const used = Object.keys(counts);
      if (used.length) {
        cont.appendChild(el('div', 'set-note', '使用中：'
          + used.map(function (v) { return esc(v) + '（' + counts[v] + '枚）'; }).join('　/　')));
      }
    }
  } else if (type === 'rating') {
    const rowEl = el('div', 'rating-form-row');
    const sel = el('select'); sel.id = 'm-field-rstyle';
    [['star', '☆ 星'], ['level', 'Lv レベル'], ['number', '数値']].forEach(function (o) {
      const op = document.createElement('option'); op.value = o[0]; op.textContent = o[1]; sel.appendChild(op);
    });
    const maxLbl = el('label', 'rating-max'); maxLbl.appendChild(document.createTextNode('最大：'));
    const maxInp = el('input'); maxInp.type = 'number'; maxInp.id = 'm-field-rmax';
    maxInp.min = '2'; maxInp.max = '10';
    maxInp.value = String((field && field.config && Number(field.config.max)) || 5);
    if (field && field.config && field.config.style) sel.value = field.config.style;
    maxLbl.appendChild(maxInp);
    rowEl.appendChild(sel); rowEl.appendChild(maxLbl);
    cont.appendChild(rowEl);
  }
}

// 編集中のフィールドID（null なら新規追加）
let editingFieldId = null;

function showFieldForm(field) {
  // 一覧の✏️から呼ばれると field が入る。＋ボタンから呼ばれると undefined。
  const f = (field && field.id) ? field : null;
  editingFieldId = f ? f.id : null;
  $('#m-field-name').value = f ? f.name : '';
  $('#m-field-type').value = f ? f.type : 'text';
  $('#m-field-type').disabled = !!f;      // 種類を変えると既存の値の意味が壊れるので触らせない
  $('#m-field-front').checked = f ? (f.showFront !== false) : true;
  renderFieldConfig(f);
  $('#m-field-save').textContent = f ? '保存' : '追加';
  $('#m-field-form').classList.remove('hidden');
  $('#m-field-name').focus();
}
function hideFieldForm() {
  const f = $('#m-field-form');
  if (f) f.classList.add('hidden');
  editingFieldId = null;
  const t = $('#m-field-type');
  if (t) t.disabled = false;
  const b = $('#m-field-save');
  if (b) b.textContent = '追加';
}

async function saveFieldForm() {
  const name = $('#m-field-name').value.trim();
  if (!name) { $('#m-field-name').focus(); return; }
  if (!currentBoardId) return;
  const type = $('#m-field-type').value;
  const showFront = $('#m-field-front').checked;
  const config = {};
  if (type === 'select') {
    const raw = $('#m-field-options') ? $('#m-field-options').value : '';
    config.options = raw.split(/[,、]/).map(function (s) { return s.trim(); }).filter(function (s) { return s; });
  } else if (type === 'rating') {
    config.style = $('#m-field-rstyle').value;
    let m = parseInt($('#m-field-rmax').value, 10);
    if (!(m >= 2)) m = 5; if (m > 10) m = 10;
    config.max = m;
  }

  const card = currentCard();

  if (editingFieldId) {
    // 使われている選択肢が消えるときは、黙って進めず知らせる
    if (type === 'select') {
      const counts = fieldValueUsage(editingFieldId);
      const gone = Object.keys(counts).filter(function (v) { return config.options.indexOf(v) < 0; });
      if (gone.length) {
        const list = gone.map(function (v) { return v + '（' + counts[v] + '枚）'; }).join('、');
        if (!confirm('次の選択肢が一覧から無くなります：' + list
          + '。該当カードの値そのものは残りますが、ドロップダウンでは選び直すまで表示されません。続けますか?')) return;
      }
    }
    await api.updateField(editingFieldId, { name: name, config: config, showFront: showFront });
    const f = STATE.fields.find(function (x) { return x.id === editingFieldId; });
    if (f) { f.name = name; f.config = config; f.showFront = showFront; }
    hideFieldForm();
    if (card) { renderFields(card); refreshCardNode(card); }
    render();                       // カード表面の表示も作り直す
    setStatus('フィールドを更新しました');
    return;
  }

  const field = await api.addField(currentBoardId, name, type, config, showFront);
  STATE.fields.push(field);
  hideFieldForm();
  if (card) renderFields(card);
  setStatus('フィールドを追加しました');
}

// 並べ替え用の値比較
function compareFieldValues(f, va, vb) {
  const ea = (va === undefined || va === null || va === '');
  const eb = (vb === undefined || vb === null || vb === '');
  if (ea && eb) return 0;
  if (ea) return 1;   // 未設定は下
  if (eb) return -1;
  if (!f) return 0;
  if (f.type === 'number' || f.type === 'rating') return Number(vb) - Number(va); // 高い順
  if (f.type === 'checkbox') return (vb ? 1 : 0) - (va ? 1 : 0);                   // チェック済みが上
  if (f.type === 'date') return String(va).localeCompare(String(vb));             // 近い順
  return String(va).localeCompare(String(vb), 'ja');                              // テキスト/選択
}

// 大きいファイル（動画など）も Drive へ直接アップロード（進捗付き・サイズ実質無制限）
async function uploadAttachmentToDrive(card, file) {
  try {
    setStatus('準備中...');
    const token = await api.getOAuthToken();
    const folderId = await api.getAttachFolderId();
    const metadata = { name: file.name };
    if (folderId) metadata.parents = [folderId];

    // 1) アップロードセッション開始（resumable）
    const initRes = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,mimeType',
      {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + token,
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Type': file.type || 'application/octet-stream'
        },
        body: JSON.stringify(metadata)
      });
    if (!initRes.ok) throw new Error('開始失敗 ' + initRes.status);
    const uploadUrl = initRes.headers.get('Location');
    if (!uploadUrl) throw new Error('アップロードURLを取得できませんでした');

    // 2) 本体を送信（進捗表示つき）
    const fileMeta = await putWithProgress(uploadUrl, file, token);

    // 3) メタ情報をカードに保存
    const att = await api.addAttachmentMeta(card.id, file.name, file.type || '', fileMeta.id);
    if (att) {
      card.attachments = (card.attachments || []).concat([att]);
      renderAttachments(card);
      refreshCardNode(card);
    }
    setStatus('添付しました');
  } catch (err) {
    alert('アップロードに失敗しました: ' + err);
    setStatus('');
  }
}

function putWithProgress(url, file, token) {
  return new Promise(function (resolve, reject) {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Authorization', 'Bearer ' + token);
    xhr.upload.onprogress = function (e) {
      if (e.lengthComputable) {
        setStatus('アップロード中... ' + Math.round(e.loaded / e.total * 100) + '%');
      }
    };
    xhr.onload = function () {
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText)); }
        catch (e) { reject(new Error('応答の解析に失敗')); }
      } else {
        reject(new Error('送信失敗 ' + xhr.status));
      }
    };
    xhr.onerror = function () { reject(new Error('通信エラー')); };
    xhr.send(file);
  });
}

/* --------------------------- リンク・YouTube埋め込み --------------------------- */
function youtubeId(url) {
  const m = String(url).match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/);
  return m ? m[1] : null;
}

function renderLinks(card) {
  const cont = $('#m-links');
  if (!cont) return;
  cont.innerHTML = '';
  const links = Array.isArray(card.links) ? card.links : [];
  links.forEach(function (url) {
    const item = el('div', 'link-item');
    const yt = youtubeId(url);
    if (yt) {
      // まずは軽いサムネ＋▶。クリックで初めてプレーヤーを読み込む（開く速度・スクロール改善）
      const wrap = el('div', 'yt-embed yt-facade');
      const thumb = document.createElement('img');
      thumb.loading = 'lazy';
      thumb.className = 'yt-thumb';
      thumb.src = 'https://img.youtube.com/vi/' + yt + '/hqdefault.jpg';
      const play = el('div', 'yt-play', '▶');
      wrap.appendChild(thumb);
      wrap.appendChild(play);
      wrap.addEventListener('click', function () {
        wrap.innerHTML = '';
        wrap.classList.remove('yt-facade');
        const ifr = document.createElement('iframe');
        ifr.src = 'https://www.youtube.com/embed/' + yt + '?autoplay=1';
        ifr.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture; fullscreen');
        ifr.setAttribute('allowfullscreen', 'true');
        ifr.setAttribute('frameborder', '0');
        wrap.appendChild(ifr);
      });
      item.appendChild(wrap);
    } else {
      const a = el('a', 'link-url', esc(url));
      a.href = url; a.target = '_blank'; a.rel = 'noopener';
      item.appendChild(a);
    }
    const del = el('button', 'att-del link-del', '削除');
    del.addEventListener('click', function () {
      card.links = (card.links || []).filter(function (u) { return u !== url; });
      api.updateCard(card.id, { links: card.links });
      renderLinks(card);
      refreshCardNode(card);
    });
    item.appendChild(del);
    cont.appendChild(item);
  });
}

/* --------------------------- 地図・場所 --------------------------- */
function renderPlaces(card) {
  const cont = $('#m-places');
  if (!cont) return;
  cont.innerHTML = '';
  const places = Array.isArray(card.places) ? card.places : [];
  places.forEach(function (q) {
    const item = el('div', 'link-item');
    const head = el('div', 'place-head');
    head.appendChild(el('span', 'place-name', esc(q)));
    const open = el('a', 'place-open', '🔗 Mapで開く');
    open.href = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q);
    open.target = '_blank'; open.rel = 'noopener';
    head.appendChild(open);
    const del = el('button', 'att-del', '削除');
    del.addEventListener('click', function () {
      card.places = places.filter(function (p) { return p !== q; });
      api.updateCard(card.id, { places: card.places });
      renderPlaces(card); refreshCardNode(card);
    });
    head.appendChild(del);
    item.appendChild(head);

    // 地図（クリックで読み込み＝軽量）
    const map = el('div', 'map-embed map-facade');
    map.appendChild(el('div', 'map-show', '🗺 地図を表示'));
    map.addEventListener('click', function () {
      if (!map.classList.contains('map-facade')) return;
      map.classList.remove('map-facade'); map.innerHTML = '';
      const ifr = document.createElement('iframe');
      ifr.setAttribute('loading', 'lazy');
      ifr.src = 'https://maps.google.com/maps?q=' + encodeURIComponent(q) + '&output=embed';
      map.appendChild(ifr);
    });
    item.appendChild(map);
    cont.appendChild(item);
  });
}

function renderAttachments(card) {
  const cont = $('#m-attachments');
  cont.innerHTML = '';
  (card.attachments || []).forEach(function (a) {
    const item = el('div', 'att-item');

    const thumb = el('a', 'att-thumb');
    thumb.href = a.url;
    thumb.target = '_blank';
    if (isImage(a.mimeType)) {
      const img = document.createElement('img');
      img.loading = 'lazy';
      img.src = 'https://drive.google.com/thumbnail?id=' + a.fileId + '&sz=w200';
      img.onerror = function () { thumb.innerHTML = ''; thumb.appendChild(el('div', 'att-file', '🖼️')); };
      thumb.appendChild(img);
    } else {
      thumb.appendChild(el('div', 'att-file', '📄'));
    }

    const meta = el('div', 'att-meta');
    meta.appendChild(el('div', 'att-name', esc(a.name)));
    meta.appendChild(el('div', 'att-date', new Date(a.createdAt).toLocaleString('ja-JP')));

    const del = el('button', 'att-del', '削除');
    del.addEventListener('click', async function (e) {
      e.preventDefault();
      if (!confirm('この添付ファイルを削除しますか?')) return;
      await api.deleteAttachment(card.id, a.id);
      card.attachments = (card.attachments || []).filter(function (x) { return x.id !== a.id; });
      renderAttachments(card);
      refreshCardNode(card);
    });

    item.appendChild(thumb);
    item.appendChild(meta);
    item.appendChild(del);
    cont.appendChild(item);
  });
}

function renderChecklist(card) {
  const cont = $('#m-checklist');
  cont.innerHTML = '';
  const list = card.checklist || [];
  const done = list.filter(function (i) { return i.done; }).length;
  $('#m-check-progress').textContent = list.length ? '(' + done + '/' + list.length + ')' : '';

  if (list.length) {
    const bar = el('div', 'progress');
    const fill = el('div');
    fill.style.width = (list.length ? (done / list.length * 100) : 0) + '%';
    bar.appendChild(fill);
    cont.appendChild(bar);
  }

  list.forEach(function (item, idx) {
    const row = el('div', 'check-item');
    const cb = el('input'); cb.type = 'checkbox'; cb.checked = !!item.done;
    cb.addEventListener('change', function () {
      list[idx].done = cb.checked;
      card.checklist = list; saveField({ checklist: list }); renderChecklist(card);
    });
    const span = el('span', item.done ? 'done' : '', esc(item.text));
    const date = el('input', 'check-due'); date.type = 'date'; date.value = item.due || '';
    date.title = '期限（カレンダーに表示されます）';
    date.addEventListener('change', function () {
      list[idx].due = date.value;
      card.checklist = list; saveField({ checklist: list }); refreshCardNode(card);
    });
    const del = el('button', '', '✕');
    del.addEventListener('click', function () {
      list.splice(idx, 1); card.checklist = list; saveField({ checklist: list }); renderChecklist(card);
    });
    row.appendChild(cb); row.appendChild(span); row.appendChild(date); row.appendChild(del);
    cont.appendChild(row);
  });
}

function renderComments(card) {
  const cont = $('#m-comments');
  cont.innerHTML = '';
  (card.comments || []).slice().reverse().forEach(function (cm, ri) {
    const idx = (card.comments.length - 1) - ri;
    const row = el('div', 'comment-item');
    const wrap = el('div');
    wrap.appendChild(el('div', 'ctext', esc(cm.text)));
    wrap.appendChild(el('div', 'cmeta', new Date(cm.ts).toLocaleString('ja-JP')));
    const del = el('button', '', '✕');
    del.addEventListener('click', function () {
      card.comments.splice(idx, 1); saveField({ comments: card.comments }); renderComments(card);
    });
    row.appendChild(wrap); row.appendChild(del);
    cont.appendChild(row);
  });
}

// フィールド保存（サーバー＋ボード再描画用）
let saveTimer = null;
function saveField(fields) {
  const card = currentCard();
  if (!card) return;
  Object.assign(card, fields);
  setStatus('保存中...');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(function () {
    api.updateCard(card.id, fields).then(function () {
      setStatus('保存しました');
      refreshCardNode(card); // ボード上のカード表示も更新
      // 連携中なら、タイトル/日付の変更をカレンダー・タスクへ自動反映
      const rel = ('title' in fields) || ('desc' in fields) || ('due' in fields) || ('start' in fields);
      if (rel && card.sync) {
        if (card.sync.gcal) api.syncCalendar(card.id, true);
        if (card.sync.gtask) api.syncTask(card.id, true);
      }
    });
  }, 300);
}

/* --------------------------- 検索・フィルター --------------------------- */
const FILTER = { keyword: '', labels: [], due: '', done: '' };

function filterActive() {
  return !!(FILTER.keyword || FILTER.labels.length || FILTER.due || FILTER.done);
}

function matchesFilter(card) {
  if (FILTER.keyword) {
    const k = FILTER.keyword.toLowerCase();
    const hay = ((card.title || '') + ' ' + (card.desc || '')).toLowerCase();
    if (hay.indexOf(k) < 0) return false;
  }
  if (FILTER.labels.length) {
    const cl = card.labels || [];
    if (!FILTER.labels.some(function (id) { return cl.indexOf(id) >= 0; })) return false;
  }
  if (FILTER.due) {
    const e = card.due || card.start || '';
    if (FILTER.due === 'none') { if (e) return false; }
    else if (FILTER.due === 'has') { if (!e) return false; }
    else {
      if (!e) return false;
      const today = ymd(new Date());
      const days = Math.round((new Date(e + 'T00:00:00') - new Date(today + 'T00:00:00')) / 86400000);
      if (FILTER.due === 'overdue' && !(days < 0)) return false;
      if (FILTER.due === 'today' && days !== 0) return false;
      if (FILTER.due === 'soon' && !(days >= 0 && days <= 3)) return false;
    }
  }
  if (FILTER.done === 'done' && !card.done) return false;
  if (FILTER.done === 'undone' && card.done) return false;
  return true;
}

function showFilter() {
  renderFilterLabels();
  $('#flKeyword').value = FILTER.keyword;
  $('#flDue').value = FILTER.due;
  $('#flDone').value = FILTER.done;
  $('#filter').classList.remove('hidden');
}
function hideFilter() { $('#filter').classList.add('hidden'); }

function renderFilterLabels() {
  const cont = $('#flLabels');
  cont.innerHTML = '';
  const ls = STATE.labels.filter(function (l) { return l.boardId === '' || l.boardId === currentBoardId; });
  if (!ls.length) { cont.appendChild(el('div', 'set-note', 'ラベルはありません')); return; }
  ls.forEach(function (l) {
    const on = FILTER.labels.indexOf(l.id) >= 0;
    const t = el('div', 'label-toggle' + (on ? ' on' : ''), esc(l.name));
    t.style.background = l.color; t.style.color = textOn(l.color);
    t.addEventListener('click', function () {
      FILTER.labels = on ? FILTER.labels.filter(function (x) { return x !== l.id; }) : FILTER.labels.concat([l.id]);
      renderFilterLabels();
    });
    cont.appendChild(t);
  });
}

function applyFilter() {
  FILTER.keyword = $('#flKeyword').value.trim();
  FILTER.due = $('#flDue').value;
  FILTER.done = $('#flDone').value;
  hideFilter(); render(); updateFilterBtn();
}
function clearFilter() {
  FILTER.keyword = ''; FILTER.labels = []; FILTER.due = ''; FILTER.done = '';
  $('#flKeyword').value = ''; $('#flDue').value = ''; $('#flDone').value = '';
  renderFilterLabels(); render(); updateFilterBtn();
}
function updateFilterBtn() {
  const b = $('#filterBtn');
  if (filterActive()) { b.classList.add('active'); b.textContent = '🔍 フィルター中'; }
  else { b.classList.remove('active'); b.textContent = '🔍 フィルター'; }
}

/* --------------------------- カードカバー --------------------------- */
const COVER_COLORS = ['#61bd4f', '#f2d600', '#ff9f1a', '#eb5a46', '#c377e0', '#0079bf', '#00c2e0', '#51e898', '#ff78cb', '#344563'];

function renderCover(card) {
  const cont = $('#m-cover');
  if (!cont) return;
  cont.innerHTML = '';
  const colors = el('div', 'cover-colors');
  COVER_COLORS.forEach(function (col) {
    const sw = el('div', 'cover-swatch');
    sw.style.background = col;
    if (card.cover && card.cover.type === 'color' && card.cover.value === col) sw.classList.add('sel');
    sw.addEventListener('click', function () { setCover(card, { type: 'color', value: col }); });
    colors.appendChild(sw);
  });
  cont.appendChild(colors);

  const imgs = (card.attachments || []).filter(function (a) { return isImage(a.mimeType); });
  if (imgs.length) {
    cont.appendChild(el('div', 'qe-sub-label', '添付画像をカバーに'));
    const row = el('div', 'cover-imgs');
    imgs.forEach(function (a) {
      const it = el('div', 'cover-img');
      const img = document.createElement('img');
      img.loading = 'lazy';
      img.src = 'https://drive.google.com/thumbnail?id=' + a.fileId + '&sz=w200';
      it.appendChild(img);
      if (card.cover && card.cover.type === 'image' && card.cover.fileId === a.fileId) it.classList.add('sel');
      it.addEventListener('click', function () { setCover(card, { type: 'image', fileId: a.fileId }); });
      row.appendChild(it);
    });
    cont.appendChild(row);
  }

  const none = el('button', 'ghost-btn small dark cover-none', 'カバーなし');
  none.addEventListener('click', function () { setCover(card, null); });
  cont.appendChild(none);
}

function setCover(card, cover) {
  card.cover = cover;
  api.updateCard(card.id, { cover: cover });
  renderCover(card);
  refreshCardNode(card);
}

/* --------------------------- 複製・移動 --------------------------- */
async function duplicateCard(card) {
  const copy = await api.copyCard(card.id);
  if (copy) { normalizeCard(copy); STATE.cards.push(copy); render(); setStatus('複製しました'); }
}

function showMovePanel() {
  const card = currentCard();
  if (!card) return;
  const bsel = $('#m-move-board');
  bsel.innerHTML = '';
  STATE.boards.filter(function (b) { return !b.archived; })
    .sort(function (a, b) { return a.position - b.position; })
    .forEach(function (b) {
      const o = document.createElement('option'); o.value = b.id; o.textContent = b.title;
      if (b.id === currentBoardId) o.selected = true;
      bsel.appendChild(o);
    });
  populateMoveLists();
  $('#m-move-panel').classList.remove('hidden');
}
function populateMoveLists() {
  const card = currentCard();
  const bid = $('#m-move-board').value;
  const lsel = $('#m-move-list');
  lsel.innerHTML = '';
  STATE.lists.filter(function (l) { return !l.archived && l.boardId === bid; })
    .sort(function (a, b) { return a.position - b.position; })
    .forEach(function (l) {
      const o = document.createElement('option'); o.value = l.id; o.textContent = l.title;
      if (card && l.id === card.listId) o.selected = true;
      lsel.appendChild(o);
    });
}
async function doMove() {
  const card = currentCard();
  if (!card) return;
  const toList = $('#m-move-list').value;
  if (!toList) { alert('移動先のリストがありません'); return; }
  await api.moveCardToList(card.id, toList);
  card.listId = toList;
  $('#m-move-panel').classList.add('hidden');
  closeModal();
  applyAutomations(card, toList);
  render();
  setStatus('移動しました');
}

/* --------------------------- 期限リマインダー --------------------------- */
function populateRemHours() {
  const sel = $('#remHour');
  if (!sel || sel.children.length) return;
  for (let h = 0; h < 24; h++) {
    const o = document.createElement('option');
    o.value = h; o.textContent = h + '時';
    if (h === 7) o.selected = true;
    sel.appendChild(o);
  }
}
async function loadReminderStatus() {
  try {
    const on = await api.isReminderOn();
    $('#reminderStatus').textContent = on ? '✅ 現在オン（毎朝メールが届きます）' : '⛔ 現在オフ';
  } catch (e) { $('#reminderStatus').textContent = ''; }
}

/* --------------------------- 自動化ルール --------------------------- */
// カードが toListId に入ったときにルールを実行
function applyAutomations(card, toListId) {
  const rules = STATE.automations.filter(function (a) { return a.triggerList === toListId; });
  if (!rules.length) return;
  const patch = {};
  rules.forEach(function (r) {
    (r.actions || []).forEach(function (act) {
      if (act.type === 'done') { card.done = true; patch.done = true; }
      else if (act.type === 'archive') { card.archived = true; patch.archived = true; }
      else if (act.type === 'clearDue') { card.due = ''; card.start = ''; patch.due = ''; patch.start = ''; }
      else if (act.type === 'due') {
        const d = new Date(); d.setDate(d.getDate() + (Number(act.days) || 0));
        const ds = ymd(d); card.due = ds; patch.due = ds;
      }
      else if (act.type === 'label' && act.labelId) {
        card.labels = card.labels || [];
        if (card.labels.indexOf(act.labelId) < 0) { card.labels = card.labels.concat([act.labelId]); patch.labels = card.labels; }
      }
    });
  });
  if (Object.keys(patch).length) {
    api.updateCard(card.id, patch);
    if (patch.archived) render(); else refreshCardNode(card);
    setStatus('自動化を実行しました');
  }
}

function ruleListName(id) { const l = STATE.lists.find(function (x) { return x.id === id; }); return l ? l.title : '(不明)'; }
function ruleActionText(act) {
  if (act.type === 'done') return '完了にする';
  if (act.type === 'archive') return 'アーカイブ';
  if (act.type === 'clearDue') return '期限を消す';
  if (act.type === 'due') return '期限を' + (act.days || 0) + '日後に';
  if (act.type === 'label') { const l = labelById(act.labelId); return 'ラベル「' + (l ? l.name : '?') + '」'; }
  return '';
}

function renderAutoList() {
  const cont = $('#autoList');
  if (!cont) return;
  cont.innerHTML = '';
  const rules = STATE.automations.filter(function (a) {
    const l = STATE.lists.find(function (x) { return x.id === a.triggerList; });
    return l && l.boardId === currentBoardId;
  });
  if (!rules.length) { cont.appendChild(el('div', 'set-note', 'まだルールがありません。')); return; }
  rules.forEach(function (r) {
    const row = el('div', 'arch-row');
    const txt = '「' + ruleListName(r.triggerList) + '」に移動したら → ' +
      (r.actions || []).map(ruleActionText).join('、');
    row.appendChild(el('span', 'arch-title', txt));
    const del = el('button', 'danger-btn arch-del', '削除');
    del.addEventListener('click', function () {
      api.deleteAutomation(r.id).then(function () {
        STATE.automations = STATE.automations.filter(function (x) { return x.id !== r.id; });
        renderAutoList();
      });
    });
    row.appendChild(del);
    cont.appendChild(row);
  });
}

function showAutoForm() {
  const tsel = $('#afTrigger');
  tsel.innerHTML = '';
  STATE.lists.filter(function (l) { return !l.archived && l.boardId === currentBoardId; })
    .sort(function (a, b) { return a.position - b.position; })
    .forEach(function (l) {
      const o = document.createElement('option'); o.value = l.id; o.textContent = l.title; tsel.appendChild(o);
    });
  const lsel = $('#afLabel');
  lsel.innerHTML = '<option value="">なし</option>';
  STATE.labels.filter(function (l) { return l.boardId === '' || l.boardId === currentBoardId; })
    .forEach(function (l) { const o = document.createElement('option'); o.value = l.id; o.textContent = l.name; lsel.appendChild(o); });
  $('#afDone').checked = false; $('#afArchive').checked = false; $('#afClearDue').checked = false;
  $('#afDue').checked = false; $('#afDueDays').value = '3';
  $('#autoForm').classList.remove('hidden');
}
function hideAutoForm() { const f = $('#autoForm'); if (f) f.classList.add('hidden'); }

async function saveAuto() {
  const trigger = $('#afTrigger').value;
  if (!trigger) return;
  const actions = [];
  if ($('#afDone').checked) actions.push({ type: 'done' });
  if ($('#afArchive').checked) actions.push({ type: 'archive' });
  if ($('#afClearDue').checked) actions.push({ type: 'clearDue' });
  if ($('#afDue').checked) actions.push({ type: 'due', days: Number($('#afDueDays').value) || 0 });
  if ($('#afLabel').value) actions.push({ type: 'label', labelId: $('#afLabel').value });
  if (!actions.length) { alert('動作を1つ以上選んでください。'); return; }
  const rule = await api.addAutomation(currentBoardId, trigger, actions);
  STATE.automations.push(rule);
  hideAutoForm();
  renderAutoList();
  setStatus('ルールを追加しました');
}

/* --------------------------- 繰り返しカード --------------------------- */
function renderRecurList() {
  const cont = $('#recurList'); if (!cont) return;
  cont.innerHTML = '';
  const rules = STATE.recurring.filter(function (r) { return r.boardId === currentBoardId; });
  if (!rules.length) { cont.appendChild(el('div', 'set-note', 'まだ繰り返しはありません。')); return; }
  rules.forEach(function (r) {
    const row = el('div', 'arch-row');
    const f = r.freq === 'daily' ? '毎日' : (r.freq === 'weekly' ? '毎週' : '毎月');
    row.appendChild(el('span', 'arch-title', f + '「' + r.title + '」→ ' + ruleListName(r.listId)));
    const del = el('button', 'danger-btn arch-del', '削除');
    del.addEventListener('click', function () {
      api.deleteRecurring(r.id).then(function () {
        STATE.recurring = STATE.recurring.filter(function (x) { return x.id !== r.id; });
        renderRecurList();
      });
    });
    row.appendChild(del); cont.appendChild(row);
  });
}
function showRecurForm() {
  $('#rfTitle').value = '';
  const lsel = $('#rfList'); lsel.innerHTML = '';
  STATE.lists.filter(function (l) { return !l.archived && l.boardId === currentBoardId; })
    .sort(function (a, b) { return a.position - b.position; })
    .forEach(function (l) { const o = document.createElement('option'); o.value = l.id; o.textContent = l.title; lsel.appendChild(o); });
  $('#rfFreq').value = 'weekly';
  $('#recurForm').classList.remove('hidden');
  $('#rfTitle').focus();
}
function hideRecurForm() { const f = $('#recurForm'); if (f) f.classList.add('hidden'); }
async function saveRecur() {
  const title = $('#rfTitle').value.trim(); const list = $('#rfList').value;
  if (!title || !list) { $('#rfTitle').focus(); return; }
  try {
    const rule = await api.addRecurring(currentBoardId, list, title, $('#rfFreq').value);
    STATE.recurring.push(rule);
    hideRecurForm(); renderRecurList(); setStatus('繰り返しを追加しました');
  } catch (e) { alert('追加に失敗: ' + e + '（自動実行の権限許可が必要かもしれません）'); }
}

/* --------------------------- 共有（読み取り専用） --------------------------- */
let APP_URL = '';
async function loadShareSection() {
  const on = await api.isSharingEnabled();
  $('#shareStatus').textContent = on ? '✅ 共有モード：有効' : '⛔ 共有モード：無効';
  $('#shareEnableBtn').textContent = on ? '共有モードを無効化' : '共有モードを有効化';
  if (!APP_URL) { try { APP_URL = await api.getAppUrl(); } catch (e) { APP_URL = ''; } }
  renderShareLink();
}
function renderShareLink() {
  const box = $('#shareLinkBox'); if (!box) return;
  box.innerHTML = '';
  const b = STATE.boards.find(function (x) { return x.id === currentBoardId; });
  if (!b) return;
  if (b.shareToken) {
    const base = APP_URL || window.location.href.split('?')[0].split('#')[0];
    const url = base + '?share=' + b.shareToken + '&board=' + b.id;
    box.appendChild(el('div', 'set-note', '「' + b.title + '」の読み取り専用リンク：'));
    const inp = el('input', 'field-input'); inp.value = url; inp.readOnly = true; inp.style.width = '100%';
    inp.addEventListener('focus', function () { this.select(); });
    box.appendChild(inp);
    const off = el('button', 'ghost-btn small dark', '共有を停止'); off.style.marginTop = '6px';
    off.addEventListener('click', async function () { await api.setBoardShare(b.id, false); b.shareToken = ''; renderShareLink(); });
    box.appendChild(off);
  } else {
    const on = el('button', 'ghost-btn small dark', 'このボードの共有リンクを作成');
    on.addEventListener('click', async function () { const t = await api.setBoardShare(b.id, true); b.shareToken = t; renderShareLink(); });
    box.appendChild(on);
  }
}

/* --------------------------- タイムライン（ガント） --------------------------- */
let tlRef = new Date();
async function showTimeline() {
  try { await ensureAllCards(); } catch (e) {}
  tlRef = new Date(); renderTimeline(); $('#timeline').classList.remove('hidden');
}
function hideTimeline() { $('#timeline').classList.add('hidden'); }
function renderTimeline() {
  const body = $('#tlBody'); body.innerHTML = '';
  const DAYS = 30;
  const start = new Date(tlRef); start.setHours(0, 0, 0, 0);
  $('#tlTitle').textContent = (start.getMonth() + 1) + '/' + start.getDate() + ' から30日';

  const cards = STATE.cards.filter(function (c) {
    if (c.archived || !(c.start || c.due)) return false;
    const l = STATE.lists.find(function (x) { return x.id === c.listId; });
    return l && !l.archived && l.boardId === currentBoardId;
  });
  if (!cards.length) { body.appendChild(el('div', 'set-note', 'このボードに日付付きカードがありません。')); return; }

  const days = [];
  for (let i = 0; i < DAYS; i++) { const d = new Date(start); d.setDate(d.getDate() + i); days.push(d); }
  const todayStr = ymd(new Date());
  const color = boardColor(currentBoardId);

  const table = el('table', 'tl-table');
  const thead = el('thead'); const htr = el('tr');
  htr.appendChild(el('th', 'tl-th-name', 'カード'));
  days.forEach(function (d) {
    const th = el('th', 'tl-th-day' + ((d.getDay() === 0 || d.getDay() === 6) ? ' we' : '') + (ymd(d) === todayStr ? ' today' : ''));
    th.textContent = d.getDate();
    htr.appendChild(th);
  });
  thead.appendChild(htr); table.appendChild(thead);

  const tbody = el('tbody');
  cards.sort(function (a, b) { return (a.start || a.due) < (b.start || b.due) ? -1 : 1; });
  cards.forEach(function (c) {
    const s = c.start || c.due, e = c.due || c.start;
    const tr = el('tr');
    const nameTd = el('td', 'tl-name', esc(c.title));
    nameTd.addEventListener('click', function () { hideTimeline(); openCardFromTable(c); });
    tr.appendChild(nameTd);
    days.forEach(function (d) {
      const ds = ymd(d);
      const td = el('td', 'tl-cell' + (ds === todayStr ? ' today' : ''));
      if (ds >= s && ds <= e) { td.classList.add('bar'); td.style.background = color; }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  body.appendChild(table);
}

/* --------------------------- キーボードショートカット --------------------------- */
function showShortcutHelp() {
  alert('キーボードショートカット（Trello準拠）\n\n'
    + '■ カードにマウスを乗せて：\n'
    + '  Enter：カードを開く\n'
    + '  e：開かずにクイック編集\n'
    + '  c：アーカイブ\n'
    + '  Space：完了/未完了の切替\n'
    + '  d：期限を編集\n'
    + '  l：ラベルを編集\n'
    + '  1〜9：ラベルの付け外し\n\n'
    + '■ リストにマウスを乗せて：\n'
    + '  [：リストの折りたたみ/展開\n\n'
    + '■ 全体：\n'
    + '  f：フィルター　x：フィルター解除\n'
    + '  /：検索　b：ボード一覧\n'
    + '  ?：このヘルプ　Esc：閉じる');
}

/* --------------------------- AIアシスタント --------------------------- */
function showAI() {
  renderAIKeyBox();
  const sel = $('#aiList'); sel.innerHTML = '';
  STATE.lists.filter(function (l) { return !l.archived && l.boardId === currentBoardId; })
    .sort(function (a, b) { return a.position - b.position; })
    .forEach(function (l) { const o = document.createElement('option'); o.value = l.id; o.textContent = l.title; sel.appendChild(o); });
  $('#aiAddResult').textContent = ''; $('#aiSumResult').textContent = '';
  $('#semResult').innerHTML = ''; $('#bulkPlan').innerHTML = ''; $('#semIndexStatus').textContent = '';
  refreshAiReviewStatus();
  $('#ai').classList.remove('hidden');
}
function hideAI() { $('#ai').classList.add('hidden'); }

async function renderAIKeyBox() {
  const box = $('#aiKeyBox'); box.innerHTML = '';
  let has = false;
  try { has = await api.hasGeminiKey(); } catch (e) {}
  if (has) {
    box.appendChild(el('div', 'set-note', '✅ Gemini APIキー設定済み'));
    const re = el('button', 'ghost-btn small dark', 'キーを変更');
    re.addEventListener('click', aiKeyPrompt);
    box.appendChild(re);
  } else {
    box.appendChild(el('div', 'set-note', '⚠️ Gemini APIキーが未設定です。Google AI Studio（aistudio.google.com）で無料のAPIキーを取得して登録してください。'));
    const set = el('button', 'primary-btn', 'APIキーを登録');
    set.addEventListener('click', aiKeyPrompt);
    box.appendChild(set);
  }
}
async function aiKeyPrompt() {
  const k = prompt('Gemini APIキーを貼り付けてください：');
  if (!k) return;
  await api.setGeminiKey(k);
  renderAIKeyBox();
  setStatus('APIキーを保存しました');
}
async function aiAddCardUI() {
  const text = $('#aiText').value.trim(); const listId = $('#aiList').value;
  if (!text || !listId) return;
  $('#aiAddResult').textContent = 'AIが解析中...';
  try {
    const card = await api.aiAddCard(currentBoardId, listId, text);
    normalizeCard(card);
    STATE.cards.push(card); render();
    $('#aiAddResult').textContent = '追加しました：「' + card.title + '」' + (card.due ? '（期限' + card.due + '）' : '');
    $('#aiText').value = '';
  } catch (e) { $('#aiAddResult').textContent = '失敗: ' + e; }
}
async function aiSummarizeUI() {
  $('#aiSumResult').textContent = 'AIが要約中...';
  try { $('#aiSumResult').textContent = await api.aiSummarizeBoard(currentBoardId); }
  catch (e) { $('#aiSumResult').textContent = '失敗: ' + e; }
}

/* --------------------------- 集計ダッシュボード --------------------------- */
async function showDashboard() {
  setStatus('読み込み中...');
  try { await ensureAllCards(); } catch (e) {}
  setStatus('');
  renderDashboard();
  $('#dashboard').classList.remove('hidden');
}
function hideDashboard() { $('#dashboard').classList.add('hidden'); }

function renderDashboard() {
  const cont = $('#dashBody');
  cont.innerHTML = '';
  const today = ymd(new Date());
  const activeLists = {}; STATE.lists.forEach(function (l) { if (!l.archived) activeLists[l.id] = l; });
  const boards = activeBoardsSorted();
  if (!boards.length) { cont.appendChild(el('div', 'set-note', 'ボードがありません。')); return; }

  boards.forEach(function (b) {
    const cards = STATE.cards.filter(function (c) {
      if (c.archived) return false;
      const l = activeLists[c.listId]; return l && l.boardId === b.id;
    });
    const total = cards.length;
    const done = cards.filter(function (c) { return c.done; }).length;
    let overdue = 0, todayN = 0, soon = 0;
    cards.forEach(function (c) {
      if (c.done) return;
      const e = c.due || c.start; if (!e) return;
      const days = Math.round((new Date(e + 'T00:00:00') - new Date(today + 'T00:00:00')) / 86400000);
      if (days < 0) overdue++; else if (days === 0) todayN++; else if (days <= 3) soon++;
    });
    const pct = total ? Math.round(done / total * 100) : 0;

    const card = el('div', 'dash-card');
    card.style.borderLeftColor = boardColor(b.id);
    card.appendChild(el('div', 'dash-name', esc(b.title)));
    const stats = el('div', 'dash-stats');
    stats.appendChild(el('span', '', 'カード ' + total));
    stats.appendChild(el('span', '', '未完了 ' + (total - done)));
    stats.appendChild(el('span', 'd-over', '期限切れ ' + overdue));
    stats.appendChild(el('span', 'd-today', '今日 ' + todayN));
    stats.appendChild(el('span', 'd-soon', '3日内 ' + soon));
    card.appendChild(stats);
    const bar = el('div', 'dash-bar'); const fill = el('div'); fill.style.width = pct + '%'; bar.appendChild(fill);
    card.appendChild(bar);
    card.appendChild(el('div', 'dash-pct', '完了率 ' + pct + '%（' + done + '/' + total + '）'));
    cont.appendChild(card);
  });
}

/* ============== テーブル（複数の保存ビュー：ボード横断の一覧表） ============== */
let currentViewId = null;

async function showTable() {
  setStatus('読み込み中...');
  try { await ensureAllCards(); } catch (e) {}
  setStatus('');
  if (!STATE.views.length) { currentViewId = null; }
  else if (!currentViewId || !STATE.views.some(function (v) { return v.id === currentViewId; })) {
    currentViewId = STATE.views[0].id;
  }
  hideViewForm();
  renderTableTabs();
  renderTable();
  $('#table').classList.remove('hidden');
}
function hideTable() { $('#table').classList.add('hidden'); }

function currentView() { return STATE.views.find(function (v) { return v.id === currentViewId; }); }

function renderTableTabs() {
  const tabs = $('#viewTabs');
  tabs.innerHTML = '';
  STATE.views.forEach(function (v) {
    const t = el('button', 'view-tab' + (v.id === currentViewId ? ' on' : ''), esc(v.name));
    t.addEventListener('click', function () { currentViewId = v.id; hideViewForm(); renderTableTabs(); renderTable(); });
    tabs.appendChild(t);
  });
  const add = el('button', 'view-tab add', '＋ 新規');
  add.addEventListener('click', function () { showViewForm(null); });
  tabs.appendChild(add);
}

// 期限フィルタ判定
function viewDueMatch(card, due) {
  const e = card.due || card.start || '';
  if (!due) return true;
  if (due === 'has') return !!e;
  if (due === 'none') return !e;
  if (!e) return false;
  const today = ymd(new Date());
  const days = Math.round((new Date(e + 'T00:00:00') - new Date(today + 'T00:00:00')) / 86400000);
  if (due === 'overdue') return days < 0;
  if (due === 'today') return days === 0;
  if (due === 'todo') return days <= 0;
  if (due === 'soon') return days >= 0 && days <= 3;
  return true;
}

function aggregateCards(view) {
  const cfg = view.config || {};
  const boardSet = (cfg.boards && cfg.boards.length) ? cfg.boards : null; // null=すべて
  const activeBoards = {}; STATE.boards.forEach(function (b) { if (!b.archived) activeBoards[b.id] = b; });
  const activeLists = {}; STATE.lists.forEach(function (l) { if (!l.archived) activeLists[l.id] = l; });

  let rows = STATE.cards.filter(function (c) {
    if (c.archived) return false;
    const list = activeLists[c.listId]; if (!list) return false;
    const b = activeBoards[list.boardId]; if (!b) return false;
    if (boardSet && boardSet.indexOf(b.id) < 0) return false;
    if (cfg.done === 'done' && !c.done) return false;
    if (cfg.done === 'undone' && c.done) return false;
    if (!viewDueMatch(c, cfg.due || '')) return false;
    return true;
  });

  const sort = cfg.sort || 'due';
  const eff = function (c) { return c.due || c.start || ''; };
  const boardName = function (c) { const l = activeLists[c.listId]; const b = l && activeBoards[l.boardId]; return b ? b.title : ''; };
  rows.sort(function (a, b) {
    if (sort === 'name') return String(a.title).localeCompare(String(b.title), 'ja');
    if (sort === 'board') {
      const c = boardName(a).localeCompare(boardName(b), 'ja');
      return c !== 0 ? c : (eff(a) < eff(b) ? -1 : 1);
    }
    const ea = eff(a), eb = eff(b);
    if (!ea && !eb) return 0;
    if (!ea) return 1; if (!eb) return -1;
    return ea < eb ? -1 : (ea > eb ? 1 : 0);
  });
  return rows;
}

function renderTable() {
  const wrap = $('#tableWrap');
  wrap.innerHTML = '';
  const view = currentView();
  if (!view) {
    wrap.appendChild(el('div', 'set-note', 'テーブルがありません。「＋ 新規」で作成してください。'));
    $('#viewCount').textContent = '';
    return;
  }
  const rows = aggregateCards(view);
  $('#viewCount').textContent = rows.length + ' 件';

  const activeLists = {}; STATE.lists.forEach(function (l) { activeLists[l.id] = l; });
  const boardById = {}; STATE.boards.forEach(function (b) { boardById[b.id] = b; });

  const table = el('table', 'data-table');
  const thead = el('thead');
  const htr = el('tr');
  ['', 'カード', 'ボード', 'リスト', 'ラベル', '期限'].forEach(function (h) {
    htr.appendChild(el('th', '', h));
  });
  thead.appendChild(htr);
  table.appendChild(thead);

  const tbody = el('tbody');
  if (!rows.length) {
    const tr = el('tr'); const td = el('td', 'dt-empty', '該当するカードはありません。'); td.colSpan = 6;
    tr.appendChild(td); tbody.appendChild(tr);
  }
  rows.forEach(function (card) {
    const list = activeLists[card.listId] || {};
    const board = boardById[list.boardId] || {};
    const tr = el('tr', card.done ? 'dt-done' : '');

    // 完了チェック
    const tdChk = el('td', 'dt-chk');
    const cb = el('input'); cb.type = 'checkbox'; cb.checked = !!card.done;
    cb.addEventListener('click', function (e) { e.stopPropagation(); });
    cb.addEventListener('change', function () { toggleDone(card); renderTable(); });
    tdChk.appendChild(cb);
    tr.appendChild(tdChk);

    // カード名
    tr.appendChild(el('td', 'dt-title', esc(card.title)));
    // ボード / リスト
    tr.appendChild(el('td', 'dt-board', esc(board.title || '')));
    tr.appendChild(el('td', 'dt-list', esc(list.title || '')));
    // ラベル
    const tdLab = el('td', 'dt-labels');
    (card.labels || []).forEach(function (id) {
      const l = labelById(id);
      if (l) { const chip = el('span', 'card-label-chip', esc(l.name)); chip.style.background = l.color; chip.style.color = textOn(l.color); tdLab.appendChild(chip); }
    });
    tr.appendChild(tdLab);
    // 期限
    const tdDue = el('td', 'dt-due');
    const badge = dateBadge(card);
    if (badge) tdDue.appendChild(badge);
    tr.appendChild(tdDue);

    tr.addEventListener('click', function () { openCardFromTable(card); });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
}

function openCardFromTable(card) {
  const list = STATE.lists.find(function (l) { return l.id === card.listId; });
  if (list) currentBoardId = list.boardId; // モーダルのフィールド/ラベル文脈を合わせる
  openModal(card.id);
}

/* ビュー編集フォーム */
function showViewForm(view) {
  const cfg = view ? (view.config || {}) : { boards: [], due: '', done: '', sort: 'due' };
  $('#vfName').value = view ? view.name : '';
  $('#vfDue').value = cfg.due || '';
  $('#vfDone').value = cfg.done || '';
  $('#vfSort').value = cfg.sort || 'due';
  renderVfBoards(cfg.boards || []);
  $('#viewForm').dataset.editing = view ? view.id : '';
  $('#viewForm').classList.remove('hidden');
  $('#vfName').focus();
}
function hideViewForm() { const f = $('#viewForm'); if (f) f.classList.add('hidden'); }

function renderVfBoards(selected) {
  const cont = $('#vfBoards');
  cont.innerHTML = '';
  STATE.boards.filter(function (b) { return !b.archived; }).forEach(function (b) {
    const lbl = el('label', 'vf-board');
    const cb = el('input'); cb.type = 'checkbox'; cb.value = b.id;
    cb.checked = selected.indexOf(b.id) >= 0;
    lbl.appendChild(cb);
    lbl.appendChild(document.createTextNode(' ' + b.title));
    cont.appendChild(lbl);
  });
}

async function saveView() {
  const name = $('#vfName').value.trim();
  if (!name) { $('#vfName').focus(); return; }
  const boards = Array.prototype.slice.call($('#vfBoards').querySelectorAll('input:checked'))
    .map(function (cb) { return cb.value; });
  const config = { boards: boards, due: $('#vfDue').value, done: $('#vfDone').value, sort: $('#vfSort').value };
  const editing = $('#viewForm').dataset.editing;
  if (editing) {
    await api.updateView(editing, { name: name, config: config });
    const v = STATE.views.find(function (x) { return x.id === editing; });
    if (v) { v.name = name; v.config = config; }
    currentViewId = editing;
  } else {
    const v = await api.addView(name, config);
    STATE.views.push(v);
    currentViewId = v.id;
  }
  hideViewForm();
  renderTableTabs();
  renderTable();
  setStatus('テーブルを保存しました');
}

async function deleteCurrentView() {
  const v = currentView();
  if (!v) return;
  if (!confirm('テーブル「' + v.name + '」を削除しますか?（カードは消えません）')) return;
  await api.deleteView(v.id);
  STATE.views = STATE.views.filter(function (x) { return x.id !== v.id; });
  currentViewId = STATE.views.length ? STATE.views[0].id : null;
  hideViewForm();
  renderTableTabs();
  renderTable();
}

/* --------------------------- ショートカット補助 --------------------------- */
function cardNode(id) { return document.querySelector('.card[data-card-id="' + id + '"]'); }

function openCardDateQuick(card) {
  const n = cardNode(card.id); if (!n) return;
  openQuickEdit(card, n);
  const menu = document.querySelector('.qe-menu');
  if (menu) qeShowDate(menu, card);
}
function openCardLabelQuick(card) {
  const n = cardNode(card.id); if (!n) return;
  openQuickEdit(card, n);
  const menu = document.querySelector('.qe-menu');
  if (menu) qeShowLabels(menu, card);
}
function toggleLabelByIndex(card, i) {
  const labels = STATE.labels.filter(function (l) { return l.boardId === '' || l.boardId === currentBoardId; });
  const l = labels[i];
  if (!l) return;
  let cl = card.labels || [];
  cl = cl.indexOf(l.id) >= 0 ? cl.filter(function (x) { return x !== l.id; }) : cl.concat([l.id]);
  card.labels = cl;
  api.updateCard(card.id, { labels: cl });
  refreshCardNode(card);
  if (openCardId === card.id) renderModal();
  setStatus('ラベル「' + l.name + '」');
}

/* --------------------------- イベント結線 --------------------------- */
/* ========================================================================
   ここから下は 2026-08-09 追加分
   今日ビュー / ゴミ箱 / ボード複製 / エクスポート / 健康診断 /
   Markdownプレビュー / テーマ切替 / 共有ターゲット
   ======================================================================== */

/* --------------------------- 今日やること（全ボード横断） --------------------------- */
function hideToday() { $('#today').classList.add('hidden'); }

async function showToday() {
  $('#today').classList.remove('hidden');
  $('#todayBody').innerHTML = '<div class="set-note">読み込み中...</div>';
  try { await ensureAllCards(); } catch (e) {}   // 横断ビューなので全カードが要る
  renderToday();
}

function renderToday() {
  const body = $('#todayBody'); body.innerHTML = '';
  const todayStr = ymd(new Date());
  const listById = {}; STATE.lists.forEach(function (l) { listById[l.id] = l; });
  const boardById = {}; STATE.boards.forEach(function (b) { boardById[b.id] = b; });

  // 期限が今日以前で、完了していない・アーカイブしていないカード
  const target = STATE.cards.filter(function (c) {
    if (c.archived || c.done || c.template) return false;
    const end = c.due || '';
    if (!end) return false;
    const list = listById[c.listId];
    if (!list || list.archived) return false;
    const board = boardById[list.boardId];
    if (!board || board.archived) return false;
    return end <= todayStr;
  });

  if (!target.length) {
    body.appendChild(el('div', 'set-note', '今日締め切りのカードはありません。'));
    return;
  }

  // 期限切れ / 今日 の2組に分ける
  const overdue = target.filter(function (c) { return c.due < todayStr; })
    .sort(function (a, b) { return a.due.localeCompare(b.due); });
  const due = target.filter(function (c) { return c.due === todayStr; });

  function section(title, cards, cls) {
    if (!cards.length) return;
    body.appendChild(el('h3', 'arch-head', title + '（' + cards.length + '）'));
    cards.forEach(function (c) {
      const list = listById[c.listId] || {};
      const board = boardById[list.boardId] || {};
      const row = el('div', 'today-row ' + cls);
      row.style.borderLeftColor = boardColor(board.id);

      const main = el('div', 'today-main');
      main.appendChild(el('div', 'today-title', esc(c.title)));
      main.appendChild(el('div', 'today-meta',
        esc(board.title || '') + ' ／ ' + esc(list.title || '') +
        (c.due < todayStr ? '　⚠ ' + esc(c.due) : '')));
      row.appendChild(main);

      const done = el('button', 'ghost-btn small dark', '✓ 完了');
      done.addEventListener('click', function (e) {
        e.stopPropagation();
        c.done = true;
        api.updateCard(c.id, { done: true });
        renderToday(); refreshCardNode(c);
        setStatus('完了にしました');
      });
      row.appendChild(done);

      // クリックでそのボードへ移動してカードを開く
      row.addEventListener('click', function () {
        if (board.id && board.id !== currentBoardId) {
          currentBoardId = board.id; saveCurrentBoard(board.id); render();
        }
        hideToday();
        openModal(c.id);
      });
      body.appendChild(row);
    });
  }

  section('⚠ 期限切れ', overdue, 'overdue');
  section('☀ 今日まで', due, '');
}

/* --------------------------- ゴミ箱 --------------------------- */
async function renderTrash() {
  const cont = $('#trashList');
  if (!cont) return;
  cont.innerHTML = '<div class="set-note">読み込み中...</div>';
  let items = [];
  try { items = await api.getTrash(); } catch (e) {
    cont.innerHTML = '<div class="set-note">ゴミ箱を読み込めませんでした: ' + esc(e) + '</div>';
    return;
  }
  cont.innerHTML = '';
  if (!items.length) {
    cont.appendChild(el('div', 'set-note', 'ゴミ箱は空です。'));
    return;
  }
  items.forEach(function (c) {
    const row = el('div', 'arch-row');
    row.appendChild(el('span', 'arch-title',
      esc(c.title) + ' <span class="trash-where">' + esc(c.boardTitle) + ' / ' + esc(c.listTitle) + '</span>'));

    const back = el('button', 'ghost-btn small dark', '元に戻す');
    back.addEventListener('click', async function () {
      await api.restoreCard(c.id);
      // 元のボードを開いている場合だけ画面へ戻す。違うボードなら次に開いたときに出る
      await reloadCurrentBoardCards();
      renderTrash(); render();
      setStatus('元に戻しました');
    });

    const purge = el('button', 'danger-btn arch-del', '完全に削除');
    purge.addEventListener('click', async function () {
      if (!confirm('「' + c.title + '」を完全に削除します。\n添付ファイルもドライブのゴミ箱へ移ります。\n取り消せません。よろしいですか?')) return;
      await api.purgeCard(c.id);
      renderTrash();
      setStatus('完全に削除しました');
    });

    row.appendChild(back); row.appendChild(purge);
    cont.appendChild(row);
  });
}

// ゴミ箱から戻したカードを画面に反映するため、今のボードのカードだけ取り直す
async function reloadCurrentBoardCards() {
  if (!currentBoardId) return;
  try {
    const fresh = await api.getCards(currentBoardId);
    const ids = {}; STATE.lists.forEach(function (l) { if (l.boardId === currentBoardId) ids[l.id] = 1; });
    STATE.cards = STATE.cards.filter(function (c) { return !ids[c.listId]; }).concat(fresh.map(normalizeCard));
  } catch (e) {}
}

/* --------------------------- エクスポート --------------------------- */
function downloadFile(name, text, mime) {
  const blob = new Blob(['﻿' + text], { type: (mime || 'text/plain') + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
}

function csvCell(v) {
  const s = String(v == null ? '' : v);
  return '"' + s.replace(/"/g, '""') + '"';
}

async function exportJson() {
  setStatus('書き出し中...');
  const data = await api.exportAll();
  downloadFile('mytrello_' + ymd(new Date()) + '.json', JSON.stringify(data, null, 2), 'application/json');
  setStatus('JSONを書き出しました');
}

async function exportCsv() {
  setStatus('書き出し中...');
  const data = await api.exportAll();
  const listById = {}; (data.lists || []).forEach(function (l) { listById[l.id] = l; });
  const boardById = {}; (data.boards || []).forEach(function (b) { boardById[b.id] = b; });
  const labelById = {}; (data.labels || []).forEach(function (l) { labelById[l.id] = l; });

  const head = ['ボード', 'リスト', 'カード', '説明', '開始', '期限', '完了', 'ラベル', 'チェックリスト', 'コメント数', '作成日', '更新日'];
  const rows = [head.map(csvCell).join(',')];

  (data.cards || []).forEach(function (c) {
    if (c.archived) return;
    const list = listById[c.listId] || {};
    const board = boardById[list.boardId] || {};
    const labels = (c.labels || []).map(function (id) { return (labelById[id] || {}).name || ''; }).filter(Boolean).join(' / ');
    const cl = (c.checklist || []);
    const clDone = cl.filter(function (i) { return i && i.done; }).length;
    rows.push([
      board.title || '', list.title || '', c.title || '', c.desc || '',
      c.start || '', c.due || '', c.done ? '済' : '',
      labels, cl.length ? (clDone + '/' + cl.length) : '',
      (c.comments || []).length, c.createdAt || '', c.updatedAt || ''
    ].map(csvCell).join(','));
  });

  downloadFile('mytrello_cards_' + ymd(new Date()) + '.csv', rows.join('\r\n'), 'text/csv');
  setStatus('CSVを書き出しました');
}

/* --------------------------- 健康診断 --------------------------- */
async function showHealth() {
  const body = $('#healthBody');
  body.innerHTML = '<div class="set-note">確認中...</div>';
  let h;
  try { h = await api.healthCheck(); } catch (e) {
    body.innerHTML = '<div class="set-note">確認できませんでした: ' + esc(e) + '</div>';
    return;
  }
  body.innerHTML = '';

  function line(label, value, state) {
    const row = el('div', 'health-row' + (state ? ' ' + state : ''));
    row.appendChild(el('span', 'health-label', esc(label)));
    row.appendChild(el('span', 'health-value', value));  // valueはHTML可
    body.appendChild(row);
  }

  // バックアップ
  const b = h.backup || {};
  let bkState = 'ng', bkText;
  if (!b.last) {
    bkText = '一度も取られていません';
  } else if (b.ageDays === null || b.ageDays === undefined) {
    bkText = esc(b.last); bkState = '';
  } else if (b.ageDays <= 2) {
    bkText = esc(b.last) + '（' + b.ageDays + '日前）'; bkState = 'ok';
  } else if (b.ageDays <= 7) {
    bkText = esc(b.last) + '（' + b.ageDays + '日前）'; bkState = 'warn';
  } else {
    bkText = esc(b.last) + '（<b>' + b.ageDays + '日前</b> — 止まっている可能性）';
  }
  line('最終バックアップ', bkText, bkState);
  line('自動バックアップ', b.freq ? esc(b.freq === 'weekly' ? '毎週' : '毎日') : '<b>オフ</b>', b.freq ? 'ok' : 'ng');

  // トリガー
  const tg = h.triggers || [];
  const names = tg.map(function (t) { return t.fn; });
  line('登録トリガー', tg.length ? esc(names.join(', ')) : '<b>なし</b>', tg.length ? 'ok' : 'ng');

  // 件数
  const c = h.counts || {};
  line('データ件数', 'ボード ' + c.boards + ' ／ リスト ' + c.lists + ' ／ カード ' + c.cards, '');
  line('ゴミ箱', (c.trash || 0) + ' 件', (c.trash > 50 ? 'warn' : ''));

  // 構成
  line('スキーマ版数', esc(h.schemaVersion), '');
  const f = h.flags || {};
  line('APIトークン', f.apiToken ? '設定済み' : '<b>未設定</b>', f.apiToken ? 'ok' : 'ng');
  line('AIキー(Gemini)', f.geminiKey ? '設定済み' : '未設定', '');
  line('共有モード', f.sharing ? '有効' : '無効', '');
  if (h.dbUrl) {
    line('データの保存先', '<a href="' + esc(h.dbUrl) + '" target="_blank" rel="noopener">スプレッドシートを開く</a>', '');
  }
  if (b.folderUrl) {
    line('バックアップ置き場', '<a href="' + esc(b.folderUrl) + '" target="_blank" rel="noopener">フォルダを開く</a>', '');
  }
}

/* --------------------------- Markdown（簡易・外部ライブラリなし） --------------------------- */
// 教材メモ程度に使う範囲だけ。見出し/太字/斜体/コード/リンク/箇条書き/番号/引用/水平線。
// esc() を必ず先に通してから記号を変換するので、HTMLの混入は起きない。
function renderMarkdown(src) {
  const lines = String(src == null ? '' : src).split(/\r?\n/);
  let out = '', listType = null;

  function closeList() { if (listType) { out += '</' + listType + '>'; listType = null; } }

  function inline(t) {
    return esc(t)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      // 素のURLも自動でリンクに（すでにリンク化した中身は href= の直後なので除外）
      .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
  }

  lines.forEach(function (raw) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) { closeList(); return; }

    let m;
    if ((m = line.match(/^(#{1,4})\s+(.*)$/))) {
      closeList();
      const lv = Math.min(6, m[1].length + 2);   // # は h3 相当から（画面の見出しと衝突させない）
      out += '<h' + lv + '>' + inline(m[2]) + '</h' + lv + '>';
    } else if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
      closeList(); out += '<hr>';
    } else if ((m = line.match(/^\s*[-*+]\s+(.*)$/))) {
      if (listType !== 'ul') { closeList(); out += '<ul>'; listType = 'ul'; }
      out += '<li>' + inline(m[1]) + '</li>';
    } else if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) {
      if (listType !== 'ol') { closeList(); out += '<ol>'; listType = 'ol'; }
      out += '<li>' + inline(m[1]) + '</li>';
    } else if ((m = line.match(/^>\s?(.*)$/))) {
      closeList(); out += '<blockquote>' + inline(m[1]) + '</blockquote>';
    } else {
      closeList(); out += '<p>' + inline(line) + '</p>';
    }
  });
  closeList();
  return out;
}

function toggleDescPreview() {
  const ta = $('#m-desc'), box = $('#m-desc-rendered'), btn = $('#m-desc-preview');
  if (!ta || !box) return;
  const showing = !box.classList.contains('hidden');
  if (showing) {
    box.classList.add('hidden'); ta.classList.remove('hidden');
    btn.textContent = '👁 プレビュー';
    ta.focus();
  } else {
    box.innerHTML = ta.value.trim() ? renderMarkdown(ta.value) : '<span class="set-note">（説明は空です）</span>';
    box.classList.remove('hidden'); ta.classList.add('hidden');
    btn.textContent = '✏ 編集にもどす';
  }
}

// カードを開くたびに編集状態へ戻す（前のカードのプレビューが残らないように）
function resetDescPreview() {
  const box = $('#m-desc-rendered'), ta = $('#m-desc'), btn = $('#m-desc-preview');
  if (box) box.classList.add('hidden');
  if (ta) ta.classList.remove('hidden');
  if (btn) btn.textContent = '👁 プレビュー';
}

/* --------------------------- テーマ（ライト/ダーク/自動） --------------------------- */
function loadTheme() { return localStorage.getItem('theme') || 'auto'; }

function applyTheme(mode) {
  const root = document.documentElement;
  root.classList.remove('theme-dark', 'theme-light');
  let effective = mode;
  if (mode === 'auto') {
    effective = (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
  }
  root.classList.add(effective === 'dark' ? 'theme-dark' : 'theme-light');
  const btns = document.querySelectorAll('.theme-btn');
  for (let i = 0; i < btns.length; i++) {
    btns[i].classList.toggle('active', btns[i].dataset.theme === mode);
  }
}

function setTheme(mode) {
  localStorage.setItem('theme', mode);
  applyTheme(mode);
}

/* --------------------------- 共有ターゲット（スマホの「共有」から） --------------------------- */
// PWAのmanifestで share_target を宣言しているので、共有されると
// ?share_title=...&share_text=...&share_url=... 付きで開かれる。
// Apps Script版ではこのパラメータは付かないので、何も起きない。
async function handleShareTarget() {
  const q = new URLSearchParams(location.search);
  const title = q.get('share_title') || q.get('title') || '';
  const text = q.get('share_text') || q.get('text') || '';
  const url = q.get('share_url') || q.get('url') || '';
  if (!title && !text && !url) return false;

  // URLはパラメータのどれに入ってくるか端末差があるので、text の中からも拾う
  let link = url;
  if (!link) {
    const m = text.match(/https?:\/\/\S+/);
    if (m) link = m[0];
  }
  const cardTitle = (title || (text ? text.split(/\r?\n/)[0] : '') || link || '共有メモ').slice(0, 120);

  // アドレスバーを綺麗にしておく（再読み込みで二重登録されないように）
  history.replaceState(null, '', location.pathname);

  const lists = boardLists();
  if (!lists.length) { alert('先にリストを作ってください。'); return true; }
  const target = lists[0];

  if (!confirm('共有された内容をカードにします。\n\n' + cardTitle + '\n\nリスト「' + target.title + '」に追加しますか?')) return true;

  const card = normalizeCard(await api.addCard(target.id, cardTitle));
  const desc = [text && text !== cardTitle ? text : '', link ? link : ''].filter(Boolean).join('\n\n');
  if (desc) { card.desc = desc; await api.updateCard(card.id, { desc: desc }); }
  if (link) { card.links = [link]; await api.updateCard(card.id, { links: card.links }); }
  STATE.cards.push(card);
  render();
  setStatus('共有からカードを追加しました');
  openModal(card.id);
  return true;
}

/* ========================================================================
   ここから下は 2026-08-09（第2弾）
   週案ビュー / 変更履歴 / Gmail取り込み / AI棚卸し / 自然文一括操作 / 意味検索
   ======================================================================== */

let CLASSES = [];            // 週案の行になるクラス名
const PERIODS = [1, 2, 3, 4, 5, 6];
const WDAY = ['日', '月', '火', '水', '木', '金', '土'];
let weekRef = new Date();    // 週案が表示している週のどこかの日付

async function loadClasses() {
  try { CLASSES = await api.getClasses(); } catch (e) { CLASSES = []; }
  return CLASSES;
}

// その週の月曜日
function mondayOf(d) {
  const x = new Date(d); x.setHours(0, 0, 0, 0);
  const w = x.getDay();                 // 0=日
  x.setDate(x.getDate() - ((w + 6) % 7));
  return x;
}

/* --------------------------- 週案ビュー --------------------------- */
function hideWeek() {
  $('#week').classList.add('hidden');
  weekSortables.forEach(function (s) { try { s.destroy(); } catch (e) {} });
  weekSortables = [];
}

async function showWeek() {
  $('#week').classList.remove('hidden');
  $('#weekBody').innerHTML = '<div class="set-note">読み込み中...</div>';
  await loadClasses();
  try { await ensureAllCards(); } catch (e) {}
  renderWeek();
}

function renderWeek() {
  const body = $('#weekBody'); body.innerHTML = '';
  const mon = mondayOf(weekRef);
  const days = [];
  for (let i = 0; i < 5; i++) { const d = new Date(mon); d.setDate(mon.getDate() + i); days.push(d); }
  $('#weekTitle').textContent = '週案 ' + (mon.getMonth() + 1) + '/' + mon.getDate() + ' の週';

  if (!CLASSES.length) {
    body.appendChild(el('div', 'set-note',
      'クラスがまだ設定されていません。⚙設定 →「🗓 週案のクラス」で登録してください。'));
    $('#weekProgress').innerHTML = '';
    return;
  }

  const dayStrs = days.map(ymd);
  // この週・このボードの授業カードを (日付, 時限, クラス) で引けるようにする
  const slot = {};
  STATE.cards.forEach(function (c) {
    if (c.archived || !c.klass || !c.period) return;
    const d = c.start || c.due; if (!d) return;
    if (dayStrs.indexOf(d) < 0) return;
    const l = STATE.lists.find(function (x) { return x.id === c.listId; });
    if (!l || l.boardId !== currentBoardId) return;
    (slot[d + '|' + c.period + '|' + c.klass] = slot[d + '|' + c.period + '|' + c.klass] || []).push(c);
  });

  const table = el('table', 'week-table');
  const thead = el('thead'); const hr = el('tr');
  hr.appendChild(el('th', 'week-th-corner', 'クラス'));
  days.forEach(function (d) {
    const th = el('th', 'week-th-day' + (ymd(d) === ymd(new Date()) ? ' today' : ''));
    th.innerHTML = WDAY[d.getDay()] + '<span class="week-date">' + (d.getMonth() + 1) + '/' + d.getDate() + '</span>';
    th.colSpan = PERIODS.length;
    hr.appendChild(th);
  });
  thead.appendChild(hr);

  const hr2 = el('tr');
  hr2.appendChild(el('th', 'week-th-corner', ''));
  days.forEach(function () {
    PERIODS.forEach(function (p) { hr2.appendChild(el('th', 'week-th-period', String(p))); });
  });
  thead.appendChild(hr2);
  table.appendChild(thead);

  const tbody = el('tbody');
  CLASSES.forEach(function (k) {
    const tr = el('tr');
    tr.appendChild(el('th', 'week-th-class', esc(k)));
    days.forEach(function (d) {
      const ds = ymd(d);
      PERIODS.forEach(function (p) {
        const td = el('td', 'week-cell' + (ds === ymd(new Date()) ? ' today' : ''));
        // ドロップ先を特定するための情報（onAdd で読む）
        td.dataset.date = ds; td.dataset.period = String(p); td.dataset.klass = k;
        const here = slot[ds + '|' + p + '|' + k] || [];
        here.forEach(function (c) {
          const chip = el('div', 'week-chip' + (c.done ? ' done' : ''), esc(c.title));
          chip.title = c.title + '（ドラッグで移動できます）';
          chip.dataset.cardId = c.id;
          chip.addEventListener('click', function () { hideWeek(); openModal(c.id); });
          td.appendChild(chip);
        });
        if (!here.length) {
          const add = el('button', 'week-add', '＋');
          add.title = k + ' ' + (d.getMonth() + 1) + '/' + d.getDate() + ' ' + p + '限';
          add.addEventListener('click', function () { addLessonCard(k, ds, p); });
          td.appendChild(add);
        }
        tr.appendChild(td);
      });
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  body.appendChild(table);

  enableWeekDrag();
  renderWeekProgress();
}

// グリッドのマス目どうしでカードをドラッグ移動できるようにする。
// 落とした先のマスから クラス・日付・時限 を読み取ってカードを書き換える。
let weekSortables = [];
function enableWeekDrag() {
  weekSortables.forEach(function (s) { try { s.destroy(); } catch (e) {} });
  weekSortables = [];
  if (typeof Sortable === 'undefined') return;

  const cells = document.querySelectorAll('#weekBody .week-cell');
  for (let i = 0; i < cells.length; i++) {
    weekSortables.push(new Sortable(cells[i], {
      group: 'weekgrid',
      draggable: '.week-chip',      // 「＋」ボタンは掴めないようにする
      animation: 120,
      delay: 200,                   // スマホの長押しドラッグ（既存のボードと同じ操作感）
      delayOnTouchOnly: true,
      onAdd: async function (evt) {
        const td = evt.to;
        const id = evt.item.dataset.cardId;
        const card = STATE.cards.find(function (c) { return c.id === id; });
        if (!card) { renderWeek(); return; }

        card.klass = td.dataset.klass;
        card.period = Number(td.dataset.period) || 0;
        card.start = td.dataset.date;
        try {
          await api.updateCard(card.id, { klass: card.klass, period: card.period, start: card.start });
          setStatus(card.klass + ' ' + card.start + ' ' + card.period + '限 に移動しました');
        } catch (e) {
          setStatus('移動を保存できませんでした');
        }
        renderWeek();               // 「＋」の出し分けを作り直すため丸ごと描き直す
        refreshCardNode(card);
      }
    }));
  }
}

// クラスごとの進度差（同じタイトルの授業が、どのクラスで何回済んでいるか）
function renderWeekProgress() {
  const box = $('#weekProgress'); box.innerHTML = '';
  if (!CLASSES.length) return;

  const listIds = {};
  STATE.lists.forEach(function (l) { if (l.boardId === currentBoardId) listIds[l.id] = 1; });
  const counts = {};   // クラス → {done, total, last}
  CLASSES.forEach(function (k) { counts[k] = { done: 0, total: 0, last: '' }; });

  STATE.cards.forEach(function (c) {
    if (c.archived || !c.klass || !listIds[c.listId]) return;
    if (!counts[c.klass]) return;
    counts[c.klass].total++;
    if (c.done) {
      counts[c.klass].done++;
      const d = c.start || c.due || '';
      if (d > counts[c.klass].last) counts[c.klass].last = d;
    }
  });

  const any = CLASSES.some(function (k) { return counts[k].total > 0; });
  if (!any) return;

  box.appendChild(el('h3', 'arch-head', 'クラスごとの進度'));
  const maxDone = CLASSES.reduce(function (m, k) { return Math.max(m, counts[k].done); }, 0);
  CLASSES.forEach(function (k) {
    const c = counts[k];
    const row = el('div', 'prog-row');
    row.appendChild(el('span', 'prog-name', esc(k)));
    const bar = el('div', 'prog-bar');
    const fill = el('div', 'prog-fill');
    fill.style.width = (c.total ? Math.round(c.done / c.total * 100) : 0) + '%';
    bar.appendChild(fill);
    row.appendChild(bar);
    const behind = maxDone - c.done;
    row.appendChild(el('span', 'prog-num',
      c.done + ' / ' + c.total + ' 時' + (behind > 0 ? '　<b class="behind">' + behind + '時 遅れ</b>' : '')));
    box.appendChild(row);
  });
}

async function addLessonCard(klass, dateStr, period) {
  const lists = boardLists();
  if (!lists.length) { alert('先にリストを作ってください。'); return; }
  const title = prompt(klass + '　' + dateStr + '　' + period + '限　の授業名:');
  if (!title) return;
  const card = normalizeCard(await api.addCard(lists[0].id, title));
  card.klass = klass; card.period = period; card.start = dateStr;
  await api.updateCard(card.id, { klass: klass, period: period, start: dateStr });
  STATE.cards.push(card);
  renderWeek(); render();
  setStatus('授業カードを作りました');
}

// カード詳細のクラス／時限の選択肢を作る
function renderKlassPeriod(card) {
  const ks = $('#m-klass'), ps = $('#m-period');
  if (!ks || !ps) return;
  ks.innerHTML = '<option value="">（なし）</option>';
  CLASSES.forEach(function (k) {
    const o = document.createElement('option'); o.value = k; o.textContent = k;
    if (card.klass === k) o.selected = true;
    ks.appendChild(o);
  });
  ps.innerHTML = '<option value="0">（なし）</option>';
  PERIODS.forEach(function (p) {
    const o = document.createElement('option'); o.value = String(p); o.textContent = p + '限';
    if (Number(card.period) === p) o.selected = true;
    ps.appendChild(o);
  });
}

/* --------------------------- 一括展開（他のクラスへ配る） --------------------------- */
function hideDistPanel() { $('#m-dist-panel').classList.add('hidden'); }

function showDistPanel() {
  const card = currentCard(); if (!card) return;
  if (!CLASSES.length) { alert('先に ⚙設定 →「🗓 週案のクラス」でクラスを登録してください。'); return; }
  if (!card.klass) { alert('先にこのカードのクラスを設定してください。'); return; }

  const base = card.start || card.due || ymd(new Date());
  const rows = $('#m-dist-rows'); rows.innerHTML = '';

  CLASSES.filter(function (k) { return k !== card.klass; }).forEach(function (k, i) {
    const row = el('div', 'dist-row');

    const chk = document.createElement('input');
    chk.type = 'checkbox'; chk.className = 'dist-chk'; chk.checked = true; chk.dataset.klass = k;
    row.appendChild(chk);
    row.appendChild(el('span', 'dist-name', esc(k)));

    // 既定は元カードと同じ日。1クラスずつ翌日にずらすのではなく、同日同時限をまず出して手で直す方が実態に合う
    const d = document.createElement('input');
    d.type = 'date'; d.className = 'dist-date'; d.value = base; d.dataset.klass = k;
    row.appendChild(d);

    const p = document.createElement('select');
    p.className = 'dist-period'; p.dataset.klass = k;
    PERIODS.forEach(function (n) {
      const o = document.createElement('option');
      o.value = String(n); o.textContent = n + '限';
      if (Number(card.period) === n) o.selected = true;
      p.appendChild(o);
    });
    row.appendChild(p);

    rows.appendChild(row);
  });

  $('#m-dist-panel').classList.remove('hidden');
}

async function runDistribute() {
  const card = currentCard(); if (!card) return;
  const chks = document.querySelectorAll('.dist-chk');
  const targets = [];
  for (let i = 0; i < chks.length; i++) {
    if (!chks[i].checked) continue;
    const k = chks[i].dataset.klass;
    const d = document.querySelector('.dist-date[data-klass="' + k + '"]');
    const p = document.querySelector('.dist-period[data-klass="' + k + '"]');
    targets.push({ klass: k, date: d ? d.value : '', period: Number(p ? p.value : 0) || 0 });
  }
  if (!targets.length) { alert('展開するクラスを選んでください。'); return; }

  setStatus('展開中...');
  const made = await api.distributeLesson(card.id, targets);
  (made || []).forEach(function (c) { STATE.cards.push(normalizeCard(c)); });
  invalidateAllCards();
  hideDistPanel();
  render();
  if (!$('#week').classList.contains('hidden')) renderWeek();
  setStatus((made || []).length + ' クラスへ展開しました');
}

/* --------------------------- 変更履歴 --------------------------- */
const HIST_LABEL = { title: 'タイトル', desc: '説明', due: '期限', start: '開始',
                     done: '完了', archived: 'アーカイブ', klass: 'クラス', period: '時限' };

async function showCardHistory() {
  const card = currentCard(); if (!card) return;
  const box = $('#m-history');
  box.innerHTML = '<div class="set-note">読み込み中...</div>';
  let rows = [];
  try { rows = await api.getCardHistory(card.id); } catch (e) {
    box.innerHTML = '<div class="set-note">履歴を読めませんでした</div>'; return;
  }
  box.innerHTML = '';
  if (!rows.length) { box.appendChild(el('div', 'set-note', 'まだ履歴はありません。')); return; }

  rows.forEach(function (h) {
    const row = el('div', 'hist-row');
    const when = String(h.at || '').replace('T', ' ').slice(0, 16);
    row.appendChild(el('div', 'hist-when', esc(when) + '　' + esc(HIST_LABEL[h.field] || h.field)));
    row.appendChild(el('div', 'hist-diff',
      '<span class="hist-before">' + esc(String(h.before).slice(0, 80) || '（空）') + '</span>'
      + ' → <span class="hist-after">' + esc(String(h.after).slice(0, 80) || '（空）') + '</span>'));
    const back = el('button', 'ghost-btn small dark', 'この変更を戻す');
    back.addEventListener('click', async function () {
      await api.revertHistory(h.id);
      await reloadCurrentBoardCards();
      renderModal(); render(); showCardHistory();
      setStatus('戻しました');
    });
    row.appendChild(back);
    box.appendChild(row);
  });
}

/* --------------------------- Gmail 取り込み --------------------------- */
function fillListSelect(sel, selectedId) {
  if (!sel) return;
  sel.innerHTML = '';
  STATE.boards.filter(function (b) { return !b.archived; }).forEach(function (b) {
    STATE.lists.filter(function (l) { return l.boardId === b.id && !l.archived; }).forEach(function (l) {
      const o = document.createElement('option');
      o.value = l.id; o.textContent = b.title + ' / ' + l.title;
      if (l.id === selectedId) o.selected = true;
      sel.appendChild(o);
    });
  });
}

async function refreshGmailStatus() {
  let s = {};
  try { s = await api.gmailImportStatus(); } catch (e) { return; }
  $('#gmailLabel').value = s.label || '';
  fillListSelect($('#gmailList'), s.listId);
  $('#gmailStatusText').innerHTML = s.on
    ? '現在：<b>オン</b>（ラベル「' + esc(s.label) + '」・1時間ごと）' + (s.last ? '　最終取り込み: ' + esc(s.last) : '')
    : '現在：オフ';
}

/* --------------------------- AI 週次棚卸し --------------------------- */
async function refreshAiReviewStatus() {
  let s = {};
  try { s = await api.aiReviewStatus(); } catch (e) { return; }
  fillListSelect($('#aiReviewList'), s.listId);
  $('#aiReviewStatusText').innerHTML = s.on
    ? '現在：<b>オン</b>（毎週日曜20時）' + (s.last ? '　最終実行: ' + esc(s.last) : '')
    : '現在：オフ';
}

/* --------------------------- 自然文でまとめて操作 --------------------------- */
let bulkActions = [];

async function planBulk() {
  const text = $('#bulkText').value.trim();
  if (!text) return;
  const box = $('#bulkPlan');
  box.innerHTML = '<div class="set-note">変更案を作っています...</div>';
  try { bulkActions = (await api.aiPlanBulk(text)).actions || []; }
  catch (e) { box.innerHTML = '<div class="set-note">' + esc(e) + '</div>'; return; }

  box.innerHTML = '';
  if (!bulkActions.length) {
    box.appendChild(el('div', 'set-note', '該当するカードが見つかりませんでした。'));
    return;
  }
  box.appendChild(el('div', 'set-note',
    '<b>' + bulkActions.length + '件</b> の変更案です。内容を確かめてから実行してください。'));

  bulkActions.forEach(function (a, i) {
    const row = el('div', 'bulk-row');
    const chk = document.createElement('input');
    chk.type = 'checkbox'; chk.checked = true; chk.dataset.idx = String(i);
    chk.className = 'bulk-chk';
    row.appendChild(chk);

    const main = el('div', 'bulk-main');
    main.appendChild(el('div', 'bulk-title', esc(a.title)));
    const parts = Object.keys(a.change).map(function (k) {
      const before = a.before && a.before[k] !== undefined ? String(a.before[k]) : '';
      return (HIST_LABEL[k] || k) + ': ' + esc(before || '（空）') + ' → <b>' + esc(String(a.change[k])) + '</b>';
    });
    main.appendChild(el('div', 'bulk-change', parts.join('　/　')));
    if (a.reason) main.appendChild(el('div', 'bulk-reason', esc(a.reason)));
    row.appendChild(main);
    box.appendChild(row);
  });

  const run = el('button', 'primary-btn', 'チェックした変更を実行する');
  run.addEventListener('click', applyBulk);
  const acts = el('div', 'imp-actions'); acts.appendChild(run);
  box.appendChild(acts);
}

async function applyBulk() {
  const chks = document.querySelectorAll('.bulk-chk');
  const picked = [];
  for (let i = 0; i < chks.length; i++) {
    if (chks[i].checked) picked.push(bulkActions[Number(chks[i].dataset.idx)]);
  }
  if (!picked.length) { alert('実行する項目がありません。'); return; }
  if (!confirm(picked.length + ' 件を変更します。よろしいですか?\n（あとからカードごとに履歴で戻せます）')) return;

  setStatus('実行中...');
  const n = await api.aiApplyBulk(picked);
  await reloadCurrentBoardCards();
  invalidateAllCards();
  $('#bulkPlan').innerHTML = '<div class="set-note">' + n + ' 件を変更しました。</div>';
  render();
  setStatus(n + ' 件を変更しました');
}

/* --------------------------- 意味で探す --------------------------- */
async function runSemanticIndex() {
  const st = $('#semIndexStatus');
  st.textContent = '索引を作っています...';
  let guard = 0;
  try {
    while (guard++ < 40) {            // 1回25件 × 最大40周＝1000件で打ち切り
      const r = await api.reindexEmbeddings(25);
      st.textContent = '残り ' + r.remaining + ' 件...';
      if (!r.remaining) { st.textContent = '索引は最新です（全 ' + r.total + ' 件）'; return; }
      if (!r.done) { st.textContent = '一部を処理できませんでした（残り ' + r.remaining + ' 件）'; return; }
    }
    st.textContent = '件数が多いため途中で止めました。もう一度押してください。';
  } catch (e) {
    st.textContent = 'エラー: ' + e;
  }
}

async function runSemanticSearch() {
  const q = $('#semQuery').value.trim();
  const box = $('#semResult');
  if (!q) return;
  box.innerHTML = '<div class="set-note">探しています...</div>';
  let hits = [];
  try { hits = await api.semanticSearch(q, 20); }
  catch (e) { box.innerHTML = '<div class="set-note">' + esc(e) + '</div>'; return; }

  box.innerHTML = '';
  if (!hits.length) {
    box.appendChild(el('div', 'set-note', '見つかりませんでした。索引がまだなら「索引を作る」を押してください。'));
    return;
  }
  hits.forEach(function (h) {
    const row = el('div', 'sem-row');
    row.appendChild(el('div', 'sem-score', Math.round(h.score * 100) + '%'));
    const main = el('div', 'sem-main');
    main.appendChild(el('div', 'sem-title', esc(h.title)));
    main.appendChild(el('div', 'sem-meta', esc(h.boardTitle) + ' / ' + esc(h.listTitle)
      + (h.desc ? '　' + esc(h.desc) : '')));
    row.appendChild(main);
    row.addEventListener('click', async function () {
      if (h.boardId && h.boardId !== currentBoardId) {
        currentBoardId = h.boardId; saveCurrentBoard(h.boardId);
        await reloadCurrentBoardCards(); render();
      }
      hideAI();
      openModal(h.id);
    });
    box.appendChild(row);
  });
}

function bindUI() {
  applyTheme(loadTheme());   // 画面がちらつかないよう、他の配線より先に

  $('#addListBtn').addEventListener('click', async function () {
    if (!currentBoardId) { alert('先にボードを作成してください'); return; }
    const name = prompt('リスト名:');
    if (!name) return;
    const list = await api.addList(currentBoardId, name);
    STATE.lists.push(list);
    render();
  });

  $('#collapseAllBtn').addEventListener('click', toggleCollapseAll);

  // ボード一覧（ホーム）
  $('#homeBtn').addEventListener('click', showHome);
  $('#boardBar').addEventListener('click', showHome);   // 名前をクリックしても切り替えられる
  $('#boardHome').addEventListener('click', function (e) {
    if (e.target.id === 'boardHome') hideHome(); // 背景クリックで閉じる
  });

  // Trello インポート
  $('#importBtn').addEventListener('click', showImporter);
  $('#impClose').addEventListener('click', hideImporter);
  $('#impRun').addEventListener('click', runImport);
  $('#importer').addEventListener('click', function (e) {
    if (e.target.id === 'importer') hideImporter();
  });

  // 更新・エラー再試行
  $('#reloadBtn').addEventListener('click', reloadData);
  $('#loadRetry').addEventListener('click', init);

  // 自動バックアップ
  $('#backupEnable').addEventListener('click', async function () {
    $('#backupStatus').textContent = '設定中...';
    try { await api.enableBackup($('#backupFreq').value); } catch (e) { alert('失敗: ' + e + '（権限の許可が必要かもしれません）'); }
    loadBackupStatus();
  });
  $('#backupDisable').addEventListener('click', async function () { await api.disableBackup(); loadBackupStatus(); });
  $('#backupNowBtn').addEventListener('click', async function () {
    $('#backupStatus').textContent = 'バックアップ中...';
    try { await api.backupNow(); $('#backupStatus').textContent = '✅ バックアップしました'; loadBackupStatus(); }
    catch (e) { $('#backupStatus').textContent = '失敗: ' + e; }
  });
  $('#backupOpen').addEventListener('click', async function () {
    let url = this.dataset.url;
    if (!url) { try { const s = await api.backupStatus(); url = s.folderUrl; this.dataset.url = url || ''; } catch (e) {} }
    if (!url) { alert('保存先フォルダのURLを取得できませんでした。一度「今すぐバックアップ」を押してからお試しください。'); return; }
    const a = document.createElement('a');
    a.href = url; a.target = '_blank'; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
  });

  // アーカイブ（カード）
  $('#archBtn').addEventListener('click', showArchive);
  $('#archClose').addEventListener('click', hideArchive);

  /* ---- 2026-08-09 追加分の配線 ---- */
  $('#todayBtn').addEventListener('click', showToday);
  $('#todayClose').addEventListener('click', hideToday);

  $('#trashEmptyBtn').addEventListener('click', async function () {
    if (!confirm('ゴミ箱の中身をすべて完全に削除します。\n添付ファイルもドライブのゴミ箱へ移ります。\n取り消せません。よろしいですか?')) return;
    const n = await api.emptyTrash();
    renderTrash();
    setStatus((n || 0) + ' 件を完全に削除しました');
  });

  /* ---- 第2弾の配線 ---- */
  $('#weekBtn').addEventListener('click', showWeek);
  $('#weekClose').addEventListener('click', hideWeek);
  $('#weekPrev').addEventListener('click', function () { weekRef.setDate(weekRef.getDate() - 7); renderWeek(); });
  $('#weekNext').addEventListener('click', function () { weekRef.setDate(weekRef.getDate() + 7); renderWeek(); });
  $('#weekToday').addEventListener('click', function () { weekRef = new Date(); renderWeek(); });

  $('#m-klass').addEventListener('change', function () {
    const card = currentCard(); if (!card) return;
    card.klass = this.value;
    api.updateCard(card.id, { klass: card.klass });
    setStatus('クラスを設定しました');
  });
  $('#m-period').addEventListener('change', function () {
    const card = currentCard(); if (!card) return;
    card.period = Number(this.value) || 0;
    api.updateCard(card.id, { period: card.period });
    setStatus('時限を設定しました');
  });
  $('#m-history-btn').addEventListener('click', showCardHistory);
  $('#m-dist-btn').addEventListener('click', showDistPanel);
  $('#m-dist-cancel').addEventListener('click', hideDistPanel);
  $('#m-dist-run').addEventListener('click', runDistribute);

  $('#classSaveBtn').addEventListener('click', async function () {
    const raw = $('#classList').value;
    const arr = raw.split(/[,、\n]/).map(function (s) { return s.trim(); }).filter(Boolean);
    CLASSES = await api.setClasses(arr);
    setStatus('クラスを保存しました（' + CLASSES.length + '件）');
  });

  $('#gmailOnBtn').addEventListener('click', async function () {
    try {
      await api.enableGmailImport($('#gmailLabel').value, $('#gmailList').value);
      await refreshGmailStatus();
      setStatus('Gmail取り込みをオンにしました');
    } catch (e) { alert(e); }
  });
  $('#gmailOffBtn').addEventListener('click', async function () {
    await api.disableGmailImport(); await refreshGmailStatus(); setStatus('オフにしました');
  });
  $('#gmailNowBtn').addEventListener('click', async function () {
    setStatus('取り込み中...');
    try {
      const r = await api.importGmailNow();
      await reloadCurrentBoardCards(); invalidateAllCards(); render();
      await refreshGmailStatus();
      setStatus((r.added || 0) + ' 件取り込みました' + (r.reason ? '（' + r.reason + '）' : ''));
    } catch (e) { alert(e); setStatus(''); }
  });

  $('#aiReviewOnBtn').addEventListener('click', async function () {
    try { await api.enableAiReview($('#aiReviewList').value); await refreshAiReviewStatus(); setStatus('オンにしました'); }
    catch (e) { alert(e); }
  });
  $('#aiReviewOffBtn').addEventListener('click', async function () {
    await api.disableAiReview(); await refreshAiReviewStatus(); setStatus('オフにしました');
  });
  $('#aiReviewNowBtn').addEventListener('click', async function () {
    setStatus('AIが確認しています...');
    try {
      const r = await api.aiWeeklyReview();
      await reloadCurrentBoardCards(); invalidateAllCards(); render();
      await refreshAiReviewStatus();
      setStatus((r.added || 0) + ' 件の提案を置きました' + (r.reason ? '（' + r.reason + '）' : ''));
    } catch (e) { alert(e); setStatus(''); }
  });

  $('#bulkPlanBtn').addEventListener('click', planBulk);
  $('#semBtn').addEventListener('click', runSemanticSearch);
  $('#semQuery').addEventListener('keydown', function (e) { if (e.key === 'Enter') runSemanticSearch(); });
  $('#semIndexBtn').addEventListener('click', runSemanticIndex);

  $('#exportJsonBtn').addEventListener('click', exportJson);
  $('#exportCsvBtn').addEventListener('click', exportCsv);
  $('#healthBtn').addEventListener('click', showHealth);
  $('#m-desc-preview').addEventListener('click', toggleDescPreview);

  const themeBtns = document.querySelectorAll('.theme-btn');
  for (let i = 0; i < themeBtns.length; i++) {
    themeBtns[i].addEventListener('click', function () { setTheme(this.dataset.theme); });
  }
  // 「自動」のときは端末側の設定変更に追随する
  if (window.matchMedia) {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = function () { if (loadTheme() === 'auto') applyTheme('auto'); };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);
  }
  $('#archive').addEventListener('click', function (e) {
    if (e.target.id === 'archive') hideArchive();
  });

  // AIアシスタント
  $('#aiBtn').addEventListener('click', showAI);
  $('#aiClose').addEventListener('click', hideAI);
  $('#ai').addEventListener('click', function (e) { if (e.target.id === 'ai') hideAI(); });
  $('#aiAddBtn').addEventListener('click', aiAddCardUI);
  $('#aiSumBtn').addEventListener('click', aiSummarizeUI);

  // 集計ダッシュボード
  $('#dashBtn').addEventListener('click', showDashboard);
  $('#dashClose').addEventListener('click', hideDashboard);
  $('#dashboard').addEventListener('click', function (e) { if (e.target.id === 'dashboard') hideDashboard(); });

  // テーブル（保存ビュー）
  $('#tableBtn').addEventListener('click', showTable);
  $('#tableClose').addEventListener('click', hideTable);
  $('#table').addEventListener('click', function (e) { if (e.target.id === 'table') hideTable(); });
  $('#viewEdit').addEventListener('click', function () { const v = currentView(); if (v) showViewForm(v); });
  $('#viewDelete').addEventListener('click', deleteCurrentView);
  $('#vfSave').addEventListener('click', saveView);
  $('#vfCancel').addEventListener('click', hideViewForm);

  // カレンダー
  $('#calBtn').addEventListener('click', showCalendar);
  $('#calClose').addEventListener('click', hideCalendar);
  $('#calendar').addEventListener('click', function (e) {
    if (e.target.id === 'calendar') hideCalendar();
  });
  $('#calPrev').addEventListener('click', function () { calRef.setMonth(calRef.getMonth() - 1); renderCalendar(); });
  $('#calNext').addEventListener('click', function () { calRef.setMonth(calRef.getMonth() + 1); renderCalendar(); });

  // 背景設定
  $('#setBtn').addEventListener('click', showSettings);
  $('#setClose').addEventListener('click', hideSettings);
  $('#settings').addEventListener('click', function (e) {
    if (e.target.id === 'settings') hideSettings();
  });
  $('#bgSearchBtn').addEventListener('click', searchBg);
  $('#bgSearch').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') searchBg();
  });
  $('#bgClearBtn').addEventListener('click', async function () {
    const b = STATE.boards.find(function (x) { return x.id === currentBoardId; });
    if (b) b.background = '';
    await api.setBoardBackground(currentBoardId, '');
    applyBackground();
    setStatus('背景を標準に戻しました');
    hideSettings();
  });

  $('#modalClose').addEventListener('click', closeModal);
  $('#modal').addEventListener('click', function (e) {
    if (e.target.id === 'modal') closeModal();
  });

  $('#m-done').addEventListener('click', function () {
    const card = currentCard();
    if (card) toggleDone(card);
  });

  $('#m-archive').addEventListener('click', function () {
    const card = currentCard();
    if (card) { archiveCard(card); closeModal(); }
  });

  // Googleカレンダー / タスク 連携
  $('#m-gcal').addEventListener('change', async function () {
    const card = currentCard(); if (!card) return;
    const checked = this.checked;
    $('#m-sync-status').textContent = checked ? 'カレンダーに登録中...' : 'カレンダーから削除中...';
    try {
      card.sync = await api.syncCalendar(card.id, checked);
      $('#m-sync-status').textContent = checked ? '✅ カレンダーに登録しました' : 'カレンダーから削除しました';
    } catch (e) {
      this.checked = !checked;
      $('#m-sync-status').textContent = '失敗: ' + e;
    }
  });
  $('#m-gtask').addEventListener('change', async function () {
    const card = currentCard(); if (!card) return;
    const checked = this.checked;
    $('#m-sync-status').textContent = checked ? 'タスクに登録中...' : 'タスクから削除中...';
    try {
      card.sync = await api.syncTask(card.id, checked);
      $('#m-sync-status').textContent = checked ? '✅ タスクに登録しました' : 'タスクから削除しました';
    } catch (e) {
      this.checked = !checked;
      $('#m-sync-status').textContent = '失敗: ' + e;
    }
  });

  // 複製・移動
  $('#m-copy').addEventListener('click', function () {
    const card = currentCard();
    if (card) { duplicateCard(card); closeModal(); }
  });
  $('#m-move').addEventListener('click', showMovePanel);
  $('#m-move-board').addEventListener('change', populateMoveLists);
  $('#m-move-go').addEventListener('click', doMove);
  $('#m-move-cancel').addEventListener('click', function () { $('#m-move-panel').classList.add('hidden'); });

  // 検索・フィルター
  $('#filterBtn').addEventListener('click', showFilter);
  $('#filterClose').addEventListener('click', hideFilter);
  $('#filter').addEventListener('click', function (e) { if (e.target.id === 'filter') hideFilter(); });
  $('#flApply').addEventListener('click', applyFilter);
  $('#flClear').addEventListener('click', clearFilter);
  $('#flKeyword').addEventListener('keydown', function (e) { if (e.key === 'Enter') applyFilter(); });

  // 期限リマインダー
  $('#remEnable').addEventListener('click', async function () {
    const hour = Number($('#remHour').value);
    $('#reminderStatus').textContent = '設定中...';
    try {
      const email = await api.enableReminders(hour);
      $('#reminderStatus').textContent = '✅ オンにしました。毎日' + hour + '時に ' + email + ' へ届きます。';
    } catch (e) {
      $('#reminderStatus').textContent = '失敗: ' + e + '（メール送信の権限許可が必要かもしれません）';
    }
  });
  $('#remDisable').addEventListener('click', async function () {
    await api.disableReminders();
    $('#reminderStatus').textContent = '⛔ オフにしました。';
  });
  // 自動化ルール
  $('#autoAddBtn').addEventListener('click', showAutoForm);
  $('#afCancel').addEventListener('click', hideAutoForm);
  $('#afSave').addEventListener('click', saveAuto);

  // 繰り返しカード
  $('#recurAddBtn').addEventListener('click', showRecurForm);
  $('#rfCancel').addEventListener('click', hideRecurForm);
  $('#rfSave').addEventListener('click', saveRecur);

  // 共有
  $('#shareEnableBtn').addEventListener('click', async function () {
    const on = await api.isSharingEnabled();
    if (on) { await api.disableSharing(); } else { await api.enableSharing(); }
    loadShareSection();
  });

  // タイムライン
  $('#timelineBtn').addEventListener('click', showTimeline);
  $('#tlClose').addEventListener('click', hideTimeline);
  $('#timeline').addEventListener('click', function (e) { if (e.target.id === 'timeline') hideTimeline(); });
  $('#tlPrev').addEventListener('click', function () { tlRef.setDate(tlRef.getDate() - 7); renderTimeline(); });
  $('#tlNext').addEventListener('click', function () { tlRef.setDate(tlRef.getDate() + 7); renderTimeline(); });

  // テンプレート
  $('#m-template').addEventListener('click', toggleTemplate);

  $('#remTest').addEventListener('click', async function () {
    $('#reminderStatus').textContent = '送信中...';
    try {
      const n = await api.sendDueReminders(true);
      $('#reminderStatus').textContent = 'テスト送信しました（対象 ' + n + ' 件）。メールを確認してください。';
    } catch (e) {
      $('#reminderStatus').textContent = '失敗: ' + e + '（メール送信の権限許可が必要かもしれません）';
    }
  });

  // ラベル追加
  $('#m-label-add-btn').addEventListener('click', showLabelForm);
  $('#m-label-cancel').addEventListener('click', hideLabelForm);
  $('#m-label-save').addEventListener('click', saveNewLabel);
  $('#m-label-name').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); saveNewLabel(); }
  });
  $('#m-label-color').addEventListener('input', function () {
    selectedLabelColor = this.value;
    renderLabelColors();
  });

  // カスタムフィールドの追加
  $('#m-field-add-btn').addEventListener('click', function () { showFieldForm(null); });
  $('#m-field-cancel').addEventListener('click', hideFieldForm);
  $('#m-field-save').addEventListener('click', saveFieldForm);
  $('#m-field-type').addEventListener('change', function () { renderFieldConfig(null); });
  $('#m-field-name').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); saveFieldForm(); }
  });

  $('#m-title').addEventListener('change', function () {
    saveField({ title: $('#m-title').value });
  });
  $('#m-desc').addEventListener('change', function () {
    saveField({ desc: $('#m-desc').value });
  });
  $('#m-desc').addEventListener('input', function () { autoGrow(this); });
  $('#m-start').addEventListener('change', function () {
    saveField({ start: $('#m-start').value });
  });
  $('#m-end').addEventListener('change', function () {
    saveField({ due: $('#m-end').value });
  });
  $('#m-allday').addEventListener('change', function () {
    saveField({ allDay: $('#m-allday').checked });
  });
  $('#m-date-clear').addEventListener('click', function () {
    $('#m-start').value = ''; $('#m-end').value = '';
    saveField({ start: '', due: '' });
  });

  $('#m-check-add').addEventListener('click', addCheck);
  $('#m-check-new').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') addCheck();
  });
  // Excelの列など複数行を貼り付け → 各行を1項目として一括追加
  $('#m-check-new').addEventListener('paste', function (e) {
    const text = (e.clipboardData || window.clipboardData).getData('text');
    if (!text || !/[\r\n]/.test(text)) return; // 単一行は通常の貼り付け
    e.preventDefault();
    const card = currentCard();
    if (!card) return;
    const items = text.split(/\r\n|\r|\n/).map(function (s) { return s.trim(); }).filter(function (s) { return s; });
    if (!items.length) return;
    card.checklist = (card.checklist || []).concat(items.map(function (s) { return { text: s, done: false }; }));
    $('#m-check-new').value = '';
    saveField({ checklist: card.checklist });
    renderChecklist(card);
    setStatus(items.length + '件を追加しました');
  });
  function addCheck() {
    const v = $('#m-check-new').value.trim();
    if (!v) return;
    const card = currentCard();
    card.checklist = (card.checklist || []).concat([{ text: v, done: false }]);
    $('#m-check-new').value = '';
    saveField({ checklist: card.checklist });
    renderChecklist(card);
  }

  // 添付ファイル（Drive 直結アップロード）
  $('#m-file-btn').addEventListener('click', function () { $('#m-file').click(); });
  $('#m-file').addEventListener('change', function () {
    const file = this.files[0];
    this.value = '';
    if (!file) return;
    const card = currentCard();
    if (!card) return;
    uploadAttachmentToDrive(card, file);
  });

  // リンク・YouTube
  function addLink() {
    const v = $('#m-link-new').value.trim();
    if (!v) return;
    const card = currentCard();
    if (!card) return;
    card.links = (card.links || []).concat([v]);
    $('#m-link-new').value = '';
    api.updateCard(card.id, { links: card.links });
    renderLinks(card);
    refreshCardNode(card);
  }
  $('#m-link-add').addEventListener('click', addLink);
  $('#m-link-new').addEventListener('keydown', function (e) { if (e.key === 'Enter') addLink(); });

  // 地図・場所
  function addPlace() {
    const v = $('#m-place-new').value.trim();
    if (!v) return;
    const card = currentCard();
    if (!card) return;
    card.places = (Array.isArray(card.places) ? card.places : []).concat([v]);
    $('#m-place-new').value = '';
    api.updateCard(card.id, { places: card.places });
    renderPlaces(card);
    refreshCardNode(card);
  }
  $('#m-place-add').addEventListener('click', addPlace);
  $('#m-place-new').addEventListener('keydown', function (e) { if (e.key === 'Enter') addPlace(); });

  $('#m-comment-add').addEventListener('click', addComment);
  $('#m-comment-new').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') addComment();
  });
  function addComment() {
    const v = $('#m-comment-new').value.trim();
    if (!v) return;
    const card = currentCard();
    card.comments = (card.comments || []).concat([{ text: v, ts: Date.now() }]);
    $('#m-comment-new').value = '';
    saveField({ comments: card.comments });
    renderComments(card);
  }

  $('#m-delete').addEventListener('click', function () {
    const card = currentCard();
    if (!card) return;
    if (confirm('このカードを削除しますか?')) {
      api.deleteCard(card.id).then(function () {
        STATE.cards = STATE.cards.filter(function (c) { return c.id !== card.id; });
        closeModal();
        render();
      });
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (document.getElementById('qe-overlay')) { closeQuickEdit(); return; }
    if (!$('#modal').classList.contains('hidden')) closeModal();
    else if (!$('#ai').classList.contains('hidden')) hideAI();
    else if (!$('#table').classList.contains('hidden')) hideTable();
    else if (!$('#dashboard').classList.contains('hidden')) hideDashboard();
    else if (!$('#timeline').classList.contains('hidden')) hideTimeline();
    else if (!$('#filter').classList.contains('hidden')) hideFilter();
    else if (!$('#archive').classList.contains('hidden')) hideArchive();
    else if (!$('#importer').classList.contains('hidden')) hideImporter();
    else if (!$('#settings').classList.contains('hidden')) hideSettings();
    else if (!$('#calendar').classList.contains('hidden')) hideCalendar();
    else if (!$('#boardHome').classList.contains('hidden')) hideHome();
  });

  // ホバー中のカードを追跡（Trello風ショートカットの対象）
  document.addEventListener('mouseover', function (e) {
    if (!e.target.closest) { hoverCardId = null; hoverListId = null; return; }
    const cardEl = e.target.closest('.card');
    hoverCardId = cardEl ? cardEl.dataset.cardId : null;
    const listEl = e.target.closest('.list');
    hoverListId = listEl ? listEl.dataset.listId : null;
  });

  // キーボードショートカット（Trello準拠。入力中・オーバーレイ表示中は無効）
  document.addEventListener('keydown', function (e) {
    const tag = (e.target.tagName || '').toLowerCase();
    const inField = (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable);
    // Ctrl/Cmd+Z で1つ戻す（テキスト欄では通常の取り消しに任せる）
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
      if (inField) return;
      e.preventDefault(); doUndo(); return;
    }
    if (inField) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === '?') { showShortcutHelp(); return; }
    const overlays = ['#modal', '#table', '#dashboard', '#timeline', '#filter', '#archive', '#settings', '#calendar', '#boardHome', '#importer', '#ai'];
    const open = overlays.some(function (s) { const n = document.querySelector(s); return n && !n.classList.contains('hidden'); });
    if (open || document.getElementById('qe-overlay')) return;

    const card = hoverCardId ? STATE.cards.find(function (c) { return c.id === hoverCardId; }) : null;
    // ── カードにホバー中のショートカット ──
    if (card) {
      if (e.key === 'Enter') { e.preventDefault(); openModal(card.id); return; }
      if (e.key === 'e') { e.preventDefault(); const n = cardNode(card.id); if (n) openQuickEdit(card, n); return; }
      if (e.key === 'c') { e.preventDefault(); archiveCard(card); return; }
      if (e.key === ' ') { e.preventDefault(); toggleDone(card); return; }
      if (e.key === 'd') { e.preventDefault(); openCardDateQuick(card); return; }
      if (e.key === 'l') { e.preventDefault(); openCardLabelQuick(card); return; }
      if (/^[1-9]$/.test(e.key)) { e.preventDefault(); toggleLabelByIndex(card, Number(e.key) - 1); return; }
    }
    // ── リストにホバー中：[ で折りたたみ/展開 ──
    if (hoverListId && e.key === '[') {
      const list = STATE.lists.find(function (l) { return l.id === hoverListId; });
      if (list) { e.preventDefault(); toggleCollapse(list, !list.collapsed); return; }
    }
    // ── 全体のショートカット ──
    if (e.key === 'f') showFilter();
    else if (e.key === 'x') clearFilter();
    else if (e.key === 'b') showHome();
    else if (e.key === '/') { e.preventDefault(); showFilter(); setTimeout(function () { const k = $('#flKeyword'); if (k) k.focus(); }, 60); }
  });
}

bindUI();
if (!getApiUrl() || !getApiToken()) { configureApi(); }
init();
