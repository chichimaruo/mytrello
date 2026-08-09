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
           'attachments', 'start', 'allDay', 'done', 'ratings', 'fields', 'cover', 'template', 'links', 'sync', 'places', 'deleted', 'klass', 'period', 'embedding', 'embHash'],
  Labels: ['id', 'name', 'color', 'boardId'],
  Fields: ['id', 'boardId', 'name', 'type', 'config', 'position', 'showFront'],
  Views: ['id', 'name', 'config', 'position'],
  Automations: ['id', 'boardId', 'triggerList', 'actions', 'position'],
  Recurring: ['id', 'boardId', 'listId', 'title', 'freq', 'lastRun', 'position'],
  History: ['id', 'cardId', 'at', 'field', 'before', 'after']
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
  getTrash: 1, restoreCard: 1, purgeCard: 1, emptyTrash: 1,
  exportAll: 1, healthCheck: 1, copyBoard: 1,
  getCardHistory: 1, revertHistory: 1,
  getClasses: 1, setClasses: 1, distributeLesson: 1,
  sampleStatus: 1, createWeekSample: 1, deleteWeekSample: 1,
  gmailImportStatus: 1, enableGmailImport: 1, disableGmailImport: 1, importGmailNow: 1,
  aiReviewStatus: 1, enableAiReview: 1, disableAiReview: 1, aiWeeklyReview: 1,
  aiPlanBulk: 1, aiApplyBulk: 1,
  reindexEmbeddings: 1, semanticSearch: 1,
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

const SCHEMA_VERSION = '19';

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

  // v18: ゴミ箱（削除を取り消せるようにする論理削除フラグ）
  ensureColumn_(ss.getSheetByName('Cards'), 'deleted', false);

  // v19: 週案（クラス・時限）／意味検索の埋め込み／変更履歴
  ensureColumn_(ss.getSheetByName('Cards'), 'klass', '');
  ensureColumn_(ss.getSheetByName('Cards'), 'period', 0);
  ensureColumn_(ss.getSheetByName('Cards'), 'embedding', '');
  ensureColumn_(ss.getSheetByName('Cards'), 'embHash', '');
  if (!ss.getSheetByName('History')) {
    const h = ss.insertSheet('History');
    h.getRange(1, 1, 1, SCHEMA.History.length).setValues([SCHEMA.History]);
    h.setFrozenRows(1);
  }

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
  c.deleted     = c.deleted === true || c.deleted === 'TRUE';
  c.klass       = c.klass === undefined || c.klass === null ? '' : String(c.klass);
  c.period      = Number(c.period) || 0;
  delete c.embedding;  // 埋め込みは重いのでクライアントへ送らない
  delete c.embHash;
  c.start       = toYmd_(c.start);
  c.due         = toYmd_(c.due);
  c.position    = Number(c.position) || 0;
  return c;
}

// ゴミ箱行の判定（parseCard_ を通す前の生データにも使える）
function isTrashed_(c) { return c.deleted === true || c.deleted === 'TRUE'; }

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
    .filter(function (c) { return listIds.indexOf(c.listId) >= 0 && !isTrashed_(c); });
  cards.forEach(parseCard_);
  cards.sort(function (a, b) { return a.position - b.position; });
  return cards;
}
function getAllCards() {
  const cards = sheetObjects_(getSS_().getSheetByName('Cards'))
    .filter(function (c) { return !isTrashed_(c); });
  cards.forEach(parseCard_);
  cards.sort(function (a, b) { return a.position - b.position; });
  return cards;
}

