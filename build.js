'use strict';
const fs   = require('fs');
const path = require('path');

const SRC  = path.join(__dirname, 'src');
const DIST = path.join(__dirname, 'dist');

// ファイル結合順序
const CSS_FILES = [
    'base.css',
    'canvas.css',
    'sidebar-left.css',
    'sidebar-right.css',
    'ui.css',
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
    'keyboard.js',
    'canvas-interaction.js',
    'init.js',
    'sidebar-right.js',
    'sidebar-left.js',
];

function read(p) {
    return fs.readFileSync(p, 'utf-8');
}

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
html = html.replace(
    /    <!-- BUILD:js -->[\s\S]*?    <!-- \/BUILD:js -->/,
    jsBlock
);

// dist/ に出力
if (!fs.existsSync(DIST)) fs.mkdirSync(DIST, { recursive: true });
fs.writeFileSync(path.join(DIST, 'index.html'), html, 'utf-8');

const lines = html.split('\n').length;
console.log(`Built: dist/index.html (${lines} lines)`);
