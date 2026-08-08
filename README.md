# My Trello

Trello の代わりに自作した、自分専用のかんばんアプリ。
サーバーは Google Apps Script、データは自分の Google ドライブ内のスプレッドシートです（完全無料）。

- **アプリ（スマホ・PC）**: https://chichimaruo.github.io/mytrello/
- 初回だけ Apps Script の URL と秘密トークンを聞かれます（端末に保存されます）。

## このリポジトリの中身

| 場所 | 何が入っているか |
|---|---|
| `apps-script/` | **本体のソース。編集するのはここだけ。** Apps Script にコピペする4ファイル |
| `webapp/` | `apps-script/` から**自動生成**される公開用ファイル。手で編集しない |
| `_build_pwa.py` | `apps-script/` → `webapp/` の変換ビルド |
| `_publish.cmd` | **ビルドして GitHub へ公開（これをダブルクリック）** |
| `_push_gas.cmd` | **Apps Script 側へ clasp で反映（これをダブルクリック）** |
| `_publish.ps1` / `_push_gas.ps1` | 上の2つが呼ぶ中身。直接ダブルクリックしないこと（下記） |
| `.github/workflows/deploy.yml` | push すると GitHub Pages へ自動公開 |
| `SETUP.md` | 初回セットアップ手順 |
| `HANDOVER.md` | **開発を再開するとき最初に読む引き継ぎ資料** |

> 正本は Google ドライブの `108 アプリ開発/My Trello Project`。
> このリポジトリは公開用のコピーで、`_publish.ps1` が同期します。

## 更新のしかた（要点）

1. `apps-script/` のファイルを編集する
2. **Apps Script 側**: `_push_gas.cmd` をダブルクリック
3. **アプリ側**: `_publish.cmd` をダブルクリック → 1〜2分で公開反映

> **`.ps1` を直接ダブルクリックしないこと。** Googleドライブは同期ファイルに
> 「インターネット由来」の印を付けるため、実行ポリシー `RemoteSigned` に弾かれて
> 黒い画面が一瞬出て消えるだけになります。`.cmd` から起動すれば回避できます。

詳しくは `HANDOVER.md` の「デプロイ運用」を参照。
