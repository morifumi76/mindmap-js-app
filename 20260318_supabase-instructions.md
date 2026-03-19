<aside> 📋

この指示書の使い方: このページの内容をまるごとコピーしてClaudeCodeに渡してください。

この指示書だけで実装に必要な情報はすべて網羅しています。 現行仕様書（2026-03-09版）は最新のリファクタリングやログイン仕様が反映されていないため、渡すと混乱する可能性があります。ClaudeCodeは実際のソースコードも読めるため、UI仕様の詳細はコードから判断できます。

</aside>

1. 概要
マインドマップWebアプリ（mindmap.johosauce.com）に Supabaseを使ったブラウザログイン機能とクラウドデータ保存機能 を追加してください。

現在の保存方式は localStorage（ブラウザ内保存）です。これを Supabase（PostgreSQL） に移行し、以下を実現します：

メール＋パスワードでのログイン／ログアウト
マップデータのクラウド保存（ログインユーザーのみ）
共有URLによる閲覧専用公開（ログイン不要で閲覧可能）
既存のlocalStorageデータからの移行機能
重要な前提：

ユーザー登録は 招待制（Supabaseダッシュボードから管理者が手動追加）。アプリ上にサインアップUIは不要
フレームワークは使わない（Vanilla JS）
画面の見た目や操作感は極力変えない
2. Supabase接続情報
Project URL: <https://aobeqireuzbovergbzqj.supabase.co>
anon public key: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFvYmVxaXJldXpib3ZjcmdienFqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM3MzYyMzAsImV4cCI6MjA4OTMxMjIzMH0.xecJ7YzpVmxnf1W16WulhJKEF0c-QKLFrMk0KUxRMTA
3. 現在のプロジェクト構成
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
│   ├── index.html        ← ソースHTML
│   └── js/
│       ├── canvas-interaction.js
│       ├── clipboard.js
│       ├── drag.js
│       ├── editing.js
│       ├── history.js
│       ├── init.js
│       ├── keyboard.js
│       ├── lasso.js
│       ├── nodes.js
│       ├── render.js
│       ├── selection.js
│       ├── sidebar-left.js   ← 37KB（左サイドバー管理）
│       ├── sidebar-right.js
│       ├── state.js
│       ├── storage.js        ← 12KB（★改修の中心）
│       └── utils.js
改修の中心ファイル: src/js/storage.js（12KB）

現在localStorageとのやりとりをすべて担当している
このファイルをSupabase版に差し替える（または切り替える）
4. テーブル設計（SQL）
以下のSQLをSupabaseのSQL Editorで実行してテーブルを作成してください。

-- ============================================
-- 1. profiles テーブル（ユーザー情報）
-- ============================================
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  display_name TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- auth.usersにユーザーが作成されたら自動でprofilesにも追加するトリガー
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email)
  VALUES (NEW.id, NEW.email);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================
-- 2. folders テーブル（フォルダ管理）
-- ============================================
CREATE TABLE public.folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- 3. maps テーブル（マップデータ）★メイン
-- ============================================
CREATE TABLE public.maps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '無題のマップ',
  data JSONB,
  folder_id UUID REFERENCES public.folders(id) ON DELETE SET NULL,
  is_public BOOLEAN DEFAULT false,
  share_id TEXT UNIQUE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- updated_at を自動更新するトリガー
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER maps_updated_at
  BEFORE UPDATE ON public.maps
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ============================================
-- 4. RLS（Row Level Security）
-- ============================================

-- profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles_select_own" ON public.profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "profiles_update_own" ON public.profiles
  FOR UPDATE USING (auth.uid() = id);

-- folders
ALTER TABLE public.folders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "folders_select_own" ON public.folders
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "folders_insert_own" ON public.folders
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "folders_update_own" ON public.folders
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "folders_delete_own" ON public.folders
  FOR DELETE USING (auth.uid() = user_id);

-- maps
ALTER TABLE public.maps ENABLE ROW LEVEL SECURITY;

-- 自分のマップ：全操作OK
CREATE POLICY "maps_select_own" ON public.maps
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "maps_insert_own" ON public.maps
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "maps_update_own" ON public.maps
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "maps_delete_own" ON public.maps
  FOR DELETE USING (auth.uid() = user_id);