// ゴミ箱の中身（削除されたカードだけ）。復元/完全削除の画面用。
function getTrash() {
  const ss = getSS_();
  const lists = sheetObjects_(ss.getSheetByName('Lists'));
  const boards = sheetObjects_(ss.getSheetByName('Boards'));
  const listMap = {}; lists.forEach(function (l) { listMap[l.id] = l; });
  const boardMap = {}; boards.forEach(function (b) { boardMap[b.id] = b; });
  const cards = sheetObjects_(ss.getSheetByName('Cards'))
    .filter(isTrashed_);
  cards.forEach(parseCard_);
  cards.forEach(function (c) {
    const l = listMap[c.listId];
    c.listTitle = l ? l.title : '(不明なリスト)';
    const b = l ? boardMap[l.boardId] : null;
    c.boardTitle = b ? b.title : '(不明なボード)';
  });
  // 新しく捨てたものが上
  cards.sort(function (a, b) { return String(b.updatedAt).localeCompare(String(a.updatedAt)); });
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
    const cards = sheetObjects_(ss.getSheetByName('Cards'))
      .filter(function (c) { return listIds.indexOf(c.listId) >= 0 && !isTrashed_(c); });
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

// ボードをまるごと複製（リスト・カード・ラベル・カスタムフィールドを引き継ぐ）
// 「昨年度と同じ流れをもう一度」「1組の進行を2組にも」といった使い方向け。
// コメント/添付は引き継がない（copyList と同じ方針）。アーカイブ済みとゴミ箱の中身は複製しない。
function copyBoard(boardId, newTitle) {
  return withLock_(function () {
    const ss = getSS_();
    const bsh = ss.getSheetByName('Boards');
    const src = sheetObjects_(bsh).filter(function (b) { return b.id === boardId; })[0];
    if (!src) return null;

    const now = new Date().toISOString();
    const newBoardId = Utilities.getUuid();
    const maxPos = sheetObjects_(bsh).reduce(function (m, o) { return Math.max(m, Number(o.position) || 0); }, -1);
    const board = {
      id: newBoardId,
      title: newTitle || ((src.title || '') + ' のコピー'),
      position: maxPos + 1, archived: false, createdAt: now,
      background: src.background || '', shareToken: ''   // 共有トークンは引き継がない
    };
    bsh.appendRow(rowFromObject_('Boards', board));

    // ラベル（このボード専用のものだけ複製。全ボード共通=boardId空 はそのまま使える）
    const lbSh = ss.getSheetByName('Labels');
    const labelIdMap = {};
    const newLabels = sheetObjects_(lbSh).filter(function (l) { return l.boardId === boardId; })
      .map(function (l) {
        const nid = Utilities.getUuid();
        labelIdMap[l.id] = nid;
        return { id: nid, name: l.name, color: l.color, boardId: newBoardId };
      });
    if (newLabels.length) appendRows_(lbSh, 'Labels', newLabels);

    // カスタムフィールド
    const fSh = ss.getSheetByName('Fields');
    const fieldIdMap = {};
    const newFields = sheetObjects_(fSh).filter(function (f) { return f.boardId === boardId; })
      .map(function (f) {
        const nid = Utilities.getUuid();
        fieldIdMap[f.id] = nid;
        return { id: nid, boardId: newBoardId, name: f.name, type: f.type,
                 config: f.config, position: Number(f.position) || 0, showFront: f.showFront === true || f.showFront === 'TRUE' };
      });
    if (newFields.length) appendRows_(fSh, 'Fields', newFields);

    // リスト
    const lsh = ss.getSheetByName('Lists');
    const listIdMap = {};
    const srcLists = sheetObjects_(lsh)
      .filter(function (l) { return l.boardId === boardId && !(l.archived === true || l.archived === 'TRUE'); })
      .sort(function (a, b) { return (Number(a.position) || 0) - (Number(b.position) || 0); });
    const newLists = srcLists.map(function (l, idx) {
      const nid = Utilities.getUuid();
      listIdMap[l.id] = nid;
      return { id: nid, title: l.title, position: idx, archived: false, boardId: newBoardId,
               wip: Number(l.wip) || 0, collapsed: false };
    });
    if (newLists.length) appendRows_(lsh, 'Lists', newLists);

    // カード（ラベルIDとフィールドIDを新しいものへ張り替える）
    const csh = ss.getSheetByName('Cards');
    const srcCards = sheetObjects_(csh)
      .filter(function (c) { return listIdMap[c.listId] && !(c.archived === true || c.archived === 'TRUE') && !isTrashed_(c); })
      .sort(function (a, b) { return (Number(a.position) || 0) - (Number(b.position) || 0); });
    const posByList = {};
    const newCards = srcCards.map(function (c) {
      const o = {}; SCHEMA.Cards.forEach(function (k) { o[k] = c[k]; });
      o.id = Utilities.getUuid();
      o.listId = listIdMap[c.listId];
      posByList[o.listId] = (posByList[o.listId] === undefined) ? 0 : posByList[o.listId] + 1;
      o.position = posByList[o.listId];
      o.comments = '[]'; o.attachments = '[]'; o.sync = '{}';
      o.createdAt = now; o.updatedAt = now; o.deleted = false;

      const labels = parseJson_(c.labels, []).map(function (id) { return labelIdMap[id] || id; });
      o.labels = JSON.stringify(labels);

      const fv = parseJson_(c.fields, {}); const nf = {};
      Object.keys(fv).forEach(function (k) { nf[fieldIdMap[k] || k] = fv[k]; });
      o.fields = JSON.stringify(nf);
      return o;
    });
    if (newCards.length) appendRows_(csh, 'Cards', newCards);

    return board;
  });
}

// 1枚の授業カードを、複数のクラスへ日付・時限を指定してまとめて配る（週案の一括展開）。
// targets = [{klass:'1年2組', date:'2026-09-08', period:3}, ...]
// 本文・チェックリスト・ラベル・カスタムフィールドは引き継ぎ、
// コメント・添付・完了状態・Google連携は引き継がない（copyCard と同じ方針）。
function distributeLesson(cardId, targets) {
  return withLock_(function () {
    const sh = getSS_().getSheetByName('Cards');
    const row = findRow_(sh, cardId);
    if (row < 0) return [];
    const vals = sh.getRange(row, 1, 1, SCHEMA.Cards.length).getValues()[0];
    const base = {};
    SCHEMA.Cards.forEach(function (k, i) { base[k] = vals[i]; });

    const now = new Date().toISOString();
    let maxPos = sheetObjects_(sh)
      .filter(function (c) { return c.listId === base.listId; })
      .reduce(function (m, p) { return Math.max(m, Number(p.position) || 0); }, -1);

    const made = [];
    (targets || []).forEach(function (t) {
      if (!t || !t.klass) return;
      const o = {};
      SCHEMA.Cards.forEach(function (k) { o[k] = base[k]; });
      o.id = Utilities.getUuid();
      o.position = ++maxPos;
      o.klass = String(t.klass);
      o.period = Number(t.period) || 0;
      o.start = t.date || base.start;
      o.due = '';                      // 授業カードに期限は持たせない
      o.comments = '[]'; o.attachments = '[]'; o.sync = '{}';
      o.done = false; o.archived = false; o.template = false; o.deleted = false;
      o.embedding = ''; o.embHash = '';
      o.createdAt = now; o.updatedAt = now;
      made.push(o);
    });
    if (made.length) appendRows_(sh, 'Cards', made);
    return made.map(function (o) { return parseCard_(o); });
  });
}

/* ====================== 週案のサンプルデータ ====================== */
// 「使ってみないと分からない」ための見本。専用ボードを1枚作るだけなので、
// 既存のボードには一切触れない。deleteWeekSample() で跡形なく消せる。

const SAMPLE_CLASSES = ['1年1組', '1年2組', '1年3組'];
const SAMPLE_LESSONS = [
  '第1時 曲との出会い／通して聴く',
  '第2時 主題を歌ってつかむ',
  '第3時 場面の移り変わりを聴き取る',
  '第4時 楽器の音色と情景を結びつける',
  '第5時 標題音楽としての工夫を考える',
  '第6時 まとめ／自分の言葉で語る'
];
// クラスごとの「毎週の授業枠」＝ [曜日(0=月), 時限] を週2コマ分
const SAMPLE_SLOTS = {
  '1年1組': [[0, 2], [3, 1]],   // 月2限・木1限
  '1年2組': [[1, 3], [4, 2]],   // 火3限・金2限
  '1年3組': [[2, 4], [4, 5]]    // 水4限・金5限
};
// わざと進度に差をつける（遅れの表示を見てもらうため）
const SAMPLE_DONE = { '1年1組': 4, '1年2組': 3, '1年3組': 2 };

function sampleStatus() {
  const id = PROP.getProperty('SAMPLE_BOARD_ID');
  if (!id) return { exists: false };
  const b = sheetObjects_(getSS_().getSheetByName('Boards')).filter(function (x) { return x.id === id; })[0];
  return b ? { exists: true, boardId: id, title: b.title } : { exists: false };
}

function createWeekSample() {
  return withLock_(function () {
    if (PROP.getProperty('SAMPLE_BOARD_ID')) throw new Error('サンプルはすでに入っています。先に削除してください。');

    const ss = getSS_();
    const now = new Date();
    const iso = now.toISOString();

    // 今週の月曜（先週=-7, 来週=+7 に授業を散らして、週の移動も試せるようにする）
    const monday = new Date(now); monday.setHours(0, 0, 0, 0);
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));

    // --- ボード ---
    const bsh = ss.getSheetByName('Boards');
    const boardId = Utilities.getUuid();
    const maxPos = sheetObjects_(bsh).reduce(function (m, o) { return Math.max(m, Number(o.position) || 0); }, -1);
    bsh.appendRow(rowFromObject_('Boards', {
      id: boardId, title: '🗓 週案サンプル（削除OK）', position: maxPos + 1,
      archived: false, createdAt: iso, background: '', shareToken: ''
    }));

    // --- リスト（前回おすすめした「準備の状態」で並べる）---
    const lsh = ss.getSheetByName('Lists');
    const listNames = ['教材準備中', '印刷済み', '実施済', '振り返り記入済'];
    const listIds = {};
    const listRows = listNames.map(function (n, i) {
      const id = Utilities.getUuid(); listIds[n] = id;
      return { id: id, title: n, position: i, archived: false, boardId: boardId, wip: 0, collapsed: false };
    });
    appendRows_(lsh, 'Lists', listRows);

    // --- 授業カード（3クラス × 6時＝18枚）---
    const csh = ss.getSheetByName('Cards');
    const cards = [];
    let pos = 0;

    SAMPLE_CLASSES.forEach(function (klass) {
      const slots = SAMPLE_SLOTS[klass];
      const doneCount = SAMPLE_DONE[klass];

      SAMPLE_LESSONS.forEach(function (title, n) {
        const weekOffset = Math.floor(n / 2) - 1;          // 0,1→先週 / 2,3→今週 / 4,5→来週
        const slot = slots[n % 2];
        const d = new Date(monday);
        d.setDate(monday.getDate() + weekOffset * 7 + slot[0]);

        const isDone = n < doneCount;
        let desc = 'スメタナ「ブルタバ（モルダウ）」の鑑賞　全6時間扱いのサンプルです。\n';
        if (isDone) {
          desc += '\n## 振り返り\n- 良かった点：主題を口ずさめる生徒が増えた\n'
                + '- 直す点：音源が長いので、聴かせる範囲を絞る\n';
        } else {
          desc += '\n## 準備メモ\n- 音源とワークシートを用意する\n- 板書は場面の順にそろえる\n';
        }

        cards.push({
          id: Utilities.getUuid(),
          listId: isDone ? listIds['実施済'] : listIds['教材準備中'],
          title: title, desc: desc, position: pos++,
          labels: '[]', due: '', checklist: '[]', comments: '[]',
          createdAt: iso, updatedAt: iso, archived: false, attachments: '[]',
          start: toYmd_(d), allDay: true, done: isDone,
          ratings: '{}', fields: '{}', cover: '', template: false, links: '[]', sync: '{}', places: '[]',
          deleted: false, klass: klass, period: slot[1], embedding: '', embHash: ''
        });
      });
    });
    appendRows_(csh, 'Cards', cards);

    // --- クラス設定（既存の設定は退避して、消すときに元へ戻す）---
    const before = PROP.getProperty('CLASSES') || '';
    PROP.setProperty('CLASSES_BEFORE_SAMPLE', before);
    const cur = parseJson_(before, []);
    const merged = cur.slice();
    SAMPLE_CLASSES.forEach(function (k) { if (merged.indexOf(k) < 0) merged.push(k); });
    PROP.setProperty('CLASSES', JSON.stringify(merged));

    PROP.setProperty('SAMPLE_BOARD_ID', boardId);
    return { boardId: boardId, cards: cards.length, classes: merged };
  });
}

