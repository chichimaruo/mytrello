/****************************************************************
 * My Trello - Backend (Google Apps Script)
 * データは1つのスプレッドシート(=Googleドライブ内)に保存されます。
 * 初回アクセス時に自動でスプレッドシートを作成します。
 ****************************************************************/

const PROP = PropertiesService.getScriptProperties();
const SS_KEY = 'SPREADSHEET_ID';

// 各シートの列定義（この順番でセルに保存されます）
const SCHEMA = {
  Boards: ['id', 'title', 'position', 'archived', 'createdAt', 'background', 'shareToken'],
  Lists:  ['id', 'title', 'position', 'archived', 'boardId', 'wip', 'collapsed'],
  Cards:  ['id', 'listId', 'title', 'desc', 'position', 'labels',
           'due', 'checklist', 'comments', 'createdAt', 'updatedAt', 'archived',
           'attachments', 'start', 'allDay', 'done', 'ratings', 'fields', 'cover', 'template', 'links', 'sync', 'places'],
  Labels: ['id', 'name', 'color', 'boardId'],
  Fields: ['id', 'boardId', 'name', 'type', 'config', 'position', 'showFront'],
  Views: ['id', 'name', 'config', 'position'],
  Automations: ['id', 'boardId', 'triggerList', 'actions', 'position'],
  Recurring: ['id', 'boardId', 'listId', 'title', 'freq', 'lastRun', 'position']
};

const DEFAULT_LABELS = [
  { name: '緊急',   color: '#eb5a46' },
  { name: '重要',   color: '#f2d600' },
  { name: '進行中', color: '#0079bf' },
  { name: '完了',   color: '#61bd4f' },
  { name: '保留',   color: '#c377e0' },
  { name: 'メモ',   color: '#ff9f1a' }
];

/* ============================ Web entry ============================ */

function doGet(e) {
  const p = (e && e.parameter) || {};
  // ① アプリ版（PWA）からのデータ要求＝JSON API（トークンで保護）
  if (p.fn) return handleApi_(e);
  // ② 共有リンク（読み取り専用・トークン照合）
  if (p.share && p.board) {
    return renderSharedBoard_(p.board, p.share);
  }
  // ③ 旧・編集アプリのHTML。所有者本人にのみ表示（公開アクセスのデプロイで他人に出さない）
  const owner = Session.getEffectiveUser().getEmail();
  const viewer = Session.getActiveUser().getEmail();
  if (owner && viewer === owner) {
    return HtmlService.createTemplateFromFile('Index')
      .evaluate()
      .setTitle('My Board')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1');
  }
  // それ以外（公開デプロイに素のURLで来た等）は案内のみ
  return HtmlService.createHtmlOutput(
    '<div style="font-family:sans-serif;padding:40px;color:#444">このURLはMTアプリのデータ用です。アプリは ' +
    '<a href="https://chichimaruo.github.io/mytrello/">こちら</a> から開いてください。</div>');
}

// アプリ版からの POST（更新系・大きなデータ）もこの窓口で受ける
function doPost(e) { return handleApi_(e); }

/* ============================ JSON API（アプリ版の窓口） ============================ */
// 許可する関数（クライアントが実際に呼ぶものだけ。これ以外は実行しない）
const API_ALLOWED = {
  apiPing: 1,
  getInitial: 1, getState: 1, getMeta: 1, getCards: 1, getAllCards: 1,
  addBoard: 1, renameBoard: 1, deleteBoard: 1, archiveBoard: 1, setBoardBackground: 1,
  addList: 1, renameList: 1, deleteList: 1, archiveList: 1, copyList: 1,
  archiveAllCards: 1, setListWip: 1, setListCollapsed: 1, setAllListsCollapsed: 1, saveListOrder: 1,
  addCard: 1, updateCard: 1, deleteCard: 1, moveCard: 1, moveCardToList: 1, copyCard: 1, saveCardOrder: 1,
  addLabel: 1, deleteLabel: 1,
  addField: 1, deleteField: 1,
  addView: 1, updateView: 1, deleteView: 1,
  addAutomation: 1, deleteAutomation: 1,
  addRecurring: 1, deleteRecurring: 1,
  getOAuthToken: 1, getAttachFolderId: 1, addAttachmentMeta: 1, deleteAttachment: 1,
  syncCalendar: 1, syncTask: 1,
  enableReminders: 1, disableReminders: 1, isReminderOn: 1, sendDueReminders: 1,
  enableBackup: 1, disableBackup: 1, backupNow: 1, backupStatus: 1,
  isSharingEnabled: 1, enableSharing: 1, disableSharing: 1, setBoardShare: 1, getAppUrl: 1,
  hasGeminiKey: 1, setGeminiKey: 1, aiAddCard: 1, aiSummarizeBoard: 1,
  searchWikimedia: 1, importTrelloBoard: 1
};

function handleApi_(e) {
  let fn, args, token;
  try {
    if (e && e.postData && e.postData.contents) {
      const body = JSON.parse(e.postData.contents);
      fn = body.fn; args = body.args || []; token = body.token;
    } else {
      const p = (e && e.parameter) || {};
      fn = p.fn; token = p.token; args = p.args ? JSON.parse(p.args) : [];
    }
  } catch (err) {
    return apiJson_({ error: 'bad request: ' + err });
  }
  if (!token || token !== PROP.getProperty('API_TOKEN')) {
    return apiJson_({ error: 'unauthorized' });
  }
  if (!API_ALLOWED[fn]) {
    return apiJson_({ error: 'unknown function: ' + fn });
  }
  try {
    const f = globalThis[fn];
    if (typeof f !== 'function') return apiJson_({ error: 'not callable: ' + fn });
    const result = f.apply(null, Array.isArray(args) ? args : []);
    return apiJson_({ ok: true, result: result });
  } catch (err) {
    return apiJson_({ error: String((err && err.message) || err) });
  }
}

function apiJson_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// 軽い疎通確認用（DBに触れず、窓口とトークンだけ確かめる）
function apiPing() {
  return { pong: true, when: new Date().toISOString() };
}

// 一度だけ実行：秘密トークンを生成して保存（ログに表示）
function setupApiToken() {
  let t = PROP.getProperty('API_TOKEN');
  if (!t) {
    t = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
    PROP.setProperty('API_TOKEN', t);
  }
  Logger.log('=== あなたの API_TOKEN ===');
  Logger.log(t);
  return t;
}

// Index.html から他ファイルを読み込むためのヘルパー
function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

/* ============================ DB helpers ============================ */

function getSS_() {
  const id = PROP.getProperty(SS_KEY);
  let ss = null;
  if (id) {
    // 「開けない（本当に消えた）」場合だけ新規作成する。
    // スキーマ更新の失敗で新DBを作ってしまうとデータを失うので、ここでは作らない。
    try { ss = SpreadsheetApp.openById(id); } catch (e) { ss = null; }
  }
  if (!ss) ss = createDB_();
  ensureSchema_(ss); // 旧バージョンのDBを自動アップグレード（失敗してもDBは作り直さない）
  return ss;
}

// 既存DBに Boards シート / Lists.boardId 列が無ければ追加して移行する
// 指定シートに列が無ければ末尾に追加し、既存行を defaultVal で埋める
function ensureColumn_(sheet, colName, defaultVal) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  if (headers.indexOf(colName) !== -1) return;
  const col = sheet.getLastColumn() + 1;
  sheet.getRange(1, col).setValue(colName);
  const n = sheet.getLastRow() - 1;
  if (n > 0) {
    const fill = [];
    for (let i = 0; i < n; i++) fill.push([defaultVal]);
    sheet.getRange(2, col, n, 1).setValues(fill);
  }
}

const SCHEMA_VERSION = '17';

