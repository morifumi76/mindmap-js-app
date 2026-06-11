// 左サイドバー: ドラッグ&ドロップ
import { getCollapseState, getMetaList, loadMapData, saveMetaList, setCollapseState } from '../storage.js';
import { showToast } from '../utils.js';
import { renderMapList } from './render.js';
import { mapDragState } from './state.js';

export function clearMapDragIndicators() {
    document.querySelectorAll('.map-item').forEach(function(el) {
        el.classList.remove('drag-over-above', 'drag-over-below', 'drag-over-into');
    });
}

// 複数ページを一括でフォルダ移動または並び替え
function handleMultiPageDrop(dragIds, targetId, position) {
    var metaList = getMetaList();
    var targetMeta = null;
    for (var i = 0; i < metaList.length; i++) {
        if (metaList[i].id === targetId) { targetMeta = metaList[i]; break; }
    }
    if (!targetMeta) return;

    var targetFolderId;
    if (position === 'into' && targetMeta.type === 'folder') {
        // フォルダへドロップ → そのフォルダへ一括移動
        targetFolderId = targetId;
    } else if (targetMeta.type === 'page') {
        // ページの上/下へドロップ → そのページと同じフォルダへ移動
        targetFolderId = targetMeta.folderId || null;
    } else if (targetMeta.type === 'folder') {
        targetFolderId = targetId;
    } else {
        return;
    }

    // 移動先フォルダの現在の最大 order を求める（手動順モードで末尾に配置するため）
    var maxOrder = -1;
    for (i = 0; i < metaList.length; i++) {
        var mi = metaList[i];
        if (mi.type === 'page' && (mi.folderId || null) === (targetFolderId || null) && dragIds.indexOf(String(mi.id)) === -1) {
            if ((mi.order || 0) > maxOrder) maxOrder = (mi.order || 0);
        }
    }

    // 選択ページをターゲットフォルダへ移動し、移動したページを記録
    var movedPages = [];
    for (i = 0; i < metaList.length; i++) {
        if (dragIds.indexOf(String(metaList[i].id)) !== -1 && metaList[i].type === 'page') {
            metaList[i].folderId = targetFolderId;
            maxOrder++;
            metaList[i].order = maxOrder;
            movedPages.push(metaList[i]);
        }
    }

    // ターゲットフォルダを展開（targetFolderId が null = トップレベルなら展開不要）
    if (targetFolderId) {
        var cs = getCollapseState();
        cs[targetFolderId] = false;
        setCollapseState(cs);
    }

    saveMetaList(metaList);

    // Supabase へ移動を反映（これが無いとリロード時に元の場所へ戻ってしまう）
    if (window._supa) {
        for (i = 0; i < movedPages.length; i++) {
            var mp = movedPages[i];
            var mpData = loadMapData(mp.id);
            if (mpData) {
                window._supa.saveMap(mp.id, mp.name, mpData, mp.folderId).catch(function(){});
            }
        }
    }

    renderMapList();
    showToast(dragIds.length + '件を移動しました');
}

// Check if targetId is a descendant of dragId (to prevent circular nesting)
function isFolderDescendant(metaList, ancestorId, checkId) {
    for (var i = 0; i < metaList.length; i++) {
        var m = metaList[i];
        if (m.id === checkId && m.type === 'folder') {
            var pf = m.parentFolderId || null;
            if (pf === null) return false;
            if (pf === ancestorId) return true;
            return isFolderDescendant(metaList, ancestorId, pf);
        }
    }
    return false;
}

// お気に入りセクション内の並び替え処理
export function handleFavDrop(dragId, targetId, position) {
    if (dragId === targetId) return;
    var metaList = getMetaList();
    var starredItems = metaList.filter(function(m) { return m.type === 'page' && m.starred && m.id !== dragId; });
    starredItems.sort(function(a, b) { return (a.starOrder || 0) - (b.starOrder || 0); });

    var dragMeta = null;
    for (var i = 0; i < metaList.length; i++) {
        if (metaList[i].id === dragId) { dragMeta = metaList[i]; break; }
    }
    if (!dragMeta) return;

    var targetIdx = -1;
    for (i = 0; i < starredItems.length; i++) {
        if (starredItems[i].id === targetId) { targetIdx = i; break; }
    }
    if (targetIdx === -1) return;
    if (position === 'below') targetIdx++;
    starredItems.splice(targetIdx, 0, dragMeta);
    for (i = 0; i < starredItems.length; i++) {
        starredItems[i].starOrder = i;
    }
    saveMetaList(metaList);
    // Supabaseに同期
    if (typeof window._supaQueueSync === 'function' && !window._isReadOnly) {
        window._supaQueueSync(dragId);
    }
    renderMapList();
}

