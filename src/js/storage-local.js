// ========================================
// ローカル版用 保存アダプター（Storage Adapter for Local）
// ----------------------------------------
// 外部と一切通信せず、ブラウザの localStorage を「正の保存先」として動作する。
// 重要：window._supa を一切定義しないことで、app-init.js の
//   `if (!window._supa) { init(); return; }` 分岐に自然に流れ込み、
// 認証画面をスキップして localStorage 直モードで起動する。
//
// 本ファイルが追加で提供するのは「JSONエクスポート / インポート」機能のみ。
// 外部APIを叩く処理は一切含まない（fetch / XHR / WebSocket 等を使用しない）。
//
// 公開API：window._localBackup
//   - exportJSON()              … mindmap-* で始まる localStorage 全項目を
//                                  単一の JSON ファイルとしてダウンロード
//   - importJSON(file)          … JSON ファイルを読んで localStorage を復元
//                                  （既存の mindmap-* キーは削除して置き換え）
//   - version                   … バックアップフォーマットのバージョン番号
// ========================================

(function() {
    'use strict';

    var STORAGE_PREFIX = 'mindmap-';
    var BACKUP_VERSION = 1;

    // ---- 全 localStorage キー（mindmap-*）を JSON にまとめてダウンロード ----
    function exportAllAsJSON() {
        var data = {};
        for (var i = 0; i < localStorage.length; i++) {
            var key = localStorage.key(i);
            if (key && key.indexOf(STORAGE_PREFIX) === 0) {
                data[key] = localStorage.getItem(key);
            }
        }
        var bundle = {
            backupVersion: BACKUP_VERSION,
            exportedAt: new Date().toISOString(),
            data: data
        };
        var json = JSON.stringify(bundle, null, 2);
        var blob = new Blob([json], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        var today = new Date();
        var y = today.getFullYear();
        var m = String(today.getMonth() + 1).padStart(2, '0');
        var d = String(today.getDate()).padStart(2, '0');
        a.download = 'mindmap-backup-' + y + m + d + '.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    // ---- JSON ファイルから localStorage を復元 ----
    // 既存の mindmap-* キーは全部削除してから上書きする（半端な混在を避ける）
    function importFromJSON(file) {
        return new Promise(function(resolve, reject) {
            var reader = new FileReader();
            reader.onload = function(e) {
                try {
                    var bundle = JSON.parse(e.target.result);
                    if (!bundle || typeof bundle.data !== 'object' || bundle.data === null) {
                        reject(new Error('不正な JSON ファイルです（data フィールドが見つかりません）'));
                        return;
                    }
                    var keysToDelete = [];
                    for (var i = 0; i < localStorage.length; i++) {
                        var key = localStorage.key(i);
                        if (key && key.indexOf(STORAGE_PREFIX) === 0) {
                            keysToDelete.push(key);
                        }
                    }
                    for (var j = 0; j < keysToDelete.length; j++) {
                        localStorage.removeItem(keysToDelete[j]);
                    }
                    for (var k in bundle.data) {
                        if (Object.prototype.hasOwnProperty.call(bundle.data, k)) {
                            var v = bundle.data[k];
                            if (typeof v === 'string') {
                                localStorage.setItem(k, v);
                            }
                        }
                    }
                    resolve();
                } catch(err) {
                    reject(err);
                }
            };
            reader.onerror = function() { reject(new Error('ファイル読み込みに失敗しました')); };
            reader.readAsText(file);
        });
    }

    // ---- ドラッグ&ドロップで JSON ファイルを受け取る ----
    // ノードのドラッグは HTML5 Drag&Drop API を使っていない（mousedown ベース）ので衝突しない
    function setupDragAndDrop() {
        document.addEventListener('dragover', function(e) {
            // ファイルがドラッグされているときだけ preventDefault する
            if (e.dataTransfer && e.dataTransfer.types && Array.prototype.indexOf.call(e.dataTransfer.types, 'Files') !== -1) {
                e.preventDefault();
            }
        });
        document.addEventListener('drop', function(e) {
            if (!e.dataTransfer || !e.dataTransfer.files || e.dataTransfer.files.length === 0) return;
            var file = e.dataTransfer.files[0];
            if (!file.name.toLowerCase().endsWith('.json')) return;
            e.preventDefault();
            var ok = window.confirm('「' + file.name + '」を読み込みますか？\n現在のデータは置き換えられます。\n（事前にエクスポートしておくと安全です）');
            if (!ok) return;
            importFromJSON(file).then(function() {
                window.alert('読み込み完了。リロードします。');
                window.location.reload();
            }).catch(function(err) {
                window.alert('エラー: ' + (err && err.message ? err.message : String(err)));
            });
        });
    }

    // ---- バックアップボタン（id="backupBtn"）が存在すればクリックでエクスポート ----
    // ローカル版HTMLには backupBtn を配置する。クラウド版にはこのIDのボタンがないので
    // querySelector は null を返し、なにも起きない（クラウド版へ無害）
    function setupBackupButton() {
        var btn = document.getElementById('backupBtn');
        if (!btn) return;
        btn.addEventListener('click', function() {
            try {
                exportAllAsJSON();
            } catch(err) {
                window.alert('バックアップに失敗しました: ' + (err && err.message ? err.message : String(err)));
            }
        });
    }

    function initLocal() {
        setupDragAndDrop();
        setupBackupButton();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initLocal);
    } else {
        initLocal();
    }

    // ---- ローカル版固有の機能を公開 ----
    window._localBackup = {
        exportJSON: exportAllAsJSON,
        importJSON: importFromJSON,
        version: BACKUP_VERSION
    };
})();
