// 左サイドバー: マップ一覧ツリーの描画
import { currentMapId } from '../state.js';
import { findMetaById, getCollapseState, getMetaList, getSortMode, setCollapseState } from '../storage.js';
import { startInlineRename, switchToMap } from './crud.js';
import { clearMapDragIndicators, handleFavDrop, handleMapDrop } from './dnd.js';
import { showContextMenu, showFolderContextMenu } from './menus.js';
import { clearSidebarSelection, sidebarRangeSelect, updateSidebarSelectionDisplay } from './selection.js';
import { mapDragState, sbState, sidebarSelectedIds } from './state.js';

// ---- Render Map List (recursive Folder → SubFolder/Page Tree) ----
export function renderMapList() {
    var list = document.getElementById('mapList');
    if (!list) return;
    var metaList = getMetaList();
    var sortMode = getSortMode();
    var collapseState = getCollapseState();

    var folders = metaList.filter(function(m) { return m.type === 'folder'; });
    var pages = metaList.filter(function(m) { return m.type === 'page'; });

    // お気に入りページを抽出し、starOrder 順にソート（アルファベットソートの影響を受けない）
    var starredPages = pages.filter(function(p) { return p.starred; });
    starredPages.sort(function(a, b) { return (a.starOrder || 0) - (b.starOrder || 0); });

    // Build maps for quick lookup
    var pagesByFolder = {};   // folderId -> [pages]（folderId 無しはトップレベル）
    var subFoldersByParent = {}; // parentFolderId -> [folders]

    for (var i = 0; i < pages.length; i++) {
        // folderId が無いページはトップレベル（pagesByFolder[null] = "プライベート" 直下）
        var fid = pages[i].folderId || null;
        if (!pagesByFolder[fid]) pagesByFolder[fid] = [];
        pagesByFolder[fid].push(pages[i]);
    }

    for (i = 0; i < folders.length; i++) {
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
    for (k in subFoldersByParent) {
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
        for (i = 0; i < subs.length; i++) {
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
                    sbState.lastSelectedId = String(folderId);
                    if (!sbState.anchorId) sbState.anchorId = String(folderId);
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
            sbState.lastSelectedId = String(folderId);
            sbState.anchorId = String(folderId);
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
                // 上25% → above, 下25% → below, 中央 → into（ネスト）
                // アルファ順モードでも有効化する：並び順は名前で再ソートされるが、
                // above/below は「ターゲットと同じ親に揃える（=階層の変更）」という意味を持つため
                // 塞いでしまうとサブフォルダを上位階層に出せなくなる。
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
                    sbState.lastSelectedId = String(pageId);
                    if (!sbState.anchorId) sbState.anchorId = String(pageId);
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
            sbState.lastSelectedId = String(pageId);
            sbState.anchorId = String(pageId);
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