function ensureSchema_(ss) {
  if (PROP.getProperty('SCHEMA_V') === SCHEMA_VERSION) return;

  let boards = ss.getSheetByName('Boards');
  let defaultBoardId = null;
  if (!boards) {
    boards = ss.insertSheet('Boards');
    boards.getRange(1, 1, 1, SCHEMA.Boards.length).setValues([SCHEMA.Boards]);
    boards.setFrozenRows(1);
    defaultBoardId = Utilities.getUuid();
    boards.appendRow([defaultBoardId, 'マイボード', 0, false, new Date().toISOString()]);
  }

  const lists = ss.getSheetByName('Lists');
  const headers = lists.getRange(1, 1, 1, lists.getLastColumn()).getValues()[0];
  if (headers.indexOf('boardId') === -1) {
    if (!defaultBoardId) {
      const bvals = boards.getDataRange().getValues();
      defaultBoardId = bvals.length > 1 ? bvals[1][0] : Utilities.getUuid();
      if (bvals.length <= 1) {
        boards.appendRow([defaultBoardId, 'マイボード', 0, false, new Date().toISOString()]);
      }
    }
    const col = lists.getLastColumn() + 1;
    lists.getRange(1, col).setValue('boardId');
    const n = lists.getLastRow() - 1;
    if (n > 0) {
      const fill = [];
      for (let i = 0; i < n; i++) fill.push([defaultBoardId]);
      lists.getRange(2, col, n, 1).setValues(fill);
    }
  }

  // Cards に attachments 列が無ければ追加
  const cards = ss.getSheetByName('Cards');
  const cHeaders = cards.getRange(1, 1, 1, cards.getLastColumn()).getValues()[0];
  if (cHeaders.indexOf('attachments') === -1) {
    const col = cards.getLastColumn() + 1;
    cards.getRange(1, col).setValue('attachments');
    const n = cards.getLastRow() - 1;
    if (n > 0) {
      const fill = [];
      for (let i = 0; i < n; i++) fill.push(['[]']);
      cards.getRange(2, col, n, 1).setValues(fill);
    }
  }

  // v4: 背景画像・開始日・終日フラグ
  ensureColumn_(ss.getSheetByName('Boards'), 'background', '');
  ensureColumn_(ss.getSheetByName('Cards'), 'start', '');
  ensureColumn_(ss.getSheetByName('Cards'), 'allDay', true);

  // v5: カード完了フラグ
  ensureColumn_(ss.getSheetByName('Cards'), 'done', false);

  // v6: 評価軸（旧 Ratings シート）＋ カードの評価値
  if (!ss.getSheetByName('Ratings') && !ss.getSheetByName('Fields')) {
    const r = ss.insertSheet('Ratings');
    r.getRange(1, 1, 1, 5).setValues([['id', 'name', 'style', 'max', 'position']]);
    r.setFrozenRows(1);
  }
  ensureColumn_(ss.getSheetByName('Cards'), 'ratings', '{}');

  // v8: ラベルをボードごとに（既存ラベルは boardId='' = 全ボード共通として残す）
  ensureColumn_(ss.getSheetByName('Labels'), 'boardId', '');

  // v9: カードカバー（色 or 画像）
  ensureColumn_(ss.getSheetByName('Cards'), 'cover', '');

  // v10: 保存テーブル（ビュー）。初回に既定ビューを2つ用意
  if (!ss.getSheetByName('Views')) {
    const v = ss.insertSheet('Views');
    v.getRange(1, 1, 1, SCHEMA.Views.length).setValues([SCHEMA.Views]);
    v.setFrozenRows(1);
    appendRows_(v, 'Views', [
      { id: Utilities.getUuid(), name: '今日やること', position: 0,
        config: JSON.stringify({ boards: [], due: 'todo', done: 'undone', sort: 'due' }) },
      { id: Utilities.getUuid(), name: '今後の予定', position: 1,
        config: JSON.stringify({ boards: [], due: 'has', done: 'undone', sort: 'due' }) }
    ]);
  }

  // v11: 自動化ルール
  if (!ss.getSheetByName('Automations')) {
    const a = ss.insertSheet('Automations');
    a.getRange(1, 1, 1, SCHEMA.Automations.length).setValues([SCHEMA.Automations]);
    a.setFrozenRows(1);
  }

  // v12: 繰り返しカード・テンプレ・共有
  if (!ss.getSheetByName('Recurring')) {
    const r = ss.insertSheet('Recurring');
    r.getRange(1, 1, 1, SCHEMA.Recurring.length).setValues([SCHEMA.Recurring]);
    r.setFrozenRows(1);
  }
  ensureColumn_(ss.getSheetByName('Cards'), 'template', false);
  ensureColumn_(ss.getSheetByName('Boards'), 'shareToken', '');

  // v13: WIPリミット
  ensureColumn_(ss.getSheetByName('Lists'), 'wip', 0);

  // v14: カードのリンク（YouTube等）
  ensureColumn_(ss.getSheetByName('Cards'), 'links', '[]');

  // v15: Google連携（カレンダー/タスクのID保持）
  ensureColumn_(ss.getSheetByName('Cards'), 'sync', '{}');

  // v16: 地図・場所
  ensureColumn_(ss.getSheetByName('Cards'), 'places', '[]');

  // v17: リストの折りたたみ
  ensureColumn_(ss.getSheetByName('Lists'), 'collapsed', false);

  // v7: 汎用カスタムフィールド（ボードごと）
  ensureColumn_(ss.getSheetByName('Cards'), 'fields', '{}');
  if (!ss.getSheetByName('Fields')) {
    const f = ss.insertSheet('Fields');
    f.getRange(1, 1, 1, SCHEMA.Fields.length).setValues([SCHEMA.Fields]);
    f.setFrozenRows(1);
    // 旧 Ratings を引き継ぐ（id を維持してカードの値も生かす）
    const oldR = ss.getSheetByName('Ratings');
    if (oldR && oldR.getLastRow() > 1) {
      const firstBoard = (sheetObjects_(ss.getSheetByName('Boards'))[0] || {}).id || '';
      const rows = sheetObjects_(oldR).map(function (r) {
        return {
          id: r.id, boardId: firstBoard, name: r.name, type: 'rating',
          config: JSON.stringify({ style: r.style || 'star', max: Number(r.max) || 5 }),
          position: Number(r.position) || 0, showFront: true
        };
      });
      appendRows_(f, 'Fields', rows);
      // カードの ratings 値を fields にコピー（id 一致のためそのまま）
      const cardsSh = ss.getSheetByName('Cards');
      const ch = cardsSh.getRange(1, 1, 1, cardsSh.getLastColumn()).getValues()[0];
      const ri = ch.indexOf('ratings'), fi = ch.indexOf('fields');
      const n = cardsSh.getLastRow() - 1;
      if (ri >= 0 && fi >= 0 && n > 0) {
        const rv = cardsSh.getRange(2, ri + 1, n, 1).getValues();
        const fv = cardsSh.getRange(2, fi + 1, n, 1).getValues();
        let changed = false;
        for (let i = 0; i < n; i++) {
          const f0 = fv[i][0];
          if ((f0 === '' || f0 === '{}') && rv[i][0] && rv[i][0] !== '{}') { fv[i][0] = rv[i][0]; changed = true; }
        }
        if (changed) cardsSh.getRange(2, fi + 1, n, 1).setValues(fv);
      }
    }
  }

  PROP.setProperty('SCHEMA_V', SCHEMA_VERSION);
}

function createDB_() {
  const ss = SpreadsheetApp.create('My Trello DB');
  PROP.setProperty(SS_KEY, ss.getId());

  // デフォルトの空シート(Sheet1)を後で消すため記録
  const first = ss.getSheets()[0];

  Object.keys(SCHEMA).forEach(function (name) {
    const sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, SCHEMA[name].length).setValues([SCHEMA[name]]);
    sh.setFrozenRows(1);
  });
  ss.deleteSheet(first);

  // シード（初期データ）
  const labels = ss.getSheetByName('Labels');
  DEFAULT_LABELS.forEach(function (l) {
    labels.appendRow([Utilities.getUuid(), l.name, l.color, '']); // boardId='' = 全ボード共通
  });

  const boardId = Utilities.getUuid();
  ss.getSheetByName('Boards')
    .appendRow([boardId, 'マイボード', 0, false, new Date().toISOString()]);

  const lists = ss.getSheetByName('Lists');
  ['ToDo', '進行中', '完了'].forEach(function (title, i) {
    lists.appendRow([Utilities.getUuid(), title, i, false, boardId]);
  });

  PROP.setProperty('SCHEMA_V', SCHEMA_VERSION);
  return ss;
}

function sheetObjects_(sh) {
  const values = sh.getDataRange().getValues();
  const headers = values.shift();
  return values.map(function (row) {
    const o = {};
    headers.forEach(function (h, i) { o[h] = row[i]; });
    return o;
  });
}

// id をキーに、対象行(1-based、ヘッダ含む)を返す。無ければ -1
function findRow_(sh, id) {
  const ids = sh.getRange(2, 1, Math.max(sh.getLastRow() - 1, 1), 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (ids[i][0] === id) return i + 2;
  }
  return -1;
}

function rowFromObject_(name, obj) {
  return SCHEMA[name].map(function (key) {
    const v = obj[key];
    return v === undefined || v === null ? '' : v;
  });
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); }
  finally { lock.releaseLock(); }
}

/* ============================ Read API ============================ */

// メタ情報（カード以外）を組み立てる。cards は空配列で返す。
function buildMeta_(ss) {
  const boards = sheetObjects_(ss.getSheetByName('Boards'));
  const lists  = sheetObjects_(ss.getSheetByName('Lists'));
  const labels = sheetObjects_(ss.getSheetByName('Labels'));
  const fields = sheetObjects_(ss.getSheetByName('Fields'));
  const views = sheetObjects_(ss.getSheetByName('Views'));
  const automations = sheetObjects_(ss.getSheetByName('Automations'));
  const recurring = sheetObjects_(ss.getSheetByName('Recurring'));

  recurring.forEach(function (r) { r.position = Number(r.position) || 0; });
  recurring.sort(function (a, b) { return a.position - b.position; });

  views.forEach(function (v) { v.config = parseJson_(v.config, {}); v.position = Number(v.position) || 0; });
  views.sort(function (a, b) { return a.position - b.position; });

  automations.forEach(function (a) { a.actions = parseJson_(a.actions, []); a.position = Number(a.position) || 0; });

  boards.forEach(function (b) { b.archived = b.archived === true || b.archived === 'TRUE'; b.position = Number(b.position) || 0; });
  boards.sort(function (a, b) { return a.position - b.position; });

  fields.forEach(function (f) {
    f.config = parseJson_(f.config, {});
    f.position = Number(f.position) || 0;
    f.showFront = !(f.showFront === false || f.showFront === 'FALSE');
  });
  fields.sort(function (a, b) { return a.position - b.position; });

  lists.forEach(function (l) {
    l.archived = l.archived === true || l.archived === 'TRUE';
    l.position = Number(l.position) || 0;
    l.wip = Number(l.wip) || 0;
    l.collapsed = l.collapsed === true || l.collapsed === 'TRUE';
  });
  lists.sort(function (a, b) { return a.position - b.position; });

  return { boards: boards, lists: lists, cards: [], labels: labels, fields: fields, views: views, automations: automations, recurring: recurring };
}

