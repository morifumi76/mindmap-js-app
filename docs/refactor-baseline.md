# リファクタリング ベースライン記録

記録日: 2026-06-12 ／ 対象コミット: `620bf7e`（main）

## ゴールデンマスター（ビルド出力の指紋）

`npm run build` の出力は決定的（同じ入力なら同じ出力）であることを確認済み。
リファクタ後にこのハッシュと一致すれば「挙動に影響なし」を証明できる。

```
sha256(dist/index.html) = caa1ade2f73d5631bc1bf5646447184c8a7c6b8014867cc8cca062546d5b27d1
```

- `dist/local.html` はビルド日付が埋め込まれるため毎回1行変わる（比較対象外）

## テストのベースライン（2026-06-12 時点）

実行方法: `npm run serve`（別ターミナル）→ `npm test`

| テスト | 結果 | 備考 |
|---|---|---|
| test_collapse.js | ❌ 起動時タイムアウト | `.node` が見つからない |
| test_grayout.js | ❌ 起動時タイムアウト | 同上 |
| test_sidebar.js | ❌ 起動時タイムアウト | 同上 |
| test_left_sidebar.js | ❌ 途中で異常終了 | 序盤の数件は pass、移行チェックで null 参照 |

### 原因（調査済み）

4本とも `http://localhost:8080/index.html`（クラウド版）を対象にしているが、
現在のクラウド版は未ログイン時に認証画面（`#authOverlay`）が表示され、
マインドマップ本体が描画されないため、全テストが `.node` 待ちで失敗する。
**テストは認証機能の導入前に書かれたまま未更新**ということ。

確認済みの事実: `local.html`（ローカル版・認証なし）ではノードが即描画される。
→ フェーズ2でテストの対象 URL を `local.html` に変更すれば復活させられる見込み。

## フェーズ2完了後の状態（2026-06-12 追記）

テストは `tests/` に再編成し、対象をローカル版 `local.html` に変更。
古い検証（UI再デザイン前のスタイル・廃止された「未分類」フォルダ仕様）は現行仕様に追従させた。

| テスト | 結果 |
|---|---|
| tests/collapse.test.js | ✅ 52/52 |
| tests/grayout.test.js | ✅ 60/60 |
| tests/sidebar.test.js | ✅ 63/63 |
| tests/left-sidebar.test.js | ✅ 78/78 |

- 実行方法: `npm test`（ビルド→サーバー起動→全テスト→後始末まで一括）
- ESLint: `npm run lint`（エラー0件。レガシー由来の warning 65件はフェーズ3/4で解消予定）
- CI: GitHub Actions（.github/workflows/ci.yml）が PR ごとに lint + テストを実行

## テスト整備中に発見したバグ（アプリ本体・未修正）

リファクタリング中は挙動変更をしない方針のため、記録のみ。フェーズ完了後に別途修正する。

1. **ノードをクリックしてもサイドバーのナビゲーションモードが解除されない**
   - 再現: 左サイドバーのマップ項目をクリック → キャンバスのノードをクリック → Enter や矢印キーを押す
   - 期待: キャンバス操作（ノード編集・ノード間移動）になる
   - 実際: サイドバー操作のまま（Enter でページのリネームが始まる等）
   - 原因: ノード上の mousedown は stopPropagation され、`sidebarNavigationMode` を解除する
     document レベルの mousedown リスナー（src/js/sidebar-left.js 付近）に届かない。
     解除されるのは「キャンバスの何もない場所」をクリックした時のみ。

## 環境メモ

- テスト実行には Playwright の Chromium が必要: `npx playwright install chromium`
- 手動確認用サーバーは `npm run serve`（tests/server.js が dist/ を 8080 番で配信）
