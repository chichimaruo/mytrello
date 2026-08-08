# My Trello — 開発引き継ぎドキュメント

最終更新: 2026-08-08 / 現在のスキーマ版数: **SCHEMA_VERSION = '17'**

このファイルは「後日また開発を再開するとき」に経緯・構造・注意点を一気に思い出すための引き継ぎ資料です。
**まずこのファイルと `MEMORY`（後述）を読めば、ほぼ全体像がつかめます。**

> **最初に3行だけ**
> 1. 触るのは `apps-script/` の4ファイルだけ。`webapp/` は自動生成なので手で編集しない。
> 2. 反映は2か所必要 → **Apps Script（コピペ＋新バージョンでデプロイ）** と **アプリ版（`_publish.ps1`）**。
> 3. 列やシートを足すときは §4（スキーマ移行）を必ず読む。ここが唯一の事故ポイント。

---

## 0. これは何か / なぜ作ったか
- **目的**: Trello有料プラン（年約2万円）を解約するため、同等以上の「かんばんアプリ」を**完全無料**で自作。
- **要件**: 無料 / データは自分のGoogleドライブ内 / PC・スマホ（出先）両方からアクセスして編集 / 自分専用（同時編集なし）。
- **採用アーキテクチャ（A案）**: **Google Apps Script（Web App）＋ GoogleスプレッドシートをDB**。
  - Googleが無料ホスト。URLを開くだけで全端末から使え、データはドライブ内のスプレッドシートに残る。
  - 「ドライブに実行ファイルを置く」案はスマホ不可＆同期破損リスクのため不採用。
- **その後（v3.7〜）**: 見た目と起動速度を上げるため、画面だけを **GitHub Pages 上の PWA** として配信し、
  Apps Script は **JSONのデータAPI** として使う形に発展。スマホのホーム画面から本物のアプリのように起動できる。

---

## 1. ファイル構成
```
My Trello Project/            ← 正本（Googleドライブ）
├─ HANDOVER.md        ← このファイル（引き継ぎ資料）
├─ SETUP.md           ← 初回セットアップ手順（デプロイ方法）
├─ README.md          ← 公開リポジトリの表紙
├─ _build_pwa.py      ← apps-script/ → webapp/ へ変換するビルド
├─ _publish.ps1       ← ビルド＋GitHubへ公開（これを実行するだけ）
├─ myboard-icon.png   ← アイコンの元画像（ここからPWAアイコンを生成）
├─ apps-script/       ← ★ソース一式。編集するのはここだけ
│  ├─ Code.gs         ← サーバー側（全ロジック・DB操作・外部連携・JSON API）
│  ├─ Index.html      ← 画面の骨格（HTML、各オーバーレイ）
│  ├─ Stylesheet.html ← 見た目（CSS）。<style>で始まる
│  ├─ JavaScript.html ← 画面の動作（クライアントJS）。<script>で始まる
│  └─ appsscript.json ← マニフェスト（タイムゾーン・Tasks高度サービス等）
├─ webapp/            ← ☆自動生成（手で編集しない）。GitHub Pagesで配信される中身
│  ├─ index.html / style.css / app.js  ← 上の3ファイルから変換したもの
│  ├─ manifest.json / service-worker.js / アイコン3種
└─ .github/workflows/deploy.yml ← push で自動ビルド＆公開
```
> Apps Script上のファイル名は **Code.gs / Index / Stylesheet / JavaScript**（HTMLは拡張子なしで作成）。大文字小文字も厳密に一致させること。
> ※ 2026-08-08 まで、サーバー側だけ日本語の既定名 **`コード.gs`** のままだった（この資料の記述と食い違っていた）。
> 初回の `clasp push` で `Code.gs` に統一済み。`.gs` のファイル名は動作に影響しない（全ファイルが同じスコープ）。

**作業用リポジトリ**: `C:\Users\cruis\repos\mytrello`（GitHub `chichimaruo/mytrello` のクローン）。
Gitはドライブ同期と相性が悪いので**ドライブの外**に置く。無くても `_publish.ps1` が自動で取り直す。

---

## 2. デプロイ運用（重要・つまずきやすい）

