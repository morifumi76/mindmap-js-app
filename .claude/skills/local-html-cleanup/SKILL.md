---
name: local-html-cleanup
description: 顧客配布用ローカル版（dist/local.html）のゴミ取り精査。納品・配布・先方に渡す・デンソー提出・ローカル版のアップデートの際に必ず実行する。外部URL・SNSメタタグ・Supabase情報・個人情報・クラウド専用UIの残骸をチェックし、クラウド版（dist/index.html）に一切影響を与えずに掃除する。
---

# ローカル版（local.html）ゴミ取り精査

顧客に渡す `dist/local.html` に不要な情報（ゴミ）が含まれていないかを精査し、
必要なら **build.js のローカル版生成処理だけ** を直して掃除する手順。

## 大原則（絶対に守る）

1. **クラウド版 `dist/index.html` のビルド結果を1バイトも変えない。**
   - 修正は `build.js` の「ローカル版（dist/local.html）」セクションの置換処理のみに入れる
   - `src/index.html` テンプレートや共通JS/CSSは両ビルド共通なので、そこを変えるとクラウド版も変わる＝原則触らない
2. 作業前に必ずクラウド版を退避し、作業後に diff で無傷を証明する（下記手順4）。

## 2層の防御構造

- **第1層（自動・毎ビルド）**: `build.js` の `forbiddenInLocal` 配列。ローカル版に禁止文字列が
  残っているとビルド自体が失敗する。CI（PRごと）でも実行されるため、ゴミの再混入は自動検知される。
  **新しい外部参照やクラウド専用UIを追加したら、この配列にも追記すること。**
  注意: 要素IDはバンドル済みJS（死にコード）内にも文字列として残るため、`id="..."` の形で登録する。
- **第2層（納品時・このスキル）**: 下記の全カテゴリを目視精査する。第1層は既知のパターンしか
  検知できないため、納品前は必ずこちらも実行する。

## 精査手順

### 1. 最新ビルド

```bash
cd ~/dev/apps/mindmap-js-app && git checkout main && git pull && npm run build
```

ビルドが通ること自体が第1層チェックの合格を意味する。

### 2. カテゴリ別スキャン（dist/local.html に対して）

```bash
# 外部URL（http/https）の一覧 — data:URI と w3.org(SVG名前空間) 以外が出たら要確認
grep -oE 'https?://[^"'"'"'  <>)]+' dist/local.html | sort | uniq -c | sort -rn

# SNS・メタタグ・外部サービス
grep -inE 'og:|twitter|x\.com|facebook|instagram|notion\.site|canonical' dist/local.html

# Supabase・鍵・認証情報（eyJ はJWTの先頭）
grep -inE 'supabase|eyJ[A-Za-z0-9]|api[_-]?key|secret|token' dist/local.html | grep -v "テキスト中の誤検知を目視除外"

# 個人情報・開発痕跡
grep -inE 'morita|森田|fumiya|@gmail|@johosauce|localhost|TODO|FIXME' dist/local.html

# 外部通信API（呼び出しコードが1件もないこと。コメント内の言及は可）
grep -nE 'fetch\(|XMLHttpRequest|sendBeacon|new WebSocket' dist/local.html

# クラウド専用UI要素（HTMLに残っていないこと）
grep -nE 'id="(authOverlay|setPasswordOverlay|migrationOverlay|shareOverlay|readonlyBanner)"' dist/local.html
```

### 3. ゴミが見つかったら

- `build.js` のローカル版セクション（`// --- ローカル版（dist/local.html） ---` 以降）に
  置換処理を追加して除去する（既存の置換 3〜5 と同じパターン）
- 同時に `forbiddenInLocal` 配列へ検知パターンを追記（第1層の強化）
- クラウド専用UIのHTMLを除去する場合は、対応するJS配線に
  要素の存在チェック（`if (!el) return`）があることを確認してから行う

### 4. クラウド版の無傷証明（必須）

```bash
# build.js 変更前に退避 → 変更後に再ビルド → diff
cp dist/index.html /tmp/index-before.html
npm run build
diff /tmp/index-before.html dist/index.html && echo "クラウド版 完全一致（無傷）"
```

差分が出たら共通部分を触ってしまっている。ローカル版セクションだけの変更に修正すること。
（バージョン番号を上げた場合はバージョン文字列のみの差分は許容）

### 5. 動作確認と納品

- `npm test` 全スイート成功（ローカル版に対するテスト群を含む）
- `dist/local.html` をブラウザで直接開き、起動・編集・保存を確認
- 納品物は `dist/local.html` 1ファイル（自己完結・外部通信ゼロ）

## 過去の経緯（参考）

- 2026-06 PR #39: 初回の外部通信ゼロ化（app-local.js方式）→ **未マージのまま残骸が残った**
- 2026-07-08 PR #47 (v2.4.3): OGP/Twitterメタ・Notionリンク・クラウド専用UIを除去し、
  `forbiddenInLocal` による自動検知を導入（マージ済み・現行方式）
- Supabase接続情報はローカル版の保存アダプター（storage-local.js）に元から含まれない
