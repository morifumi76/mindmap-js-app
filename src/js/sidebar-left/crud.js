// 左サイドバー: ページ/フォルダの作成・削除・複製・切替・リネーム
import { finishEditing } from '../editing.js';
import { saveState } from '../history.js';
import { updatePageTitle, updateUrlParam } from '../init.js';
import { render, resetView } from '../render.js';
import { selectNode } from '../selection.js';
import {
    currentMapId,
    selectedNodeIds,
    setCurrentMapId,
    setEditingNodeId,
    setLastSelectedNodeId,
    setMindMapData,
    setSelectionAnchorId,
    setUndoHistory,
    setUndoIndex
} from '../state.js';
import {
    findMetaById,
    getCollapseState,
    getDefaultNewMapName,
    getMapDataKey,
    getMetaList,
    getNextMapId,
    getTitleDateMode,
    loadMapData,
    nowISO,
    saveMetaList,
    saveToLocalStorage,
    setCollapseState,
    setLastActiveId
} from '../storage.js';
import { deepClone, isImeRelatedKey, showToast } from '../utils.js';
import { renderMapList } from './render.js';
import { clearSidebarSelection } from './selection.js';
import { sidebarSelectedIds } from './state.js';

// ---- CRUD: Pages ----
export function createNewMap() {
    // 新規ページの配置先優先順位:
    //   ① サイドバーで選択中のアイテムがフォルダ → そのフォルダ内
    //   ② サイドバーで選択中のアイテムがページ → そのページのフォルダ内
    //   ③ アクティブなマップがあればそのページのフォルダ内
    //   ④ いずれも該当なし → トップレベル（folderId = null）
    saveToLocalStorage();

    var metaList = getMetaList();

    var targetFolderId = null;
    // ① / ② サイドバーの選択を最優先（明示的なユーザーの操作なので）
    if (typeof sidebarSelectedIds !== 'undefined' && sidebarSelectedIds.size > 0) {
        var firstSelectedId = null;
        sidebarSelectedIds.forEach(function(id) {
            if (firstSelectedId === null) firstSelectedId = id;
        });
        if (firstSelectedId !== null) {
            var selMeta = findMetaById(firstSelectedId);
            if (selMeta) {
                if (selMeta.type === 'folder') {
                    targetFolderId = selMeta.id;
                } else if (selMeta.type === 'page') {
                    targetFolderId = selMeta.folderId || null;
                }
            }
        }
    }
    // ③ サイドバー未選択なら、アクティブなマップのフォルダにフォールバック
    if (targetFolderId === null && currentMapId) {
        var currentMeta = findMetaById(currentMapId);
        if (currentMeta && currentMeta.type === 'page') {
            targetFolderId = currentMeta.folderId || null;
        }
    }
    // ④ いずれも無ければトップレベル（targetFolderId は null のまま）

    var newId = getNextMapId();
    var now = nowISO();
    var defaultData = { root: { id: 'root', text: '中心テーマ', children: [] } };

    // 同じ親（targetFolderId）内のページの最大 order を取得して末尾に置く
    var maxOrder = 0;
    for (var i = 0; i < metaList.length; i++) {
        var mi = metaList[i];
        if (mi.type === 'page' && (mi.folderId || null) === targetFolderId && (mi.order || 0) >= maxOrder) {
            maxOrder = (mi.order || 0) + 1;
        }
    }

    var defaultName = getDefaultNewMapName();
    var meta = { id: newId, name: defaultName, type: 'page', folderId: targetFolderId, order: maxOrder, createdAt: now, updatedAt: now };
    metaList.push(meta);
    saveMetaList(metaList);
    try { localStorage.setItem(getMapDataKey(newId), JSON.stringify(defaultData)); } catch(e) {}

    // 配置先がフォルダなら展開しておく
    if (targetFolderId) {
        var cs = getCollapseState();
        cs[targetFolderId] = false;
        setCollapseState(cs);
    }

    switchToMap(newId);
    showToast('新しいマップを作成しました');
    // Supabase: create map (will be synced on first save via saveToLocalStorage)
    if (window._supa) {
        window._supa.saveMap(newId, defaultName, defaultData, targetFolderId).catch(function(){});
    }
    // タイトル日付モードON時は新規作成後すぐリネーム入力モードに入り、_ の直後にカーソル
    if (getTitleDateMode()) {
        setTimeout(function() { startInlineRename(newId, { cursorAtEnd: true }); }, 200);
    }
}