### 2-A. いま動いている「2つの入口」
| | 入口 | 中身 | 使い分け |
|---|---|---|---|
| **アプリ版（普段使う方）** | https://chichimaruo.github.io/mytrello/ | GitHub Pages上のPWA。`fetch`でApps ScriptのJSON APIを叩く | スマホのホーム画面から起動。起動が速い |
| **旧・Web App版（予備）** | Apps ScriptのウェブアプリURL | `google.script.run` で動く従来のHTML版 | アプリ版が動かないときの逃げ道 |

**どちらも中身のソースは `apps-script/` の同じ4ファイル**。アプリ版は `_build_pwa.py` が変換して作る。
→ だから **コードを直したら2か所に反映が必要**（2-B と 2-C の両方）。

- JSON APIの窓口は `Code.gs` の `doGet`/`doPost` → `handleApi_`。`API_ALLOWED` に載っている関数だけ実行できる。
- 認証は **秘密トークン**（Script Properties の `API_TOKEN`）。初回に一度 `setupApiToken()` を実行してログに出たものを、
  アプリの「⚙設定 → 🔌接続設定」で URL とともに登録する（端末の localStorage に保存）。
- **アプリ版を使うにはデプロイのアクセスを「リンクを知っている全員」にする必要がある**（別オリジンからのfetchのため）。
  素のURLで来た他人には案内文しか出ないよう `doGet` でガード済み。データはトークンが無いと1件も取れない。

### 2-B. Apps Script 側の反映
1. script.google.com の対象プロジェクト（"My Trello"）を開く。
2. **コード更新時**: 各ファイルを「全選択→削除→パソコンの同名ファイルを貼付→Ctrl+S」。
   - ※貼る場所を間違えない（過去にCode.gsをJavaScript.htmlへ貼って全停止した事故あり）。各ファイル先頭で判別：
     `Code.gs`=`/****`、`Index.html`=`<!DOCTYPE html>`、`Stylesheet.html`=`<style>`、`JavaScript.html`=`<script>`。
3. **反映**: 「デプロイ」→「デプロイを管理」→鉛筆✏️→バージョン=「**新バージョン**」→「デプロイ」。URLは変わらない。
4. ブラウザで **Ctrl+Shift+R**（強制リロード）。
5. **appsscript.json を編集**するには、Apps Scriptの歯車「プロジェクトの設定」→「`appsscript.json` をエディタで表示」にチェック。
6. **スコープが増えた回**は、デプロイ/初回操作で**権限の再承認**が出る → 「許可」（「確認されていません」は自作アプリなので 詳細→移動→許可）。

### 2-B'. コピペをやめる ＝ `_push_gas.ps1`（**セットアップ完了済み・そのまま使える**）
`clasp`（Google公式のコマンドツール）で、2-B の「全選択→削除→貼付」を **コマンド1発**に置き換えられる。
貼り間違い事故（§11-9）が原理的に起きなくなる。**下記は 2026-08-08 に全て完了済み**：

```
✅ npm install -g @google/clasp   … clasp 3.3.0 / Node v22.17.1
✅ clasp login                    … cruisingyui@gmail.com で認証済み
✅ Google Apps Script API をオン  … script.google.com/home/usersettings
✅ .clasp.json 作成済み           … scriptId と rootDir=apps-script（公開リポジトリには載せない）
✅ 初回の突き合わせ＋push 実施     … サーバーとドライブが全ファイル一致
```

> **★久しぶりに触るときの安全確認**：`clasp push` は**このフォルダの中身でサーバー側を上書き**する。
> Apps Scriptのエディタで直接いじって、こちらに写していない変更があると**消える**。
> 先に別フォルダへ落として見比べること：
> ```
> mkdir C:\temp\gas-check ; cd C:\temp\gas-check
> clasp clone-script <スクリプトID>     ← IDは .clasp.json か「プロジェクトの設定」から
> ```
> 落ちてきたファイルが `apps-script/` と同じなら安心して使ってよい。
> **実際、2026-08-08 の初回確認でサーバーとドライブの食い違いが3ファイル見つかった**（§11-12）。形だけの手順ではない。

