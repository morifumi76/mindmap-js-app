# 🧠 マインドマップアプリ（mindmap-js-app）

ブラウザで動作するマインドマップツール。フレームワークなしの Vanilla JS 製で、
ビルドすると **単一 HTML ファイル** として出力されます。

## 2つのビルド

| ビルド | 出力 | 保存先 | 用途 |
|---|---|---|---|
| クラウド版 | `dist/index.html` | Supabase（要ログイン） | Vercel で公開。共有URL（`/share/*`）対応 |
| ローカル版 | `dist/local.html` | ブラウザの localStorage | 配布用。外部通信なし・JSONバックアップ付き |

本体コードは両ビルド共通で、保存アダプター（`storage-supabase.js` / `storage-local.js`）だけが差し替わります。

## 主な機能

- マルチマップ＋フォルダ管理（左サイドバー、ドラッグ&ドロップ、複数選択、undo/redo）
- ノード編集（Enter/Tab での追加、F2 編集、コピー/カット/ペースト、ドラッグ移動）
- 関連線（ノード間を線で結ぶ・メモラベル付き）
- グレーアウト / ハイライト / 各種カラー（Option+Cmd+G / Y / B / M / A）
- 折りたたみ、テキスト形式でのコピー出力、ひよこモード 🐤

## 開発

```bash
npm install
npx playwright install chromium   # テスト実行に必要（初回のみ）

npm run dev     # src/ を監視して自動ビルド
npm run serve   # dist/ を http://localhost:8080 で配信
npm run build   # dist/index.html と dist/local.html を生成
npm test        # ビルド → サーバー起動 → 全テスト → 後始末 まで一括
npm run lint    # ESLint（エラー・警告ゼロ運用）
```

## アーキテクチャ

```
src/
├── index.html        # テンプレート（BUILD マーカーに CSS/JS が注入される）
├── css/              # 結合順は build.js の CSS_FILES 参照
└── js/
    ├── app.js        # エントリポイント（esbuild がここからバンドル）
    ├── state.js      # アプリ全体の状態と setter
    ├── storage.js    # localStorage の読み書き・スキーマ移行
    ├── storage-supabase.js / storage-local.js   # 保存アダプター（ビルドで差し替え）
    ├── nodes.js / selection.js / editing.js / clipboard.js / drag.js / lasso.js
    ├── render.js / keyboard.js / canvas-interaction.js
    ├── relations/    # 関連線（model / geometry / draw / labels / connection / ...）
    ├── sidebar-left/ # 左サイドバー（render / crud / dnd / events / ...）
    ├── sidebar-right.js / link-modal.js
    ├── init.js       # 起動処理・URL ルーティング
    └── cloud/        # クラウド版の認証・同期・共有・起動（boot / auth-ui / sync / ...）
```

- モジュールは ES Modules（import/export）。`build.js` が esbuild で IIFE にバンドルし、
  CSS とともに `src/index.html` のマーカー位置へインライン展開して単一 HTML を生成します
- 他モジュールから再代入される状態変数は `state.js` の setter 経由で書き換えます
  （import 束縛は読み取り専用のため）

## テスト

Playwright によるブラウザテスト（`tests/`、約250アサーション）。
対象はローカル版 `dist/local.html`（クラウド版は認証画面のため対象外）。
PR ごとに GitHub Actions（`.github/workflows/ci.yml`）で lint + テストが実行されます。

## デプロイ

Vercel（`vercel.json`）。push すると `npm run build` が実行され `dist/` が公開されます。
`/share/*` は `index.html` に rewrite されます。

## ドキュメント

- `docs/REFACTORING_PLAN.md` — 2026-06 リファクタリングの計画と実施記録
- `docs/refactor-baseline.md` — テスト基盤の経緯・既知バグの記録
- `docs/notes/` — 機能ごとの仕様メモ（日付付き）