function deleteWeekSample() {
  const id = PROP.getProperty('SAMPLE_BOARD_ID');
  if (!id) return false;
  deleteBoard(id);                       // リストとカードも一緒に消える
  const before = PROP.getProperty('CLASSES_BEFORE_SAMPLE');
  if (before === null || before === undefined || before === '') PROP.deleteProperty('CLASSES');
  else PROP.setProperty('CLASSES', before);
  PROP.deleteProperty('CLASSES_BEFORE_SAMPLE');
  PROP.deleteProperty('SAMPLE_BOARD_ID');
  return true;
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
      attachments: '[]', start: '', allDay: true, done: false, ratings: '{}', fields: '{}', cover: '', template: false, links: '[]', sync: '{}', places: '[]', deleted: false, klass: '', period: 0, embedding: '', embHash: ''
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

    // 履歴に残す項目は、変更前の値を先に読んでおく
    const before = {};
    HISTORY_FIELDS.forEach(function (k) {
      if (fields[k] !== undefined) before[k] = sh.getRange(row, colIndex[k]).getValue();
    });

    ['title', 'desc', 'due', 'start', 'allDay', 'done', 'archived', 'template', 'klass', 'period'].forEach(function (k) {
      if (fields[k] !== undefined) sh.getRange(row, colIndex[k]).setValue(fields[k]);
    });
    ['labels', 'checklist', 'comments', 'fields', 'cover', 'links', 'places'].forEach(function (k) {
      if (fields[k] !== undefined) {
        sh.getRange(row, colIndex[k]).setValue(JSON.stringify(fields[k]));
      }
    });
    sh.getRange(row, colIndex['updatedAt']).setValue(new Date().toISOString());

    // 内容が変わったので、意味検索の埋め込みは作り直しが必要（次回の再計算で拾わせる）
    if (fields.title !== undefined || fields.desc !== undefined) {
      sh.getRange(row, colIndex['embHash']).setValue('');
    }

    recordHistory_(id, before, fields);
    return true;
  });
}

