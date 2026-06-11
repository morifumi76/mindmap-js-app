`20260320_bugfix-folder-hierarchy-not-persisted.md`

<aside>
📋

この指示書の使い方：　このページの内容をまるごとコピーしてClaudeCodeに渡してください。

この指示書だけで必要な情報はすべて記載しています。過去と重複する指示がある場合、本指示書の内容を「正」としてください。

</aside>

# 1. 概要

マインドマップWebアプリ（[mindmap.johosauce.com](http://mindmap.johosauce.com)）のフォルダ多階層化において、**フォルダの親子関係（`parentFolderId`）がリロード後に失われる不具合** を修正する。

---

# 2. 現在のプロジェクト構成

```
mindmap-app/
├── build.js              ← ビルドスクリプト
├── dist/
│   └── index.html        ← ビルド後の成果物
├── package.json
├── src/
│   ├── css/
│   │   ├── base.css
│   │   ├── canvas.css
│   │   ├── sidebar-left.css
│   │   ├── sidebar-right.css
│   │   └── ui.css
│   ├── js/
│   │   ├── canvas-interaction.js
│   │   ├── clipboard.js
│   │   ├── drag.js
│   │   ├── editing.js
│   │   ├── history.js
│   │   ├── init.js
│   │   ├── keyboard.js
│   │   ├── lasso.js
│   │   ├── render.js
│   │   └── sidebar.js
│   └── index.html        ← ソースHTML
└── supabase-instructions.md
```

---

# 3. 不具合の内容

## 3.1 再現手順

**パターンA：フォルダ移動**

1. 1階層目にフォルダAとフォルダBがある
2. フォルダAをドラッグして、フォルダBの中にドロップする（2階層目に移動）
3. 見た目上はフォルダBの中にフォルダAが入る → ✅ ここまでは正常
4. **ブラウザをリロードする**
5. フォルダAが1階層目に戻ってしまう → ❌ **不具合**

**パターンB：サブフォルダ新規作成**

1. フォルダBの ⋯メニュー から「📁 フォルダを追加」でサブフォルダを作成
2. 見た目上はフォルダBの中にサブフォルダができる → ✅ ここまでは正常
3. **ブラウザをリロードする**
4. サブフォルダが1階層目に出てしまう → ❌ **不具合**

## 3.2 期待される動作

- フォルダの移動・サブフォルダの新規作成後、**リロードしても親子関係が維持される**
- `parentFolderId` がlocalStorageに正しく保存され、リロード時に正しく読み込まれること

## 3.3 推定原因

フォルダの `parentFolderId` に関する永続化処理に問題がある。以下のいずれか（または複数）が原因と考えられる：

### 原因候補1：保存時に `parentFolderId` が含まれていない

- フォルダデータをlocalStorageに保存する際、`parentFolderId` プロパティが保存対象に含まれていない
- または、保存処理が走る前のタイミングで `parentFolderId` がセットされていない

### 原因候補2：読み込み時に `parentFolderId` が無視されている

- localStorageからフォルダデータを読み込む際、`parentFolderId` をパースしていない
- または、読み込み後のフォルダツリー構築ロジックが `parentFolderId` を参照していない

### 原因候補3：保存のタイミングが漏れている

- フォルダのD&D移動後にlocalStorageへの保存処理（`saveMetaList` 等）が呼ばれていない
- サブフォルダ新規作成後にlocalStorageへの保存処理が呼ばれていない

---

# 4. 修正方針

## 4.1 調査手順

1. **localStorageの中身を確認：** フォルダ移動後、リロード前にDevToolsのApplication → Local Storageでフォルダデータを確認し、`parentFolderId` が保存されているか確認する
2. **保存処理の追跡：** フォルダ移動・サブフォルダ作成時に呼ばれる保存関数を特定し、`parentFolderId` が保存対象に含まれているか確認する
3. **読み込み処理の追跡：** ページロード時のフォルダデータ読み込み処理で、`parentFolderId` が正しく復元されるか確認する

## 4.2 修正のポイント

- フォルダの保存データに `parentFolderId` が **必ず含まれる** ようにする
- フォルダのD&D移動時に `parentFolderId` を更新した後、**必ずlocalStorageに保存する**
- サブフォルダ新規作成時に `parentFolderId` をセットした後、**必ずlocalStorageに保存する**
- ページロード時にフォルダデータを読み込む際、`parentFolderId` を使って **正しいツリー構造を復元する**

## 4.3 データ構造の確認

フォルダデータは以下の構造であるべき（前回の修正Aで定義済み）：

```json
{
  "folders": [
    {
      "id": "folder-1",
      "name": "メモ",
      "parentFolderId": null,
      "order": 0
    },
    {
      "id": "folder-1-1",
      "name": "old",
      "parentFolderId": "folder-1",
      "order": 0
    }
  ]
}
```

- `parentFolderId: null` → ルート階層（1階層目）のフォルダ
- `parentFolderId: "folder-1"` → folder-1 の中にあるサブフォルダ

---

# 5. 作業の進め方

1. まずDevToolsでlocalStorageの中身を確認し、`parentFolderId` が保存されているか確認する
2. `sidebar.js` を中心に、フォルダの保存・読み込み処理を確認する
3. 原因を特定し、修正を実施する
4. 以下のテストケースで動作確認する：
    - フォルダをD&Dで別フォルダ内に移動 → リロード → 親子関係が維持されること
    - サブフォルダを新規作成 → リロード → 親フォルダ内に残っていること
    - 3階層以上のネスト → リロード → 全階層が維持されること
    - 既存のフォルダ・マップページに影響がないこと
5. 変更後、ビルド（`node build.js`）してから動作確認する
6. 完了後、`git add` → `git commit` → `git push` する

---

# 6. 注意事項

- 既存のフォルダ・マップページのデータを壊さないこと
- localStorageの後方互換性を維持すること（`parentFolderId` が存在しない旧データは `null` として扱う）
- フォルダの展開/折りたたみ状態はリロード後も維持されること（既存機能）
- マップページの `folderId`（所属フォルダ）には影響を与えないこと