export function createPageInFolder(folderId) {
    // Creates a new page in specified folder
    saveToLocalStorage();

    var metaList = getMetaList();
    var newId = getNextMapId();
    var now = nowISO();
    var defaultData = { root: { id: 'root', text: '中心テーマ', children: [] } };

    // Get max order among pages in this folder
    var maxOrder = 0;
    for (var i = 0; i < metaList.length; i++) {
        if (metaList[i].type === 'page' && metaList[i].folderId === folderId && (metaList[i].order || 0) >= maxOrder) {
            maxOrder = (metaList[i].order || 0) + 1;
        }
    }

    var defaultName = getDefaultNewMapName();
    var meta = { id: newId, name: defaultName, type: 'page', folderId: folderId, order: maxOrder, createdAt: now, updatedAt: now };
    metaList.push(meta);
    saveMetaList(metaList);
    try { localStorage.setItem(getMapDataKey(newId), JSON.stringify(defaultData)); } catch(e) {}

    // Expand the folder
    var cs = getCollapseState();
    cs[folderId] = false;
    setCollapseState(cs);

    switchToMap(newId);
    showToast('新しいマップを作成しました');
    // タイトル日付モードON時は _ の直後にカーソル、OFF時は従来通り全選択
    setTimeout(function() {
        startInlineRename(newId, getTitleDateMode() ? { cursorAtEnd: true } : undefined);
    }, 200);
    if (window._supa) {
        window._supa.saveMap(newId, defaultName, defaultData, folderId).catch(function(){});
    }
}

// ---- CRUD: Folders ----
export function createFolder() {
    var metaList = getMetaList();
    var newId = getNextMapId();
    var now = nowISO();

    // Get max order among non-default folders
    var maxOrder = 0;
    for (var i = 0; i < metaList.length; i++) {
        if (metaList[i].type === 'folder' && !metaList[i].isDefault && (metaList[i].order || 0) >= maxOrder) {
            maxOrder = (metaList[i].order || 0) + 1;
        }
    }

    var meta = { id: newId, name: '新しいフォルダ', type: 'folder', order: maxOrder, createdAt: now, updatedAt: now };
    metaList.push(meta);
    saveMetaList(metaList);
    renderMapList();
    showToast('フォルダを作成しました');
    setTimeout(function() { startInlineRename(newId); }, 200);
    if (window._supa) {
        window._supa.saveFolder(newId, '新しいフォルダ', maxOrder).catch(function(){});
    }
}

export function createSubFolder(parentFolderId) {
    var metaList = getMetaList();
    var newId = getNextMapId();
    var now = nowISO();

    // Get max order among sibling folders
    var maxOrder = 0;
    for (var i = 0; i < metaList.length; i++) {
        if (metaList[i].type === 'folder' && !metaList[i].isDefault
            && (metaList[i].parentFolderId || null) === (parentFolderId || null)
            && (metaList[i].order || 0) >= maxOrder) {
            maxOrder = (metaList[i].order || 0) + 1;
        }
    }

    var meta = { id: newId, name: '新しいフォルダ', type: 'folder', parentFolderId: parentFolderId, order: maxOrder, createdAt: now, updatedAt: now };
    metaList.push(meta);
    saveMetaList(metaList);

    // Expand parent folder
    var cs = getCollapseState();
    cs[parentFolderId] = false;
    setCollapseState(cs);

    renderMapList();
    showToast('フォルダを作成しました');
    setTimeout(function() { startInlineRename(newId); }, 200);
    if (window._supa) {
        window._supa.saveFolder(newId, '新しいフォルダ', maxOrder, parentFolderId).catch(function(){});
    }
}