/* ============================ 変更履歴 / 巻き戻し ============================ */

// 履歴を残す項目。全部残すと重くなるので、後から戻したくなるものだけ。
const HISTORY_FIELDS = ['title', 'desc', 'due', 'start', 'done', 'archived', 'klass', 'period'];
const HISTORY_MAX = 2000;   // これを超えたら古い方から捨てる

function histText_(v) {
  if (v === null || v === undefined) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') return toYmd_(v);
  return String(v);
}

// updateCard の中から呼ばれる。値が実際に変わった項目だけ1行ずつ積む。
function recordHistory_(cardId, before, fields) {
  try {
    const rows = [];
    const at = new Date().toISOString();
    HISTORY_FIELDS.forEach(function (k) {
      if (fields[k] === undefined) return;
      const b = histText_(before[k]);
      const a = histText_(fields[k]);
      if (b === a) return;                       // 変わっていないなら残さない
      rows.push({ id: Utilities.getUuid(), cardId: cardId, at: at, field: k,
                  before: b.slice(0, 2000), after: a.slice(0, 2000) });
    });
    if (!rows.length) return;
    const sh = getSS_().getSheetByName('History');
    if (!sh) return;
    appendRows_(sh, 'History', rows);
    // 上限を超えたぶんを古い方から削除
    const over = sh.getLastRow() - 1 - HISTORY_MAX;
    if (over > 0) sh.deleteRows(2, over);
  } catch (e) { /* 履歴で本体の保存を失敗させない */ }
}

// カード1枚の履歴（新しい順）
function getCardHistory(cardId) {
  const sh = getSS_().getSheetByName('History');
  if (!sh) return [];
  return sheetObjects_(sh)
    .filter(function (h) { return h.cardId === cardId; })
    .sort(function (a, b) { return String(b.at).localeCompare(String(a.at)); })
    .slice(0, 100);
}

// 履歴1件の「変更前」の値へ戻す（戻した操作自体も履歴に残る）
function revertHistory(historyId) {
  const sh = getSS_().getSheetByName('History');
  if (!sh) return false;
  const h = sheetObjects_(sh).filter(function (x) { return x.id === historyId; })[0];
  if (!h) return false;
  const val = (h.field === 'done' || h.field === 'archived')
    ? (String(h.before) === 'true' || String(h.before) === 'TRUE')
    : (h.field === 'period' ? (Number(h.before) || 0) : h.before);
  const patch = {}; patch[h.field] = val;
  updateCard(h.cardId, patch);
  return true;
}

