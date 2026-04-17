// ========================================
// Left Sidebar: My Maps Management
// ========================================

// ---- Sidebar Multi-Selection State ----
var sidebarSelectedIds = new Set();
var sidebarLastSelectedId = null;
var sidebarAnchorId = null;

// Flag: true while keyboard focus is logically "inside" the sidebar list
window.sidebarNavigationMode = false;

// Clipboard for sidebar copy/paste/cut
var sidebarClipboard = null; // { mode: 'copy'|'cut', ids: [] }


// Undo/Redo history (metaList snapshots)
var sidebarHistory = [];
var sidebarHistoryPos = -1;
var SIDEBAR_HISTORY_MAX = 30;

var LEFT_SIDEBAR_OPEN_MIN = 200;
var LEFT_SIDEBAR_DEFAULT = 240;
var LEFT_SIDEBAR_KEY = 'mindmap_left_sidebar_width';
var leftSidebarIsOpen = false;
var leftSidebarPeekTimeout = null;
var leftSidebarInitialized = false;

// ========================================
// Sidebar Clipboard & Undo/Redo
// ========================================

function sidebarPushHistory() {
    if (sidebarHistoryPos < sidebarHistory.length - 1) {
        sidebarHistory = sidebarHistory.slice(0, sidebarHistoryPos + 1);
    }
    sidebarHistory.push(JSON.stringify(getMetaList()));
    if (sidebarHistory.length > SIDEBAR_HISTORY_MAX) sidebarHistory.shift();
    sidebarHistoryPos = sidebarHistory.length - 1;
}

