'use strict';
const fs   = require('fs');
const path = require('path');
const { buildSync } = require('esbuild');

const SRC  = path.join(__dirname, 'src');
const DIST = path.join(__dirname, 'dist');

// package.json の version をビルド時に取得（HTML 内の __APP_VERSION__ を実値に置換）
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf-8'));
const APP_VERSION = pkg.version || '0.0.0';

// ファイル結合順序
const CSS_FILES = [
    'base.css',
    'canvas.css',
    'sidebar-left.css',
    'sidebar-right.css',
    'ui.css',
    'auth.css',
];

const JS_FILES = [
    'state.js',
    'utils.js',
    'storage.js',
    'history.js',
    'nodes.js',
    'selection.js',
    'editing.js',
    'clipboard.js',
    'drag.js',
    'lasso.js',
    'render.js',
    'relations.js',
    'keyboard.js',
    'canvas-interaction.js',
    'init.js',
    'sidebar-right.js',
    'sidebar-left.js',
    'app-init.js',
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

// CSS を結合して <style> タグで包む
const css = CSS_FILES.map(f => read(path.join(SRC, 'css', f))).join('\n');
const cssBlock = `<style>\n${css}</style>`;

// JS を結合して IIFE で包む
const js = JS_FILES.map(f => read(path.join(SRC, 'js', f))).join('\n');
const jsBlock = `<script>\n    (function() {\n        'use strict';\n\n${js}\n    })();\n    </script>`;

// テンプレート読み込み & プレースホルダー置換
let html = read(path.join(SRC, 'index.html'));
html = html.replace(
    /    <!-- BUILD:css -->[\s\S]*?    <!-- \/BUILD:css -->/,
    cssBlock
);
// Supabase bundle を先に、その後に既存 JS を配置
html = html.replace(
    /    <!-- BUILD:js -->[\s\S]*?    <!-- \/BUILD:js -->/,
    supaBundleBlock + '\n    ' + jsBlock
);

// __APP_VERSION__ プレースホルダーを package.json の version に置換
html = html.split('__APP_VERSION__').join(APP_VERSION);

// dist/ に出力
if (!fs.existsSync(DIST)) fs.mkdirSync(DIST, { recursive: true });
fs.writeFileSync(path.join(DIST, 'index.html'), html, 'utf-8');

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

const lines = html.split('\n').length;
console.log(`Built: dist/index.html (${lines} lines)`);