// 添付ファイル(JSON文字列)に含まれるDriveファイルをゴミ箱へ
function trashAttachmentsJson_(attJson) {
  parseJson_(attJson, []).forEach(function (a) {
    if (a && a.fileId) { try { DriveApp.getFileById(a.fileId).setTrashed(true); } catch (e) {} }
  });
}

// カード削除＝ゴミ箱へ（論理削除）。行も添付も残すので取り消せる。
// 本当に消すのは purgeCard / emptyTrash。
function deleteCard(id) {
  return withLock_(function () {
    const sh = getSS_().getSheetByName('Cards');
    const colIndex = {}; SCHEMA.Cards.forEach(function (k, i) { colIndex[k] = i + 1; });
    const row = findRow_(sh, id);
    if (row > 0) {
      sh.getRange(row, colIndex['deleted']).setValue(true);
      sh.getRange(row, colIndex['updatedAt']).setValue(new Date().toISOString());
    }
    return true;
  });
}

// ゴミ箱から戻す
function restoreCard(id) {
  return withLock_(function () {
    const sh = getSS_().getSheetByName('Cards');
    const colIndex = {}; SCHEMA.Cards.forEach(function (k, i) { colIndex[k] = i + 1; });
    const row = findRow_(sh, id);
    if (row > 0) {
      sh.getRange(row, colIndex['deleted']).setValue(false);
      sh.getRange(row, colIndex['updatedAt']).setValue(new Date().toISOString());
    }
    return true;
  });
}

// 完全に削除（行を消し、添付もDriveのゴミ箱へ）。取り消せない。
function purgeCard(id) {
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

// ゴミ箱を空にする（下の行から消さないと行番号がずれる）
function emptyTrash() {
  return withLock_(function () {
    const sh = getSS_().getSheetByName('Cards');
    const colIndex = {}; SCHEMA.Cards.forEach(function (k, i) { colIndex[k] = i + 1; });
    const last = sh.getLastRow();
    if (last < 2) return 0;
    const delCol = sh.getRange(2, colIndex['deleted'], last - 1, 1).getValues();
    const attCol = sh.getRange(2, colIndex['attachments'], last - 1, 1).getValues();
    let n = 0;
    for (let i = delCol.length - 1; i >= 0; i--) {
      const v = delCol[i][0];
      if (v === true || v === 'TRUE') {
        trashAttachmentsJson_(attCol[i][0]);
        sh.deleteRow(i + 2);
        n++;
      }
    }
    return n;
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
  const cards = sheetObjects_(ss.getSheetByName('Cards')).filter(function (c) { return !isTrashed_(c); });
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
      .filter(function (c) { return c.listId === listId && !(c.archived === true || c.archived === 'TRUE') && !isTrashed_(c); })
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
    .filter(function (c) { return !(c.archived === true || c.archived === 'TRUE') && !isTrashed_(c); })
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
  const cards = sheetObjects_(ss.getSheetByName('Cards')).filter(function (c) { return !(c.archived === true || c.archived === 'TRUE') && !isTrashed_(c); });
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

/* ============================ エクスポート ============================ */

// 全データを1つのオブジェクトで返す。アプリの外に持ち出せる形を用意しておくため
// （バックアップはスプレッドシートの複製なので、他へ移す手段がこれまで無かった）。
// CSV への整形はクライアント側で行う（サーバーの実行時間を使わないため）。
function exportAll() {
  const ss = getSS_();
  return {
    exportedAt: new Date().toISOString(),
    schemaVersion: SCHEMA_VERSION,
    boards: sheetObjects_(ss.getSheetByName('Boards')),
    lists: sheetObjects_(ss.getSheetByName('Lists')),
    cards: getAllCards(),                 // ゴミ箱の中身は含めない
    labels: sheetObjects_(ss.getSheetByName('Labels')),
    fields: sheetObjects_(ss.getSheetByName('Fields')),
    views: sheetObjects_(ss.getSheetByName('Views')),
    automations: sheetObjects_(ss.getSheetByName('Automations')),
    recurring: sheetObjects_(ss.getSheetByName('Recurring'))
  };
}

/* ============================ 健康診断 ============================ */

// 「静かに止まる」類の問題を自分で見つけられるようにするための状態まとめ。
// 2026-08-08に自動バックアップが2か月止まっていたこと、トリガーが1個しか
// 登録されていなかったことに気づけなかった反省から追加。
function healthCheck() {
  const ss = getSS_();
  const triggers = ScriptApp.getProjectTriggers().map(function (t) {
    return { fn: t.getHandlerFunction(), source: String(t.getEventType()) };
  });
  const cardsAll = sheetObjects_(ss.getSheetByName('Cards'));
  const bk = backupStatus();

  // 最終バックアップからの経過日数（'yyyy-MM-dd HH:mm' 形式で保存されている）
  let backupAgeDays = null;
  if (bk.last) {
    const d = new Date(String(bk.last).replace(' ', 'T') + ':00');
    if (!isNaN(d.getTime())) backupAgeDays = Math.floor((Date.now() - d.getTime()) / 86400000);
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    dbUrl: ss.getUrl(),
    appUrl: ScriptApp.getService().getUrl(),
    backup: { freq: bk.freq, last: bk.last, ageDays: backupAgeDays, folderUrl: bk.folderUrl },
    triggers: triggers,
    counts: {
      boards: sheetObjects_(ss.getSheetByName('Boards')).length,
      lists: sheetObjects_(ss.getSheetByName('Lists')).length,
      cards: cardsAll.filter(function (c) { return !isTrashed_(c); }).length,
      trash: cardsAll.filter(isTrashed_).length
    },
    flags: {
      geminiKey: !!PROP.getProperty('GEMINI_KEY'),
      sharing: isSharingEnabled(),
      apiToken: !!PROP.getProperty('API_TOKEN')
    }
  };
}

/* ============================ 週案（クラス設定） ============================ */
// クラス名の一覧。週案ビューの行になる。1人で使う前提なので全体で1つ持つ。
function getClasses() { return parseJson_(PROP.getProperty('CLASSES'), []); }
function setClasses(list) {
  const arr = (list || []).map(function (s) { return String(s).trim(); }).filter(Boolean);
  PROP.setProperty('CLASSES', JSON.stringify(arr));
  return arr;
}

/* ============================ Gmail から取り込む ============================ */
// 指定ラベルの付いたスレッドをカードにする。取り込んだらラベルを外し、
// 代わりに「MyTrello済み」を付けるので二重取り込みは起きない。

const GMAIL_DONE_LABEL = 'MyTrello済み';

function gmailImportStatus() {
  return {
    label: PROP.getProperty('GMAIL_LABEL') || '',
    listId: PROP.getProperty('GMAIL_LIST') || '',
    last: PROP.getProperty('GMAIL_LAST') || '',
    on: !!PROP.getProperty('GMAIL_LABEL') &&
        ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'importGmailNow'; })
  };
}

function enableGmailImport(labelName, listId) {
  const name = String(labelName || '').trim();
  if (!name) throw new Error('Gmailのラベル名を入れてください');
  if (!listId) throw new Error('取り込み先のリストを選んでください');
  if (!GmailApp.getUserLabelByName(name)) {
    throw new Error('Gmailに「' + name + '」というラベルが見つかりません。先にGmailで作ってください。');
  }
  PROP.setProperty('GMAIL_LABEL', name);
  PROP.setProperty('GMAIL_LIST', listId);
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'importGmailNow') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('importGmailNow').timeBased().everyHours(1).create();
  return true;
}

function disableGmailImport() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'importGmailNow') ScriptApp.deleteTrigger(t);
  });
  PROP.deleteProperty('GMAIL_LABEL');
  return true;
}