あとは `_push_gas.ps1` を実行するだけ（scriptIdは初回に聞かれ `.clasp.json` に保存。このファイルは公開リポジトリには載せない）。
中では `clasp show-file-status`（送る中身の確認）→ `clasp push --force` → `clasp list-deployments` →
`clasp update-deployment <デプロイID>`（新バージョンへ差し替え・**URLは変わらない**）の順で実行する。

**clasp v3 はコマンド名が v2 から変わっている**（`deploy -i` → `update-deployment`、`clone` → `clone-script`、
`deployments` → `list-deployments`、`status` → `show-file-status`）。旧v2向けの記事をそのまま真似すると動かない。
上記コマンド名・オプションは clasp 3.3.0 の `--help` で実在を確認済み。

### 2-C. アプリ版（PWA）の反映 ＝ `_publish.ps1` を実行するだけ
`My Trello Project\_publish.ps1` を右クリック →「PowerShell で実行」。中でやっていること：
1. `python _build_pwa.py` … `apps-script/` から `webapp/` を作り直す（Pillowが必要: `pip install Pillow`）
2. ドライブの中身を作業用リポジトリへコピー（リポジトリが無ければ自動でclone）
3. 確認プロンプトのあと commit & push → GitHub Actions が Pages へ自動公開（1〜2分）

進行状況: https://github.com/chichimaruo/mytrello/actions

**`_build_pwa.py` が自動でやる変換（＝手作業しなくていい理由）**
- `Stylesheet.html` の `<style>` を剥がして `style.css`
- `JavaScript.html` の `<script>` を剥がし、`google.script.run` の窓口を **fetch＋トークン**の窓口に差し替えて `app.js`
- `Index.html` の `<?!= include(...) ?>` を実ファイル参照に差し替え、PWA用meta・Service Worker登録・「🔌接続設定」ボタンを足して `index.html`
- `myboard-icon.png` から 192/512/180px のアイコンを生成
- **Service Worker のキャッシュ版数を html+css+js のハッシュで自動更新** → 各端末のキャッシュが自然に切り替わる

> 変換は「元の文字列がちょうど1個あること」を `assert` で確認してから差し替える。
> `apps-script/` 側の該当箇所（`<base target="_top">` の行、`api` の Proxy 定義、`bindUI();\ninit();`、
> `<div id="bgResults" ...>` の行、`include('JavaScript')` の行）を書き換えるとビルドが**止まる**。
> 止まったら壊れたのではなく「対応する差し替え文字列も直して」というサイン。`_build_pwa.py` の該当 `OLD_*` を直す。

---

## 3. データモデル（スプレッドシート = DB）
DBは「My Trello DB」というスプレッドシート（初回アクセス時に自動生成、IDはScript Propertiesの`SPREADSHEET_ID`に保存）。
各シート＝テーブル。**列の並び順が重要**（後述の不変条件）。

| シート | 列 |
|---|---|
| **Boards** | id, title, position, archived, createdAt, background, shareToken |
| **Lists** | id, title, position, archived, boardId, wip, collapsed |
| **Cards** | id, listId, title, desc, position, labels, due, checklist, comments, createdAt, updatedAt, archived, attachments, start, allDay, done, ratings, fields, cover, template, links, sync, places |
| **Labels** | id, name, color, boardId |
| **Fields** | id, boardId, name, type, config, position, showFront |
| **Views** | id, name, config, position |
| **Automations** | id, boardId, triggerList, actions, position |
| **Recurring** | id, boardId, listId, title, freq, lastRun, position |

JSON文字列で保存する列：Cards.labels(配列), checklist(配列), comments(配列), attachments(配列), ratings(旧・未使用), fields({fieldId:値}), cover({type,value/fileId}|null), links(URL配列), sync({gcal,gtask}), places(地名の文字列配列) / Fields.config / Views.config / Automations.actions。
boolean列：archived, allDay, done, template, showFront, collapsed。

> **ratings列は旧「評価軸」の名残で現在未使用**（fieldsに統合済み）。Ratingsシートも旧版の名残で残ることがあるが未使用。

---