export function deleteFolder(folderId) {
    var metaList = getMetaList();
    var folderMeta = findMetaById(folderId);
    if (!folderMeta || folderMeta.isDefault) {
        showToast('⚠️ このフォルダは削除できません');
        return;
    }

    // Collect all descendant folder IDs recursively
    function collectDescendantFolderIds(id) {
        var ids = [id];
        for (var i = 0; i < metaList.length; i++) {
            if (metaList[i].type === 'folder' && (metaList[i].parentFolderId || null) === (id || null)) {
                ids = ids.concat(collectDescendantFolderIds(metaList[i].id));
            }
        }
        return ids;
    }
    var allFolderIds = collectDescendantFolderIds(folderId);
    var folderIdSet = {};
    for (var i = 0; i < allFolderIds.length; i++) folderIdSet[allFolderIds[i]] = true;

    // Remove pages in those folders
    var pagesToDelete = [];
    for (i = 0; i < metaList.length; i++) {
        if (metaList[i].type === 'page' && folderIdSet[metaList[i].folderId]) {
            pagesToDelete.push(metaList[i].id);
        }
    }

    // 削除内容の件数を確認ダイアログに明示（誤削除防止）
    var subFolderCount = allFolderIds.length - 1; // 自分自身を除く
    var pageCount      = pagesToDelete.length;
    var confirmMsg = '「' + folderMeta.name + '」フォルダを削除しますか？\n\n';
    if (subFolderCount === 0 && pageCount === 0) {
        confirmMsg += '（中身は空です）';
    } else {
        var parts = [];
        if (subFolderCount > 0) parts.push('サブフォルダ ' + subFolderCount + '個');
        if (pageCount > 0)      parts.push('マップ ' + pageCount + '個');
        confirmMsg += '⚠ 中の ' + parts.join(' と ') + ' もすべて削除されます。\nこの操作は元に戻せません。';
    }
    if (!confirm(confirmMsg)) return;

    // Delete page data from localStorage
    for (i = 0; i < pagesToDelete.length; i++) {
        try { localStorage.removeItem(getMapDataKey(pagesToDelete[i])); } catch(e) {}
        if (window._supa) window._supa.deleteMap(pagesToDelete[i]).catch(function(){});
    }

    // Remove all affected folders and pages from meta
    var newMeta = metaList.filter(function(m) {
        if (folderIdSet[m.id]) return false;
        if (m.type === 'page' && folderIdSet[m.folderId]) return false;
        return true;
    });

    // If current map was deleted, switch to another
    var needSwitch = (pagesToDelete.indexOf(currentMapId) !== -1);

    saveMetaList(newMeta);

    if (window._supa) {
        for (i = 0; i < allFolderIds.length; i++) {
            window._supa.deleteFolder(allFolderIds[i]).catch(function(){});
        }
    }

    if (needSwitch) {
        var remainingPages = newMeta.filter(function(m) { return m.type === 'page'; });
        remainingPages.sort(function(a, b) { return (b.updatedAt || '').localeCompare(a.updatedAt || ''); });
        if (remainingPages.length > 0) {
            switchToMap(remainingPages[0].id);
        }
    } else {
        renderMapList();
    }
    showToast('🗑 フォルダを削除しました');
}

