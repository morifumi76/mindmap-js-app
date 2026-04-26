'use strict';
const fs   = require('fs');
const path = require('path');
const { buildSync } = require('esbuild');

const SRC  = path.join(__dirname, 'src');
const DIST = path.join(__dirname, 'dist');

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

// Supabase bundle: esbuild で supabase-entry.js を IIFE にバンドル
const supabaseResult = buildSync({
    entryPoints: [path.join(SRC, 'js', 'supabase-entry.js')],
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

// dist/ に出力
if (!fs.existsSync(DIST)) fs.mkdirSync(DIST, { recursive: true });
fs.writeFileSync(path.join(DIST, 'index.html'), html, 'utf-8');

// Netlify リダイレクト設定（/share/* → index.html）
const redirectsPath = path.join(DIST, '_redirects');
if (!fs.existsSync(redirectsPath)) {
    fs.writeFileSync(redirectsPath, '/share/*  /index.html  200\n', 'utf-8');
}

const lines = html.split('\n').length;
console.log(`Built: dist/index.html (${lines} lines)`);
