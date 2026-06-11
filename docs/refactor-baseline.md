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

## 環境メモ

- テスト実行には Playwright の Chromium が必要: `npx playwright install chromium`
- サーバーは `npm run serve`（python3 の http.server で dist/ を 8080 番で配信）