// 全データ（メタ＋全カード）。reloadや共有・互換用。
function getState() {
  const meta = buildMeta_(getSS_());
  meta.cards = getAllCards();
  return meta;
}

function parseJson_(v, fallback) {
  if (v === '' || v === null || v === undefined) return fallback;
  if (typeof v !== 'string') return fallback; // 非文字列(数値など)の異常セルは安全に既定値へ
  try { return JSON.parse(v); } catch (e) { return fallback; }
}

// 1枚のカード行を整形（getState/getCards/getAllCards 共通）
function parseCard_(c) {
  c.labels      = parseJson_(c.labels, []);
  c.checklist   = parseJson_(c.checklist, []);
  c.comments    = parseJson_(c.comments, []);
  c.attachments = parseJson_(c.attachments, []);
  c.archived    = c.archived === true || c.archived === 'TRUE';
  c.allDay      = !(c.allDay === false || c.allDay === 'FALSE');
  c.done        = c.done === true || c.done === 'TRUE';
  c.fields      = parseJson_(c.fields, {});
  c.cover       = parseJson_(c.cover, null);
  c.template    = c.template === true || c.template === 'TRUE';
  c.links       = parseJson_(c.links, []);
  c.sync        = parseJson_(c.sync, {});
  c.places      = parseJson_(c.places, []);
  c.start       = toYmd_(c.start);
  c.due         = toYmd_(c.due);
  c.position    = Number(c.position) || 0;
  return c;
}

/* ---- 遅延ロード用：メタ情報（カード以外）／ボード単位カード／全カード ---- */
function getMeta() {
  return buildMeta_(getSS_()); // カードは読まない（軽い）
}
function getCards(boardId) {
  const ss = getSS_();
  const listIds = sheetObjects_(ss.getSheetByName('Lists'))
    .filter(function (l) { return l.boardId === boardId; })
    .map(function (l) { return l.id; });
  const cards = sheetObjects_(ss.getSheetByName('Cards'))
    .filter(function (c) { return listIds.indexOf(c.listId) >= 0; });
  cards.forEach(parseCard_);
  cards.sort(function (a, b) { return a.position - b.position; });
  return cards;
}
function getAllCards() {
  const cards = sheetObjects_(getSS_().getSheetByName('Cards'));
  cards.forEach(parseCard_);
  cards.sort(function (a, b) { return a.position - b.position; });
  return cards;
}

// 初回ロード：メタ＋「指定（無効なら先頭）の板」のカードを1往復で返す
function getInitial(boardId) {
  const ss = getSS_();
  const meta = buildMeta_(ss);
  let bid = boardId;
  if (!bid || !meta.boards.some(function (b) { return b.id === bid; })) {
    const active = meta.boards.filter(function (b) { return !b.archived; });
    bid = active.length ? active[0].id : '';
  }
  if (bid) {
    const listIds = meta.lists.filter(function (l) { return l.boardId === bid; }).map(function (l) { return l.id; });
    const cards = sheetObjects_(ss.getSheetByName('Cards')).filter(function (c) { return listIds.indexOf(c.listId) >= 0; });
    cards.forEach(parseCard_);
    cards.sort(function (a, b) { return a.position - b.position; });
    meta.cards = cards;
  }
  meta.initialBoard = bid;
  return meta;
}

// 日付セルが Date 型でも文字列でも 'yyyy-MM-dd' に正規化
function toYmd_(v) {
  if (!v) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return String(v);
}

/* ============================ Board API ============================ */

function addBoard(title) {
  return withLock_(function () {
    const sh = getSS_().getSheetByName('Boards');
    const objs = sheetObjects_(sh);
    const maxPos = objs.reduce(function (m, o) { return Math.max(m, Number(o.position) || 0); }, -1);
    const board = {
      id: Utilities.getUuid(), title: title, position: maxPos + 1,
      archived: false, createdAt: new Date().toISOString()
    };
    sh.appendRow(rowFromObject_('Boards', board));
    return board;
  });
}

function renameBoard(id, title) {
  return withLock_(function () {
    const sh = getSS_().getSheetByName('Boards');
    const row = findRow_(sh, id);
    if (row > 0) sh.getRange(row, 2).setValue(title);
    return true;
  });
}

function archiveBoard(id, archived) {
  return withLock_(function () {
    const sh = getSS_().getSheetByName('Boards');
    const row = findRow_(sh, id);
    if (row < 0) return false;
    const colIndex = {};
    SCHEMA.Boards.forEach(function (k, i) { colIndex[k] = i + 1; });
    sh.getRange(row, colIndex['archived']).setValue(!!archived);
    return true;
  });
}

// ボードと、その中のリスト・カードをすべて削除
function deleteBoard(id) {
  return withLock_(function () {
    const ss = getSS_();
    const bsh = ss.getSheetByName('Boards');
    const brow = findRow_(bsh, id);
    if (brow > 0) bsh.deleteRow(brow);

    const lsh = ss.getSheetByName('Lists');
    const lists = sheetObjects_(lsh);
    const listIds = lists.filter(function (l) { return l.boardId === id; })
                         .map(function (l) { return l.id; });
    for (let i = lists.length - 1; i >= 0; i--) {
      if (lists[i].boardId === id) lsh.deleteRow(i + 2);
    }

    const csh = ss.getSheetByName('Cards');
    const cards = sheetObjects_(csh);
    for (let i = cards.length - 1; i >= 0; i--) {
      if (listIds.indexOf(cards[i].listId) >= 0) { trashAttachmentsJson_(cards[i].attachments); csh.deleteRow(i + 2); }
    }
    return true;
  });
}

function saveBoardOrder(orderedIds) {
  return withLock_(function () {
    const sh = getSS_().getSheetByName('Boards');
    orderedIds.forEach(function (id, idx) {
      const row = findRow_(sh, id);
      if (row > 0) sh.getRange(row, 3).setValue(idx);
    });
    return true;
  });
}

// ボードの背景画像URL（空文字で標準に戻す）
function setBoardBackground(boardId, url) {
  return withLock_(function () {
    const sh = getSS_().getSheetByName('Boards');
    const row = findRow_(sh, boardId);
    if (row < 0) return false;
    const colIndex = {};
    SCHEMA.Boards.forEach(function (k, i) { colIndex[k] = i + 1; });
    sh.getRange(row, colIndex['background']).setValue(url || '');
    return true;
  });
}

/* ====================== 背景画像検索 (Wikimedia Commons) ====================== */

// Wikimedia Commons から画像を検索（自由ライセンスの画像群）
function searchWikimedia(query) {
  const url = 'https://commons.wikimedia.org/w/api.php'
    + '?action=query&format=json&generator=search'
    + '&gsrsearch=' + encodeURIComponent(query + ' filetype:bitmap')
    + '&gsrnamespace=6&gsrlimit=24'
    + '&prop=imageinfo&iiprop=' + encodeURIComponent('url|mime') + '&iiurlwidth=500';
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) return [];
  const data = JSON.parse(res.getContentText());
  const pages = (data.query && data.query.pages) ? data.query.pages : {};
  const out = [];
  Object.keys(pages).forEach(function (k) {
    const p = pages[k];
    const ii = p.imageinfo && p.imageinfo[0];
    if (ii && ii.thumburl && /^image\//.test(ii.mime || '')) {
      out.push({ title: String(p.title || '').replace(/^File:/, ''), thumb: ii.thumburl, full: ii.url });
    }
  });
  return out;
}

/* ============================ List API ============================ */

function addList(boardId, title) {
  return withLock_(function () {
    const ss = getSS_();
    const sh = ss.getSheetByName('Lists');
    const objs = sheetObjects_(sh).filter(function (l) { return l.boardId === boardId; });
    const maxPos = objs.reduce(function (m, o) { return Math.max(m, Number(o.position) || 0); }, -1);
    const list = { id: Utilities.getUuid(), title: title, position: maxPos + 1, archived: false, boardId: boardId };
    sh.appendRow(rowFromObject_('Lists', list));
    return list;
  });
}

function renameList(id, title) {
  return withLock_(function () {
    const sh = getSS_().getSheetByName('Lists');
    const row = findRow_(sh, id);
    if (row > 0) sh.getRange(row, 2).setValue(title);
    return true;
  });
}

