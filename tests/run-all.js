'use strict';
// テスト一括ランナー: ビルド → サーバー起動 → 全テスト実行 → 集計 → 後始末
// 使い方: npm test（= node tests/run-all.js）
//
// サーバーは別プロセスで起動する。テスト実行に spawnSync（同期）を使うため、
// 同一プロセス内でサーバーを動かすとイベントループが止まり応答できなくなる。
const { execSync, spawn, spawnSync } = require('child_process');
const http = require('http');
const path = require('path');
const { PORT } = require('./helpers');

const ROOT = path.join(__dirname, '..');

const TEST_FILES = [
    'collapse.test.js',
    'grayout.test.js',
    'sidebar.test.js',
    'tree-import.test.js',
    'node-move.test.js',
    'duplicate.test.js',
    'node-height.test.js',
    'undo-decorations.test.js',
    'left-sidebar.test.js',
    'relations-reconnect.test.js',
    'vertical-layout.test.js',
    'link.test.js',
    'cloud.test.js',
    'collab.test.js',
    'collab-ui.test.js',
    'owner-banner.test.js',
];

function waitForServer(port, retries, done) {
    http.get('http://localhost:' + port + '/local.html', function (res) {
        res.resume();
        done(null);
    }).on('error', function (err) {
        if (retries <= 0) return done(err);
        setTimeout(function () { waitForServer(port, retries - 1, done); }, 200);
    });
}

console.log('=== ビルド ===');
// BUILD_TEST=1: クラウド版テスト用の dist/test.html も生成する
execSync('node build.js', {
    stdio: 'inherit',
    cwd: ROOT,
    env: Object.assign({}, process.env, { BUILD_TEST: '1' }),
});

const server = spawn('node', [path.join(__dirname, 'server.js')], {
    env: Object.assign({}, process.env, { PORT: String(PORT) }),
    stdio: 'ignore',
});

waitForServer(PORT, 25, function (err) {
    if (err) {
        console.error('テストサーバーが起動しませんでした: ' + err.message);
        server.kill();
        process.exit(1);
    }
    console.log('=== テストサーバー起動 (port ' + PORT + ') ===');
    const failures = [];
    for (const file of TEST_FILES) {
        console.log('\n========== ' + file + ' ==========');
        const result = spawnSync('node', [path.join(__dirname, file)], { stdio: 'inherit' });
        if (result.status !== 0) failures.push(file);
    }
    server.kill();
    console.log('\n========== 結果 ==========');
    if (failures.length > 0) {
        console.log('❌ 失敗したテストファイル: ' + failures.join(', '));
        process.exit(1);
    }
    console.log('✅ 全テストファイルが成功');
});