// 複数ページを一括削除
export function deleteMapMultiple(mapIds) {
    if (!mapIds || mapIds.length === 0) return;
    var metaList = getMetaList();
    var pages = metaList.filter(function(m) { return m.type === 'page'; });
    if (pages.length <= mapIds.length) {
        showToast('⚠️ すべてのマップは削除できません');
        return;
    }
    if (!confirm(mapIds.length + '件のマップを削除しますか？')) return;

    var newMeta = metaList.filter(function(m) { return mapIds.indexOf(String(m.id)) === -1; });
    for (var i = 0; i < mapIds.length; i++) {
        try { localStorage.removeItem(getMapDataKey(mapIds[i])); } catch(e) {}
        if (window._supa) window._supa.deleteMap(mapIds[i]).catch(function(){});
    }
    clearSidebarSelection();

    var needSwitch = mapIds.indexOf(String(currentMapId)) !== -1;
    saveMetaList(newMeta);
    if (needSwitch) {
        var remaining = newMeta.filter(function(m) { return m.type === 'page'; });
        remaining.sort(function(a, b) { return (b.updatedAt || '').localeCompare(a.updatedAt || ''); });
        if (remaining.length > 0) switchToMap(remaining[0].id);
    } else {
        renderMapList();
    }
    showToast('🗑 ' + mapIds.length + '件のマップを削除しました');
}

// 複数フォルダを一括削除
export function deleteFolderMultiple(folderIds) {
    if (!folderIds || folderIds.length === 0) return;

    var metaList = getMetaList();
    var deletedPageIds = [];

    // 子孫フォルダ収集ヘルパー（外側へ移動して件数集計でも使えるようにする）
    function collectDesc(id) {
        var ids = [id];
        for (var i = 0; i < metaList.length; i++) {
            if (metaList[i].type === 'folder' && (metaList[i].parentFolderId || null) === (id || null)) {
                ids = ids.concat(collectDesc(metaList[i].id));
            }
        }
        return ids;
    }

    for (var fi = 0; fi < folderIds.length; fi++) {
        var fid = folderIds[fi];
        var allIds = collectDesc(fid);
        for (var i = 0; i < metaList.length; i++) {
            if (allIds.indexOf(metaList[i].id) !== -1 && metaList[i].type !== 'folder') {
                deletedPageIds.push(metaList[i].id);
            }
            if (metaList[i].type === 'page' && allIds.indexOf(metaList[i].folderId) !== -1) {
                if (deletedPageIds.indexOf(metaList[i].id) === -1) deletedPageIds.push(metaList[i].id);
            }
        }
    }

    // 削除内容の件数を確認ダイアログに明示
    var totalFolderSet = {};
    for (fi = 0; fi < folderIds.length; fi++) {
        var allDesc = collectDesc(folderIds[fi]);
        for (i = 0; i < allDesc.length; i++) totalFolderSet[allDesc[i]] = true;
    }
    var totalFolderCount = Object.keys(totalFolderSet).length;
    var pageCount        = deletedPageIds.length;
    var confirmMsg = folderIds.length + '個のフォルダを削除しますか？\n\n';
    var parts = [];
    parts.push('フォルダ ' + totalFolderCount + '個（サブフォルダ含む）');
    if (pageCount > 0) parts.push('マップ ' + pageCount + '個');
    confirmMsg += '⚠ ' + parts.join(' と ') + ' をすべて削除します。\nこの操作は元に戻せません。';
    if (!confirm(confirmMsg)) return;

    // ページデータを削除
    for (i = 0; i < deletedPageIds.length; i++) {
        try { localStorage.removeItem(getMapDataKey(deletedPageIds[i])); } catch(e) {}
        if (window._supa) window._supa.deleteMap(deletedPageIds[i]).catch(function(){});
    }

    // メタからフォルダ・ページを除去（件数集計時に作った totalFolderSet を再利用）
    var allFolderSet = totalFolderSet;
    var newMeta = metaList.filter(function(m) {
        if (allFolderSet[m.id]) return false;
        if (m.type === 'page' && allFolderSet[m.folderId]) return false;
        if (deletedPageIds.indexOf(m.id) !== -1) return false;
        return true;
    });

    clearSidebarSelection();
    var needSwitch = deletedPageIds.indexOf(currentMapId) !== -1;
    saveMetaList(newMeta);

    if (window._supa) {
        for (var id in allFolderSet) window._supa.deleteFolder(id).catch(function(){});
    }

    if (needSwitch) {
        var remaining = newMeta.filter(function(m) { return m.type === 'page'; });
        remaining.sort(function(a, b) { return (b.updatedAt || '').localeCompare(a.updatedAt || ''); });
        if (remaining.length > 0) switchToMap(remaining[0].id);
    } else {
        renderMapList();
    }
    showToast('🗑 ' + folderIds.length + '件のフォルダを削除しました');
}