function deleteList(id) {
  return withLock_(function () {
    const ss = getSS_();
    const sh = ss.getSheetByName('Lists');
    const row = findRow_(sh, id);
    if (row > 0) sh.deleteRow(row);
    // 中のカードも削除（添付ファイルも処分）
    const cardSh = ss.getSheetByName('Cards');
    const cards = sheetObjects_(cardSh);
    for (let i = cards.length - 1; i >= 0; i--) {
      if (cards[i].listId === id) { trashAttachmentsJson_(cards[i].attachments); cardSh.deleteRow(i + 2); }
    }
    return true;
  });
}

function saveListOrder(orderedIds) {
  return withLock_(function () {
    const sh = getSS_().getSheetByName('Lists');
    orderedIds.forEach(function (id, idx) {
      const row = findRow_(sh, id);
      if (row > 0) sh.getRange(row, 3).setValue(idx);
    });
    return true;
  });
}

/* ============================ Card API ============================ */

function addCard(listId, title) {
  return withLock_(function () {
    const sh = getSS_().getSheetByName('Cards');
    const objs = sheetObjects_(sh).filter(function (c) { return c.listId === listId; });
    const maxPos = objs.reduce(function (m, o) { return Math.max(m, Number(o.position) || 0); }, -1);
    const now = new Date().toISOString();
    const card = {
      id: Utilities.getUuid(), listId: listId, title: title, desc: '',
      position: maxPos + 1, labels: '[]', due: '', checklist: '[]',
      comments: '[]', createdAt: now, updatedAt: now, archived: false,
      attachments: '[]', start: '', allDay: true, done: false, ratings: '{}', fields: '{}', cover: '', template: false, links: '[]', sync: '{}', places: '[]'
    };
    sh.appendRow(rowFromObject_('Cards', card));
    return card;
  });
}

// 部分更新。fields は {title, desc, due, labels[], checklist[], comments[]} の一部
function updateCard(id, fields) {
  return withLock_(function () {
    const sh = getSS_().getSheetByName('Cards');
    const row = findRow_(sh, id);
    if (row < 0) return false;
    const colIndex = {};
    SCHEMA.Cards.forEach(function (k, i) { colIndex[k] = i + 1; });

    ['title', 'desc', 'due', 'start', 'allDay', 'done', 'archived', 'template'].forEach(function (k) {
      if (fields[k] !== undefined) sh.getRange(row, colIndex[k]).setValue(fields[k]);
    });
    ['labels', 'checklist', 'comments', 'fields', 'cover', 'links', 'places'].forEach(function (k) {
      if (fields[k] !== undefined) {
        sh.getRange(row, colIndex[k]).setValue(JSON.stringify(fields[k]));
      }
    });
    sh.getRange(row, colIndex['updatedAt']).setValue(new Date().toISOString());
    return true;
  });
}

// 添付ファイル(JSON文字列)に含まれるDriveファイルをゴミ箱へ
function trashAttachmentsJson_(attJson) {
  parseJson_(attJson, []).forEach(function (a) {
    if (a && a.fileId) { try { DriveApp.getFileById(a.fileId).setTrashed(true); } catch (e) {} }
  });
}

function deleteCard(id) {
  return withLock_(function () {
    const sh = getSS_().getSheetByName('Cards');
    const colIndex = {}; SCHEMA.Cards.forEach(function (k, i) { colIndex[k] = i + 1; });
    const row = findRow_(sh, id);
    if (row > 0) {
      trashAttachmentsJson_(sh.getRange(row, colIndex['attachments']).getValue());
      sh.deleteRow(row);
    }
    return true;
  });
}

// リスト内のカードの並び順を orderedIds の順に確定（並べ替え用）
function saveCardOrder(orderedIds) {
  return withLock_(function () {
    const sh = getSS_().getSheetByName('Cards');
    orderedIds.forEach(function (id, idx) {
      const row = findRow_(sh, id);
      if (row > 0) sh.getRange(row, 5).setValue(idx); // position は5列目
    });
    return true;
  });
}

// カードを toListId へ移動し、その移動先リストの並びを orderedIds の順に確定
function moveCard(cardId, toListId, orderedIds) {
  return withLock_(function () {
    const sh = getSS_().getSheetByName('Cards');
    // 移動カードの listId 更新
    const cardRow = findRow_(sh, cardId);
    if (cardRow > 0) sh.getRange(cardRow, 2).setValue(toListId);
    // 移動先リストの position 再採番
    orderedIds.forEach(function (id, idx) {
      const row = findRow_(sh, id);
      if (row > 0) sh.getRange(row, 5).setValue(idx);
    });
    return true;
  });
}

// カードを別リスト/別ボードへ移動（移動先リストの末尾へ）
function moveCardToList(cardId, toListId) {
  return withLock_(function () {
    const sh = getSS_().getSheetByName('Cards');
    const row = findRow_(sh, cardId);
    if (row < 0) return false;
    const colIndex = {};
    SCHEMA.Cards.forEach(function (k, i) { colIndex[k] = i + 1; });
    const maxPos = sheetObjects_(sh)
      .filter(function (c) { return c.listId === toListId; })
      .reduce(function (m, o) { return Math.max(m, Number(o.position) || 0); }, -1);
    sh.getRange(row, colIndex['listId']).setValue(toListId);
    sh.getRange(row, colIndex['position']).setValue(maxPos + 1);
    return true;
  });
}

// カードを複製（同じリストの末尾へ。コメント/添付は引き継がない）
function copyCard(cardId) {
  return withLock_(function () {
    const sh = getSS_().getSheetByName('Cards');
    const row = findRow_(sh, cardId);
    if (row < 0) return null;
    const vals = sh.getRange(row, 1, 1, SCHEMA.Cards.length).getValues()[0];
    const o = {};
    SCHEMA.Cards.forEach(function (k, i) { o[k] = vals[i]; });

    const now = new Date().toISOString();
    const maxPos = sheetObjects_(sh)
      .filter(function (c) { return c.listId === o.listId; })
      .reduce(function (m, p) { return Math.max(m, Number(p.position) || 0); }, -1);
    o.id = Utilities.getUuid();
    o.position = maxPos + 1;
    o.comments = '[]';
    o.attachments = '[]';
    o.done = false;
    o.archived = false;
    o.template = false; // 複製したものはテンプレートにしない
    o.sync = '{}';      // 複製は連携を引き継がない
    o.createdAt = now;
    o.updatedAt = now;
    sh.appendRow(rowFromObject_('Cards', o));

    // クライアント用に整形して返す
    o.labels = parseJson_(o.labels, []);
    o.checklist = parseJson_(o.checklist, []);
    o.comments = [];
    o.attachments = [];
    o.fields = parseJson_(o.fields, {});
    o.cover = parseJson_(o.cover, null);
    o.allDay = !(o.allDay === false || o.allDay === 'FALSE');
    o.start = toYmd_(o.start);
    o.due = toYmd_(o.due);
    o.position = Number(o.position) || 0;
    return o;
  });
}

/* ========================= 期限リマインダー（メール） ========================= */

function isReminderOn() {
  return PROP.getProperty('REMINDER_ON') === '1';
}

function enableReminders(hour) {
  const h = (hour === undefined || hour === null) ? 7 : Number(hour);
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sendDueReminders') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sendDueReminders').timeBased().everyDays(1).atHour(h).create();
  PROP.setProperty('REMINDER_ON', '1');
  PROP.setProperty('REMINDER_HOUR', String(h));
  return Session.getEffectiveUser().getEmail();
}

function disableReminders() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sendDueReminders') ScriptApp.deleteTrigger(t);
  });
  PROP.setProperty('REMINDER_ON', '0');
  return true;
}

// 期限が近い/過ぎた未完了カードをメールで通知（force=true で該当なしでも送る＝テスト用）
function sendDueReminders(force) {
  const ss = getSS_();
  const lists = sheetObjects_(ss.getSheetByName('Lists'));
  const boards = sheetObjects_(ss.getSheetByName('Boards'));
  const cards = sheetObjects_(ss.getSheetByName('Cards'));
  const listMap = {}; lists.forEach(function (l) { listMap[l.id] = l; });
  const boardMap = {}; boards.forEach(function (b) { boardMap[b.id] = b; });

  const todayStr = toYmd_(new Date());
  const soonStr = toYmd_(new Date(Date.now() + 3 * 86400000));
  const overdue = [], dueToday = [], dueSoon = [];

  cards.forEach(function (c) {
    if (c.archived === true || c.archived === 'TRUE') return;
    if (c.done === true || c.done === 'TRUE') return;
    const due = toYmd_(c.due) || toYmd_(c.start);
    if (!due) return;
    const list = listMap[c.listId];
    if (!list || list.archived === true || list.archived === 'TRUE') return;
    const board = boardMap[list.boardId];
    if (board && (board.archived === true || board.archived === 'TRUE')) return;
    const e = { title: c.title, board: board ? board.title : '', list: list.title, due: due };
    if (due < todayStr) overdue.push(e);
    else if (due === todayStr) dueToday.push(e);
    else if (due <= soonStr) dueSoon.push(e);
  });

  const total = overdue.length + dueToday.length + dueSoon.length;
  // 自動実行(force≠true)で該当なしなら送らない。手動テスト(force===true)は必ず送る。
  if (!total && force !== true) return 0;

  function sec(title, arr) {
    if (!arr.length) return '';
    arr.sort(function (a, b) { return a.due < b.due ? -1 : 1; });
    let s = '■ ' + title + '\n';
    arr.forEach(function (e) { s += '  ・[' + e.board + ' / ' + e.list + '] ' + e.title + '（' + e.due + '）\n'; });
    return s + '\n';
  }
  let body = 'My Board 期限リマインダー（' + todayStr + '）\n\n';
  if (!total) body += '期限の近いカードはありません。\n';
  body += sec('🔴 期限切れ', overdue);
  body += sec('🟡 今日が期限', dueToday);
  body += sec('🟢 まもなく期限（3日以内）', dueSoon);

  const email = Session.getEffectiveUser().getEmail();
  MailApp.sendEmail(email, '【My Board】期限リマインダー (' + todayStr + ')', body);
  return total;
}