function sidebarUndo() {
    if (sidebarHistoryPos <= 0) { showToast('これ以上戻せません'); return; }
    sidebarHistoryPos--;
    var snapshot = JSON.parse(sidebarHistory[sidebarHistoryPos]);
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

function sidebarRedo() {
    if (sidebarHistoryPos >= sidebarHistory.length - 1) { showToast('やり直す操作がありません'); return; }
    sidebarHistoryPos++;
    var snapshot = JSON.parse(sidebarHistory[sidebarHistoryPos]);
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

function sidebarCopyItems() {
    if (sidebarSelectedIds.size === 0) { showToast('アイテムを選択してください'); return; }
    var ids = [];
    sidebarSelectedIds.forEach(function(id) { ids.push(id); });
    sidebarClipboard = { mode: 'copy', ids: ids };
    showToast('📋 ' + ids.length + '件をコピーしました');
}

function sidebarCutItems() {
    if (sidebarSelectedIds.size === 0) { showToast('アイテムを選択してください'); return; }
    var ids = [];
    sidebarSelectedIds.forEach(function(id) {
        var m = findMetaById(id);
        if (m && m.type === 'page') ids.push(id);
    });
    if (ids.length === 0) { showToast('ページのみ切り取り可能です'); return; }
    sidebarClipboard = { mode: 'cut', ids: ids };
    showToast('✂️ ' + ids.length + '件を切り取りました');
}

function sidebarGetPasteDestFolder() {
    var metaList = getMetaList();
    if (sidebarLastSelectedId) {
        var m = findMetaById(sidebarLastSelectedId);
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

function sidebarPasteItems(moveMode) {
    if (!sidebarClipboard || sidebarClipboard.ids.length === 0) {
        showToast('コピーしたアイテムがありません'); return;
    }
    var destFolderId = sidebarGetPasteDestFolder();
    var isMove = moveMode || sidebarClipboard.mode === 'cut';

    sidebarPushHistory();

    if (!isMove) {
        // 複製
        var count = 0;
        for (var i = 0; i < sidebarClipboard.ids.length; i++) {
            var newId = duplicateMapToFolder(sidebarClipboard.ids[i], destFolderId);
            if (newId) count++;
        }
        renderMapList();
        showToast('📑 ' + count + '件を複製しました');
    } else {
        // 移動
        var metaList = getMetaList();
        var count = 0;
        for (var i = 0; i < sidebarClipboard.ids.length; i++) {
            var sid = sidebarClipboard.ids[i];
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
        sidebarClipboard = null;
        renderMapList();
        showToast('📁 ' + count + '件を移動しました');
    }
}

function initLeftSidebar() {
    if (leftSidebarInitialized) return;
    leftSidebarInitialized = true;
    // 初期状態を履歴に記録（Undoの起点）
    setTimeout(function() { sidebarPushHistory(); }, 0);
    var sidebar = document.getElementById('leftSidebar');
    var handle = document.getElementById('leftSidebarResizeHandle');
    var hoverZone = document.getElementById('leftSidebarHoverZone');
    var floatToggle = document.getElementById('leftSidebarFloatToggle');

    // Determine initial state: open by default (240px), or use saved width
    var savedW = parseInt(localStorage.getItem(LEFT_SIDEBAR_KEY), 10);
    if (savedW && savedW >= LEFT_SIDEBAR_OPEN_MIN) {
        openLeftSidebar(savedW);
    } else if (savedW === 0) {
        // Explicitly closed before
        closeLeftSidebar();
    } else {
        // First time: open at default width and save
        openLeftSidebar(LEFT_SIDEBAR_DEFAULT);
        try { localStorage.setItem(LEFT_SIDEBAR_KEY, LEFT_SIDEBAR_DEFAULT); } catch(ex) {}
    }

    // Toggle button «/» inside the header closes sidebar
    var toggleBtn = document.getElementById('leftSidebarToggle');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            if (leftSidebarIsOpen) {
                closeLeftSidebar();
                try { localStorage.setItem(LEFT_SIDEBAR_KEY, '0'); } catch(ex) {}
            } else {
                openLeftSidebar(LEFT_SIDEBAR_DEFAULT);
                try { localStorage.setItem(LEFT_SIDEBAR_KEY, LEFT_SIDEBAR_DEFAULT); } catch(ex) {}
            }
            renderMapList();
        });
    }

    // Floating ☰ button re-opens the sidebar
    if (floatToggle) {
        floatToggle.addEventListener('click', function(e) {
            e.stopPropagation();
            openLeftSidebar(LEFT_SIDEBAR_DEFAULT);
            try { localStorage.setItem(LEFT_SIDEBAR_KEY, LEFT_SIDEBAR_DEFAULT); } catch(ex) {}
            renderMapList();
        });
    }

    // Hover zone: when sidebar is collapsed, hovering near left edge peeks it in
    if (hoverZone) {
        hoverZone.addEventListener('mouseenter', function() {
            if (leftSidebarIsOpen) return;
            leftSidebarPeekTimeout = setTimeout(function() {
                sidebar.classList.add('peek');
            }, 200);
        });
        hoverZone.addEventListener('mouseleave', function() {
            clearTimeout(leftSidebarPeekTimeout);
        });
    }

    // Remove peek when mouse leaves the sidebar area
    sidebar.addEventListener('mouseleave', function() {
        if (!leftSidebarIsOpen) {
            sidebar.classList.remove('peek');
        }
    });

    // New map button
    document.getElementById('newMapBtn').addEventListener('click', function(e) {
        e.stopPropagation();
        createNewMap();
    });

    // キャンバス右上の星ボタン: お気に入りトグル
    var canvasStarBtn = document.getElementById('canvasStarBtn');
    if (canvasStarBtn) {
        canvasStarBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            if (!currentMapId) return;
            var isNowStarred = toggleFavorite(currentMapId);
            renderMapList();
            showToast(isNowStarred ? '★ お気に入りに追加しました' : '☆ お気に入りから外しました');
        });
    }

    // Context menu actions for pages
    document.getElementById('ctxMenu').addEventListener('click', function(e) {
        var action = e.target.getAttribute('data-action');
        if (!action || !ctxMenuTargetMapId) return;
        var cm = document.getElementById('ctxMenu');
        cm.classList.remove('show');
        var targetId = ctxMenuTargetMapId;
        ctxMenuTargetMapId = null;

        if (action === 'rename') {
            startInlineRename(targetId);
        } else if (action === 'duplicate') {
            duplicateMap(targetId);
        } else if (action === 'delete') {
            // 複数選択中なら選択したページを一括削除
            if (sidebarSelectedIds.size > 1 && sidebarSelectedIds.has(String(targetId))) {
                var pageIds = [];
                sidebarSelectedIds.forEach(function(id) {
                    var m = findMetaById(id);
                    if (m && m.type === 'page') pageIds.push(id);
                });
                deleteMapMultiple(pageIds);
            } else {
                deleteMap(targetId);
            }
        } else if (action === 'share') {
            if (typeof window.showShareDialog === 'function') window.showShareDialog(targetId);
        }
    });

    // Context menu actions for folders
    document.getElementById('ctxMenuFolder').addEventListener('click', function(e) {
        var action = e.target.getAttribute('data-action');
        if (!ctxMenuTargetMapId) return;
        var cm = document.getElementById('ctxMenuFolder');
        cm.classList.remove('show');
        var targetId = ctxMenuTargetMapId;
        ctxMenuTargetMapId = null;

        if (action === 'folder-rename') {
            startInlineRename(targetId);
        } else if (action === 'folder-add-page') {
            createPageInFolder(targetId);
        } else if (action === 'folder-add-subfolder') {
            createSubFolder(targetId);
        } else if (action === 'folder-delete') {
            // 複数選択中なら選択したフォルダを一括削除
            if (sidebarSelectedIds.size > 1 && sidebarSelectedIds.has(String(targetId))) {
                var folderIds = [];
                sidebarSelectedIds.forEach(function(id) {
                    var m = findMetaById(id);
                    if (m && m.type === 'folder' && !m.isDefault) folderIds.push(id);
                });
                deleteFolderMultiple(folderIds);
            } else {
                deleteFolder(targetId);
            }
        }
    });

    // Context menu for empty area
    document.getElementById('ctxMenuArea').addEventListener('click', function(e) {
        var action = e.target.getAttribute('data-action');
        var cm = document.getElementById('ctxMenuArea');
        cm.classList.remove('show');
        if (action === 'create-folder') {
            createFolder();
        }
    });

    // Click on empty area of map list → clear selection
    document.getElementById('mapList').addEventListener('click', function(e) {
        if (e.target === document.getElementById('mapList')) {
            clearSidebarSelection();
        }
    });

    // Flag-based arrow key navigation
    // mousedown on any map-item → enter navigation mode
    document.getElementById('mapList').addEventListener('mousedown', function(e) {
        var item = e.target.closest('.map-item');
        if (item) {
            window.sidebarNavigationMode = true;
        }
    });
    // mousedown outside sidebar → exit navigation mode
    document.addEventListener('mousedown', function(e) {
        var sidebar = document.getElementById('leftSidebar');
        if (sidebar && !sidebar.contains(e.target)) {
            window.sidebarNavigationMode = false;
        }
    });

    document.addEventListener('keydown', function(e) {
        if (!window.sidebarNavigationMode) return;
        // リネーム入力中はこのリスナーを無視（Enter確定後の再発火を防ぐ）
        var _activeEl = document.activeElement;
        if (_activeEl && _activeEl.classList.contains('map-item-rename-input')) return;

        var sbIsMac = /Mac/.test(navigator.platform);
        var sbCmd   = sbIsMac ? e.metaKey : e.ctrlKey;
        var isVertical   = e.key === 'ArrowUp'   || e.key === 'ArrowDown';
        var isHorizontal = e.key === 'ArrowLeft' || e.key === 'ArrowRight';
        // Mac: Enter=rename, Win: F2=rename
        var isRename    = (sbIsMac && e.key === 'Enter' && !e.shiftKey && !sbCmd) ||
                          (!sbIsMac && e.key === 'F2');
        // Mac: Cmd+Backspace=delete, Win: Delete (no modifier)=delete
        var isDelete    = (sbIsMac && sbCmd && e.key === 'Backspace') ||
                          (!sbIsMac && e.key === 'Delete' && !sbCmd && !e.shiftKey && !e.altKey);
        var isCopy      = sbCmd && !e.shiftKey && !e.altKey && (e.key === 'c' || e.key === 'C');
        var isCut       = sbCmd && !e.shiftKey && !e.altKey && (e.key === 'x' || e.key === 'X');
        var isPaste     = sbCmd && !e.shiftKey && !e.altKey && (e.key === 'v' || e.key === 'V');
        var isMovePaste = sbIsMac && sbCmd && e.altKey && (e.key === 'v' || e.key === 'V');
        var isUndo      = sbCmd && !e.shiftKey && !e.altKey && (e.key === 'z' || e.key === 'Z');
        var isRedo      = (sbCmd && e.shiftKey && (e.key === 'z' || e.key === 'Z')) ||
                          (!sbIsMac && sbCmd && (e.key === 'y' || e.key === 'Y'));

        if (!isVertical && !isHorizontal && !isRename && !isDelete &&
            !isCopy && !isCut && !isPaste && !isMovePaste && !isUndo && !isRedo) return;
        e.preventDefault();

        // ── Undo ────────────────────────────────────────────────────────────
        if (isUndo) { sidebarUndo(); return; }

        // ── Redo ────────────────────────────────────────────────────────────
        if (isRedo) { sidebarRedo(); return; }

        // ── コピー（Cmd+C / Ctrl+C）─────────────────────────────────────────
        if (isCopy) { sidebarCopyItems(); return; }

        // ── 切り取り（Win: Ctrl+X）──────────────────────────────────────────
        if (isCut) { sidebarCutItems(); return; }

        // ── 貼り付け（Cmd+V=複製 / Cmd+Option+V=移動 / Win Ctrl+V=cut時は移動）─
        if (isPaste || isMovePaste) {
            sidebarPasteItems(isMovePaste);
            return;
        }

        // ── リネーム（Mac: Enter / Win: F2）──────────────────────────────────
        if (isRename) {
            if (sidebarLastSelectedId) startInlineRename(sidebarLastSelectedId);
            return;
        }

        // ── 削除（Mac: Cmd+Backspace / Win: Delete）──────────────────────────
        if (isDelete) {
            if (sidebarSelectedIds.size === 0) return;
            var delPageIds = [], delFolderIds = [];
            sidebarSelectedIds.forEach(function(sid) {
                var dm = findMetaById(sid);
                if (!dm) return;
                if (dm.type === 'page') delPageIds.push(dm.id);
                else if (dm.type === 'folder' && !dm.isDefault) delFolderIds.push(dm.id);
            });
            if (delPageIds.length > 0 && delFolderIds.length === 0) {
                if (delPageIds.length === 1) deleteMap(delPageIds[0]);
                else deleteMapMultiple(delPageIds.map(String));
            } else if (delFolderIds.length > 0 && delPageIds.length === 0) {
                if (delFolderIds.length === 1) deleteFolder(delFolderIds[0]);
                else deleteFolderMultiple(delFolderIds);
            } else if (delPageIds.length > 0 || delFolderIds.length > 0) {
                // 混在：ページ→フォルダの順で削除
                if (delPageIds.length > 0) deleteMapMultiple(delPageIds.map(String));
                if (delFolderIds.length > 0) deleteFolderMultiple(delFolderIds);
            }
            return;
        }

        // ── 左右キー（フォルダ開閉 / 親へ移動）──────────────────────────────
        if (isHorizontal && sidebarLastSelectedId) {
            var curMeta = findMetaById(sidebarLastSelectedId);
            if (curMeta && curMeta.type === 'folder') {
                var cs = getCollapseState();
                var curCollapsed = cs[curMeta.id] === true;
                if (e.key === 'ArrowRight' && curCollapsed) {
                    // 展開
                    cs[curMeta.id] = false;
                    setCollapseState(cs);
                    renderMapList();
                } else if (e.key === 'ArrowRight' && !curCollapsed) {
                    // 展開済み → 最初の子アイテムへ移動
                    var allItems = Array.from(document.querySelectorAll('#mapList .map-item'));
                    var curPos = -1;
                    for (var ci = 0; ci < allItems.length; ci++) {
                        if (String(allItems[ci].dataset.mapId) === String(sidebarLastSelectedId)) { curPos = ci; break; }
                    }
                    if (curPos !== -1 && curPos + 1 < allItems.length) {
                        var fcId = String(allItems[curPos + 1].dataset.mapId);
                        clearSidebarSelection();
                        sidebarSelectedIds.add(fcId);
                        sidebarLastSelectedId = fcId;
                        sidebarAnchorId = fcId;
                        updateSidebarSelectionDisplay();
                        allItems[curPos + 1].scrollIntoView({ block: 'nearest' });
                        var fcMeta = findMetaById(fcId);
                        if (fcMeta && fcMeta.type === 'page') switchToMap(fcMeta.id);
                    }
                } else if (e.key === 'ArrowLeft' && !curCollapsed) {
                    // 折りたたむ
                    cs[curMeta.id] = true;
                    setCollapseState(cs);
                    renderMapList();
                } else if (e.key === 'ArrowLeft' && curCollapsed) {
                    // 折りたたみ済み → 親フォルダへ移動
                    var pId = curMeta.parentFolderId;
                    if (pId) {
                        clearSidebarSelection();
                        sidebarSelectedIds.add(String(pId));
                        sidebarLastSelectedId = String(pId);
                        sidebarAnchorId = String(pId);
                        updateSidebarSelectionDisplay();
                        var pEl = document.querySelector('#mapList .map-item[data-map-id="' + pId + '"]');
                        if (pEl) pEl.scrollIntoView({ block: 'nearest' });
                    }
                }
            } else if (curMeta && curMeta.type === 'page' && e.key === 'ArrowLeft') {
                // ページ選択中に左 → 親フォルダへ移動
                var ppId = curMeta.folderId;
                if (ppId) {
                    clearSidebarSelection();
                    sidebarSelectedIds.add(String(ppId));
                    sidebarLastSelectedId = String(ppId);
                    sidebarAnchorId = String(ppId);
                    updateSidebarSelectionDisplay();
                    var ppEl = document.querySelector('#mapList .map-item[data-map-id="' + ppId + '"]');
                    if (ppEl) ppEl.scrollIntoView({ block: 'nearest' });
                }
            }
            return;
        }

        // ── 上下キー ──────────────────────────────────────────────────────────
        var items = Array.from(document.querySelectorAll('#mapList .map-item'));
        if (items.length === 0) return;

        // 現在位置を sidebarLastSelectedId から特定
        var currentIndex = -1;
        if (sidebarLastSelectedId) {
            for (var i = 0; i < items.length; i++) {
                if (String(items[i].dataset.mapId) === String(sidebarLastSelectedId)) {
                    currentIndex = i;
                    break;
                }
            }
        }
        if (currentIndex === -1) currentIndex = 0;

        var nextIndex;
        if (e.key === 'ArrowDown') {
            nextIndex = currentIndex < items.length - 1 ? currentIndex + 1 : currentIndex;
        } else {
            nextIndex = currentIndex > 0 ? currentIndex - 1 : 0;
        }
        if (nextIndex === currentIndex) return;

        var nextId = String(items[nextIndex].dataset.mapId);

        // Shift+↑↓: 範囲選択
        if (e.shiftKey) {
            sidebarRangeSelect(nextId);
            items[nextIndex].scrollIntoView({ block: 'nearest' });
            return;
        }

        // 通常の上下移動
        clearSidebarSelection();
        sidebarSelectedIds.add(nextId);
        sidebarLastSelectedId = nextId;
        sidebarAnchorId = nextId;
        updateSidebarSelectionDisplay();

        var nextMeta = findMetaById(nextId);
        if (nextMeta && nextMeta.type === 'page') {
            switchToMap(nextMeta.id);
            setTimeout(function() {
                var newEl = document.querySelector('#mapList .map-item[data-map-id="' + nextId + '"]');
                if (newEl) newEl.scrollIntoView({ block: 'nearest' });
            }, 0);
        } else {
            items[nextIndex].scrollIntoView({ block: 'nearest' });
        }
    });

    // Right-click on map list empty area to create folder
    document.getElementById('mapList').addEventListener('contextmenu', function(e) {
        // Only trigger if clicking on the list background itself
        if (e.target === document.getElementById('mapList')) {
            e.preventDefault();
            showAreaContextMenu(e.clientX, e.clientY);
        }
    });

    // Resize handle
    var dragging = false;
    handle.addEventListener('mousedown', function(e) {
        e.preventDefault();
        dragging = true;
        handle.classList.add('dragging');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
    });
    document.addEventListener('mousemove', function(e) {
        if (!dragging) return;
        var w = e.clientX;
        if (w < LEFT_SIDEBAR_OPEN_MIN) {
            w = LEFT_SIDEBAR_OPEN_MIN;
        } else if (w > window.innerWidth * 0.4) {
            w = Math.floor(window.innerWidth * 0.4);
        }
        sidebar.style.width = w + 'px';
        adjustCanvasForSidebars();
    });
    document.addEventListener('mouseup', function() {
        if (!dragging) return;
        dragging = false;
        handle.classList.remove('dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        var currentW = parseInt(sidebar.style.width, 10) || LEFT_SIDEBAR_DEFAULT;
        try { localStorage.setItem(LEFT_SIDEBAR_KEY, currentW); } catch(e) {}
    });
}

function openLeftSidebar(width) {
    var sidebar = document.getElementById('leftSidebar');
    var floatToggle = document.getElementById('leftSidebarFloatToggle');
    var toggleBtn = document.getElementById('leftSidebarToggle');
    var w = width || LEFT_SIDEBAR_DEFAULT;
    sidebar.style.width = w + 'px';
    sidebar.classList.remove('collapsed', 'peek');
    leftSidebarIsOpen = true;
    if (floatToggle) floatToggle.classList.remove('show');
    if (toggleBtn) toggleBtn.textContent = '«';
    adjustCanvasForSidebars();
}

function closeLeftSidebar() {
    var sidebar = document.getElementById('leftSidebar');
    var floatToggle = document.getElementById('leftSidebarFloatToggle');
    var toggleBtn = document.getElementById('leftSidebarToggle');
    sidebar.classList.add('collapsed');
    sidebar.classList.remove('peek');
    leftSidebarIsOpen = false;
    if (floatToggle) floatToggle.classList.add('show');
    if (toggleBtn) toggleBtn.textContent = '»';
    adjustCanvasForSidebars();
}

// ---- Render Map List (recursive Folder → SubFolder/Page Tree) ----
function renderMapList() {
    var list = document.getElementById('mapList');
    if (!list) return;
    var metaList = getMetaList();
    metaList = ensureDefaultFolder(metaList);
    saveMetaList(metaList);
    var sortMode = getSortMode();
    var collapseState = getCollapseState();

    var folders = metaList.filter(function(m) { return m.type === 'folder'; });
    var pages = metaList.filter(function(m) { return m.type === 'page'; });

    // お気に入りページを抽出し、starOrder 順にソート（アルファベットソートの影響を受けない）
    var starredPages = pages.filter(function(p) { return p.starred; });
    starredPages.sort(function(a, b) { return (a.starOrder || 0) - (b.starOrder || 0); });

    // Build maps for quick lookup
    var pagesByFolder = {};   // folderId -> [pages]
    var subFoldersByParent = {}; // parentFolderId -> [folders]
    var defFolderId = getDefaultFolderId(metaList);

    for (var i = 0; i < pages.length; i++) {
        var fid = pages[i].folderId || defFolderId;
        if (!pagesByFolder[fid]) pagesByFolder[fid] = [];
        pagesByFolder[fid].push(pages[i]);
    }

    for (var i = 0; i < folders.length; i++) {
        var pf = folders[i].parentFolderId || null;
        if (!subFoldersByParent[pf]) subFoldersByParent[pf] = [];
        subFoldersByParent[pf].push(folders[i]);
    }

    // Sort helper
    function sortItems(arr) {
        if (sortMode === 'alpha') {
            arr.sort(function(a, b) { return (a.name || '').localeCompare(b.name || ''); });
        } else {
            arr.sort(function(a, b) { return (a.order || 0) - (b.order || 0); });
        }
    }

    // Sort all groups
    for (var k in pagesByFolder) sortItems(pagesByFolder[k]);
    for (var k in subFoldersByParent) {
        var grp = subFoldersByParent[k];
        var defPart = grp.filter(function(f) { return f.isDefault; });
        var regPart = grp.filter(function(f) { return !f.isDefault; });
        sortItems(regPart);
        subFoldersByParent[k] = regPart.concat(defPart);
    }

    var isDndFolderEnabled = true; // Finder風：ソートモードに関わらず常にドラッグ可能
    var isDndPageEnabled = true;

    // フォルダが現在のアクティブマップを（直接または子孫フォルダ経由で）含むか判定
    function folderContainsActive(folderId) {
        var pages = pagesByFolder[folderId] || [];
        for (var i = 0; i < pages.length; i++) {
            if (String(pages[i].id) === String(currentMapId)) return true;
        }
        var subs = subFoldersByParent[folderId] || [];
        for (var i = 0; i < subs.length; i++) {
            if (folderContainsActive(subs[i].id)) return true;
        }
        return false;
    }

    list.innerHTML = '';

    // --- お気に入りセクション（常時表示・折りたたみ対応） ---
    var FAV_COLLAPSE_KEY = 'mindmap-fav-collapsed';
    var isFavCollapsed = localStorage.getItem(FAV_COLLAPSE_KEY) === '1';

    var favHeader = document.createElement('div');
    favHeader.className = 'map-section-header map-section-header--collapsible';
    favHeader.innerHTML = '<span class="map-section-toggle">' + (isFavCollapsed ? '►' : '▼') + '</span> お気に入り';
    favHeader.title = isFavCollapsed ? '展開' : '折りたたむ';
    favHeader.addEventListener('click', function() {
        isFavCollapsed = !isFavCollapsed;
        try { localStorage.setItem(FAV_COLLAPSE_KEY, isFavCollapsed ? '1' : '0'); } catch(e) {}
        renderMapList();
    });
    list.appendChild(favHeader);

    if (!isFavCollapsed) {
        for (var si = 0; si < starredPages.length; si++) {
            var sp = starredPages[si];
            var isSpActive = (String(sp.id) === String(currentMapId));
            var spEl = createPageElement(sp, isSpActive, true, 0, true);
            list.appendChild(spEl);
        }
    }

    var PRIV_COLLAPSE_KEY = 'mindmap-priv-collapsed';
    var isPrivCollapsed = localStorage.getItem(PRIV_COLLAPSE_KEY) === '1';

    var privHeader = document.createElement('div');
    privHeader.className = 'map-section-header map-section-header--collapsible';
    privHeader.innerHTML = '<span class="map-section-toggle">' + (isPrivCollapsed ? '►' : '▼') + '</span> プライベート';
    privHeader.title = isPrivCollapsed ? '展開' : '折りたたむ';
    privHeader.addEventListener('click', function() {
        isPrivCollapsed = !isPrivCollapsed;
        try { localStorage.setItem(PRIV_COLLAPSE_KEY, isPrivCollapsed ? '1' : '0'); } catch(e) {}
        renderMapList();
    });
    list.appendChild(privHeader);

    // Recursive render starting from root (parentFolderId === null)
    function renderFolderChildren(parentId, depth) {
        if (isPrivCollapsed) return;
        var childFolders = subFoldersByParent[parentId] || [];
        var childPages = pagesByFolder[parentId] || [];

        for (var fi = 0; fi < childFolders.length; fi++) {
            var folder = childFolders[fi];
            var hasChildren = (pagesByFolder[folder.id] && pagesByFolder[folder.id].length > 0)
                           || (subFoldersByParent[folder.id] && subFoldersByParent[folder.id].length > 0);
            var isCollapsed = collapseState[folder.id] === true;
            var containsActive = folderContainsActive(folder.id);

            var folderEl = createFolderElement(folder, hasChildren, isCollapsed, isDndFolderEnabled, depth, containsActive);
            list.appendChild(folderEl);

            if (!isCollapsed) {
                renderFolderChildren(folder.id, depth + 1);
            }
        }

        for (var pi = 0; pi < childPages.length; pi++) {
            var page = childPages[pi];
            var isPageActive = (page.id === currentMapId);
            var pageEl = createPageElement(page, isPageActive, isDndPageEnabled, depth);
            list.appendChild(pageEl);
        }
    }

    renderFolderChildren(null, 0);
    updateSidebarSelectionDisplay();
    updateCanvasStarBtn();
}

function createFolderElement(folder, hasPages, isCollapsed, isDndEnabled, depth, containsActive) {
    depth = depth || 0;
    var item = document.createElement('div');
    item.className = 'map-item folder-item' + (folder.isDefault ? ' default-folder' : '');
    item.dataset.mapId = folder.id;
    item.dataset.itemType = 'folder';
    item.dataset.isDefault = folder.isDefault ? '1' : '';
    item.style.paddingLeft = (12 + depth * 20) + 'px';
    item.tabIndex = 0;

    if (isDndEnabled && !folder.isDefault) {
        item.draggable = true;
    }

    // Expand/collapse toggle
    var toggle = document.createElement('button');
    toggle.className = 'map-item-toggle';
    if (hasPages) {
        toggle.textContent = isCollapsed ? '►' : '▼';
        toggle.title = isCollapsed ? '展開' : '折りたたむ';
    } else {
        toggle.textContent = '►';
        toggle.style.visibility = 'hidden';
    }
    toggle.addEventListener('click', function(e) {
        e.stopPropagation();
        if (!hasPages) return;
        var cs = getCollapseState();
        cs[folder.id] = !isCollapsed;
        setCollapseState(cs);
        renderMapList();
    });
    item.appendChild(toggle);

    var name = document.createElement('span');
    name.className = 'map-item-name';
    name.textContent = '\uD83D\uDCC1 ' + folder.name;
    name.title = folder.name;
    if (containsActive) name.style.fontWeight = 'bold';

    var menuBtn = document.createElement('button');
    menuBtn.className = 'map-item-menu-btn';
    menuBtn.textContent = '⋯';
    menuBtn.title = 'メニュー';

    item.appendChild(name);
    item.appendChild(menuBtn);

    (function(folderId, folderMeta, itemEl, nameEl, menuBtnEl) {
        // Click on folder: multi-select or toggle expand/collapse
        itemEl.addEventListener('click', function(e) {
            if (e.target === menuBtnEl || e.target.classList.contains('map-item-menu-btn')) return;
            if (e.target.contentEditable === 'true') return;
            if (e.target.tagName === 'INPUT') return;
            if (e.target.classList.contains('map-item-toggle')) return;

            if (e.metaKey || e.ctrlKey) {
                // Cmd+click: トグル選択（展開/折りたたみは変更しない）
                if (sidebarSelectedIds.has(String(folderId))) {
                    sidebarSelectedIds.delete(String(folderId));
                } else {
                    sidebarSelectedIds.add(String(folderId));
                    sidebarLastSelectedId = String(folderId);
                    if (!sidebarAnchorId) sidebarAnchorId = String(folderId);
                }
                updateSidebarSelectionDisplay();
                return;
            }
            if (e.shiftKey) {
                // Shift+click: 範囲選択
                sidebarRangeSelect(String(folderId));
                return;
            }
            // 通常クリック: 選択をリセットしてこのフォルダだけ選択 + 展開/折りたたみ
            clearSidebarSelection();
            sidebarSelectedIds.add(String(folderId));
            sidebarLastSelectedId = String(folderId);
            sidebarAnchorId = String(folderId);
            var cs = getCollapseState();
            cs[folderId] = !cs[folderId];
            setCollapseState(cs);
            renderMapList();
        });

        // Right-click on folder shows folder context menu
        itemEl.addEventListener('contextmenu', function(e) {
            e.preventDefault();
            e.stopPropagation();
            showFolderContextMenu(folderId, menuBtnEl);
        });

        menuBtnEl.addEventListener('click', function(e) {
            e.stopPropagation();
            showFolderContextMenu(folderId, menuBtnEl);
        });

        // Double-click to rename (not for 未分類)
        if (!folderMeta.isDefault) {
            nameEl.addEventListener('dblclick', function(e) {
                e.stopPropagation();
                e.preventDefault();
                startInlineRename(folderId);
            });
        }

        // Drag & Drop for folders
        if (isDndEnabled && !folderMeta.isDefault) {
            itemEl.addEventListener('dragstart', function(e) {
                e.dataTransfer.setData('text/plain', String(folderId));
                e.dataTransfer.setData('item-type', 'folder');
                e.dataTransfer.effectAllowed = 'move';
                itemEl.classList.add('map-dragging');
                mapDragState.draggingId = folderId;
                mapDragState.draggingType = 'folder';
            });
            itemEl.addEventListener('dragend', function(e) {
                itemEl.classList.remove('map-dragging');
                clearMapDragIndicators();
                mapDragState.draggingId = null;
                mapDragState.draggingType = null;
            });
        }

        // Drop target for folders (accept pages dropped onto folder, or folder reorder)
        itemEl.addEventListener('dragover', function(e) {
            if (!mapDragState.draggingId) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            clearMapDragIndicators();
            if (mapDragState.draggingId === folderId) return;

            var rect = itemEl.getBoundingClientRect();
            var relY = e.clientY - rect.top;
            var h = rect.height;

            if (mapDragState.draggingType === 'folder') {
                if (folderMeta.isDefault) return;
                if (getSortMode() === 'alpha') {
                    // アルファ順モード：フォルダ全体を "into" ゾーンにする（同階層並び替え不可）
                    itemEl.classList.add('drag-over-into');
                    mapDragState.dropTarget = { id: folderId, position: 'into', type: 'folder' };
                } else {
                    // 手動順モード：上25% → above, 下25% → below, 中央 → into（ネスト）
                    if (relY < h * 0.25) {
                        itemEl.classList.add('drag-over-above');
                        mapDragState.dropTarget = { id: folderId, position: 'above', type: 'folder' };
                    } else if (relY > h * 0.75) {
                        itemEl.classList.add('drag-over-below');
                        mapDragState.dropTarget = { id: folderId, position: 'below', type: 'folder' };
                    } else {
                        itemEl.classList.add('drag-over-into');
                        mapDragState.dropTarget = { id: folderId, position: 'into', type: 'folder' };
                    }
                }
            } else {
                // Page dropped onto folder: move page into this folder
                itemEl.classList.add('drag-over-into');
                mapDragState.dropTarget = { id: folderId, position: 'into', type: 'folder' };
            }
        });
        itemEl.addEventListener('dragleave', function(e) {
            itemEl.classList.remove('drag-over-above', 'drag-over-below', 'drag-over-into');
        });
        itemEl.addEventListener('drop', function(e) {
            e.preventDefault();
            clearMapDragIndicators();
            if (!mapDragState.draggingId || !mapDragState.dropTarget) return;
            handleMapDrop(mapDragState.draggingId, mapDragState.dropTarget.id, mapDragState.dropTarget.position, mapDragState.draggingType);
            mapDragState.draggingId = null;
            mapDragState.dropTarget = null;
            mapDragState.draggingType = null;
        });
    })(folder.id, folder, item, name, menuBtn);

    return item;
}

function createPageElement(page, isActive, isDndEnabled, depth, inFavSection) {
    depth = depth || 0;
    var item = document.createElement('div');
    item.className = 'map-item page-item' + (isActive ? ' active' : '');
    item.dataset.mapId = page.id;
    item.dataset.itemType = 'page';
    item.dataset.folderId = page.folderId || '';
    item.style.paddingLeft = (12 + depth * 20) + 'px';
    item.tabIndex = 0;

    if (isDndEnabled) {
        item.draggable = true;
    }
    if (inFavSection) {
        item.dataset.inFav = 'true';
    }

    var name = document.createElement('span');
    name.className = 'map-item-name' + (page.isPublic ? ' map-item-name--shared' : '');
    name.title = page.name;
    // Name text + inline pin with half-width space
    name.textContent = page.name;
    if (isActive) {
        var pinEl = document.createElement('span');
        pinEl.className = 'map-item-pin';
        pinEl.textContent = ' 📌';
        name.appendChild(pinEl);
    }

    var menuBtn = document.createElement('button');
    menuBtn.className = 'map-item-menu-btn';
    menuBtn.textContent = '⋯';
    menuBtn.title = 'メニュー';

    item.appendChild(name);
    item.appendChild(menuBtn);

    (function(pageId, pageMeta, itemEl, nameEl, menuBtnEl) {
        // Click on page -> multi-select or switch to that map
        itemEl.addEventListener('click', function(e) {
            if (e.target === menuBtnEl || e.target.classList.contains('map-item-menu-btn')) return;
            if (e.target.contentEditable === 'true') return;
            if (e.target.tagName === 'INPUT') return;

            if (e.metaKey || e.ctrlKey) {
                // Cmd+click: トグル選択（マップ切替なし）
                if (sidebarSelectedIds.has(String(pageId))) {
                    sidebarSelectedIds.delete(String(pageId));
                } else {
                    sidebarSelectedIds.add(String(pageId));
                    sidebarLastSelectedId = String(pageId);
                    if (!sidebarAnchorId) sidebarAnchorId = String(pageId);
                }
                updateSidebarSelectionDisplay();
                return;
            }
            if (e.shiftKey) {
                // Shift+click: 範囲選択（マップ切替なし）
                sidebarRangeSelect(String(pageId));
                return;
            }
            // 通常クリック: 選択リセット + このページだけ選択 + マップ切替
            clearSidebarSelection();
            sidebarSelectedIds.add(String(pageId));
            sidebarLastSelectedId = String(pageId);
            sidebarAnchorId = String(pageId);
            updateSidebarSelectionDisplay();
            window.sidebarNavigationMode = true;
            switchToMap(pageId);
        });

        menuBtnEl.addEventListener('click', function(e) {
            e.stopPropagation();
            showContextMenu(pageId, menuBtnEl);
        });

        // Double-click to rename
        nameEl.addEventListener('dblclick', function(e) {
            e.stopPropagation();
            e.preventDefault();
            startInlineRename(pageId);
        });

        // Drag & Drop for pages
        if (isDndEnabled) {
            var _inFav = !!inFavSection;
            itemEl.addEventListener('dragstart', function(e) {
                e.dataTransfer.setData('text/plain', String(pageId));
                e.dataTransfer.setData('item-type', 'page');
                e.dataTransfer.effectAllowed = 'copyMove';
                mapDragState.draggingId = pageId;
                mapDragState.draggingType = 'page';
                mapDragState.fromFavSection = _inFav;
                // 複数選択中なら全選択ページをまとめてドラッグ
                if (!_inFav && sidebarSelectedIds.size > 1 && sidebarSelectedIds.has(String(pageId))) {
                    var allIds = [];
                    sidebarSelectedIds.forEach(function(id) { allIds.push(id); });
                    mapDragState.draggingIds = allIds;
                    document.querySelectorAll('#mapList .map-item.sidebar-selected').forEach(function(el) {
                        el.classList.add('map-dragging');
                    });
                } else {
                    mapDragState.draggingIds = null;
                    itemEl.classList.add('map-dragging');
                }
            });
            itemEl.addEventListener('dragend', function(e) {
                document.querySelectorAll('#mapList .map-item').forEach(function(el) {
                    el.classList.remove('map-dragging');
                });
                clearMapDragIndicators();
                mapDragState.draggingId = null;
                mapDragState.draggingIds = null;
                mapDragState.draggingType = null;
                mapDragState.fromFavSection = false;
            });
            itemEl.addEventListener('dragover', function(e) {
                if (!mapDragState.draggingId) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                clearMapDragIndicators();
                if (mapDragState.draggingId === pageId) return;

                // お気に入りセクション内のドロップはお気に入り同士のみ許可
                if (_inFav && !mapDragState.fromFavSection) return;
                if (!_inFav && mapDragState.fromFavSection) return;

                // Only pages can be placed above/below other pages
                if (mapDragState.draggingType !== 'page') return;

                var rect = itemEl.getBoundingClientRect();
                var relY = e.clientY - rect.top;
                var h = rect.height;

                if (relY < h * 0.5) {
                    itemEl.classList.add('drag-over-above');
                    mapDragState.dropTarget = { id: pageId, position: 'above', type: 'page', inFav: _inFav };
                } else {
                    itemEl.classList.add('drag-over-below');
                    mapDragState.dropTarget = { id: pageId, position: 'below', type: 'page', inFav: _inFav };
                }
            });
            itemEl.addEventListener('dragleave', function(e) {
                itemEl.classList.remove('drag-over-above', 'drag-over-below');
            });
            itemEl.addEventListener('drop', function(e) {
                e.preventDefault();
                clearMapDragIndicators();
                if (!mapDragState.draggingId || !mapDragState.dropTarget) return;
                if (mapDragState.dropTarget.inFav) {
                    handleFavDrop(mapDragState.draggingId, mapDragState.dropTarget.id, mapDragState.dropTarget.position);
                } else {
                    handleMapDrop(mapDragState.draggingId, mapDragState.dropTarget.id, mapDragState.dropTarget.position, mapDragState.draggingType);
                }
                mapDragState.draggingId = null;
                mapDragState.dropTarget = null;
                mapDragState.draggingType = null;
                mapDragState.fromFavSection = false;
            });
        }
    })(page.id, page, item, name, menuBtn);

    return item;
}

// ---- キャンバス右上の星ボタンを現在のマップ状態に合わせて更新 ----
function updateCanvasStarBtn() {
    var btn = document.getElementById('canvasStarBtn');
    if (!btn) return;
    var meta = findMetaById(currentMapId);
    if (!meta) return;
    btn.textContent = meta.starred ? '★' : '☆';
    btn.classList.toggle('starred', !!meta.starred);
    btn.title = meta.starred ? 'お気に入りから外す' : 'お気に入りに追加';
}

// ---- Map Drag & Drop State ----
var mapDragState = {
    draggingId: null,
    draggingIds: null,  // 複数選択ドラッグ時の全ID配列
    draggingType: null, // 'folder' or 'page'
    dropTarget: null
};

function clearMapDragIndicators() {
    document.querySelectorAll('.map-item').forEach(function(el) {
        el.classList.remove('drag-over-above', 'drag-over-below', 'drag-over-into');
    });
}

// ---- Sidebar Selection Helpers ----
function clearSidebarSelection() {
    sidebarSelectedIds.clear();
    sidebarLastSelectedId = null;
    sidebarAnchorId = null;
    document.querySelectorAll('#mapList .map-item.sidebar-selected').forEach(function(el) {
        el.classList.remove('sidebar-selected');
    });
}

function updateSidebarSelectionDisplay() {
    document.querySelectorAll('#mapList .map-item').forEach(function(el) {
        el.classList.toggle('sidebar-selected', sidebarSelectedIds.has(el.dataset.mapId));
    });
}

function sidebarRangeSelect(targetId) {
    if (!sidebarAnchorId) {
        sidebarSelectedIds.add(targetId);
        sidebarLastSelectedId = targetId;
        sidebarAnchorId = targetId;
        updateSidebarSelectionDisplay();
        return;
    }
    var items = Array.from(document.querySelectorAll('#mapList .map-item'));
    var ids = items.map(function(el) { return el.dataset.mapId; });
    var ai = ids.indexOf(sidebarAnchorId);
    var ti = ids.indexOf(targetId);
    if (ai === -1 || ti === -1) {
        sidebarSelectedIds.add(targetId);
        sidebarLastSelectedId = targetId;
        updateSidebarSelectionDisplay();
        return;
    }
    var mn = Math.min(ai, ti), mx = Math.max(ai, ti);
    sidebarSelectedIds.clear();
    for (var i = mn; i <= mx; i++) {
        if (ids[i]) sidebarSelectedIds.add(ids[i]);
    }
    sidebarLastSelectedId = targetId;
    updateSidebarSelectionDisplay();
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
        targetFolderId = targetMeta.folderId;
    } else if (targetMeta.type === 'folder') {
        targetFolderId = targetId;
    } else {
        return;
    }

    // 選択ページをターゲットフォルダへ移動
    for (var i = 0; i < metaList.length; i++) {
        if (dragIds.indexOf(String(metaList[i].id)) !== -1 && metaList[i].type === 'page') {
            metaList[i].folderId = targetFolderId;
        }
    }

    // ターゲットフォルダを展開
    var cs = getCollapseState();
    cs[targetFolderId] = false;
    setCollapseState(cs);

    saveMetaList(metaList);
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
function handleFavDrop(dragId, targetId, position) {
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
    for (var i = 0; i < starredItems.length; i++) {
        if (starredItems[i].id === targetId) { targetIdx = i; break; }
    }
    if (targetIdx === -1) return;
    if (position === 'below') targetIdx++;
    starredItems.splice(targetIdx, 0, dragMeta);
    for (var i = 0; i < starredItems.length; i++) {
        starredItems[i].starOrder = i;
    }
    saveMetaList(metaList);
    // Supabaseに同期
    if (typeof window._supaQueueSync === 'function' && !window._isReadOnly) {
        window._supaQueueSync(dragId);
    }
    renderMapList();
}

function handleMapDrop(dragId, targetId, position, dragType) {
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
            for (var i = 0; i < siblings.length; i++) {
                if (siblings[i].id === targetId) { targetIdx = i; break; }
            }
            if (targetIdx === -1) return;
            if (position === 'below') targetIdx++;
            siblings.splice(targetIdx, 0, dragMeta);
            for (var i = 0; i < siblings.length; i++) {
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
            var cs = getCollapseState();
            cs[targetId] = false;
            setCollapseState(cs);
        } else if (targetMeta.type === 'page') {
            // Reorder page among siblings in same folder
            var targetFolderId = targetMeta.folderId;
            dragMeta.folderId = targetFolderId;

            var siblings = metaList.filter(function(m) {
                return m.type === 'page' && m.folderId === targetFolderId && m.id !== dragId;
            });
            siblings.sort(function(a, b) { return (a.order || 0) - (b.order || 0); });

            var targetIdx = -1;
            for (var i = 0; i < siblings.length; i++) {
                if (siblings[i].id === targetId) { targetIdx = i; break; }
            }
            if (targetIdx === -1) targetIdx = siblings.length - 1;
            if (position === 'below') targetIdx++;
            siblings.splice(targetIdx, 0, dragMeta);
            for (var i = 0; i < siblings.length; i++) {
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

// ---- Context Menus ----
function showContextMenu(mapId, anchorEl) {
    hideAllContextMenus();
    ctxMenuTargetMapId = mapId;
    var cm = document.getElementById('ctxMenu');
    // Show share item only if logged in (Supabase available)
    var shareItem = cm.querySelector('[data-action="share"]');
    if (shareItem) shareItem.style.display = window._supa ? '' : 'none';
    var rect = anchorEl.getBoundingClientRect();
    cm.style.top = rect.bottom + 4 + 'px';
    cm.style.left = rect.left + 'px';
    cm.classList.add('show');
    var cmRect = cm.getBoundingClientRect();
    if (cmRect.right > window.innerWidth) cm.style.left = (window.innerWidth - cmRect.width - 8) + 'px';
    if (cmRect.bottom > window.innerHeight) cm.style.top = (rect.top - cmRect.height - 4) + 'px';
    document.querySelectorAll('.map-item-menu-btn.open').forEach(function(el) { el.classList.remove('open'); });
    anchorEl.classList.add('open');
}

function showFolderContextMenu(folderId, anchorEl) {
    hideAllContextMenus();
    ctxMenuTargetMapId = folderId;
    var meta = findMetaById(folderId);
    var cm = document.getElementById('ctxMenuFolder');
    // Hide rename, add-subfolder, and delete for 未分類
    var renameItem = cm.querySelector('[data-action="folder-rename"]');
    var addSubfolderItem = cm.querySelector('[data-action="folder-add-subfolder"]');
    var deleteItem = cm.querySelector('[data-action="folder-delete"]');
    if (renameItem) renameItem.style.display = (meta && meta.isDefault) ? 'none' : '';
    if (addSubfolderItem) addSubfolderItem.style.display = (meta && meta.isDefault) ? 'none' : '';
    if (deleteItem) deleteItem.style.display = (meta && meta.isDefault) ? 'none' : '';

    var rect = anchorEl.getBoundingClientRect();
    cm.style.top = rect.bottom + 4 + 'px';
    cm.style.left = rect.left + 'px';
    cm.classList.add('show');
    var cmRect = cm.getBoundingClientRect();
    if (cmRect.right > window.innerWidth) cm.style.left = (window.innerWidth - cmRect.width - 8) + 'px';
    if (cmRect.bottom > window.innerHeight) cm.style.top = (rect.top - cmRect.height - 4) + 'px';
    document.querySelectorAll('.map-item-menu-btn.open').forEach(function(el) { el.classList.remove('open'); });
    anchorEl.classList.add('open');
}

function showAreaContextMenu(clientX, clientY) {
    hideAllContextMenus();
    var cm = document.getElementById('ctxMenuArea');
    cm.style.top = clientY + 'px';
    cm.style.left = clientX + 'px';
    cm.classList.add('show');
    var cmRect = cm.getBoundingClientRect();
    if (cmRect.right > window.innerWidth) cm.style.left = (window.innerWidth - cmRect.width - 8) + 'px';
    if (cmRect.bottom > window.innerHeight) cm.style.top = (clientY - cmRect.height) + 'px';
}

function hideAllContextMenus() {
    document.querySelectorAll('.ctx-menu.show').forEach(function(el) { el.classList.remove('show'); });
    ctxMenuTargetMapId = null;
}

// ---- CRUD: Pages ----
function createNewMap() {
    // Creates a new page in the currently selected folder (or 未分類)
    saveToLocalStorage();

    var metaList = getMetaList();
    var defFolderId = getDefaultFolderId(metaList);

    // Determine target folder: use folder of current active page, or 未分類
    var targetFolderId = defFolderId;
    if (currentMapId) {
        var currentMeta = findMetaById(currentMapId);
        if (currentMeta && currentMeta.type === 'page' && currentMeta.folderId) {
            targetFolderId = currentMeta.folderId;
        }
    }

    var newId = getNextMapId();
    var now = nowISO();
    var defaultData = { root: { id: 'root', text: '中心テーマ', children: [] } };

    // Get max order among pages in target folder
    var maxOrder = 0;
    for (var i = 0; i < metaList.length; i++) {
        if (metaList[i].type === 'page' && metaList[i].folderId === targetFolderId && (metaList[i].order || 0) >= maxOrder) {
            maxOrder = (metaList[i].order || 0) + 1;
        }
    }

    var meta = { id: newId, name: '無題のマップ', type: 'page', folderId: targetFolderId, order: maxOrder, createdAt: now, updatedAt: now };
    metaList.push(meta);
    saveMetaList(metaList);
    try { localStorage.setItem(getMapDataKey(newId), JSON.stringify(defaultData)); } catch(e) {}

    // Expand the target folder
    var cs = getCollapseState();
    cs[targetFolderId] = false;
    setCollapseState(cs);

    switchToMap(newId);
    showToast('新しいマップを作成しました');
    // Supabase: create map (will be synced on first save via saveToLocalStorage)
    if (window._supa) {
        window._supa.saveMap(newId, '無題のマップ', defaultData, targetFolderId).catch(function(){});
    }
}

function createPageInFolder(folderId) {
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

    var meta = { id: newId, name: '無題のマップ', type: 'page', folderId: folderId, order: maxOrder, createdAt: now, updatedAt: now };
    metaList.push(meta);
    saveMetaList(metaList);
    try { localStorage.setItem(getMapDataKey(newId), JSON.stringify(defaultData)); } catch(e) {}

    // Expand the folder
    var cs = getCollapseState();
    cs[folderId] = false;
    setCollapseState(cs);

    switchToMap(newId);
    showToast('新しいマップを作成しました');
    setTimeout(function() { startInlineRename(newId); }, 200);
    if (window._supa) {
        window._supa.saveMap(newId, '無題のマップ', defaultData, folderId).catch(function(){});
    }
}

// ---- CRUD: Folders ----
function createFolder() {
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

function createSubFolder(parentFolderId) {
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

function deleteFolder(folderId) {
    var metaList = getMetaList();
    var folderMeta = findMetaById(folderId);
    if (!folderMeta || folderMeta.isDefault) {
        showToast('⚠️ このフォルダは削除できません');
        return;
    }

    if (!confirm('このフォルダを削除しますか？\n中のページとサブフォルダも含めてすべて削除されます。')) return;

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
    var defFolderId = getDefaultFolderId(metaList);
    var pagesToDelete = [];
    for (var i = 0; i < metaList.length; i++) {
        if (metaList[i].type === 'page' && folderIdSet[metaList[i].folderId]) {
            pagesToDelete.push(metaList[i].id);
        }
    }

    // Delete page data from localStorage
    for (var i = 0; i < pagesToDelete.length; i++) {
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
        for (var i = 0; i < allFolderIds.length; i++) {
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
function deleteMapMultiple(mapIds) {
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
function deleteFolderMultiple(folderIds) {
    if (!folderIds || folderIds.length === 0) return;
    if (!confirm(folderIds.length + '件のフォルダを削除しますか？\n中のページとサブフォルダも含めてすべて削除されます。')) return;

    var metaList = getMetaList();
    var deletedPageIds = [];

    for (var fi = 0; fi < folderIds.length; fi++) {
        var fid = folderIds[fi];
        // 子孫フォルダIDを収集
        function collectDesc(id) {
            var ids = [id];
            for (var i = 0; i < metaList.length; i++) {
                if (metaList[i].type === 'folder' && (metaList[i].parentFolderId || null) === (id || null)) {
                    ids = ids.concat(collectDesc(metaList[i].id));
                }
            }
            return ids;
        }
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

    // ページデータを削除
    for (var i = 0; i < deletedPageIds.length; i++) {
        try { localStorage.removeItem(getMapDataKey(deletedPageIds[i])); } catch(e) {}
        if (window._supa) window._supa.deleteMap(deletedPageIds[i]).catch(function(){});
    }

    // メタからフォルダ・ページを除去
    var allFolderSet = {};
    for (var fi = 0; fi < folderIds.length; fi++) {
        var allDesc = collectDesc(folderIds[fi]);
        for (var i = 0; i < allDesc.length; i++) allFolderSet[allDesc[i]] = true;
    }
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

function switchToMap(mapId) {
    if (mapId === currentMapId) return;

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
    lastSelectedNodeId = null;
    selectionAnchorId = null;
    editingNodeId = null;
    undoHistory = [];
    undoIndex = -1;
    clipboard = null;
    clipboardIsCut = false;

    currentMapId = mapId;
    mindMapData = data;
    setLastActiveId(mapId);
    updateUrlParam(mapId);
    updatePageTitle();

    saveState();
    render();
    resetView();
    renderMapList();
    selectNode('root');
}

function duplicateMap(mapId) {
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

    renderMapList();
    showToast('📑 マップを複製しました');
}

function deleteMap(mapId) {
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

function startInlineRename(mapId) {
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
    input.select();

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
            e.preventDefault();
            if (e.isComposing || e.keyCode === 229) return; // 変換中のEnterは無視
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

// Expose for testing/integration
window.getCurrentCopyText = getCurrentCopyText;
window.getSelectedNodeIds = function() { return selectedNodeIds; };
window.getMindMapData = function() { return mindMapData; };
window.getCurrentMapId = function() { return currentMapId; };
window.getMetaList = getMetaList;
window.switchToMap = switchToMap;
window.createNewMap = createNewMap;
window.createFolder = createFolder;
window.createSubFolder = createSubFolder;
window.createPageInFolder = createPageInFolder;
window.deleteFolder = deleteFolder;
window.openRightSidebar = openRightSidebar;
window.closeRightSidebar = closeRightSidebar;
window.openLeftSidebar = openLeftSidebar;
window.closeLeftSidebar = closeLeftSidebar;
window.startInlineRename = startInlineRename;
window.getSortMode = getSortMode;
window.setSortMode = setSortMode;
window.getCollapseState = getCollapseState;
window.setCollapseState = setCollapseState;
window.renderMapList = renderMapList;
window.getDefaultFolderId = getDefaultFolderId;
window.ensureDefaultFolder = ensureDefaultFolder;
window.toggleNodeCollapse = toggleNodeCollapse;
window.isNodeCollapsed = isNodeCollapsed;
window.getNodeCollapseState = getNodeCollapseState;
window.setNodeCollapseState = setNodeCollapseState;
window.expandAllNodes = expandAllNodes;
window.collapseAllNodes = collapseAllNodes;
window.getVisibleNodesInOrder = getVisibleNodesInOrder;
window.isNodeGrayedOut = isNodeGrayedOut;
window.getNodeGrayoutState = getNodeGrayoutState;
window.setNodeGrayoutState = setNodeGrayoutState;
window.toggleNodeGrayout = toggleNodeGrayout;
window.isDescendantOfGrayedOut = isDescendantOfGrayedOut;
window.isNodeOrAncestorGrayedOut = isNodeOrAncestorGrayedOut;
window.isNodeHighlighted = isNodeHighlighted;
window.getNodeHighlightState = getNodeHighlightState;
window.setNodeHighlightState = setNodeHighlightState;
window.toggleNodeHighlight = toggleNodeHighlight;

