// 左サイドバー: メタ操作の履歴(undo/redo)とコピー/カット/ペースト
import { currentMapId } from '../state.js';
import {
    findMetaById,
    getDefaultFolderId,
    getMapDataKey,
    getMetaList,
    getNextMapId,
    loadMapData,
    nowISO,
    saveMetaList
} from '../storage.js';
import { deepClone, showToast } from '../utils.js';
import { switchToMap } from './crud.js';
import { renderMapList } from './render.js';
import { SIDEBAR_HISTORY_MAX, sbState, sidebarSelectedIds } from './state.js';

// ========================================
// Sidebar Clipboard & Undo/Redo
// ========================================

export function sidebarPushHistory() {
    if (sbState.historyPos < sbState.history.length - 1) {
        sbState.history = sbState.history.slice(0, sbState.historyPos + 1);
    }
    sbState.history.push(JSON.stringify(getMetaList()));
    if (sbState.history.length > SIDEBAR_HISTORY_MAX) sbState.history.shift();
    sbState.historyPos = sbState.history.length - 1;
}

export function sidebarUndo() {
    if (sbState.historyPos <= 0) { showToast('これ以上戻せません'); return; }
    sbState.historyPos--;
    var snapshot = JSON.parse(sbState.history[sbState.historyPos]);
    saveMetaList(snapshot);
    var meta = findMetaById(currentMapId);
    if (!meta) {
        var pages = snapshot.filter(function(m) { return m.type === 'page'; });
        pages.sort(function(a, b) { return (b.updatedAt || '').localeCompare(a.updatedAt || ''); });
        if (pages.length > 0) { window.sidebarNavigationMode = true; switchToMap(pages[0].id); return; }
    }
    renderMapList();
    showToast('↩ 元に戻しました');
}

export function sidebarRedo() {
    if (sbState.historyPos >= sbState.history.length - 1) { showToast('やり直す操作がありません'); return; }
    sbState.historyPos++;
    var snapshot = JSON.parse(sbState.history[sbState.historyPos]);
    saveMetaList(snapshot);
    var meta = findMetaById(currentMapId);
    if (!meta) {
        var pages = snapshot.filter(function(m) { return m.type === 'page'; });
        pages.sort(function(a, b) { return (b.updatedAt || '').localeCompare(a.updatedAt || ''); });
        if (pages.length > 0) { window.sidebarNavigationMode = true; switchToMap(pages[0].id); return; }
    }
    renderMapList();
    showToast('↪ やり直しました');
}

export function sidebarCopyItems() {
    if (sidebarSelectedIds.size === 0) { showToast('アイテムを選択してください'); return; }
    var ids = [];
    sidebarSelectedIds.forEach(function(id) { ids.push(id); });
    sbState.clipboard = { mode: 'copy', ids: ids };
    showToast('📋 ' + ids.length + '件をコピーしました');
}

export function sidebarCutItems() {
    if (sidebarSelectedIds.size === 0) { showToast('アイテムを選択してください'); return; }
    var ids = [];
    sidebarSelectedIds.forEach(function(id) {
        var m = findMetaById(id);
        if (m && m.type === 'page') ids.push(id);
    });
    if (ids.length === 0) { showToast('ページのみ切り取り可能です'); return; }
    sbState.clipboard = { mode: 'cut', ids: ids };
    showToast('✂️ ' + ids.length + '件を切り取りました');
}

function sidebarGetPasteDestFolder() {
    var metaList = getMetaList();
    if (sbState.lastSelectedId) {
        var m = findMetaById(sbState.lastSelectedId);
        if (m && m.type === 'folder') return m.id;
        if (m && m.type === 'page') return m.folderId || getDefaultFolderId(metaList);
    }
    return getDefaultFolderId(metaList);
}

// ページを指定フォルダへ複製（コピー先フォルダを指定可能なduplicateMap）
function duplicateMapToFolder(srcId, destFolderId) {
    var srcMeta = findMetaById(srcId);
    if (!srcMeta || srcMeta.type !== 'page') return;
    var srcData = loadMapData(srcMeta.id);
    if (!srcData) return;

    var newId = getNextMapId();
    var now = nowISO();
    var metaList = getMetaList();
    var maxOrder = 0;
    for (var i = 0; i < metaList.length; i++) {
        if (metaList[i].type === 'page' && metaList[i].folderId === destFolderId
            && (metaList[i].order || 0) >= maxOrder) {
            maxOrder = (metaList[i].order || 0) + 1;
        }
    }
    var newMeta = { id: newId, name: srcMeta.name + ' のコピー', type: 'page',
                    folderId: destFolderId, order: maxOrder, createdAt: now, updatedAt: now };
    metaList.push(newMeta);
    saveMetaList(metaList);
    try { localStorage.setItem(getMapDataKey(newId), JSON.stringify(deepClone(srcData))); } catch(e) {}
    if (window._supa) window._supa.saveMap(newId, newMeta.name, srcData, destFolderId).catch(function(){});
    return newId;
}

export function sidebarPasteItems(moveMode) {
    if (!sbState.clipboard || sbState.clipboard.ids.length === 0) {
        showToast('コピーしたアイテムがありません'); return;
    }
    var destFolderId = sidebarGetPasteDestFolder();
    var isMove = moveMode || sbState.clipboard.mode === 'cut';

    sidebarPushHistory();

    if (!isMove) {
        // 複製
        var count = 0;
        for (var i = 0; i < sbState.clipboard.ids.length; i++) {
            var newId = duplicateMapToFolder(sbState.clipboard.ids[i], destFolderId);
            if (newId) count++;
        }
        renderMapList();
        showToast('📑 ' + count + '件を複製しました');
    } else {
        // 移動
        var metaList = getMetaList();
        count = 0;
        for (i = 0; i < sbState.clipboard.ids.length; i++) {
            var sid = sbState.clipboard.ids[i];
            for (var j = 0; j < metaList.length; j++) {
                if (String(metaList[j].id) === String(sid) && metaList[j].type === 'page') {
                    if (String(metaList[j].folderId) === String(destFolderId)) break;
                    metaList[j].folderId = destFolderId;
                    var pagesInDest = metaList.filter(function(m) {
                        return m.type === 'page' && String(m.folderId) === String(destFolderId);
                    });
                    metaList[j].order = pagesInDest.length > 0
                        ? Math.max.apply(null, pagesInDest.map(function(m) { return m.order || 0; })) + 1 : 0;
                    if (window._supa) {
                        var pageData = loadMapData(metaList[j].id);
                        window._supa.saveMap(metaList[j].id, metaList[j].name, pageData, destFolderId).catch(function(){});
                    }
                    count++;
                    break;
                }
            }
        }
        saveMetaList(metaList);
        sbState.clipboard = null;
        renderMapList();
        showToast('📁 ' + count + '件を移動しました');
    }
}