## 4. スキーマ移行のしくみ（★最重要・事故ポイント）
- `Code.gs` の `SCHEMA`（各シートの列定義）と `ensureSchema_()` がDBを自動アップグレードする。
- **不変条件（絶対守る）**:
  1. `rowFromObject_()` は **SCHEMAの順番**でセルに書き込み、`sheetObjects_()` は**ヘッダ名**で読む。
     → **新しい列は必ず SCHEMA[name] の末尾に追加**し、`ensureColumn_()`（末尾に列追加）で物理列も末尾に追加する。途中に挿入しない。
  2. バージョン判定は **`const SCHEMA_VERSION` 1箇所**で管理。`ensureSchema_`先頭のガードも末尾の`setProperty`も全部この定数を使う。
     - 【過去の重大バグ】ガードが`'4'`固定のままで、SCHEMA_Vが'4'のDBは移行が永久スキップ→新シート/列が作られず`getState`がnull参照で落ち「ボード全消し」に見えた。**定数1元管理で再発防止済み**。
  3. `getSS_()` は **openById失敗時のみ** `createDB_()`（新規空DB作成）する。`ensureSchema_`の失敗で新DBを作るとデータ喪失するので、ensureSchemaはtryの外で実行している。
- **新機能で列/シートを足す手順**: ①SCHEMAに末尾追加 ②`SCHEMA_VERSION`を+1 ③`ensureSchema_`に`ensureColumn_`（または`insertSheet`）の処理を追記 ④`getState`でパース ⑤`addCard`等の初期値追加。

---

## 5. 機能一覧と所在（どこに何があるか）
ボード/リスト/カードの基本＋以下を実装済み（“Trello有料級”をほぼ網羅）。
- **複数ボード**＋ボード一覧ホーム（サムネ縦リスト）/ 背景画像（Wikimedia Commons検索）/ ボードのアーカイブ
- **ラベル**（ボードごと＋全ボード共通、色・削除）
- **カード**: 日付（スタート/終わり/終日）, 完了チェック, チェックリスト, コメント, 説明（自動リサイズ）, カバー（色/画像）, **カスタムフィールド**（text/number/checkbox/date/select/rating, ボードごと, ソート可）, **YouTube/リンク埋め込み**（サムネ→クリックで再生）, 複製/別ボードへ移動, アーカイブ, テンプレート
- **添付ファイル**: Drive直結アップロード（動画OK・進捗表示・サムネ）。削除時はDriveファイルもゴミ箱へ
- **ビュー**: カレンダー（横断・ボード色分け）, **テーブル**（保存ビュー複数, ボード横断, Trello有料相当）, **集計ダッシュボード**, **タイムライン（ガント）**, 検索・フィルター
- **自動化ルール**（Butler相当: リスト移動でアクション）, **繰り返しカード**（毎日/毎週/毎月）, **期限リマインダー（メール）**
- **AI（Gemini）**: 自然文でカード追加 / ボード要約
- **Google連携**: カレンダー＋タスクへ同期（双方向）
- **共有**: 読み取り専用リンク（トークン式）
- **キーボードショートカット**: c/b/t/d/f/a/?
- **WIPリミット**（リストの上限・超過で赤）
- **Trelloインポート**（JSON）, **自動バックアップ**, **更新ボタン＋エラー表示**
- **地図・場所**（`Cards.places`）: カードに地名を登録 → クリックで地図を読み込み／Google Mapsで開く
- **リストの折りたたみ**（`Lists.collapsed`）: 個別／一括。畳んだリストは件数だけ縦表示
- **復帰のしやすさ**: 再読み込みしてもスクロール位置と開いていたカードを復元（スマホでSafariに落とされても続きから）

UIは画面下部の各 `#overlay`（boardHome, calendar, table, dashboard, timeline, filter, archive, settings, importer, ai, modal）で構成。設定系（リマインダー/自動化/繰り返し/共有/背景/バックアップ）は **⚙設定オーバーレイ(`#settings`)** に集約。

---