/* ============================ List操作（複製・一括アーカイブ） ============================ */

// リストを中のカードごと複製
function copyList(listId) {
  return withLock_(function () {
    const ss = getSS_();
    const lsh = ss.getSheetByName('Lists');
    const lrow = findRow_(lsh, listId);
    if (lrow < 0) return false;
    const lvals = lsh.getRange(lrow, 1, 1, SCHEMA.Lists.length).getValues()[0];
    const lo = {}; SCHEMA.Lists.forEach(function (k, i) { lo[k] = lvals[i]; });

    const newListId = Utilities.getUuid();
    const maxPos = sheetObjects_(lsh).filter(function (l) { return l.boardId === lo.boardId; })
      .reduce(function (m, o) { return Math.max(m, Number(o.position) || 0); }, -1);
    lsh.appendRow(rowFromObject_('Lists', {
      id: newListId, title: (lo.title || '') + ' のコピー', position: maxPos + 1, archived: false, boardId: lo.boardId
    }));

    const csh = ss.getSheetByName('Cards');
    const now = new Date().toISOString();
    const cards = sheetObjects_(csh)
      .filter(function (c) { return c.listId === listId && !(c.archived === true || c.archived === 'TRUE'); })
      .sort(function (a, b) { return (Number(a.position) || 0) - (Number(b.position) || 0); });
    const rows = cards.map(function (c, idx) {
      const o = {}; SCHEMA.Cards.forEach(function (k) { o[k] = c[k]; });
      o.id = Utilities.getUuid(); o.listId = newListId; o.position = idx;
      o.comments = '[]'; o.attachments = '[]'; o.createdAt = now; o.updatedAt = now;
      return o;
    });
    appendRows_(csh, 'Cards', rows);
    return true;
  });
}

// リストをアーカイブ/復元（archived フラグ）
function archiveList(listId, archived) {
  return withLock_(function () {
    const sh = getSS_().getSheetByName('Lists');
    const row = findRow_(sh, listId);
    if (row < 0) return false;
    const colIndex = {}; SCHEMA.Lists.forEach(function (k, i) { colIndex[k] = i + 1; });
    sh.getRange(row, colIndex['archived']).setValue(!!archived);
    return true;
  });
}

// リストの折りたたみ状態を保存
function setListCollapsed(listId, collapsed) {
  return withLock_(function () {
    const sh = getSS_().getSheetByName('Lists');
    const row = findRow_(sh, listId);
    if (row < 0) return false;
    const colIndex = {}; SCHEMA.Lists.forEach(function (k, i) { colIndex[k] = i + 1; });
    sh.getRange(row, colIndex['collapsed']).setValue(!!collapsed);
    return true;
  });
}

// ボードの全リストをまとめて折りたたみ/展開
function setAllListsCollapsed(boardId, collapsed) {
  return withLock_(function () {
    const sh = getSS_().getSheetByName('Lists');
    const colIndex = {}; SCHEMA.Lists.forEach(function (k, i) { colIndex[k] = i + 1; });
    sheetObjects_(sh).forEach(function (l, i) {
      if (l.boardId === boardId && !(l.archived === true || l.archived === 'TRUE')) {
        sh.getRange(i + 2, colIndex['collapsed']).setValue(!!collapsed);
      }
    });
    return true;
  });
}

// WIP上限を設定（0で無制限）
function setListWip(listId, wip) {
  return withLock_(function () {
    const sh = getSS_().getSheetByName('Lists');
    const row = findRow_(sh, listId);
    if (row < 0) return false;
    const colIndex = {}; SCHEMA.Lists.forEach(function (k, i) { colIndex[k] = i + 1; });
    sh.getRange(row, colIndex['wip']).setValue(Number(wip) || 0);
    return true;
  });
}

// リスト内の全カードをアーカイブ
function archiveAllCards(listId) {
  return withLock_(function () {
    const sh = getSS_().getSheetByName('Cards');
    const colIndex = {}; SCHEMA.Cards.forEach(function (k, i) { colIndex[k] = i + 1; });
    const cards = sheetObjects_(sh);
    cards.forEach(function (c, i) {
      if (c.listId === listId && !(c.archived === true || c.archived === 'TRUE')) {
        sh.getRange(i + 2, colIndex['archived']).setValue(true);
      }
    });
    return true;
  });
}

/* ============================ Recurring API（繰り返しカード） ============================ */

function addRecurring(boardId, listId, title, freq) {
  return withLock_(function () {
    const sh = getSS_().getSheetByName('Recurring');
    const objs = sheetObjects_(sh);
    const maxPos = objs.reduce(function (m, o) { return Math.max(m, Number(o.position) || 0); }, -1);
    const rule = {
      id: Utilities.getUuid(), boardId: boardId, listId: listId,
      title: title, freq: freq || 'weekly', lastRun: '', position: maxPos + 1
    };
    sh.appendRow(rowFromObject_('Recurring', rule));
    ensureRecurringTrigger_();
    return rule;
  });
}

function deleteRecurring(id) {
  return withLock_(function () {
    const sh = getSS_().getSheetByName('Recurring');
    const row = findRow_(sh, id);
    if (row > 0) sh.deleteRow(row);
    return true;
  });
}

function ensureRecurringTrigger_() {
  const has = ScriptApp.getProjectTriggers().some(function (t) {
    return t.getHandlerFunction() === 'runRecurring';
  });
  if (!has) ScriptApp.newTrigger('runRecurring').timeBased().everyDays(1).atHour(1).create();
}

function daysDiff_(a, b) {
  return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
}

// 毎日1回トリガーで実行：期日が来た繰り返しカードを生成
function runRecurring() {
  const ss = getSS_();
  const sh = ss.getSheetByName('Recurring');
  const cardsSh = ss.getSheetByName('Cards');
  const rules = sheetObjects_(sh);
  const today = toYmd_(new Date());
  const colIndex = {}; SCHEMA.Recurring.forEach(function (k, i) { colIndex[k] = i + 1; });

  rules.forEach(function (r) {
    const last = r.lastRun ? toYmd_(r.lastRun) : '';
    if (last === today) return;
    let due = false;
    if (r.freq === 'daily') due = true;
    else if (r.freq === 'weekly') due = !last || daysDiff_(last, today) >= 7;
    else if (r.freq === 'monthly') due = !last || daysDiff_(last, today) >= 28;
    if (!due) return;

    const now = new Date().toISOString();
    const maxPos = sheetObjects_(cardsSh)
      .filter(function (c) { return c.listId === r.listId; })
      .reduce(function (m, o) { return Math.max(m, Number(o.position) || 0); }, -1);
    const card = {
      id: Utilities.getUuid(), listId: r.listId, title: r.title, desc: '', position: maxPos + 1,
      labels: '[]', due: '', checklist: '[]', comments: '[]', createdAt: now, updatedAt: now,
      archived: false, attachments: '[]', start: '', allDay: true, done: false,
      ratings: '{}', fields: '{}', cover: '', template: false
    };
    cardsSh.appendRow(rowFromObject_('Cards', card));
    const row = findRow_(sh, r.id);
    if (row > 0) sh.getRange(row, colIndex['lastRun']).setValue(today);
  });
}

/* ============================ 共有（読み取り専用） ============================ */

// このウェブアプリの公開URL（共有リンクの土台に使う）
function getAppUrl() { return ScriptApp.getService().getUrl(); }

function isSharingEnabled() { return PROP.getProperty('SHARE_ENABLED') === '1'; }
function enableSharing() { PROP.setProperty('SHARE_ENABLED', '1'); return true; }
function disableSharing() { PROP.setProperty('SHARE_ENABLED', '0'); return true; }

// ボードの共有トークンを発行/解除。enabled=trueでトークン返却、falseで空に
function setBoardShare(boardId, enabled) {
  return withLock_(function () {
    const sh = getSS_().getSheetByName('Boards');
    const row = findRow_(sh, boardId);
    if (row < 0) return '';
    const colIndex = {}; SCHEMA.Boards.forEach(function (k, i) { colIndex[k] = i + 1; });
    const token = enabled ? Utilities.getUuid().replace(/-/g, '') : '';
    sh.getRange(row, colIndex['shareToken']).setValue(token);
    return token;
  });
}

