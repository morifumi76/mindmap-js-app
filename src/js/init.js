// ========================================
// Initialization
// ========================================

function init() {
    // Run migration from old storage format
    migrateIfNeeded();

    // Determine which map to load (only pages can be loaded)
    var urlParams = new URLSearchParams(window.location.search);
    var requestedId = urlParams.get('id') ? parseInt(urlParams.get('id'), 10) : null;
    var lastId = getLastActiveId();
    var metaList = getMetaList();
    var pages = metaList.filter(function(m) { return m.type === 'page'; });

    if (requestedId && findMetaById(requestedId) && findMetaById(requestedId).type === 'page') {
        currentMapId = requestedId;
    } else if (lastId && findMetaById(lastId) && findMetaById(lastId).type === 'page') {
        currentMapId = lastId;
    } else if (pages.length > 0) {
        // Sort by updatedAt desc, pick first
        pages.sort(function(a, b) { return (b.updatedAt || '').localeCompare(a.updatedAt || ''); });
        currentMapId = pages[0].id;
    } else {
        // No pages exist at all, create one in 未分類
        metaList = ensureDefaultFolder(metaList);
        saveMetaList(metaList);
        var defFolderId = getDefaultFolderId(metaList);
        var newId = getNextMapId();
        var now = nowISO();
        var defaultData = { root: { id: 'root', text: '中心テーマ', children: [] } };
        metaList.push({ id: newId, name: '無題のマップ', type: 'page', folderId: defFolderId, order: 0, createdAt: now, updatedAt: now });
        saveMetaList(metaList);
        try { localStorage.setItem(getMapDataKey(newId), JSON.stringify(defaultData)); } catch(e) {}
        currentMapId = newId;
    }

    // Load map data
    var saved = loadMapData(currentMapId);
    if (saved) {
        mindMapData = saved;
    }
    setLastActiveId(currentMapId);
    updateUrlParam(currentMapId);
    updatePageTitle();

    saveState();
    document.addEventListener('keydown', handleKeyDown);
    initCanvasInteraction();
    initZoomControl();
    document.getElementById('copyBtn').addEventListener('click', copyToClipboard);
    document.getElementById('expandAllBtn').addEventListener('click', expandAllNodes);
    document.getElementById('collapseAllBtn').addEventListener('click', collapseAllNodes);

    // Grey-out floating button
    var grayoutBtn = document.getElementById('grayoutFloatBtn');
    if (grayoutBtn) {
        grayoutBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            var nodes = getSelectedNodes();
            if (nodes.length > 0) {
                // 1つでもOFFがあれば全部ON、全部ONなら全部OFF
                var allOn = nodes.every(function(node) { return isNodeGrayedOut(node.id); });
                var grayState = getNodeGrayoutState();
                var hlState = getNodeHighlightState();
                nodes.forEach(function(node) {
                    if (allOn) {
                        delete grayState[node.id];
                    } else {
                        // グレーアウトON時はハイライトを解除（相互排他）
                        delete hlState[node.id];
                        grayState[node.id] = true;
                    }
                });
                setNodeGrayoutState(grayState);
                setNodeHighlightState(hlState);
                saveState();
                showToast(allOn ? 'グレーアウトを解除しました' : 'グレーアウトしました');
                render();
            } else {
                showToast('ノードを選択してください');
            }
        });
    }

    // Highlight floating button
    var highlightBtn = document.getElementById('highlightFloatBtn');
    if (highlightBtn) {
        highlightBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            var nodes = getSelectedNodes();
            if (nodes.length > 0) {
                // 1つでもOFFがあれば全部ON、全部ONなら全部OFF
                var allOn = nodes.every(function(node) { return isNodeHighlighted(node.id); });
                var hlState = getNodeHighlightState();
                var grayState = getNodeGrayoutState();
                nodes.forEach(function(node) {
                    if (allOn) {
                        delete hlState[node.id];
                    } else {
                        // ハイライトON時はグレーアウトを解除（相互排他）
                        delete grayState[node.id];
                        hlState[node.id] = true;
                    }
                });
                setNodeHighlightState(hlState);
                setNodeGrayoutState(grayState);
                saveState();
                showToast(allOn ? 'ハイライトを解除しました' : 'ハイライトしました');
                render();
            } else {
                showToast('ノードを選択してください');
            }
        });
    }
    document.getElementById('sidebarMiniCopy').addEventListener('click', function(e) {
        e.stopPropagation();
        copyToClipboard();
    });

    // Persist format/border selection – now driven by toggle buttons
    var savedFormat = localStorage.getItem('mindmap_copyFormat');
    var savedBorder = localStorage.getItem('mindmap_copyBorder');
    // family mode has been removed – fall back to simple
    if (savedFormat === 'family') savedFormat = 'simple';
    // Apply saved state to hidden selects
    if (savedFormat) document.getElementById('copyFormat').value = savedFormat;
    document.getElementById('copyBorder').value = savedBorder || 'border';
    // Sync toggle button UI with saved state
    syncToggleButtons();

    // Sort toggle
    var sortInput = document.getElementById('sortToggleInput');
    if (sortInput) {
        sortInput.checked = (getSortMode() === 'alpha');
        sortInput.addEventListener('change', function() {
            setSortMode(this.checked ? 'alpha' : 'none');
            renderMapList();
        });
    }

    // Toggle switch: ひよこ ON/OFF
    document.getElementById('toggleHiyokoInput').addEventListener('change', function() {
        var formatEl = document.getElementById('copyFormat');
        formatEl.value = this.checked ? 'hiyoko' : 'simple';
        try { localStorage.setItem('mindmap_copyFormat', formatEl.value); } catch(e) {}
        renderSidebarTree();
    });

    // Toggle switch: 罫線 ON/OFF
    document.getElementById('toggleBorderInput').addEventListener('change', function() {
        var borderEl = document.getElementById('copyBorder');
        borderEl.value = this.checked ? 'border' : 'none';
        try { localStorage.setItem('mindmap_copyBorder', borderEl.value); } catch(e) {}
        renderSidebarTree();
    });

    // Keep hidden selects in sync (for backward compat / API)
    document.getElementById('copyFormat').addEventListener('change', function() {
        try { localStorage.setItem('mindmap_copyFormat', this.value); } catch(e) {}
        syncToggleButtons();
        renderSidebarTree();
    });
    document.getElementById('copyBorder').addEventListener('change', function() {
        try { localStorage.setItem('mindmap_copyBorder', this.value); } catch(e) {}
        syncToggleButtons();
        renderSidebarTree();
    });

    // Right sidebar resize & toggle
    initSidebar();
    // Left sidebar
    initLeftSidebar();
    // Adjust canvas for both sidebars
    adjustCanvasForSidebars();
    resetView();
    render();
    renderMapList();
    selectNode('root');
    setTimeout(function() { startEditing('root'); }, 100);

    // Close context menus on any click outside
    document.addEventListener('click', function(e) {
        var menus = ['ctxMenu', 'ctxMenuFolder', 'ctxMenuArea'];
        for (var mi = 0; mi < menus.length; mi++) {
            var cm = document.getElementById(menus[mi]);
            if (cm && !cm.contains(e.target)) {
                cm.classList.remove('show');
            }
        }
        if (!e.target.closest('.ctx-menu')) {
            ctxMenuTargetMapId = null;
        }
    });
}

function updateUrlParam(mapId) {
    var url = new URL(window.location);
    url.searchParams.set('id', mapId);
    history.replaceState(null, '', url);
}

function updatePageTitle() {
    var meta = findMetaById(currentMapId);
    document.title = meta ? meta.name + ' - マインドマップ' : 'マインドマップ';
}

// DOMContentLoaded is handled by app-init.js (which calls init() after auth check)