function importGmailNow() {
  const name = PROP.getProperty('GMAIL_LABEL');
  const listId = PROP.getProperty('GMAIL_LIST');
  if (!name || !listId) return { added: 0, reason: '未設定' };

  const src = GmailApp.getUserLabelByName(name);
  if (!src) return { added: 0, reason: 'ラベルが見つかりません' };
  let done = GmailApp.getUserLabelByName(GMAIL_DONE_LABEL) || GmailApp.createLabel(GMAIL_DONE_LABEL);

  const threads = src.getThreads(0, 20);   // 1回あたり20件まで（実行時間の上限対策）
  let added = 0;
  threads.forEach(function (th) {
    const msgs = th.getMessages();
    const first = msgs[0];
    const title = (th.getFirstMessageSubject() || '(件名なし)').slice(0, 200);
    const body = msgs.map(function (m) {
      return '── ' + m.getFrom() + '  ' + Utilities.formatDate(m.getDate(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm') + '\n'
        + (m.getPlainBody() || '').slice(0, 3000);
    }).join('\n\n');
    const link = 'https://mail.google.com/mail/u/0/#all/' + th.getId();

    const card = addCard(listId, title);
    updateCard(card.id, {
      desc: body + '\n\n' + link,
      links: [link],
      start: toYmd_(first.getDate())
    });
    th.removeLabel(src);
    th.addLabel(done);
    added++;
  });

  PROP.setProperty('GMAIL_LAST', Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm'));
  return { added: added };
}

/* ============================ AI：週次の棚卸し ============================ */
// 毎週トリガーで盤面全体をGeminiに読ませ、気づきを「提案カード」として置く。
// 勝手に既存カードを書き換えることはしない（提案するだけ）。

function aiReviewStatus() {
  return {
    listId: PROP.getProperty('AIREVIEW_LIST') || '',
    last: PROP.getProperty('AIREVIEW_LAST') || '',
    on: ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'aiWeeklyReview'; })
  };
}

function enableAiReview(listId) {
  if (!listId) throw new Error('提案の置き場所になるリストを選んでください');
  PROP.setProperty('AIREVIEW_LIST', listId);
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'aiWeeklyReview') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('aiWeeklyReview').timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(20).create();
  return true;
}

function disableAiReview() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'aiWeeklyReview') ScriptApp.deleteTrigger(t);
  });
  return true;
}