-- 共有マップ：誰でも閲覧OK（ログイン不要）
CREATE POLICY "maps_select_shared" ON public.maps
  FOR SELECT USING (is_public = true AND share_id IS NOT NULL);

-- ============================================
-- 5. インデックス
-- ============================================
CREATE INDEX idx_maps_user_id ON public.maps(user_id);
CREATE INDEX idx_maps_share_id ON public.maps(share_id) WHERE share_id IS NOT NULL;
CREATE INDEX idx_folders_user_id ON public.folders(user_id);
5. 実装要件
5.1 パッケージ追加
npm install @supabase/supabase-js
5.2 新規ファイル作成
src/js/supabase-client.js（Supabase初期化）
// Supabaseクライアントの初期化
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = '<https://aobeqireuzbovergbzqj.supabase.co>'
const SUPABASE_ANON_KEY = 'ここにanon keyを設定'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
src/js/auth.js（認証まわり）
以下の機能を実装：

login(email, password) — ログイン
logout() — ログアウト
getCurrentUser() — 現在のログインユーザーを取得
onAuthStateChange(callback) — 認証状態の変化を監視
src/css/auth.css（ログイン画面のスタイル）
5.3 storage.js の改修方針
現在の storage.js の主要な機能（これらをSupabase版に置き換える）：

現在の関数（localStorage）	Supabase版でやること
マップデータの保存	maps テーブルにUPSERT
マップデータの読み込み	maps テーブルからSELECT
マップ一覧の取得	maps テーブルからSELECT（user_idでフィルタ）
マップの新規作成	maps テーブルにINSERT
マップの削除	maps テーブルからDELETE
マップの複製	既存マップをSELECT → 新しいレコードとしてINSERT
マップ名の変更	maps テーブルのnameをUPDATE
フォルダ操作	folders テーブルのCRUD
最後に開いたマップID	localStorageに残す（UIの利便性のため）
重要: ログインしていない状態（共有URL閲覧時）でもアプリが動く必要がある。

6. 認証フロー
6.1 ログイン画面
アプリにアクセスしたとき、ログインしていなければ ログイン画面 を表示
ただし、共有URL（/share/xxxxx）でアクセスした場合はログイン画面を表示しない（直接マップを閲覧モードで表示）
ログイン画面にはメールアドレスとパスワードの入力欄、ログインボタンのみ
サインアップ（新規登録）ボタンは不要（招待制のため）
ログインエラー時は「メールアドレスまたはパスワードが正しくありません」と表示
6.2 ログイン後
ログイン成功 → メインのマインドマップ画面を表示
最後に開いていたマップを自動で開く
ログイン状態はSupabaseのセッションで管理（ブラウザを閉じてもセッションが残る）
6.3 ログアウト
左サイドバーの下部に「ログアウト」ボタンを追加
ログアウト → ログイン画面に戻る
7. 共有URL機能
7.1 共有ボタン
左サイドバーのマップの ⋯ メニューに 「🔗 共有」 を追加
クリックすると共有ダイアログを表示：
共有ON/OFFのトグルスイッチ
ONにすると share_id を自動生成し、共有URLを表示
「URLをコピー」ボタン
OFFにすると is_public = false に更新（URLは無効になる）
7.2 共有URL形式
<https://mindmap.johosauce.com/share/{share_id}>
例: https://mindmap.johosauce.com/share/abc123xyz

