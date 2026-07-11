// クラウド版: Supabase へのデバウンス同期と離脱時の強制フラッシュ
import { setSaveStatus, showSaveIndicator } from './save-status.js';

// ========================================
// App Startup: Auth / Share routing / Migration
// (Vanilla JS — loaded after supabase bundle)
// ========================================


var saveDebounceTimer = null;

// ---- Supabase debounced sync (called from storage.js hook) ----
// 保留中の同期対象マップID（フラッシュ時に参照）
var pendingSyncMapId = null;

// デバウンス時間（短いほどデータロスのリスクが減る／長いほど通信回数が減る）
var SAVE_DEBOUNCE_MS = 800;

window._supaQueueSync = function(localId) {
    if (!window._supa) return;
    // 異なる mapId が連続して来た場合、前マップの保留分を先に即時フラッシュする。
    // （以前は debounce タイマーが新マップ用に上書きされて前マップが永久に未同期に
    //   なる不具合があった。複数マップ編集→ステータスが「未保存の変更」のまま残る）
    if (saveDebounceTimer && pendingSyncMapId && pendingSyncMapId !== localId) {
        clearTimeout(saveDebounceTimer);
        var prevId = pendingSyncMapId;
        saveDebounceTimer = null;
        pendingSyncMapId = null;
        doSupabaseSync(prevId); // fire-and-forget。完了時に pending マーカーが消える
    }
    clearTimeout(saveDebounceTimer);
    pendingSyncMapId = localId;
    // 通信前に未同期マーカーを localStorage に書く（同期書き込みなので即座に永続化）
    // → タブを閉じても次回起動時に拾われる
    try {
        var p = JSON.parse(localStorage.getItem('mindmap-pending-sync') || '{}');
        p[String(localId)] = 1;
        localStorage.setItem('mindmap-pending-sync', JSON.stringify(p));
    } catch(e) {}
    showSaveIndicator('保存中...');
    saveDebounceTimer = setTimeout(function() {
        saveDebounceTimer = null;
        var idToSync = pendingSyncMapId;
        pendingSyncMapId = null;
        doSupabaseSync(idToSync);
    }, SAVE_DEBOUNCE_MS);
};

// 保留中のデバウンス保存を即時実行する（離脱時・マップ切替時・ログアウト時に使用）
// 戻り値: Supabase 保存完了の Promise（保留が無い場合は即解決）
export function flushSupabaseSyncImmediate() {
    if (!saveDebounceTimer) return Promise.resolve();
    clearTimeout(saveDebounceTimer);
    saveDebounceTimer = null;
    var idToSync = pendingSyncMapId;
    pendingSyncMapId = null;
    if (!idToSync) return Promise.resolve();
    return doSupabaseSync(idToSync);
}

// 他モジュール（sidebar-left.js など）から呼び出せるよう公開
window._supaFlushSync = flushSupabaseSyncImmediate;

// pending マーカーから1件削除し、残りに応じてステータス更新／チェーン続行する
function settlePendingAfterStaleEntry(staleId) {
    try {
        var p = JSON.parse(localStorage.getItem('mindmap-pending-sync') || '{}');
        delete p[String(staleId)];
        localStorage.setItem('mindmap-pending-sync', JSON.stringify(p));
    } catch(e) {}
    var remaining;
    try { remaining = JSON.parse(localStorage.getItem('mindmap-pending-sync') || '{}'); } catch(e) { remaining = {}; }
    var keys = Object.keys(remaining);
    if (keys.length > 0) {
        showSaveIndicator('保存中...');
        doSupabaseSync(parseInt(keys[0], 10));
    } else {
        setSaveStatus('saved');
    }
}

function doSupabaseSync(localId) {
    if (!window._supa || !localId) return Promise.resolve();
    return window._supa.getCurrentUser().then(function(user) {
        if (!user) return;
        var metaList;
        try { metaList = JSON.parse(localStorage.getItem('mindmap-meta') || '[]'); } catch(e) { metaList = []; }
        var meta = null;
        for (var i = 0; i < metaList.length; i++) {
            if (metaList[i].id === localId) { meta = metaList[i]; break; }
        }
        if (!meta || meta.type !== 'page') {
            // 削除済みマップ等で対象が無い → pending を片付けて次へ
            settlePendingAfterStaleEntry(localId);
            return;
        }
        var data;
        try { data = JSON.parse(localStorage.getItem('mindmap-data-' + localId)); } catch(e) { settlePendingAfterStaleEntry(localId); return; }
        if (!data) { settlePendingAfterStaleEntry(localId); return; }
        // グレーアウト・ハイライト・水色・赤文字状態をデータに含めてSupabaseへ保存
        try {
            var gray = localStorage.getItem('mindmap-node-grayout-' + localId);
            var hl   = localStorage.getItem('mindmap-node-highlight-' + localId);
            var cy   = localStorage.getItem('mindmap-node-cyan-' + localId);
            var gr   = localStorage.getItem('mindmap-node-green-' + localId);
            var pk   = localStorage.getItem('mindmap-node-pink-' + localId);
            var rt   = localStorage.getItem('mindmap-node-redtext-' + localId);
            data._grayout   = gray  ? JSON.parse(gray)  : {};
            data._highlight = hl    ? JSON.parse(hl)    : {};
            data._cyan      = cy    ? JSON.parse(cy)    : {};
            data._green     = gr    ? JSON.parse(gr)    : {};
            data._pink      = pk    ? JSON.parse(pk)    : {};
            data._redtext   = rt    ? JSON.parse(rt)    : {};
            data._starred   = !!meta.starred;
            data._starOrder = meta.starOrder || 0;
        } catch(e) {}
        return window._supa.saveMap(localId, meta.name, data, meta.folderId).then(function() {
            // saveMap 成功時に自分の pending マーカーは削除済み。
            // 他に未同期のマップが残っていれば連続で同期する（取りこぼし防止のチェーン）
            var pending;
            try { pending = JSON.parse(localStorage.getItem('mindmap-pending-sync') || '{}'); } catch(e) { pending = {}; }
            var nextIds = Object.keys(pending).filter(function(id) {
                return parseInt(id, 10) && parseInt(id, 10) !== localId;
            });
            if (nextIds.length > 0) {
                // まだ他に未同期がある → 続けて同期（再帰的に処理される）
                showSaveIndicator('保存中...');
                doSupabaseSync(parseInt(nextIds[0], 10));
            } else {
                setSaveStatus('saved');
            }
        }).catch(function() {
            setSaveStatus(navigator.onLine ? 'error' : 'offline');
        });
    });
}

// ---- 離脱時の強制保存 ----
// タブを閉じる・リロード・別ページ遷移・PC スリープ等で
// デバウンス中の保存が消えないよう即時フラッシュする
window.addEventListener('pagehide', function() { flushSupabaseSyncImmediate(); });

window.addEventListener('beforeunload', function() { flushSupabaseSyncImmediate(); });

document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'hidden') flushSupabaseSyncImmediate();
});