function htmlEsc_(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// 共有リンク用の読み取り専用ボードHTML（トークン照合）
function renderSharedBoard_(boardId, token) {
  const ss = getSS_();
  const board = sheetObjects_(ss.getSheetByName('Boards')).filter(function (b) { return b.id === boardId; })[0];
  if (!board || !board.shareToken || String(board.shareToken) !== String(token)) {
    return HtmlService.createHtmlOutput('<div style="font-family:sans-serif;padding:40px;color:#444">このリンクは無効です。</div>');
  }
  const lists = sheetObjects_(ss.getSheetByName('Lists'))
    .filter(function (l) { return l.boardId === boardId && !(l.archived === true || l.archived === 'TRUE'); })
    .sort(function (a, b) { return (Number(a.position) || 0) - (Number(b.position) || 0); });
  const labelMap = {}; sheetObjects_(ss.getSheetByName('Labels')).forEach(function (l) { labelMap[l.id] = l; });
  const cards = sheetObjects_(ss.getSheetByName('Cards'))
    .filter(function (c) { return !(c.archived === true || c.archived === 'TRUE'); })
    .sort(function (a, b) { return (Number(a.position) || 0) - (Number(b.position) || 0); });

  let html = '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<title>' + htmlEsc_(board.title) + '（共有）</title><style>'
    + 'body{margin:0;font-family:-apple-system,"Segoe UI","Noto Sans JP",sans-serif;background:linear-gradient(135deg,#0079bf,#5e4db2);color:#172b4d;}'
    + 'header{padding:12px 16px;color:#fff;font-weight:700;font-size:18px;background:rgba(0,0,0,.15)}'
    + '.ro-note{font-size:12px;font-weight:400;opacity:.85}'
    + 'main{display:flex;gap:12px;padding:14px;overflow-x:auto;align-items:flex-start}'
    + '.list{background:#f1f2f4;border-radius:10px;width:280px;flex:0 0 280px;padding:8px}'
    + '.list h2{font-size:14px;margin:6px 8px}'
    + '.card{background:#fff;border-radius:8px;padding:8px 10px;margin:6px 0;box-shadow:0 1px 0 rgba(9,30,66,.25);font-size:14px}'
    + '.chips{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:5px}'
    + '.chip{font-size:11px;font-weight:700;border-radius:4px;padding:2px 8px;color:#fff}'
    + '.due{display:inline-block;margin-top:5px;font-size:12px;background:#091e420a;border-radius:4px;padding:1px 6px}'
    + '.done{text-decoration:line-through;opacity:.6}'
    + '</style></head><body>'
    + '<header>📋 ' + htmlEsc_(board.title) + ' <span class="ro-note">（読み取り専用の共有ビュー）</span></header><main>';

  lists.forEach(function (l) {
    html += '<div class="list"><h2>' + htmlEsc_(l.title) + '</h2>';
    cards.filter(function (c) { return c.listId === l.id; }).forEach(function (c) {
      const labels = parseJson_(c.labels, []);
      const done = (c.done === true || c.done === 'TRUE');
      html += '<div class="card' + (done ? ' done' : '') + '">';
      if (labels.length) {
        html += '<div class="chips">';
        labels.forEach(function (id) { const lb = labelMap[id]; if (lb) html += '<span class="chip" style="background:' + htmlEsc_(lb.color) + '">' + htmlEsc_(lb.name) + '</span>'; });
        html += '</div>';
      }
      html += htmlEsc_(c.title);
      const due = toYmd_(c.due) || toYmd_(c.start);
      if (due) html += '<div class="due">🕑 ' + htmlEsc_(due) + '</div>';
      html += '</div>';
    });
    html += '</div>';
  });
  html += '</main></body></html>';
  return HtmlService.createHtmlOutput(html).setTitle(board.title + '（共有）')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/* ============================ Automation API ============================ */

function addAutomation(boardId, triggerList, actions) {
  return withLock_(function () {
    const sh = getSS_().getSheetByName('Automations');
    const objs = sheetObjects_(sh);
    const maxPos = objs.reduce(function (m, o) { return Math.max(m, Number(o.position) || 0); }, -1);
    const rule = {
      id: Utilities.getUuid(), boardId: boardId, triggerList: triggerList,
      actions: JSON.stringify(actions || []), position: maxPos + 1
    };
    sh.appendRow(rowFromObject_('Automations', rule));
    rule.actions = actions || [];
    return rule;
  });
}

function deleteAutomation(id) {
  return withLock_(function () {
    const sh = getSS_().getSheetByName('Automations');
    const row = findRow_(sh, id);
    if (row > 0) sh.deleteRow(row);
    return true;
  });
}

/* ============================ View API（保存テーブル） ============================ */

function addView(name, config) {
  return withLock_(function () {
    const sh = getSS_().getSheetByName('Views');
    const objs = sheetObjects_(sh);
    const maxPos = objs.reduce(function (m, o) { return Math.max(m, Number(o.position) || 0); }, -1);
    const view = {
      id: Utilities.getUuid(), name: name,
      config: JSON.stringify(config || {}), position: maxPos + 1
    };
    sh.appendRow(rowFromObject_('Views', view));
    view.config = config || {};
    return view;
  });
}

function updateView(id, patch) {
  return withLock_(function () {
    const sh = getSS_().getSheetByName('Views');
    const row = findRow_(sh, id);
    if (row < 0) return false;
    const colIndex = {};
    SCHEMA.Views.forEach(function (k, i) { colIndex[k] = i + 1; });
    if (patch.name !== undefined) sh.getRange(row, colIndex['name']).setValue(patch.name);
    if (patch.config !== undefined) sh.getRange(row, colIndex['config']).setValue(JSON.stringify(patch.config));
    return true;
  });
}

function deleteView(id) {
  return withLock_(function () {
    const sh = getSS_().getSheetByName('Views');
    const row = findRow_(sh, id);
    if (row > 0) sh.deleteRow(row);
    return true;
  });
}

/* ============================ Label API ============================ */

function addLabel(boardId, name, color) {
  return withLock_(function () {
    const sh = getSS_().getSheetByName('Labels');
    const label = { id: Utilities.getUuid(), boardId: boardId || '', name: name, color: color };
    sh.appendRow(rowFromObject_('Labels', label));
    return label;
  });
}

function deleteLabel(id) {
  return withLock_(function () {
    const sh = getSS_().getSheetByName('Labels');
    const row = findRow_(sh, id);
    if (row > 0) sh.deleteRow(row);
    return true;
  });
}

/* ========================= Attachment API ========================= */

// 添付ファイル保存用のドライブフォルダを取得（無ければ作成）
function getAttachFolder_() {
  const key = 'ATTACH_FOLDER_ID';
  const id = PROP.getProperty(key);
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (e) { /* 消えていたら再作成 */ }
  }
  const folder = DriveApp.createFolder('My Trello Attachments');
  PROP.setProperty(key, folder.getId());
  return folder;
}

/* --- Drive 直結アップロード（大きいファイル・動画用） --- */

// クライアントが直接 Drive にアップロードするための一時トークン
function getOAuthToken() {
  return ScriptApp.getOAuthToken();
}

// 添付保存フォルダのID（クライアントが parents 指定に使う）
function getAttachFolderId() {
  return getAttachFolder_().getId();
}

// クライアントが Drive に上げ終えたファイルのメタ情報をカードに紐付ける
function addAttachmentMeta(cardId, fileName, mimeType, fileId) {
  return withLock_(function () {
    const att = {
      id: Utilities.getUuid(),
      name: fileName,
      mimeType: mimeType || '',
      fileId: fileId,
      url: 'https://drive.google.com/file/d/' + fileId + '/view',
      createdAt: new Date().toISOString()
    };
    const sh = getSS_().getSheetByName('Cards');
    const row = findRow_(sh, cardId);
    if (row < 0) return null;
    const colIndex = {};
    SCHEMA.Cards.forEach(function (k, i) { colIndex[k] = i + 1; });
    const cur = parseJson_(sh.getRange(row, colIndex['attachments']).getValue(), []);
    cur.push(att);
    sh.getRange(row, colIndex['attachments']).setValue(JSON.stringify(cur));
    sh.getRange(row, colIndex['updatedAt']).setValue(new Date().toISOString());
    return att;
  });
}

// クライアントから base64 で受け取ったファイルをドライブに保存し、カードに紐付ける（小さいファイル用・予備）
function uploadAttachment(cardId, fileName, mimeType, base64) {
  return withLock_(function () {
    const folder = getAttachFolder_();
    const bytes = Utilities.base64Decode(base64);
    const blob = Utilities.newBlob(bytes, mimeType || 'application/octet-stream', fileName);
    const file = folder.createFile(blob);

    const att = {
      id: Utilities.getUuid(),
      name: fileName,
      mimeType: mimeType || '',
      fileId: file.getId(),
      url: 'https://drive.google.com/file/d/' + file.getId() + '/view',
      createdAt: new Date().toISOString()
    };

    const sh = getSS_().getSheetByName('Cards');
    const row = findRow_(sh, cardId);
    if (row < 0) return null;
    const colIndex = {};
    SCHEMA.Cards.forEach(function (k, i) { colIndex[k] = i + 1; });
    const cur = parseJson_(sh.getRange(row, colIndex['attachments']).getValue(), []);
    cur.push(att);
    sh.getRange(row, colIndex['attachments']).setValue(JSON.stringify(cur));
    sh.getRange(row, colIndex['updatedAt']).setValue(new Date().toISOString());
    return att;
  });
}

function deleteAttachment(cardId, attId) {
  return withLock_(function () {
    const sh = getSS_().getSheetByName('Cards');
    const row = findRow_(sh, cardId);
    if (row < 0) return false;
    const colIndex = {};
    SCHEMA.Cards.forEach(function (k, i) { colIndex[k] = i + 1; });
    let cur = parseJson_(sh.getRange(row, colIndex['attachments']).getValue(), []);
    const target = cur.filter(function (a) { return a.id === attId; })[0];
    cur = cur.filter(function (a) { return a.id !== attId; });
    sh.getRange(row, colIndex['attachments']).setValue(JSON.stringify(cur));
    if (target && target.fileId) {
      try { DriveApp.getFileById(target.fileId).setTrashed(true); } catch (e) {}
    }
    return true;
  });
}

/* ========================= Trello インポート ========================= */

// 複数行をまとめて追記（速い）
function appendRows_(sheet, name, objs) {
  if (!objs.length) return;
  const rows = objs.map(function (o) { return rowFromObject_(name, o); });
  const startRow = sheet.getLastRow() + 1;
  sheet.getRange(startRow, 1, rows.length, SCHEMA[name].length).setValues(rows);
}

function trelloColorHex_(c) {
  const m = {
    green: '#61bd4f', yellow: '#f2d600', orange: '#ff9f1a', red: '#eb5a46',
    purple: '#c377e0', blue: '#0079bf', sky: '#00c2e0', lime: '#51e898',
    pink: '#ff78cb', black: '#344563'
  };
  if (!c) return '#b3bac5';
  const base = String(c).replace(/_(light|dark)$/, '');
  return m[base] || '#b3bac5';
}

// Trello の JSON(必要部分のみに整形済み)を取り込み、新しいボードとして作成
function importTrelloBoard(jsonText) {
  return withLock_(function () {
    const data = JSON.parse(jsonText);
    const ss = getSS_();
    const now = new Date().toISOString();

    // 1) ボード
    const boardId = Utilities.getUuid();
    const boardsSh = ss.getSheetByName('Boards');
    const maxPos = sheetObjects_(boardsSh)
      .reduce(function (m, o) { return Math.max(m, Number(o.position) || 0); }, -1);
    const boardTitle = data.name || 'インポートしたボード';
    appendRows_(boardsSh, 'Boards', [{
      id: boardId, title: boardTitle, position: maxPos + 1,
      archived: false, createdAt: now, background: ''
    }]);

    // 2) ラベル
    const labelMap = {};
    const labelRows = [];
    (data.labels || []).forEach(function (l) {
      const id = Utilities.getUuid();
      labelMap[l.id] = id;
      labelRows.push({ id: id, boardId: boardId, name: l.name || 'ラベル', color: trelloColorHex_(l.color) });
    });
    appendRows_(ss.getSheetByName('Labels'), 'Labels', labelRows);

    // 3) リスト
    const listMap = {};
    const lists = (data.lists || [])
      .filter(function (l) { return !l.closed; })
      .sort(function (a, b) { return (a.pos || 0) - (b.pos || 0); });
    const listRows = lists.map(function (l, idx) {
      const id = Utilities.getUuid();
      listMap[l.id] = id;
      return { id: id, title: l.name || '(無題)', position: idx, archived: false, boardId: boardId };
    });
    appendRows_(ss.getSheetByName('Lists'), 'Lists', listRows);

    // チェックリスト（カードごとに統合）
    const checklistByCard = {};
    (data.checklists || []).forEach(function (cl) {
      const items = (cl.checkItems || [])
        .sort(function (a, b) { return (a.pos || 0) - (b.pos || 0); })
        .map(function (ci) { return { text: ci.name, done: ci.state === 'complete' }; });
      checklistByCard[cl.idCard] = (checklistByCard[cl.idCard] || []).concat(items);
    });

    // コメント（commentCard アクションから）
    const commentsByCard = {};
    (data.actions || []).forEach(function (a) {
      if (a.type === 'commentCard' && a.data && a.data.card) {
        const cid = a.data.card.id;
        (commentsByCard[cid] = commentsByCard[cid] || []).push({
          text: a.data.text || '', ts: a.date ? new Date(a.date).getTime() : Date.now()
        });
      }
    });
    Object.keys(commentsByCard).forEach(function (k) {
      commentsByCard[k].sort(function (x, y) { return x.ts - y.ts; });
    });

    // 4) カード
    const cards = (data.cards || [])
      .filter(function (c) { return !c.closed; })
      .sort(function (a, b) { return (a.pos || 0) - (b.pos || 0); });
    const posCounter = {};
    const cardRows = [];
    cards.forEach(function (c) {
      const ourList = listMap[c.idList];
      if (!ourList) return;
      posCounter[ourList] = (posCounter[ourList] == null) ? 0 : posCounter[ourList] + 1;
      const labels = (c.idLabels || []).map(function (id) { return labelMap[id]; })
        .filter(function (x) { return x; });
      cardRows.push({
        id: Utilities.getUuid(), listId: ourList, title: c.name || '', desc: c.desc || '',
        position: posCounter[ourList], labels: JSON.stringify(labels),
        due: c.due ? toYmd_(new Date(c.due)) : '',
        checklist: JSON.stringify(checklistByCard[c.id] || []),
        comments: JSON.stringify(commentsByCard[c.id] || []),
        createdAt: now, updatedAt: now, archived: false,
        attachments: '[]', start: c.start ? toYmd_(new Date(c.start)) : '',
        allDay: true, done: !!c.dueComplete
      });
    });
    appendRows_(ss.getSheetByName('Cards'), 'Cards', cardRows);

    return { board: boardTitle, lists: listRows.length, cards: cardRows.length, labels: labelRows.length };
  });
}

/* ============================ Field API ============================ */

// config はオブジェクト（select は {options:[...]}, rating は {style,max}）
function addField(boardId, name, type, config, showFront) {
  return withLock_(function () {
    const sh = getSS_().getSheetByName('Fields');
    const objs = sheetObjects_(sh).filter(function (o) { return o.boardId === boardId; });
    const maxPos = objs.reduce(function (m, o) { return Math.max(m, Number(o.position) || 0); }, -1);
    const field = {
      id: Utilities.getUuid(), boardId: boardId, name: name, type: type || 'text',
      config: JSON.stringify(config || {}), position: maxPos + 1,
      showFront: showFront !== false
    };
    sh.appendRow(rowFromObject_('Fields', field));
    field.config = config || {};
    return field;
  });
}

function updateField(id, patch) {
  return withLock_(function () {
    const sh = getSS_().getSheetByName('Fields');
    const row = findRow_(sh, id);
    if (row < 0) return false;
    const colIndex = {};
    SCHEMA.Fields.forEach(function (k, i) { colIndex[k] = i + 1; });
    if (patch.name !== undefined) sh.getRange(row, colIndex['name']).setValue(patch.name);
    if (patch.showFront !== undefined) sh.getRange(row, colIndex['showFront']).setValue(patch.showFront);
    if (patch.config !== undefined) sh.getRange(row, colIndex['config']).setValue(JSON.stringify(patch.config));
    return true;
  });
}

function deleteField(id) {
  return withLock_(function () {
    const sh = getSS_().getSheetByName('Fields');
    const row = findRow_(sh, id);
    if (row > 0) sh.deleteRow(row);
    return true;
  });
}

/* ====================== Google連携（カレンダー / タスク） ====================== */

function cardObjFromRow_(sh, row) {
  const vals = sh.getRange(row, 1, 1, SCHEMA.Cards.length).getValues()[0];
  const o = {}; SCHEMA.Cards.forEach(function (k, i) { o[k] = vals[i]; });
  return o;
}

// カードをGoogleカレンダーに同期（enabled=falseで削除）
function syncCalendar(cardId, enabled) {
  return withLock_(function () {
    const sh = getSS_().getSheetByName('Cards');
    const row = findRow_(sh, cardId);
    if (row < 0) return null;
    const colIndex = {}; SCHEMA.Cards.forEach(function (k, i) { colIndex[k] = i + 1; });
    const card = cardObjFromRow_(sh, row);
    const sync = parseJson_(sh.getRange(row, colIndex['sync']).getValue(), {});
    const cal = CalendarApp.getDefaultCalendar();

    if (!enabled) {
      if (sync.gcal) { try { const ev = cal.getEventById(sync.gcal); if (ev) ev.deleteEvent(); } catch (e) {} delete sync.gcal; }
      sh.getRange(row, colIndex['sync']).setValue(JSON.stringify(sync));
      return sync;
    }

    const s = toYmd_(card.start) || toYmd_(card.due);
    const e = toYmd_(card.due) || toYmd_(card.start);
    if (!s) throw new Error('日付（スタートまたは終わり）が未設定です');
    const title = String(card.title || '(無題)');
    const startDate = new Date(s + 'T00:00:00');
    const endDate = new Date(e + 'T00:00:00');
    const endExclusive = new Date(endDate); endExclusive.setDate(endExclusive.getDate() + 1);

    let ev = null;
    if (sync.gcal) { try { ev = cal.getEventById(sync.gcal); } catch (e2) { ev = null; } }
    if (ev) {
      ev.setTitle(title);
      ev.setAllDayDates(startDate, endExclusive);
      ev.setDescription(card.desc || '');
    } else {
      ev = (s === e) ? cal.createAllDayEvent(title, startDate)
                     : cal.createAllDayEvent(title, startDate, endExclusive);
      ev.setDescription(card.desc || '');
      sync.gcal = ev.getId();
    }
    sh.getRange(row, colIndex['sync']).setValue(JSON.stringify(sync));
    return sync;
  });
}

// カードをGoogleタスクに同期（enabled=falseで削除）。Tasks 高度なサービスが必要
function syncTask(cardId, enabled) {
  return withLock_(function () {
    const sh = getSS_().getSheetByName('Cards');
    const row = findRow_(sh, cardId);
    if (row < 0) return null;
    const colIndex = {}; SCHEMA.Cards.forEach(function (k, i) { colIndex[k] = i + 1; });
    const card = cardObjFromRow_(sh, row);
    const sync = parseJson_(sh.getRange(row, colIndex['sync']).getValue(), {});
    const listId = '@default';

    if (!enabled) {
      if (sync.gtask) { try { Tasks.Tasks.remove(listId, sync.gtask); } catch (e) {} delete sync.gtask; }
      sh.getRange(row, colIndex['sync']).setValue(JSON.stringify(sync));
      return sync;
    }

    const due = toYmd_(card.due) || toYmd_(card.start);
    const task = { title: String(card.title || '(無題)'), notes: String(card.desc || '') };
    if (due) task.due = due + 'T00:00:00.000Z';

    let ok = false;
    if (sync.gtask) {
      try { Tasks.Tasks.patch(task, listId, sync.gtask); ok = true; } catch (e) { sync.gtask = null; }
    }
    if (!ok) {
      const created = Tasks.Tasks.insert(task, listId);
      sync.gtask = created.id;
    }
    sh.getRange(row, colIndex['sync']).setValue(JSON.stringify(sync));
    return sync;
  });
}

/* ============================ AI（Gemini） ============================ */

function hasGeminiKey() { return !!PROP.getProperty('GEMINI_KEY'); }
function setGeminiKey(key) { PROP.setProperty('GEMINI_KEY', String(key || '').trim()); return true; }

function aiCallGemini_(prompt) {
  const key = PROP.getProperty('GEMINI_KEY');
  if (!key) throw new Error('Gemini APIキーが未設定です（設定画面から登録してください）');
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + encodeURIComponent(key);
  const res = UrlFetchApp.fetch(url, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    payload: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
  });
  const code = res.getResponseCode();
  const data = JSON.parse(res.getContentText());
  if (code !== 200) throw new Error('AI呼び出し失敗(' + code + '): ' + (data.error ? data.error.message : ''));
  try { return data.candidates[0].content.parts[0].text; } catch (e) { return ''; }
}

