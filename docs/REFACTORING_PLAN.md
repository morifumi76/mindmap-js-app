# mindmap-js-app リファクタリング計画

作成日: 2026-06-11 ／ 対象バージョン: 2.0.0（コミット `620bf7e`）
復元ポイント: ローカルコピー `mindmap-js-app.backup-20260611-pre-refactor/` ＋ GitHub タグ `backup-20260611-pre-refactor`

---

## 現状調査で判明した「無駄」の棚卸し

### A. 死蔵ファイル（どこからも使われていない）
| 対象 | 規模 | 根拠 |
|---|---|---|
| ルートの `index.html` | 4,753行 | ビルドは `src/index.html` をテンプレートに `dist/` を生成。ルートの旧モノリスは src/ 分割前の遺物で、build.js からも vercel.json からも参照なし |
| `src/js/sidebar-left.js.bak` | 1,556行 | バックアップファイルが git 管理下に残存 |
| `src/js/keyboard.js.bak` | 221行 | 同上 |
| `src/js/auth.js` | 21行 | build.js の `JS_FILES` に含まれず。ES import 構文のため連結ビルドでは動作不能。参照は古い作業メモのみ |
| `src/js/supabase-client.js` | 16行 | 同上（auth.js からのみ import される） |

### B. リポジトリ衛生
- `dist/index.html`（891KB）・`dist/local.html`（379KB）がコミットされている。Vercel は `buildCommand: npm run build` で自前ビルドするため不要
- `.DS_Store` がルートと `src/` で git 追跡されている（`.gitignore` 未登録）
- 日付付き作業メモ7本（`20260318_*.md` 〜 `20260322_*.md`）がリポジトリ直下に散乱
- `package.json`: `esbuild`・`playwright` が `dependencies` に入っている（開発専用なので `devDependencies` が正しい）
- `dev` スクリプトが package.json 内の `node -e` ワンライナー（読めない・直せない）

### C. テストの未整備
- `test_*.js`（Playwright製、計4本・約2,160行）がリポジトリ直下に置かれ、`npm test` なし
- `http://localhost:8080` 前提だがサーバー起動コマンドがどこにも定義されていない
- assert ヘルパー等が4ファイルにコピペ重複

### D. アーキテクチャ上の負債（最大の問題）
- **連結ビルド**: build.js が 18個の JS を文字列連結して1つの IIFE に詰める方式。全ファイルがスコープを暗黙共有し、`import`/`export` が一切ない。どの関数がどこから呼ばれるか機械的に追えず、これがあらゆる変更を危険にしている根因
- **グローバル可変状態**: `state.js` がトップレベル `let` 変数群（`mindMapData`, `selectedNodeIds`, `viewState` 等）で、全モジュールが直接書き換える
- **巨大ファイル**: `sidebar-left.js` 2,055行（44関数）／ `relations.js` 809行 ／ `app-init.js` 675行 ／ `init.js` 581行
- **init の二重化**: `init.js` と `app-init.js` の責務境界が不明瞭

---

## フェーズ計画

原則: **1フェーズ = 1ブランチ = 1PR**。マージしてから次へ。全フェーズで挙動変更ゼロ（バグを見つけてもメモして別対応）。各コミットで build + テストが green であること。

### フェーズ0: 安全網の整備（目安: 半日）
ゴール: 「壊れたら即わかる」状態を作る。コード変更なし。

1. `npm run build` を実行し、`dist/index.html` が git HEAD と一致することを確認（連結ビルドは決定的。`local.html` のみビルド日付が入る）→ この出力を**ゴールデンマスター**として控える
2. `package.json` に最低限のスクリプトを追加:
   - `serve`: `npx http-server dist -p 8080`（または `python3 -m http.server`）
   - `test`: 4本の test_*.js を順次実行
3. 全テストを実行し、**現時点の pass/fail を記録**（最初から fail しているものを把握しておかないと、リファクタ起因か判別できなくなる）

検証: テスト結果のベースラインが docs/ に記録されている。

### フェーズ1: 死蔵ファイルの一掃（目安: 1日、リスク: 極小）
ゴール: 約7,000行・1.3MB をリポジトリから削減。ビルド出力はバイト単位で不変。

1. 削除: ルート `index.html`、`*.bak` 2本、`src/js/auth.js`、`src/js/supabase-client.js`
2. `dist/` を git 追跡から外す: `git rm -r --cached dist` + `.gitignore` に `dist/` 追加（vercel.json がビルドするため動作影響なし。デプロイで要確認 → 検証手順3）
3. `.DS_Store` を `git rm --cached` + `.gitignore` に追加
4. 作業メモ7本を `docs/notes/` へ移動
5. `package.json`: `esbuild`・`playwright` を `devDependencies` へ移動。`dev` ワンライナーを `scripts/dev.js` に切り出し
6. `package-lock.json` の name 修正（未コミット分）もここで取り込む

