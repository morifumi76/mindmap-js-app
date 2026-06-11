'use strict';
// dist/ を配信する最小静的サーバー（テスト・開発確認用、外部依存なし）
// 単体起動: node tests/server.js（PORT 環境変数で変更可、既定 8080）
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'dist');
const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js':   'text/javascript; charset=utf-8',
    '.css':  'text/css; charset=utf-8',
    '.json': 'application/json',
    '.png':  'image/png',
    '.svg':  'image/svg+xml',
};

function createServer() {
    return http.createServer(function (req, res) {
        const urlPath = decodeURIComponent(req.url.split('?')[0]);
        const file = path.normalize(path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath));
        // dist/ の外へのパストラバーサルを拒否
        if (!file.startsWith(ROOT)) {
            res.writeHead(403);
            res.end('Forbidden');
            return;
        }
        fs.readFile(file, function (err, data) {
            if (err) {
                res.writeHead(404);
                res.end('Not Found');
                return;
            }
            res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
            res.end(data);
        });
    });
}

if (require.main === module) {
    const port = process.env.PORT || 8080;
    createServer().listen(port, function () {
        console.log('Serving dist/ at http://localhost:' + port);
    });
}

module.exports = { createServer };