// 自然文からカードを作成（タイトル＋日付を抽出）
function aiAddCard(boardId, listId, text) {
  const today = toYmd_(new Date());
  const prompt = '次の日本語の予定/タスク文から、カードのタイトルと日付を抽出してJSONだけ返してください。'
    + '形式: {"title":"...","start":"YYYY-MM-DD または空","due":"YYYY-MM-DD または空"}。'
    + '相対的な日付（明日/来週金曜/月末/3日後 など）は今日(' + today + ')を基準に実際の日付へ変換。'
    + '期間があればstartとdue、単一の締切ならdueのみ。日付が無ければ空文字。JSON以外は一切出力しない。\n文: ' + text;
  let obj = {};
  try { obj = JSON.parse(aiCallGemini_(prompt).replace(/```json|```/g, '').trim()); } catch (e) { obj = { title: text }; }
  const card = addCard(listId, obj.title || text);
  const patch = {};
  if (obj.due) patch.due = obj.due;
  if (obj.start) patch.start = obj.start;
  if (Object.keys(patch).length) updateCard(card.id, patch);
  card.due = obj.due || '';
  card.start = obj.start || '';
  return card;
}

// ボードを要約
function aiSummarizeBoard(boardId) {
  const ss = getSS_();
  const board = sheetObjects_(ss.getSheetByName('Boards')).filter(function (b) { return b.id === boardId; })[0];
  const lists = sheetObjects_(ss.getSheetByName('Lists'))
    .filter(function (l) { return l.boardId === boardId && !(l.archived === true || l.archived === 'TRUE'); })
    .sort(function (a, b) { return (Number(a.position) || 0) - (Number(b.position) || 0); });
  const cards = sheetObjects_(ss.getSheetByName('Cards')).filter(function (c) { return !(c.archived === true || c.archived === 'TRUE'); });
  let text = 'ボード名: ' + (board ? board.title : '') + '\n';
  lists.forEach(function (l) {
    text += '\n【' + l.title + '】\n';
    cards.filter(function (c) { return c.listId === l.id; }).forEach(function (c) {
      const due = toYmd_(c.due) || toYmd_(c.start);
      text += '- ' + c.title + (due ? '（期限' + due + '）' : '') + ((c.done === true || c.done === 'TRUE') ? ' [完了]' : '') + '\n';
    });
  });
  const today = toYmd_(new Date());
  const prompt = '今日は' + today + 'です。次のかんばんボードの状況を日本語で簡潔に要約してください。'
    + '「今すぐ着手すべきこと(期限切れ/今日)」「今週の注意点」「全体の進捗感」を箇条書きで。\n\n' + text;
  return aiCallGemini_(prompt);
}