// 盤面をAIに渡せる短いテキストにまとめる（トークンを使いすぎないよう要点だけ）
function boardDigest_() {
  const ss = getSS_();
  const boards = sheetObjects_(ss.getSheetByName('Boards')).filter(function (b) { return !(b.archived === true || b.archived === 'TRUE'); });
  const lists = sheetObjects_(ss.getSheetByName('Lists')).filter(function (l) { return !(l.archived === true || l.archived === 'TRUE'); });
  const cards = getAllCards().filter(function (c) { return !c.archived && !c.template; });
  const listMap = {}; lists.forEach(function (l) { listMap[l.id] = l; });
  const boardMap = {}; boards.forEach(function (b) { boardMap[b.id] = b; });
  const today = toYmd_(new Date());

  const rows = cards.slice(0, 400).map(function (c) {
    const l = listMap[c.listId]; if (!l) return null;
    const b = boardMap[l.boardId]; if (!b) return null;
    return [c.id, b.title, l.title, c.title,
            c.start || '-', c.due || '-', c.done ? '完了' : '未完了',
            '更新:' + String(c.updatedAt || '').slice(0, 10)].join(' | ');
  }).filter(Boolean);

  return '今日は ' + today + ' です。\n'
    + '書式: カードID | ボード | リスト | タイトル | 開始 | 期限 | 状態 | 最終更新\n'
    + rows.join('\n');
}

function aiWeeklyReview() {
  const listId = PROP.getProperty('AIREVIEW_LIST');
  if (!listId) return { added: 0, reason: '未設定' };

  const prompt = 'あなたは私専属の進行管理アシスタントです。以下のかんばんの全カードを読み、'
    + '気づいた点を最大8件、日本語のJSON配列だけで返してください。\n'
    + '形式: [{"type":"放置|矛盾|重複|着手時期","title":"40字以内の要点","detail":"なぜそう思うかを120字以内"}]\n'
    + '観点: (1)長く更新が無く忘れられていそうなもの (2)日付の矛盾（開始が期限より後、期限切れなのに未完了で放置）'
    + ' (3)実質同じ内容が複数枚に分かれているもの (4)期限から逆算してそろそろ着手すべきもの。\n'
    + '重要でないものは無理に挙げない。JSON以外は一切出力しない。\n\n' + boardDigest_();

  let items = [];
  try {
    items = JSON.parse(aiCallGemini_(prompt).replace(/```json|```/g, '').trim());
  } catch (e) {
    return { added: 0, reason: 'AIの返答を解釈できませんでした' };
  }
  if (!Array.isArray(items) || !items.length) {
    PROP.setProperty('AIREVIEW_LAST', Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm'));
    return { added: 0 };
  }

  const stamp = toYmd_(new Date());
  let added = 0;
  items.slice(0, 8).forEach(function (it) {
    if (!it || !it.title) return;
    const card = addCard(listId, '🤖 ' + (it.type || '気づき') + '：' + String(it.title).slice(0, 60));
    updateCard(card.id, { desc: String(it.detail || '') + '\n\n（' + stamp + ' のAI棚卸しによる提案です。対応したら削除してください）' });
    added++;
  });
  PROP.setProperty('AIREVIEW_LAST', Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm'));
  return { added: added };
}

/* ============================ AI：自然文でまとめて操作 ============================ */
// 危険な操作なので「案を作る」と「実行する」を必ず分ける。
// aiPlanBulk は何も変更しない。aiApplyBulk は画面で承認された案だけを受け取る。

function aiPlanBulk(instruction) {
  const text = String(instruction || '').trim();
  if (!text) throw new Error('指示を入力してください');

  const prompt = 'あなたはかんばんアプリの操作を提案するアシスタントです。'
    + '次の指示を実行するために変更すべきカードを選び、日本語のJSONだけで返してください。\n'
    + '形式: {"actions":[{"cardId":"...","title":"対象カードのタイトル","change":{"due":"YYYY-MM-DD"},"reason":"20字以内"}]}\n'
    + 'changeに使ってよいキーは due, start, done, archived, title のみ。'
    + '日付は必ず YYYY-MM-DD。doneとarchivedは true/false。\n'
    + '確信が持てないカードは含めない。該当が無ければ {"actions":[]} を返す。'
    + '最大30件。JSON以外は一切出力しない。\n\n指示: ' + text + '\n\n' + boardDigest_();

  let plan = { actions: [] };
  try { plan = JSON.parse(aiCallGemini_(prompt).replace(/```json|```/g, '').trim()); } catch (e) {
    throw new Error('AIの返答を解釈できませんでした。指示を短く区切って試してください。');
  }
  const allowed = { due: 1, start: 1, done: 1, archived: 1, title: 1 };
  const cards = {}; getAllCards().forEach(function (c) { cards[c.id] = c; });

  // 実在するカードと、許可したキーだけに絞る（AIの取り違えをここで止める）
  const actions = (plan.actions || []).filter(function (a) { return a && cards[a.cardId]; }).slice(0, 30)
    .map(function (a) {
      const ch = {};
      Object.keys(a.change || {}).forEach(function (k) { if (allowed[k]) ch[k] = a.change[k]; });
      const cur = cards[a.cardId];
      return {
        cardId: a.cardId, title: cur.title, reason: String(a.reason || ''),
        change: ch,
        before: { due: cur.due || '', start: cur.start || '', done: !!cur.done, archived: !!cur.archived, title: cur.title }
      };
    })
    .filter(function (a) { return Object.keys(a.change).length; });

  return { actions: actions };
}

// 画面で承認された案をそのまま実行する。履歴に残るので後から個別に戻せる。
function aiApplyBulk(actions) {
  const allowed = { due: 1, start: 1, done: 1, archived: 1, title: 1 };
  let n = 0;
  (actions || []).forEach(function (a) {
    if (!a || !a.cardId || !a.change) return;
    const ch = {};
    Object.keys(a.change).forEach(function (k) { if (allowed[k]) ch[k] = a.change[k]; });
    if (!Object.keys(ch).length) return;
    updateCard(a.cardId, ch);
    n++;
  });
  return n;
}

/* ============================ 意味で探す検索 ============================ */
// Geminiの埋め込みでカードをベクトル化し、言い回しが違っても意味が近ければ見つかるようにする。
// 埋め込みは embHash（対象テキストのハッシュ）で差分だけ再計算する。

function embedText_(text) {
  const key = PROP.getProperty('GEMINI_KEY');
  if (!key) throw new Error('Gemini APIキーが未設定です');
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=' + encodeURIComponent(key);
  const res = UrlFetchApp.fetch(url, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    payload: JSON.stringify({
      model: 'models/text-embedding-004',
      content: { parts: [{ text: String(text).slice(0, 8000) }] }
    })
  });
  if (res.getResponseCode() !== 200) throw new Error('埋め込みの取得に失敗: ' + res.getContentText().slice(0, 200));
  const data = JSON.parse(res.getContentText());
  return (data.embedding && data.embedding.values) ? data.embedding.values : null;
}

function hashText_(s) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, String(s), Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ((b & 0xff) + 0x100).toString(16).slice(1); }).join('');
}