## 6. サーバーAPI（Code.gs 主な関数）
- **基盤**: `doGet(e)`, `doPost(e)`, `handleApi_/apiJson_/apiPing/setupApiToken`, `getSS_/ensureSchema_/createDB_/ensureColumn_/sheetObjects_/findRow_/rowFromObject_/withLock_/parseJson_/parseCard_/toYmd_`
- **データ取得（遅延ロード）**: `getInitial(boardId)`(メタ＋その板のカードを1往復), `getMeta()`(カード以外), `getCards(boardId)`, `getAllCards()`, `getState()`(全部＝旧互換)
- **Board**: addBoard, renameBoard, archiveBoard, deleteBoard, saveBoardOrder, setBoardBackground, setBoardShare
- **List**: addList, renameList, deleteList, saveListOrder, archiveList, setListWip, setListCollapsed, setAllListsCollapsed, copyList, archiveAllCards
- **Card**: addCard, updateCard, deleteCard, saveCardOrder, moveCard, moveCardToList, copyCard
- **添付**: getOAuthToken, getAttachFolderId, addAttachmentMeta, deleteAttachment, uploadAttachment(旧base64・予備), trashAttachmentsJson_
- **Label/Field/View/Automation/Recurring**: add/delete系（CRUD）。runRecurring（トリガー）
- **リマインダー**: enableReminders/disableReminders/isReminderOn/sendDueReminders
- **共有**: isSharingEnabled/enableSharing/disableSharing/getAppUrl/renderSharedBoard_
- **Google連携**: syncCalendar/syncTask/cardObjFromRow_
- **AI**: hasGeminiKey/setGeminiKey/aiCallGemini_/aiAddCard/aiSummarizeBoard
- **Trelloインポート**: importTrelloBoard/appendRows_/trelloColorHex_
- **バックアップ**: backupNow/enableBackup/disableBackup/backupStatus/getBackupFolder_/pruneBackups_
- **復旧/確認**: getDbUrl, listTrelloDbs（My Trello DBを全列挙）, useDb(id)（使うDB切替）

---

## 7. クライアント構造（JavaScript.html）
- `api`：`await api.関数名(...)` で呼べる Proxy。**Web App版では `google.script.run`、アプリ版ではビルド時に fetch＋トークンへ差し替わる**（§2-C）。呼ぶ側のコードは同じ。
- `STATE = { boards, lists, cards, labels, fields, views, automations, recurring }`：`getInitial` の結果。
- **遅延ロード**：起動時は `getInitial(現在の板)` で**その板のカードだけ**取得。カレンダー／テーブル／ダッシュボード／タイムライン／ボード一覧を開くときに `ensureAllCards()` が初めて全カードを取りに行く（1回だけ・`allCardsPromise` でキャッシュ）。
  → **横断ビューに関わる処理を足すときは、先頭で `await ensureAllCards()` を呼ぶこと**。忘れると「他の板のカードが出ない」バグになる。
- 描画：`render()`→`renderList()`→`renderCard()`。カード詳細は `openModal/renderModal`＋各 `render〇〇`。
- `normalizeCard(c)`：**サーバー返りのカードは配列/オブジェクトが文字列のことがある**ため、push前に必ず整形（addCard/copyCard/aiAddCard後）。
- `FILTER`（検索条件）, `SORTABLES`（ドラッグ実体・再描画時にdestroy）, `currentBoardId`（localStorage保持）。

---

## 8. 権限スコープ / トリガー / 外部連携
- **スコープ**: spreadsheets, drive, script.external_request（UrlFetch=Gemini/Wikimedia/Drive REST), script.send_mail（MailApp=リマインダー）, script.scriptapp（トリガー）, calendar（CalendarApp）, tasks（Tasks高度サービス）。
- **appsscript.json**: `enabledAdvancedServices`に **Tasks v1** を宣言（Googleタスク連携に必須）。
- **時刻トリガー（3種）**: `sendDueReminders`（毎朝・任意時刻）, `runRecurring`（毎日1時）, `backupNow`（毎日/毎週2時）。いずれもUIのオン/オフで作成・削除。