export function switchToMap(mapId) {
    if (mapId === currentMapId) return;

    // 直前マップの保留中 Supabase 保存を強制フラッシュ
    // （切替後にデバウンスタイマーが新マップ用に上書きされ、直前マップの保存が消えるのを防ぐ）
    if (typeof window._supaFlushSync === 'function') window._supaFlushSync();

    // フォーカスをクリアする（マップ名のリネーム入力欄等にフォーカスが残っていると、
    // 切替後のキー入力・ペーストがそちらに流れてしまうため）
    try {
        var ae = document.activeElement;
        if (ae && ae.blur && ae !== document.body) ae.blur();
    } catch(e) {}
    // 注: ここでサイドバーナビゲーションモードは解除しない。
    // マイマップでマップを選んだ後も矢印キーでリスト移動・フォルダ開閉を続けられるようにする（Finder風）。
    // モードの解除は「サイドバー外の mousedown」を捕捉するリスナー（events.js）が担う。

    // Save current map
    saveToLocalStorage();

    // Load new map
    var data = loadMapData(mapId);
    if (!data) {
        showToast('マップデータが見つかりません');
        return;
    }

    // Reset state
    finishEditing();
    selectedNodeIds.clear();
    setLastSelectedNodeId(null);
    setSelectionAnchorId(null);
    setEditingNodeId(null);
    setUndoHistory([]);
    setUndoIndex(-1);
    // クリップボードはページを跨いで保持する（ページ間コピペを可能にするため）。
    // クリップボードのデータは deep clone 済みで元マップから独立しており、
    // ペースト時に reassignIds() で全ノードIDを再採番するため衝突も発生しない。

    setCurrentMapId(mapId);
    setMindMapData(data);
    setLastActiveId(mapId);
    updateUrlParam(mapId);
    updatePageTitle();

    saveState();
    render();
    resetView();
    renderMapList();
    selectNode('root');
}

export function duplicateMap(mapId) {
    var srcMeta = findMetaById(mapId);
    if (!srcMeta || srcMeta.type !== 'page') return;

    var srcData = loadMapData(mapId);
    if (!srcData) return;

    var newId = getNextMapId();
    var now = nowISO();

    // Get max order among pages in same folder
    var metaList = getMetaList();
    var folderId = srcMeta.folderId;
    var maxOrder = 0;
    for (var i = 0; i < metaList.length; i++) {
        if (metaList[i].type === 'page' && metaList[i].folderId === folderId && (metaList[i].order || 0) >= maxOrder) {
            maxOrder = (metaList[i].order || 0) + 1;
        }
    }

    var newMeta = {
        id: newId,
        name: srcMeta.name + ' のコピー',
        type: 'page',
        folderId: folderId,
        order: maxOrder,
        createdAt: now,
        updatedAt: now
    };

    metaList.push(newMeta);
    saveMetaList(metaList);
    try { localStorage.setItem(getMapDataKey(newId), JSON.stringify(deepClone(srcData))); } catch(e) {}
    // Supabase へも保存（リロードで複製マップが消える事故を防ぐ）
    if (window._supa) window._supa.saveMap(newId, newMeta.name, srcData, folderId).catch(function(){});

    renderMapList();
    showToast('📑 マップを複製しました');
}