7.3 共有URLでのアクセス時の挙動
URLの /share/xxxxx を検出したら、ログイン不要でそのマップを取得
閲覧専用モード で表示：
ノードの編集不可
ノードの追加・削除不可
キーボードショートカットによる編集操作を無効化
左サイドバー（マイマップ）は非表示
右サイドバーは表示する（コピーボタンは有効）
ズーム・パン操作は可能
折りたたみ/展開は可能
存在しない share_id や is_public = false のマップにアクセスした場合は「このマップは共有されていません」と表示
8. データ保存の挙動
8.1 自動保存
現在と同じく、ノードの追加・編集・削除時に自動保存
ただし Supabaseへの保存はデバウンス（2秒間操作がなければ保存） を入れること（APIコール削減のため）
保存中はどこかに小さなインジケーター（例：「保存中...」「✅ 保存済み」）を表示
8.2 オフライン対応（簡易）
ネットワークエラー時は一時的にlocalStorageにフォールバック保存
次回オンライン時にSupabaseに同期
完全なオフライン対応は不要（あくまで一時的なフォールバック）
9. localStorageからの移行（マイグレーション）
9.1 マイグレーションフロー
ユーザーがログインする
localStorageに既存のマインドマップデータがあるか確認
データがあれば モーダルダイアログ を表示：
┌─────────────────────────────────────┐
│  📦 データの移行                       │
│                                      │
│  ブラウザに保存されているマインドマップ    │
│  データが見つかりました。                │
│  クラウドに移行しますか？               │
│                                      │
│  マップ数: 5件                         │
│  フォルダ数: 2件                       │
│                                      │
│    [移行する]    [あとで]              │
└─────────────────────────────────────┘
「移行する」→ localStorageの全マップ＆フォルダをSupabaseにINSERT
移行完了後、「✅ 移行が完了しました」と表示
localStorageのデータは 削除しない（バックアップとして残す）
localStorageに mindmap-migrated-supabase フラグを立てて、次回以降は聞かない
9.2 移行するデータ
localStorageのキー	移行先
mindmap-meta（配列の各エントリ）	maps テーブル（name, folder情報）
mindmap-data-{id}（各マップのJSON）	maps テーブルの data カラム
フォルダ情報（metaに含まれる）	folders テーブル
10. UI変更まとめ
場所	変更内容
ログイン画面（新規）	メール＋パスワード入力、ログインボタン
左サイドバー下部	「ログアウト」ボタン追加
左サイドバー⋯メニュー	「🔗 共有」メニュー追加
共有ダイアログ（新規）	ON/OFFトグル、URLコピーボタン
マイグレーションダイアログ（新規）	初回ログイン時のデータ移行確認
保存インジケーター（新規）	「保存中...」「✅ 保存済み」表示
閲覧専用モード	共有URLアクセス時の制限UI
11. デザインガイドライン
既存のデザインと統一すること：

要素	値
メインカラー	#37352f（Notionダークグレー）
ボタン背景	#37352f
ボタン文字色	#ffffff
ボタンborder-radius	6px
ホバー色	#f7f7f5
フォント	Meiryo UI
セパレーター	1px solid #e8e8e8
トグルスイッチ	iOS風カプセル（40px × 20px）、ON色: #37352f、OFF色: #d4d4d4
ログイン画面もこのデザインテイストに揃えること。シンプルでNotionライクなデザインにする。

12. build.js への影響
@supabase/supabase-js をインポートするため、ビルドプロセスに影響がある
現在の build.js がどのようにバンドルしているか確認し、必要に応じて修正すること
ESモジュール（import/export）の利用を前提とする場合、ビルドツール（例: esbuild, rollup）の導入が必要になるかもしれない
最終的に dist/index.html に1ファイルとして出力するビルドフローを維持すること
13. 実装の優先順位（推奨）
ClaudeCodeに以下の順番で実装してもらうのがおすすめ：

Supabase接続 — supabase-client.js 作成、接続確認
テーブル作成 — SQL Editorでテーブル＋RLS作成（上記SQLを実行）
認証機能 — auth.js 作成、ログイン画面UI
storage.js改修 — localStorage → Supabase版に切り替え
マイグレーション — 既存データの移行機能
共有URL機能 — 共有ダイアログ、閲覧専用モード
ビルド＆テスト — build.js 修正、動作確認
14. テスト項目
実装後、以下を確認してください：

[ ] ログイン画面が表示される
[ ] メール＋パスワードでログインできる
[ ] ログイン後、マップの新規作成・編集・保存ができる
[ ] マップ一覧が正しく表示される
[ ] フォルダの作成・マップの移動ができる
[ ] ログアウトできる
[ ] ログアウト後、再ログインでデータが残っている
[ ] 別ブラウザからログインしても同じデータが表示される
[ ] 共有ボタンでURLが生成される
[ ] 共有URLで閲覧専用アクセスできる（ログイン不要）
[ ] 閲覧専用ではノード編集不可、コピーボタンのみ有効
[ ] 共有OFFにすると閲覧できなくなる
[ ] localStorageに既存データがある状態でログイン → 移行ダイアログが出る
[ ] 移行後、全マップ＆フォルダがSupabase上に保存されている
[ ] dist/index.html にビルドできる
[ ] mindmap.johosauce.com にデプロイして動作する