> **★トリガーは「作ったつもり」で存在しないことがある。定期的に実物を見ること。**
> 一覧はここ → script.google.com で My Trello を開く → 左サイドバーの **⏰ マイトリガー**
>
> - **2026-08-09 時点の実態＝`backupNow` の1個だけ**だった。`sendDueReminders`（期限リマインダーのメール）と
>   `runRecurring`（繰り返しカード）は**未登録＝機能として動いていなかった**。実装はあるのに誰も気づいていない状態。
>   → 使うならアプリの ⚙設定 からオンにする。
> - **トリガーは「導入」列のバージョンに紐づいて実行される**（実物は `バージョン 40`）。
>   つまり `clasp push`（＝HEADの更新）だけでは**トリガーの挙動は変わらない**。
>   `backupNow` / `sendDueReminders` / `runRecurring` を直したときは、**必ず新バージョンをデプロイ**すること（§2-B/2-B'）。
>   これを忘れると「コードは直したのに夜のバッチだけ古い動きのまま」という切り分けの難しい状態になる。
- **AI**: Google AI Studio（aistudio.google.com）で無料のGemini APIキーを取得し、アプリの「✨AI」→キー登録（PROP `GEMINI_KEY`に保存・サーバー側のみ）。

---

## 9. 共有（読み取り専用）の安全設計
- `?share=<token>&board=<boardId>` で `renderSharedBoard_`（サーバー生成の静的read-only HTML）を返す。
- 他人に開かせるには **デプロイのアクセスを「リンクを知っている全員」** に変更し、設定で**共有モードを有効化**。
- 共有モード有効時のみ `doGet` が「本人以外の編集アプリ表示」を拒否（共有用デプロイで素のアプリを晒さない対策）。デフォルトはガード無効でロックアウト無し。
- 万一ロックアウト時は、エディタで `disableSharing()` を実行して復旧。

---

## 10. バックアップ / 復旧
- **バックアップ**: ⚙設定→自動バックアップをオン（毎日推奨）。`backupNow`が「My Trello Backups」フォルダにDBを日付名コピー（直近10個保持）。

> **★2026-08-08に判明：自動バックアップが止まっていた → 2026-08-09 に復旧済み。**
> `My Trello Backups` に **2026-06-05 の1個しか無かった**（正常なら直近10個ある）。
> 6/5に手動で `backupNow` を1回押しただけで、その後2か月ぶん退避が無い状態だった。
> 8/9に自動バックアップ（毎日2時）をオンにし、「今すぐバックアップ」で
> `MyTrelloDB_backup_2026-08-09_0840` を作成して穴を埋め、処理が正常動作することも確認済み。
> **オンにしても誰も見ていないと静かに死ぬ**ので、`_publish.ps1` の冒頭に鮮度チェックを入れてある
> （最新が7日より古いと赤字で警告）。開発のたびに通るので気づける。
>
> **自分で確かめる方法**（フォルダを見るだけ・アプリを開かなくてよい）:
> ```
> Get-ChildItem 'H:\マイドライブ\My Trello Backups' -File | Sort-Object LastWriteTime -Descending | Select-Object -First 3 LastWriteTime,Name
> ```
> 直近の日付が出て、ファイルが複数あれば正常。1個しか無い／日付が古い＝止まっている。
>
> ※ `enableBackup` は Apps Script の時刻トリガーを作る関数なので、**外部（clasp等）からは実行できない**
> （`clasp run-function` はAPI実行可能デプロイ＋GCPプロジェクトが必要）。アプリのUIから操作すること。
- **DBがおかしくなったら**: Apps Scriptエディタで `listTrelloDbs()` を実行→実行ログで「My Trello DB」一覧確認。データのある正しいDBのIDで `useDb('そのID')` を実行すれば切替（SCHEMA_Vも消えて再移行）。
- **戻すとき**: バックアップのコピー（My Trello Backups内）を「My Trello DB」に置き換えるか、そのコピーのIDで `useDb()`。

---

