# mindmap-js-app

シンプルなマインドマップアプリ。1つの `src/` から2つのビルドを生成する。

- **クラウド版** `dist/index.html` — Vercel で公開（https://mindmap.johosauce.com）。Supabase 認証・同期・共有あり
- **ローカル版** `dist/local.html` — 顧客配布用の自己完結HTML。外部通信ゼロ

HTMLは手書きせず `node build.js` が `src/` から生成する（dist/ は gitignore）。

## ローカル版の配布ルール（必須）

**先方（顧客）に渡すレベルのアップデートを行うときは、必ず `local-html-cleanup` スキル
（.claude/skills/local-html-cleanup/）を実行して dist/local.html のゴミ取り精査を行うこと。**

- 外部URL・SNSメタタグ・Supabase情報・個人情報・クラウド専用UIの残骸が対象
- 掃除は `build.js` のローカル版生成処理のみで行い、**クラウド版 dist/index.html の
  ビルド結果を1バイトも変えないこと**（変更前後の diff で無傷を証明する）
- `build.js` の `forbiddenInLocal` 配列が第1層の自動検知（ビルド/CIごとに実行され、
  禁止文字列が残っているとビルド失敗）。新しい外部参照を追加したら配列にも追記する

## 開発の進め方

- 1変更 = 1ブランチ = 1PR。CI（lint + Playwrightテスト）通過後にマージ
- main への push で Vercel が自動デプロイ（本番公開）
- バージョンは package.json の1箇所。build.js が両ビルドに注入する
- 検証は `npm test`（全テストスイート）と `npm run lint`