export function deleteMap(mapId) {
    var metaList = getMetaList();
    var pages = metaList.filter(function(m) { return m.type === 'page'; });
    if (pages.length <= 1) {
        showToast('⚠️ 最後のマップは削除できません');
        return;
    }
    if (!confirm('このマップを削除しますか？')) return;

    // Remove from meta
    var newMeta = metaList.filter(function(m) { return m.id !== mapId; });

    saveMetaList(newMeta);
    try { localStorage.removeItem(getMapDataKey(mapId)); } catch(e) {}
    if (window._supa) {
        window._supa.deleteMap(mapId).catch(function(){});
    }

    if (mapId === currentMapId) {
        // Switch to first available page
        var remainingPages = newMeta.filter(function(m) { return m.type === 'page'; });
        remainingPages.sort(function(a, b) { return (b.updatedAt || '').localeCompare(a.updatedAt || ''); });
        if (remainingPages.length > 0) {
            switchToMap(remainingPages[0].id);
        }
    } else {
        renderMapList();
    }
    showToast('🗑 マップを削除しました');
}

export function startInlineRename(mapId, options) {
    var item = document.querySelector('.map-item[data-map-id="' + mapId + '"]');
    if (!item) return;
    var nameEl = item.querySelector('.map-item-name');
    if (!nameEl) return;

    // Check if it's the default folder (未分類) - don't allow rename
    var meta = findMetaById(mapId);
    if (meta && meta.type === 'folder' && meta.isDefault) return;

    // Replace name span with an input element
    // Use meta name (raw) to avoid including display-only prefixes like \uD83D\uDCC1
    var currentName = meta ? meta.name : nameEl.textContent;
    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'map-item-rename-input';
    input.value = currentName;

    nameEl.style.display = 'none';
    nameEl.parentNode.insertBefore(input, nameEl.nextSibling);
    input.focus();
    // options.cursorAtEnd が true なら末尾にカーソル、それ以外は全選択（既存挙動）
    if (options && options.cursorAtEnd) {
        var endPos = input.value.length;
        input.setSelectionRange(endPos, endPos);
    } else {
        input.select();
    }

    var finished = false;
    function finish(save) {
        if (finished) return;
        finished = true;
        var defaultName = (meta && meta.type === 'folder') ? '新しいフォルダ' : '無題のマップ';
        var newName = save ? (input.value.trim() || defaultName) : currentName;
        nameEl.style.display = '';
        if (input.parentNode) input.parentNode.removeChild(input);

        if (save) {
            var metaList = getMetaList();
            var savedMeta = null;
            for (var i = 0; i < metaList.length; i++) {
                if (String(metaList[i].id) === String(mapId)) {
                    metaList[i].name = newName;
                    metaList[i].updatedAt = nowISO();
                    savedMeta = metaList[i];
                    break;
                }
            }
            saveMetaList(metaList);
            if (mapId === currentMapId) updatePageTitle();
            // Supabase sync for rename
            if (window._supa && savedMeta) {
                if (savedMeta.type === 'folder') {
                    window._supa.saveFolder(mapId, newName, savedMeta.order || 0).catch(function(){});
                } else {
                    // For page rename, use saveMap with current data
                    var pageData;
                    try { pageData = JSON.parse(localStorage.getItem('mindmap-data-' + mapId)); } catch(e2) { pageData = null; }
                    if (pageData) {
                        window._supa.saveMap(mapId, newName, pageData, savedMeta.folderId).catch(function(){});
                    }
                }
            }
        }
        renderMapList();
    }

    input.addEventListener('keydown', function(e) {
        e.stopPropagation(); // Prevent global keyboard handler
        if (e.key === 'Enter') {
            // IME変換中・変換確定直後のEnterはリネーム確定しない
            if (isImeRelatedKey(e)) return;
            e.preventDefault();
            finish(true);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            finish(false);
        }
    });
    input.addEventListener('blur', function() {
        finish(true);
    });
}
