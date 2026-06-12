'use strict';
const fs   = require('fs');
const path = require('path');
const { buildSync } = require('esbuild');

const SRC  = path.join(__dirname, 'src');
const DIST = path.join(__dirname, 'dist');

// package.json の version をビルド時に取得（HTML 内の __APP_VERSION__ を実値に置換）
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf-8'));
const APP_VERSION = pkg.version || '0.0.0';

// ローカル版の配布日表示用（ビルド時のローカル日付を YYYY-MM-DD で）
function getBuildDateStr() {
    const d = new Date();
    return d.getFullYear() + '-' +
        String(d.getMonth() + 1).padStart(2, '0') + '-' +
        String(d.getDate()).padStart(2, '0');
}
const BUILD_DATE = getBuildDateStr();

// ファイル結合順序
const CSS_FILES = [
    'base.css',
    'canvas.css',
    'sidebar-left.css',
    'sidebar-right.css',
    'ui.css',
    'auth.css',
];



function read(p) {
    return fs.readFileSync(p, 'utf-8');
}

// クラウド版 保存アダプター（Supabase）を esbuild で IIFE バンドル
const supabaseResult = buildSync({
    entryPoints: [path.join(SRC, 'js', 'storage-supabase.js')],
    bundle: true,
    format: 'iife',
    write: false,
    minify: false,
    target: ['es2017'],
    define: { 'process.env.NODE_ENV': '"production"' }
});
const supabaseBundle = supabaseResult.outputFiles[0].text;
const supaBundleBlock = `<script>\n${supabaseBundle}\n</script>`;

// ローカル版 保存アダプター（外部通信なし・esbuild不要）
const localStorageJs = read(path.join(SRC, 'js', 'storage-local.js'));
const localBundleBlock = `<script>\n${localStorageJs}\n</script>`;

// CSS を結合して <style> タグで包む（両ビルド共通）
const css = CSS_FILES.map(f => read(path.join(SRC, 'css', f))).join('\n');
const cssBlock = `<style>\n${css}</style>`;

// アプリ本体を esbuild で IIFE バンドル（src/js/app.js がエントリポイント。両ビルド共通）
const appResult = buildSync({
    entryPoints: [path.join(SRC, 'js', 'app.js')],
    bundle: true,
    format: 'iife',
    write: false,
    minify: false,
    target: ['es2017'],
});
const jsBlock = `<script>\n${appResult.outputFiles[0].text}\n</script>`;

// テンプレート読み込み
const template = read(path.join(SRC, 'index.html'));

// 共通：プレースホルダー置換 → HTML 生成
function buildHtml(adapterBlock, versionString) {
    let html = template;
    html = html.replace(
        / {4}<!-- BUILD:css -->[\s\S]*? {4}<!-- \/BUILD:css -->/,
        cssBlock
    );
    html = html.replace(
        / {4}<!-- BUILD:js -->[\s\S]*? {4}<!-- \/BUILD:js -->/,
        adapterBlock + '\n    ' + jsBlock
    );
    html = html.split('__APP_VERSION__').join(versionString);
    return html;
}

// dist/ を準備
if (!fs.existsSync(DIST)) fs.mkdirSync(DIST, { recursive: true });

// --- クラウド版（dist/index.html） ---
const cloudHtml = buildHtml(supaBundleBlock, APP_VERSION);
fs.writeFileSync(path.join(DIST, 'index.html'), cloudHtml, 'utf-8');

// --- ローカル版（dist/local.html） ---
// バージョン表記: "1.0.0 (2026-05-30)"
const localVersionString = `${APP_VERSION} (${BUILD_DATE})`;
let localHtml = buildHtml(localBundleBlock, localVersionString);

// ローカル版固有の HTML 差分：
//   1) leftSidebarFooter は起動時から表示（クラウドは認証後に display:'' する）
localHtml = localHtml.replace(
    'id="leftSidebarFooter" style="display:none"',
    'id="leftSidebarFooter"'
);
//   2) ログアウトボタンを「JSONバックアップ」ボタンに置き換える
localHtml = localHtml.replace(
    '<button class="logout-btn" id="logoutBtn">ログアウト</button>',
    '<button class="logout-btn" id="backupBtn">JSONバックアップ</button>'
);

fs.writeFileSync(path.join(DIST, 'local.html'), localHtml, 'utf-8');

// --- テスト版（dist/test.html）: BUILD_TEST=1 のときのみ生成 ---
// クラウド版と同じ HTML 構成で、保存アダプターだけを Supabase モックに差し替える。
// クラウド版の認証・同期・共有フローをネットワークなしでテストするためのもの。
// 本番ビルド（Vercel）では生成されない。
if (process.env.BUILD_TEST) {
    const mockJs = read(path.join(__dirname, 'tests', 'mocks', 'supa-mock.js'));
    const mockBundleBlock = `<script>\n${mockJs}\n</script>`;
    const testHtml = buildHtml(mockBundleBlock, APP_VERSION + '-test');
    fs.writeFileSync(path.join(DIST, 'test.html'), testHtml, 'utf-8');
    console.log(`Built: dist/test.html  (テスト版・モックアダプター)`);
}

// 静的アセット（OGP 画像など）を dist/assets/ にコピー
const SRC_ASSETS  = path.join(SRC, 'assets');
const DIST_ASSETS = path.join(DIST, 'assets');
if (fs.existsSync(SRC_ASSETS)) {
    if (!fs.existsSync(DIST_ASSETS)) fs.mkdirSync(DIST_ASSETS, { recursive: true });
    for (const file of fs.readdirSync(SRC_ASSETS)) {
        fs.copyFileSync(path.join(SRC_ASSETS, file), path.join(DIST_ASSETS, file));
    }
}

// Netlify リダイレクト設定（/share/* → index.html）
const redirectsPath = path.join(DIST, '_redirects');
if (!fs.existsSync(redirectsPath)) {
    fs.writeFileSync(redirectsPath, '/share/*  /index.html  200\n', 'utf-8');
}

console.log(`Built: dist/index.html (${cloudHtml.split('\n').length} lines, version ${APP_VERSION})`);
console.log(`Built: dist/local.html  (${localHtml.split('\n').length} lines, version ${localVersionString})`);