export function handleMapDrop(dragId, targetId, position, dragType) {
    // 複数選択ドラッグ（ページ一括移動）
    if (mapDragState.draggingIds && mapDragState.draggingIds.length > 1 && dragType === 'page') {
        handleMultiPageDrop(mapDragState.draggingIds, targetId, position);
        mapDragState.draggingIds = null;
        return;
    }
    if (dragId === targetId) return;
    var metaList = getMetaList();
    var dragMeta = null, targetMeta = null;
    for (var i = 0; i < metaList.length; i++) {
        if (metaList[i].id === dragId) dragMeta = metaList[i];
        if (metaList[i].id === targetId) targetMeta = metaList[i];
    }
    if (!dragMeta || !targetMeta) return;

    if (dragType === 'folder') {
        if (targetMeta.type !== 'folder') return;

        if (position === 'into') {
            // Drop folder INTO another folder (nesting)
            if (targetMeta.isDefault) return;
            // Prevent circular reference
            if (isFolderDescendant(metaList, dragId, targetId)) {
                showToast('⚠️ 自分自身の中には移動できません');
                return;
            }
            dragMeta.parentFolderId = targetId;
            // Expand the target folder
            var cs = getCollapseState();
            cs[targetId] = false;
            setCollapseState(cs);
            // Supabase に親子関係を保存
            if (window._supa) {
                window._supa.saveFolder(dragId, dragMeta.name, dragMeta.order || 0, targetId).catch(function(){});
            }
        } else {
            // Reorder: above or below among siblings with same parentFolderId
            if (targetMeta.isDefault) return;
            var sameParent = targetMeta.parentFolderId || null;
            // Prevent circular reference when reparenting
            if (sameParent !== (dragMeta.parentFolderId || null)) {
                if (isFolderDescendant(metaList, dragId, targetId)) {
                    showToast('⚠️ 自分自身の中には移動できません');
                    return;
                }
            }
            dragMeta.parentFolderId = sameParent;

            var siblings = metaList.filter(function(m) {
                return m.type === 'folder' && !m.isDefault && m.id !== dragId
                    && (m.parentFolderId || null) === sameParent;
            });
            siblings.sort(function(a, b) { return (a.order || 0) - (b.order || 0); });
            var targetIdx = -1;
            for (i = 0; i < siblings.length; i++) {
                if (siblings[i].id === targetId) { targetIdx = i; break; }
            }
            if (targetIdx === -1) return;
            if (position === 'below') targetIdx++;
            siblings.splice(targetIdx, 0, dragMeta);
            for (i = 0; i < siblings.length; i++) {
                siblings[i].order = i;
            }
            // Supabase に並び順・親フォルダを保存（階層が変わる場合も含む）
            if (window._supa) {
                window._supa.saveFolder(dragId, dragMeta.name, dragMeta.order || 0, sameParent || null).catch(function(){});
            }
        }
    } else if (dragType === 'page') {
        if (position === 'into' && targetMeta.type === 'folder') {
            // Move page into folder
            dragMeta.folderId = targetId;
            var pagesInFolder = metaList.filter(function(m) { return m.type === 'page' && m.folderId === targetId; });
            dragMeta.order = pagesInFolder.length > 0 ? Math.max.apply(null, pagesInFolder.map(function(m) { return m.order || 0; })) + 1 : 0;
            // Expand the target folder
            cs = getCollapseState();
            cs[targetId] = false;
            setCollapseState(cs);
        } else if (targetMeta.type === 'page') {
            // Reorder page among siblings in same folder
            var targetFolderId = targetMeta.folderId;
            dragMeta.folderId = targetFolderId;

            siblings = metaList.filter(function(m) {
                return m.type === 'page' && m.folderId === targetFolderId && m.id !== dragId;
            });
            siblings.sort(function(a, b) { return (a.order || 0) - (b.order || 0); });

            targetIdx = -1;
            for (i = 0; i < siblings.length; i++) {
                if (siblings[i].id === targetId) { targetIdx = i; break; }
            }
            if (targetIdx === -1) targetIdx = siblings.length - 1;
            if (position === 'below') targetIdx++;
            siblings.splice(targetIdx, 0, dragMeta);
            for (i = 0; i < siblings.length; i++) {
                siblings[i].order = i;
            }
        }
    }

    saveMetaList(metaList);

    // ページ移動後に Supabase へ同期（フォルダ変更・並び順変更どちらも対象）
    if (window._supa && dragType === 'page' && dragMeta) {
        var _movedData = loadMapData(dragMeta.id);
        if (_movedData) {
            window._supa.saveMap(dragMeta.id, dragMeta.name, _movedData, dragMeta.folderId).catch(function(){});
        }
    }

    renderMapList();
}
