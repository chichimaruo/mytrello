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
| `_publish.ps1` | ビルドして GitHub へ公開するスクリプト（Windows 用） |
| `.github/workflows/deploy.yml` | push すると GitHub Pages へ自動公開 |
| `SETUP.md` | 初回セットアップ手順 |
| `HANDOVER.md` | **開発を再開するとき最初に読む引き継ぎ資料** |

> 正本は Google ドライブの `108 アプリ開発/My Trello Project`。
> このリポジトリは公開用のコピーで、`_publish.ps1` が同期します。

## 更新のしかた（要点）

1. `apps-script/` のファイルを編集する
2. **Apps Script 側**: script.google.com にコピペ →「デプロイを管理」→ 新バージョン
3. **アプリ側**: `_publish.ps1` を実行 → 1〜2分で公開反映

詳しくは `HANDOVER.md` の「デプロイ運用」を参照。
