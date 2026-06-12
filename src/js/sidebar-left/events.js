// 左サイドバー: 初期化とイベント結線
import { adjustCanvasForSidebars } from '../sidebar-right.js';
import { ctxMenuTargetMapId, currentMapId, setCtxMenuTargetMapId } from '../state.js';
import { findMetaById, getCollapseState, setCollapseState, toggleFavorite } from '../storage.js';
import { showToast } from '../utils.js';
import {
    createFolder,
    createNewMap,
    createPageInFolder,
    createSubFolder,
    deleteFolder,
    deleteFolderMultiple,
    deleteMap,
    deleteMapMultiple,
    duplicateMap,
    startInlineRename,
    switchToMap
} from './crud.js';
import {
    sidebarCopyItems,
    sidebarCutItems,
    sidebarPasteItems,
    sidebarPushHistory,
    sidebarRedo,
    sidebarUndo
} from './history-clipboard.js';
import { showAreaContextMenu } from './menus.js';
import { closeLeftSidebar, openLeftSidebar } from './panel.js';
import { renderMapList } from './render.js';
import { clearSidebarSelection, sidebarRangeSelect, updateSidebarSelectionDisplay } from './selection.js';
import {
    LEFT_SIDEBAR_DEFAULT,
    LEFT_SIDEBAR_KEY,
    LEFT_SIDEBAR_OPEN_MIN,
    sbState,
    sidebarSelectedIds
} from './state.js';

export function initLeftSidebar() {
    if (sbState.initialized) return;
    sbState.initialized = true;
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
            if (sbState.isOpen) {
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
            if (sbState.isOpen) return;
            sbState.peekTimeout = setTimeout(function() {
                sidebar.classList.add('peek');
            }, 200);
        });
        hoverZone.addEventListener('mouseleave', function() {
            clearTimeout(sbState.peekTimeout);
        });
    }

    // Remove peek when mouse leaves the sidebar area
    sidebar.addEventListener('mouseleave', function() {
        if (!sbState.isOpen) {
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
        setCtxMenuTargetMapId(null);

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
        setCtxMenuTargetMapId(null);

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
    // キャプチャ段階で登録する：ノード上の mousedown は stopPropagation されて
    // バブリングが document まで届かないため、バブル段階だと
    // 「ノードをクリックしてもナビゲーションモードが解除されない」バグになる
    document.addEventListener('mousedown', function(e) {
        var sidebar = document.getElementById('leftSidebar');
        if (sidebar && !sidebar.contains(e.target)) {
            window.sidebarNavigationMode = false;
        }
    }, true);

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
            if (sbState.lastSelectedId) startInlineRename(sbState.lastSelectedId);
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
        if (isHorizontal && sbState.lastSelectedId) {
            var curMeta = findMetaById(sbState.lastSelectedId);
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
                        if (String(allItems[ci].dataset.mapId) === String(sbState.lastSelectedId)) { curPos = ci; break; }
                    }
                    if (curPos !== -1 && curPos + 1 < allItems.length) {
                        var fcId = String(allItems[curPos + 1].dataset.mapId);
                        clearSidebarSelection();
                        sidebarSelectedIds.add(fcId);
                        sbState.lastSelectedId = fcId;
                        sbState.anchorId = fcId;
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
                        sbState.lastSelectedId = String(pId);
                        sbState.anchorId = String(pId);
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
                    sbState.lastSelectedId = String(ppId);
                    sbState.anchorId = String(ppId);
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

        // 現在位置を sbState.lastSelectedId から特定
        var currentIndex = -1;
        if (sbState.lastSelectedId) {
            for (var i = 0; i < items.length; i++) {
                if (String(items[i].dataset.mapId) === String(sbState.lastSelectedId)) {
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
        sbState.lastSelectedId = nextId;
        sbState.anchorId = nextId;
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
