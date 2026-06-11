'use strict';
// 開発用ウォッチャー: src/ の変更を検知して自動で再ビルドする
// （以前は package.json 内のワンライナーだったものを切り出し。挙動は同じ）
const fs = require('fs');
const { execSync } = require('child_process');

function build() {
    try {
        execSync('node build.js', { stdio: 'inherit', cwd: __dirname + '/..' });
    } catch (e) {
        // ビルドエラーは画面に出るので、ウォッチは継続する
    }
}

build();

let timer;
fs.watch(__dirname + '/../src', { recursive: true }, () => {
    clearTimeout(timer);
    timer = setTimeout(build, 150);
});

console.log('Watching src/ ... (Ctrl+C to stop)');