## 11. つまずき集（過去に踏んだ・対処済み）
1. **SCHEMA_VERSION定数化**：ガードと書込を1元管理（'4'固定バグで全消し体験）。
2. **getSS_はopen失敗時のみ新規作成**（移行エラーで新DBを作らない＝データ喪失防止）。
3. **parseJson_は非文字列セル（数値等）でfallback**を返す（`return v`にしていて links=数値→forEach不能で開けない事故）。
4. **クライアントnormalizeCard**：addCard等の返りはJSON文字列のまま→配列化しないと「📎誤表示・カードが開かない」。
5. **数字だけのタイトル**：Sheetsは数値型で返す→Tasks APIは厳格→`String(...)`で送る。
6. **Apps Scriptサンドボックス**：`window.open`はブロックされがち→`<a target=_blank>`をクリック。`window.location`はiframeのURL→アプリURLは`ScriptApp.getService().getUrl()`。
7. **時刻トリガーは第1引数にeventを渡す**→`sendDueReminders(force)`は`force===true`のみ強制送信。
8. **性能**：背景の`background-attachment:fixed`除去 / モーダルは内側スクロール＋`translateZ(0)` / YouTubeはサムネ→クリックで`iframe` / 画像`loading=lazy` / Sortableは再描画時にdestroy。
9. **貼り間違い**：各ファイル先頭で判別（§2-B参照）。
10. **`webapp/index.html` の手作業コピー**：以前はここだけビルド対象外で手写しだった。`Index.html` にオーバーレイを足しても
    アプリ版に入らない、という静かな事故になりやすかったため、**2026-08-08 にビルド生成へ変更**（§2-C）。**webapp/ は絶対に手で編集しない**。
11. **Gitをドライブの中に置かない**：`H:\マイドライブ\...` 直下の `.git` は同期で中身が消えて空になっていた。
    作業用リポジトリは **`C:\Users\cruis\repos\mytrello`（ドライブ外）**。ドライブが正本、リポジトリは公開用のコピー、という関係。
12. **★`appsscript.json` の `webapp.access` を `MYSELF` に戻さない**：アプリ版(PWA)は GitHub Pages という
    **別オリジン**から `fetch` するので **`ANYONE_ANONYMOUS` が必須**。`MYSELF` のまま新バージョンをデプロイすると
    **アプリ版が丸ごと繋がらなくなる**。
    - 【実際にあった】2026-08-08 の clasp 導入時、ドライブ側だけ PWA化以前の `MYSELF` のまま取り残されていた。
      サーバー側は `ANYONE_ANONYMOUS`。気づかず push→デプロイしていたらアプリが死んでいた。**ドライブ側を修正済み**。
    - 公開範囲を広げても危なくない理由：データは `handleApi_` のトークン照合（`API_TOKEN`）で守られており、
      素のURLで来た他人には `doGet` のガードで案内文しか出ない。
13. **`.ps1` は BOM付きUTF-8 で保存する**：Windows PowerShell 5.1 は BOM が無い `.ps1` を cp932 として読むため、
    日本語コメントが化けて**構文エラーで起動すらしない**。`_publish.ps1` / `_push_gas.ps1` を編集したら保存形式に注意。
    確認方法（エラーが出なければOK）:
    ```
    $e=$null; [void][System.Management.Automation.Language.Parser]::ParseFile('_publish.ps1',[ref]$null,[ref]$e); $e
    ```
14. **`clasp push` 前に必ず突き合わせる**：`push` は**ドライブの中身でサーバーを上書き**する。サーバー側だけで直した
    変更は消える。久しぶりに触るときは §2-B' の `clone-script` で落として比較してから push すること。
15. **アプリ版で「読み込みに失敗しました」**：たいてい ①Apps Scriptを再デプロイして**新バージョンにしていない** ②デプロイのアクセスが
    「自分のみ」に戻っている ③トークン不一致、のどれか。⚙設定 →「🔌接続設定」で URL とトークンを入れ直せば直る。

---