/* ============================ 自動バックアップ ============================ */

function getBackupFolder_() {
  const key = 'BACKUP_FOLDER_ID';
  const id = PROP.getProperty(key);
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  const f = DriveApp.createFolder('My Trello Backups');
  PROP.setProperty(key, f.getId());
  return f;
}

function pruneBackups_(folder, keep) {
  const files = [];
  const it = folder.getFiles();
  while (it.hasNext()) files.push(it.next());
  files.sort(function (a, b) { return b.getDateCreated() - a.getDateCreated(); });
  for (let i = keep; i < files.length; i++) { try { files[i].setTrashed(true); } catch (e) {} }
}

// 今すぐバックアップ（DBを複製。直近10個を保持）
function backupNow() {
  const ssId = PROP.getProperty(SS_KEY);
  if (!ssId) return false;
  const folder = getBackupFolder_();
  const tz = Session.getScriptTimeZone();
  const name = 'MyTrelloDB_backup_' + Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd_HHmm');
  DriveApp.getFileById(ssId).makeCopy(name, folder);
  pruneBackups_(folder, 10);
  PROP.setProperty('LAST_BACKUP', Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm'));
  return true;
}

function enableBackup(freq) {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'backupNow') ScriptApp.deleteTrigger(t);
  });
  const tb = ScriptApp.newTrigger('backupNow').timeBased();
  if (freq === 'weekly') tb.onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(2).create();
  else { freq = 'daily'; tb.everyDays(1).atHour(2).create(); }
  PROP.setProperty('BACKUP_FREQ', freq);
  return true;
}

function disableBackup() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'backupNow') ScriptApp.deleteTrigger(t);
  });
  PROP.deleteProperty('BACKUP_FREQ');
  return true;
}

function backupStatus() {
  return {
    freq: PROP.getProperty('BACKUP_FREQ') || '',
    last: PROP.getProperty('LAST_BACKUP') || '',
    folderUrl: getBackupFolder_().getUrl()
  };
}

/* ============================ Utility / 復旧 ============================ */

// スプレッドシートのURLを取得（設定確認用）
function getDbUrl() {
  return getSS_().getUrl();
}

// ドライブ内の「My Trello DB」を全部リスト表示（複数できていないか確認用）
// Apps Script エディタでこの関数を選んで実行 → 実行ログに一覧が出ます
function listTrelloDbs() {
  const cur = PROP.getProperty(SS_KEY);
  const it = DriveApp.getFilesByName('My Trello DB');
  const out = [];
  while (it.hasNext()) {
    const f = it.next();
    out.push({
      id: f.getId(),
      updated: f.getLastUpdated(),
      current: (f.getId() === cur),
      url: f.getUrl()
    });
  }
  out.sort(function (a, b) { return b.updated - a.updated; });
  out.forEach(function (o) {
    Logger.log((o.current ? '★今使用中 ' : '          ') +
      o.updated + '  ' + o.url);
  });
  if (!out.length) Logger.log('「My Trello DB」は見つかりませんでした。');
  return out;
}

// 使うスプレッドシートを切り替える（復旧用）。idは listTrelloDbs() のURL末尾 /d/●●●/ の●●● 部分
function useDb(id) {
  PROP.setProperty(SS_KEY, id);
  PROP.deleteProperty('SCHEMA_V'); // 念のため再アップグレードさせる
  const url = getSS_().getUrl();
  Logger.log('切り替えました: ' + url);
  return url;
}
