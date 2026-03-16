// ========================================
// Left Sidebar: My Maps Management
// ========================================

var LEFT_SIDEBAR_OPEN_MIN = 200;
var LEFT_SIDEBAR_DEFAULT = 240;
var LEFT_SIDEBAR_KEY = 'mindmap_left_sidebar_width';
var leftSidebarIsOpen = false;
var leftSidebarPeekTimeout = null;

function initLeftSidebar() {
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
            deleteMap(targetId);
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
        } else if (action === 'folder-delete') {
            deleteFolder(targetId);
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

// ---- Render Map List (Folder → Page Tree) ----
function renderMapList() {
    var list = document.getElementById('mapList');
    if (!list) return;
    var metaList = getMetaList();
    metaList = ensureDefaultFolder(metaList);
    saveMetaList(metaList);
    var sortMode = getSortMode();
    var collapseState = getCollapseState();

    // Separate folders and pages
    var folders = metaList.filter(function(m) { return m.type === 'folder'; });
    var pages = metaList.filter(function(m) { return m.type === 'page'; });

    // Build page map: folderId -> [pages]
    var pageMap = {};
    for (var i = 0; i < pages.length; i++) {
        var fid = pages[i].folderId || getDefaultFolderId(metaList);
        if (!pageMap[fid]) pageMap[fid] = [];
        pageMap[fid].push(pages[i]);
    }

    // Sort folders: 未分類 always last, others by order or alpha
    var defaultFolders = folders.filter(function(f) { return f.isDefault; });
    var regularFolders = folders.filter(function(f) { return !f.isDefault; });

    if (sortMode === 'alpha') {
        regularFolders.sort(function(a, b) { return (a.name || '').localeCompare(b.name || ''); });
        for (var fid in pageMap) {
            pageMap[fid].sort(function(a, b) { return (a.name || '').localeCompare(b.name || ''); });
        }
    } else {
        regularFolders.sort(function(a, b) { return (a.order || 0) - (b.order || 0); });
        for (var fid in pageMap) {
            pageMap[fid].sort(function(a, b) { return (a.order || 0) - (b.order || 0); });
        }
    }

    // Final folder order: regular folders + 未分類 at bottom
    var orderedFolders = regularFolders.concat(defaultFolders);

    list.innerHTML = '';
    var isDndFolderEnabled = (sortMode !== 'alpha'); // alpha時はフォルダ並び替え不可
    var isDndPageEnabled = true; // ページ移動は常に有効

    for (var fi = 0; fi < orderedFolders.length; fi++) {
        var folder = orderedFolders[fi];
        var folderPages = pageMap[folder.id] || [];
        var hasPages = folderPages.length > 0;
        var isCollapsed = collapseState[folder.id] === true;

        var folderEl = createFolderElement(folder, hasPages, isCollapsed, isDndFolderEnabled);
        list.appendChild(folderEl);

        // Render pages if not collapsed
        if (!isCollapsed) {
            for (var pi = 0; pi < folderPages.length; pi++) {
                var page = folderPages[pi];
                var isPageActive = (page.id === currentMapId);
                var pageEl = createPageElement(page, isPageActive, isDndPageEnabled, folder);
                list.appendChild(pageEl);
            }
        }
    }
}

function createFolderElement(folder, hasPages, isCollapsed, isDndEnabled) {
    var item = document.createElement('div');
    item.className = 'map-item folder-item' + (folder.isDefault ? ' default-folder' : '');
    item.dataset.mapId = folder.id;
    item.dataset.itemType = 'folder';
    item.dataset.isDefault = folder.isDefault ? '1' : '';

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

    var menuBtn = document.createElement('button');
    menuBtn.className = 'map-item-menu-btn';
    menuBtn.textContent = '⋯';
    menuBtn.title = 'メニュー';

    item.appendChild(name);
    item.appendChild(menuBtn);

    (function(folderId, folderMeta, itemEl, nameEl, menuBtnEl) {
        // Click on folder: toggle expand/collapse
        itemEl.addEventListener('click', function(e) {
            if (e.target === menuBtnEl || e.target.classList.contains('map-item-menu-btn')) return;
            if (e.target.contentEditable === 'true') return;
            if (e.target.tagName === 'INPUT') return;
            if (e.target.classList.contains('map-item-toggle')) return;
            // Toggle expand/collapse on folder click
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
                // Folder reordering: above or below only (no nesting), but NOT on 未分類
                if (folderMeta.isDefault) return;
                if (relY < h * 0.5) {
                    itemEl.classList.add('drag-over-above');
                    mapDragState.dropTarget = { id: folderId, position: 'above', type: 'folder' };
                } else {
                    itemEl.classList.add('drag-over-below');
                    mapDragState.dropTarget = { id: folderId, position: 'below', type: 'folder' };
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

function createPageElement(page, isActive, isDndEnabled, parentFolder) {
    var item = document.createElement('div');
    item.className = 'map-item page-item' + (isActive ? ' active' : '');
    item.dataset.mapId = page.id;
    item.dataset.itemType = 'page';
    item.dataset.folderId = page.folderId || '';

    if (isDndEnabled) {
        item.draggable = true;
    }

    var name = document.createElement('span');
    name.className = 'map-item-name';
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
        // Click on page -> switch to that map
        itemEl.addEventListener('click', function(e) {
            if (e.target === menuBtnEl || e.target.classList.contains('map-item-menu-btn')) return;
            if (e.target.contentEditable === 'true') return;
            if (e.target.tagName === 'INPUT') return;
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
            itemEl.addEventListener('dragstart', function(e) {
                e.dataTransfer.setData('text/plain', String(pageId));
                e.dataTransfer.setData('item-type', 'page');
                e.dataTransfer.effectAllowed = 'move';
                itemEl.classList.add('map-dragging');
                mapDragState.draggingId = pageId;
                mapDragState.draggingType = 'page';
            });
            itemEl.addEventListener('dragend', function(e) {
                itemEl.classList.remove('map-dragging');
                clearMapDragIndicators();
                mapDragState.draggingId = null;
                mapDragState.draggingType = null;
            });
            itemEl.addEventListener('dragover', function(e) {
                if (!mapDragState.draggingId) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                clearMapDragIndicators();
                if (mapDragState.draggingId === pageId) return;

                // Only pages can be placed above/below other pages
                if (mapDragState.draggingType !== 'page') return;

                var rect = itemEl.getBoundingClientRect();
                var relY = e.clientY - rect.top;
                var h = rect.height;

                if (relY < h * 0.5) {
                    itemEl.classList.add('drag-over-above');
                    mapDragState.dropTarget = { id: pageId, position: 'above', type: 'page' };
                } else {
                    itemEl.classList.add('drag-over-below');
                    mapDragState.dropTarget = { id: pageId, position: 'below', type: 'page' };
                }
            });
            itemEl.addEventListener('dragleave', function(e) {
                itemEl.classList.remove('drag-over-above', 'drag-over-below');
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
        }
    })(page.id, page, item, name, menuBtn);

    return item;
}

// ---- Map Drag & Drop State ----
var mapDragState = {
    draggingId: null,
    draggingType: null, // 'folder' or 'page'
    dropTarget: null
};

function clearMapDragIndicators() {
    document.querySelectorAll('.map-item').forEach(function(el) {
        el.classList.remove('drag-over-above', 'drag-over-below', 'drag-over-into');
    });
}

function handleMapDrop(dragId, targetId, position, dragType) {
    if (dragId === targetId) return;
    var metaList = getMetaList();
    var dragMeta = null, targetMeta = null;
    for (var i = 0; i < metaList.length; i++) {
        if (metaList[i].id === dragId) dragMeta = metaList[i];
        if (metaList[i].id === targetId) targetMeta = metaList[i];
    }
    if (!dragMeta || !targetMeta) return;

    if (dragType === 'folder') {
        // Folder reordering among folders only
        if (targetMeta.type !== 'folder' || targetMeta.isDefault) return;
        var allFolders = metaList.filter(function(m) { return m.type === 'folder' && !m.isDefault && m.id !== dragId; });
        allFolders.sort(function(a, b) { return (a.order || 0) - (b.order || 0); });
        var targetIdx = -1;
        for (var i = 0; i < allFolders.length; i++) {
            if (allFolders[i].id === targetId) { targetIdx = i; break; }
        }
        if (targetIdx === -1) return;
        if (position === 'below') targetIdx++;
        allFolders.splice(targetIdx, 0, dragMeta);
        for (var i = 0; i < allFolders.length; i++) {
            allFolders[i].order = i;
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
            // Reorder page among siblings in same folder, or move to different folder
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
    renderMapList();
}

// ---- Context Menus ----
function showContextMenu(mapId, anchorEl) {
    hideAllContextMenus();
    ctxMenuTargetMapId = mapId;
    var cm = document.getElementById('ctxMenu');
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
    // Hide rename and delete for 未分類
    var renameItem = cm.querySelector('[data-action="folder-rename"]');
    var deleteItem = cm.querySelector('[data-action="folder-delete"]');
    if (renameItem) renameItem.style.display = (meta && meta.isDefault) ? 'none' : '';
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
}

function deleteFolder(folderId) {
    var metaList = getMetaList();
    var folderMeta = findMetaById(folderId);
    if (!folderMeta || folderMeta.isDefault) {
        showToast('⚠️ このフォルダは削除できません');
        return;
    }

    var pagesInFolder = metaList.filter(function(m) { return m.type === 'page' && m.folderId === folderId; });

    if (!confirm('このフォルダを削除しますか？\n中のページは「未分類」に移動されます。')) return;

    // Move children pages to 未分類
    var defFolderId = getDefaultFolderId(metaList);
    for (var i = 0; i < metaList.length; i++) {
        if (metaList[i].type === 'page' && metaList[i].folderId === folderId) {
            metaList[i].folderId = defFolderId;
        }
    }

    // Remove folder from meta
    var newMeta = metaList.filter(function(m) { return m.id !== folderId; });
    saveMetaList(newMeta);
    renderMapList();
    showToast('🗑 フォルダを削除しました');
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
            for (var i = 0; i < metaList.length; i++) {
                if (metaList[i].id === mapId) {
                    metaList[i].name = newName;
                    metaList[i].updatedAt = nowISO();
                    break;
                }
            }
            saveMetaList(metaList);
            if (mapId === currentMapId) updatePageTitle();
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