## 12. バージョン履歴（ダイジェスト）
- v1.0 基本（リスト/カード/D&D/ラベル/期限/チェックリスト/コメント）
- v1.1 複数ボード / v1.2 添付(Drive) / v1.3 ボード一覧・カレンダー・並べ替え / v1.4 スタート/終わり日・終日・背景画像 / v1.5 Drive直結アップロード(動画)・完了チェック・日付色分け / v1.6 カスタムラベル
- v1.7 クイック編集 / v1.8 Trelloインポート / v1.9→v2.0 カスタムフィールド（評価軸を一般化, ボードごと）
- v2.0.1 ★スキーマ移行バグ修正（定数化・getSS_安全化・復旧関数）
- v2.1 アーカイブ / v2.2 ラベルをボードごと / v2.3 リマインダー・検索フィルター・カバー・複製/移動 / v2.4 スマホ長押しドラッグ＆ダークテーマ / v2.5 ボード一覧刷新 / v2.6 テーブル(保存ビュー) / v2.7 横断カレンダー・ダッシュボード・自動化 / v2.8 繰り返し・テンプレ・タイムライン・共有 / v2.9 リスト⋯メニュー
- v3.0 AI(Gemini)・WIP・キーボード / v3.1 説明自動リサイズ・YouTube埋め込み / v3.2 Google連携(カレンダー/タスク) / v3.3 軽量化(背景fixed除去等) / v3.4 YouTube facade / v3.5 モーダル内側スクロール / v3.6 自動バックアップ・更新/エラー表示・添付掃除
- **v3.7 アプリ版(PWA)**：JSON API（`doPost`＋`API_TOKEN`）新設、`_build_pwa.py` でビルド、GitHub Pages へ自動公開。スマホのホーム画面から起動
- **v3.8 遅延ロード**（`getInitial`/`getMeta`/`getCards`/`getAllCards`）＝起動が大幅に軽くなった。スクロール位置・開いていたカードの復元も追加
- **v3.9 地図/場所（SCHEMA 16）・リスト折りたたみ（SCHEMA 17）**
- **v3.10（2026-08-08 保守回）**：`webapp/index.html` を手作業コピーからビルド生成に変更（単一ソース化）、`_publish.ps1` 追加、作業用リポジトリを復旧、README/HANDOVER 整備、残骸ファイル削除
- **v3.11（2026-08-08）**：clasp 導入で Apps Script 側もコマンド反映に（`_push_gas.ps1`）。
  その初回突き合わせで**ドライブ側の `appsscript.json` が PWA化以前の `MYSELF` のまま取り残されていた事故要因を発見・修正**（§11-12）。
  併せてサーバー側に未反映だった iPhone セーフエリア対応CSS・折りたたみ件数のフィルター対応を反映し、全ファイル一致にした

---

## 13. 未実装 / TODO（次にやるなら）
- ~~遅延ロード~~ → **v3.8 で実装済み**（§7参照）
- 候補：説明のMarkdownプレビュー / PCのダークモード切替 / バーンダウン等の推移グラフ / カードの関連付け・依存 / 時間トラッキング・ポモドーロ / 音声でカード追加。
- 保守面の候補：Apps Script 側も `clasp` でコマンドから配信できるようにする（今はコピペ）。

---

## 14. 再開のしかた
- このセッションはローカルに記録されている。ターミナルで **`claude --resume`**（または `--continue`）でこの続きから再開可能。
- AIアシスタント（Claude Code）のメモリにプロジェクト経緯を保持（`~/.claude/projects/.../memory/project-overview.md` と `MEMORY.md`）。このHANDOVER.mdと合わせて読めば全体を素早く把握できる。
- まずは §4（スキーマ移行）と §11（つまずき集）に目を通してから着手するのが安全。

### 手を動かす前の3分チェック
```
1. python -c "import PIL"        … 何も出なければOK（出たら pip install Pillow）
2. python _build_pwa.py          … "ALL DONE" が出れば環境は生きている
3. アプリを開く                   … https://chichimaruo.github.io/mytrello/ が表示されるか
```
### 変更を1回転させる流れ
```
apps-script/ を編集
   ├─→ Apps Script にコピペ →「デプロイを管理」→ 新バージョン → Ctrl+Shift+R   （§2-B）
   └─→ _publish.ps1 を実行 → 1〜2分待つ → アプリを開き直す                     （§2-C）
```
**サーバー側（Code.gs）だけ直したときも両方**必要。Code.gs は Apps Script にしか無いが、
`API_ALLOWED` に関数を足し忘れると アプリ版だけ `unknown function` で失敗する。