検証:
- `npm run build` 成功、`dist/index.html` がフェーズ0のゴールデンマスターと一致
- 全テストがベースラインと同じ結果
- Vercel のプレビューデプロイが成功し、クラウド版・共有URL（`/share/*` rewrite）が動く

### フェーズ2: テスト基盤の整備（目安: 1〜2日、リスク: 小）
ゴール: フェーズ3以降の大手術に耐える安全網。

1. `test_*.js` → `tests/` へ移動し、重複している assert・ブラウザ起動・サーバー前提を `tests/helpers.js` に共通化
2. `npm test` 一発で「build → サーバー起動 → 全テスト → 後始末」が走るランナー（`tests/run-all.js`）を作成
3. ESLint 導入（`no-undef` / `no-unused-vars` 中心）。連結ビルドの暗黙グローバルを洗い出す目的なので、初回は警告だらけで正常。グローバル一覧を `eslint.config.js` の `globals` に明示することで「ファイル間の暗黙依存マップ」が手に入る — これがフェーズ3の設計資料になる
4. GitHub Actions: PR ごとに build + lint + テストを実行
5. ローカル版 `dist/local.html` のスモークテストを1本追加（現状テストはクラウド版の `index.html` のみ対象）

検証: CI が green。ローカルでも `npm test` が完走する。

### フェーズ3: ESモジュール化（目安: 3〜5日、リスク: 中。本丸その1）
ゴール: 文字列連結 → esbuild バンドルに移行し、全依存を `import`/`export` で明示化。

方針:
- `src/js/app.js` をエントリポイントに新設し、build.js を `buildSync({ entryPoints, bundle: true, format: 'iife' })` に変更（storage-supabase.js では既に同じ方式を使用済みなので延長線上）
- 連結順 = 依存の浅い順なので、**葉から順に**モジュール化する:
  `utils` → `history` → `state` → `storage` → `nodes` / `selection` / `editing` → `clipboard` / `drag` / `lasso` / `render` → `relations` → `keyboard` / `canvas-interaction` → `sidebar-right` / `sidebar-left` → `init` / `app-init`
- 1ファイル変換するごとに build + テスト実行。ESLint `no-undef` が見落とし参照を機械検出する
- `state.js` のグローバル `let` 群は、このフェーズでは `export const state = {...}` への集約まで（アクセサ設計などの改善はフェーズ4へ。一度に変えない）
- storage アダプター切替（supabase / local の2ビルド）は esbuild の `alias` か entryPoint 差し替えで実現し、build.js の文字列置換ハックを削減

検証: 全テスト green ＋ クラウド版/ローカル版の手動スモーク（作成・編集・保存・リロード・共有URL・JSONバックアップ）。
注意: バンドル化で dist の中身は変わるため、ゴールデンマスター比較はこのフェーズで卒業し、以後はテストが正。

### フェーズ4: 巨大ファイルの分割と責務整理（目安: 3〜5日、リスク: 中。本丸その2）
ゴール: 1ファイル500行以下を目安に、責務単位の構成へ。

1. `sidebar-left.js`（2,055行・44関数）を分割。着手前に関数一覧から責務マップを作り、おおよそ以下を想定（実態を見て確定）:
   - ツリー描画 / フォルダ開閉・階層 / ドラッグ&ドロップ / コンテキストメニュー / マップ一覧・切替 / キーボード操作
2. `init.js` + `app-init.js` の統合・再編: 「DOM イベント結線」と「起動シーケンス（認証→データロード→初回描画）」に役割を分離
3. `relations.js`（809行）: データモデル操作と SVG 描画の分離
4. ESLint `no-unused-vars` で浮いた未使用関数・重複ロジックを削除
5. （任意）CSS 監査: `auth.css` 558行など、ローカル版で丸ごと不要なスタイルの整理

検証: 各分割ごとにテスト green。フェーズ末に手動スモーク一式。

### フェーズ5: 仕上げ（目安: 1日）
1. README 更新: アーキテクチャ図（モジュール構成）、開発手順（dev / build / test）、デプロイの仕組み
2. Prettier（または Biome）でフォーマット統一を最後に一括適用（diff 汚染を避けるため最終フェーズで）
3. バージョンを 2.1.0 にバンプしてリリース
4. このファイルに各フェーズの完了日と学びを追記してクローズ

---

## リスク管理

- **戻し方**: いつでも `git checkout backup-20260611-pre-refactor`。フェーズ単位なら該当 PR を revert
- **最重要の検証対象**: 保存系（Supabase 同期・localStorage・JSON バックアップ）。テストが薄い領域なので、フェーズ3・4の後は必ず手動確認
- **やらないこと**: 機能追加、UI 変更、フレームワーク導入、TypeScript 化（モジュール化が済めば後からいつでもできる。今回のスコープ外）

## 進捗記録

- [ ] フェーズ0: 安全網
- [ ] フェーズ1: 死蔵ファイル一掃
- [ ] フェーズ2: テスト基盤
- [ ] フェーズ3: ESモジュール化
- [ ] フェーズ4: 巨大ファイル分割
- [ ] フェーズ5: 仕上げ