function cardEmbedSource_(c) { return String(c.title || '') + '\n' + String(c.desc || ''); }

// 未計算のカードだけ埋め込みを作る。1回の実行で batch 件まで（実行時間の上限対策）。
// 残りがある間は画面から繰り返し呼ぶ。
function reindexEmbeddings(batch) {
  const n = Math.max(1, Math.min(Number(batch) || 25, 50));
  const sh = getSS_().getSheetByName('Cards');
  const colIndex = {}; SCHEMA.Cards.forEach(function (k, i) { colIndex[k] = i + 1; });
  const all = sheetObjects_(sh);

  const todo = all.filter(function (c) {
    if (isTrashed_(c)) return false;
    return String(c.embHash || '') !== hashText_(cardEmbedSource_(c));
  });

  let done = 0;
  todo.slice(0, n).forEach(function (c) {
    const row = findRow_(sh, c.id);
    if (row < 0) return;
    const src = cardEmbedSource_(c);
    try {
      const v = embedText_(src);
      if (!v) return;
      // 小数を丸めてセルを軽くする（検索精度にはほぼ影響しない）
      sh.getRange(row, colIndex['embedding']).setValue(JSON.stringify(v.map(function (x) { return Math.round(x * 10000) / 10000; })));
      sh.getRange(row, colIndex['embHash']).setValue(hashText_(src));
      done++;
    } catch (e) { /* 1枚失敗しても続ける */ }
  });

  return { done: done, remaining: Math.max(0, todo.length - done), total: all.length };
}

function semanticSearch(query, topN) {
  const q = String(query || '').trim();
  if (!q) return [];
  const qv = embedText_(q);
  if (!qv) return [];

  const ss = getSS_();
  const lists = sheetObjects_(ss.getSheetByName('Lists'));
  const boards = sheetObjects_(ss.getSheetByName('Boards'));
  const listMap = {}; lists.forEach(function (l) { listMap[l.id] = l; });
  const boardMap = {}; boards.forEach(function (b) { boardMap[b.id] = b; });

  // クエリ側のノルム（各カードごとに計算し直さないよう先に出す）
  let qn = 0; for (let i = 0; i < qv.length; i++) qn += qv[i] * qv[i];
  qn = Math.sqrt(qn) || 1;

  const scored = [];
  sheetObjects_(ss.getSheetByName('Cards')).forEach(function (c) {
    if (isTrashed_(c) || !c.embedding) return;
    const v = parseJson_(c.embedding, null);
    if (!v || v.length !== qv.length) return;
    let dot = 0, vn = 0;
    for (let i = 0; i < v.length; i++) { dot += qv[i] * v[i]; vn += v[i] * v[i]; }
    vn = Math.sqrt(vn) || 1;
    const l = listMap[c.listId]; const b = l ? boardMap[l.boardId] : null;
    scored.push({
      id: c.id, title: c.title,
      desc: String(c.desc || '').slice(0, 120),
      boardId: b ? b.id : '', boardTitle: b ? b.title : '', listTitle: l ? l.title : '',
      score: dot / (qn * vn)
    });
  });

  scored.sort(function (a, b) { return b.score - a.score; });
  return scored.slice(0, Math.max(1, Math.min(Number(topN) || 20, 50)));
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
