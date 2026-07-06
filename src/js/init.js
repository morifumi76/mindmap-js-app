import { initLinkModal, openLinkModal, updateLinkButtonState } from './link-modal.js';
import {
    collapseAllNodes,
    currentMapId,
    expandAllNodes,
    getFastMode,
    getNodeCyanState,
    getNodeGrayoutState,
    getNodeGreenState,
    getNodeHighlightState,
    getNodeRedTextState,
    isNodeCyan,
    isNodeGrayedOut,
    isNodeGreen,
    isNodeHighlighted,
    isNodeRedText,
    setCtxMenuTargetMapId,
    setCurrentMapId,
    setFastMode,
    setMindMapData,
    setNodeCyanState,
    setNodeGrayoutState,
    setNodeGreenState,
    setNodeHighlightState,
    setNodeRedTextState,
    setVerticalLayout,
    syncFastModeToggleUI
} from './state.js';
import { showToast } from './utils.js';
import {
    cleanupDefaultFolders,
    findMetaById,
    getLastActiveId,
    getMapDataKey,
    getMetaList,
    getNextMapId,
    getSortMode,
    getTitleDateMode,
    loadMapData,
    migrateIfNeeded,
    nowISO,
    saveMetaList,
    setLastActiveId,
    setSortMode,
    setTitleDateMode
} from './storage.js';
import { saveState } from './history.js';
import { getSelectedNodes, selectNode } from './selection.js';
import { startEditing } from './editing.js';
import { copyToClipboard } from './clipboard.js';
import { render, resetView } from './render.js';
import { initRelationsEvents } from './relations/index.js';
import { handleKeyDown } from './keyboard.js';
import { initCanvasInteraction, initZoomControl, syncToggleButtons } from './canvas-interaction.js';
import { adjustCanvasForSidebars, initSidebar, renderSidebarTree } from './sidebar-right.js';
import { initLeftSidebar } from './sidebar-left/events.js';
import { renderMapList } from './sidebar-left/render.js';

// ========================================
// Initialization
// ========================================

export var appInitialized = false;
export function init() {
    // Run migration from old storage format
    migrateIfNeeded();
    // 旧仕様の "未分類" フォルダが残っていれば取り除き、配下ページはトップレベルに救出する
    if (typeof cleanupDefaultFolders === 'function') cleanupDefaultFolders();

    // Determine which map to load (only pages can be loaded)
    var urlParams = new URLSearchParams(window.location.search);
    var requestedId = urlParams.get('id') ? parseInt(urlParams.get('id'), 10) : null;
    var lastId = getLastActiveId();
    var metaList = getMetaList();
    var pages = metaList.filter(function(m) { return m.type === 'page'; });

    if (requestedId && findMetaById(requestedId) && findMetaById(requestedId).type === 'page') {
        setCurrentMapId(requestedId);
    } else if (lastId && findMetaById(lastId) && findMetaById(lastId).type === 'page') {
        setCurrentMapId(lastId);
    } else if (pages.length > 0) {
        // Sort by updatedAt desc, pick first
        pages.sort(function(a, b) { return (b.updatedAt || '').localeCompare(a.updatedAt || ''); });
        setCurrentMapId(pages[0].id);
    } else {
        // ページが一つもないとき：トップレベル（folderId = null）に新規ページを作成する
        var newId = getNextMapId();
        var now = nowISO();
        var defaultData = { root: { id: 'root', text: '中心テーマ', children: [] } };
        metaList.push({ id: newId, name: '無題のマップ', type: 'page', folderId: null, order: 0, createdAt: now, updatedAt: now });
        saveMetaList(metaList);
        try { localStorage.setItem(getMapDataKey(newId), JSON.stringify(defaultData)); } catch(e) {}
        setCurrentMapId(newId);
    }

    // Load map data
    var saved = loadMapData(currentMapId);
    if (saved) {
        setMindMapData(saved);
    }
    setLastActiveId(currentMapId);
    updateUrlParam(currentMapId);
    updatePageTitle();

    saveState();
    if (!appInitialized) {
        appInitialized = true;
        document.addEventListener('keydown', handleKeyDown);
        initCanvasInteraction();
        initZoomControl();
        if (typeof initRelationsEvents === 'function') initRelationsEvents();
        document.getElementById('copyBtn').addEventListener('click', copyToClipboard);
        document.getElementById('expandAllBtn').addEventListener('click', expandAllNodes);
        document.getElementById('collapseAllBtn').addEventListener('click', collapseAllNodes);

        // 高速モードトグル：localStorageから初期状態を反映し、クリックで切り替え
        var fastToggle = document.getElementById('fastModeToggle');
        if (fastToggle) {
            syncFastModeToggleUI();
            fastToggle.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                setFastMode(!getFastMode());
            });
        }

        // 縦表示チェックボックス：マップデータの isVertical を切り替えて即再レイアウト。
        // 保存は render() 内の既存自動保存に乗る。saveState() は呼ばない（Undo/Redoの対象外）。
        var verticalCb = document.getElementById('verticalModeCheckbox');
        if (verticalCb) {
            verticalCb.addEventListener('change', function() {
                setVerticalLayout(verticalCb.checked);
                render();
                // ルートノードが画面内に収まるよう自動でセンタリング
                resetView();
            });
        }
    }

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
                var cyanState0 = getNodeCyanState();
                var greenState0 = getNodeGreenState();
                nodes.forEach(function(node) {
                    if (allOn) {
                        delete grayState[node.id];
                    } else {
                        // グレーアウトON時はハイライト・水色・緑を解除（相互排他）
                        delete hlState[node.id];
                        delete cyanState0[node.id];
                        delete greenState0[node.id];
                        grayState[node.id] = true;
                    }
                });
                setNodeGrayoutState(grayState);
                setNodeHighlightState(hlState);
                setNodeCyanState(cyanState0);
                setNodeGreenState(greenState0);
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
                var cyanState1 = getNodeCyanState();
                var greenState1 = getNodeGreenState();
                nodes.forEach(function(node) {
                    if (allOn) {
                        delete hlState[node.id];
                    } else {
                        // ハイライトON時はグレーアウト・水色・緑を解除（相互排他）
                        delete grayState[node.id];
                        delete cyanState1[node.id];
                        delete greenState1[node.id];
                        hlState[node.id] = true;
                    }
                });
                setNodeHighlightState(hlState);
                setNodeGrayoutState(grayState);
                setNodeCyanState(cyanState1);
                setNodeGreenState(greenState1);
                saveState();
                showToast(allOn ? 'ハイライトを解除しました' : 'ハイライトしました');
                render();
            } else {
                showToast('ノードを選択してください');
            }
        });
    }
    // 緑ハイライトフローティングボタン
    var greenBtn = document.getElementById('greenFloatBtn');
    if (greenBtn) {
        greenBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            var nodes = getSelectedNodes();
            if (nodes.length > 0) {
                var allOn = nodes.every(function(node) { return isNodeGreen(node.id); });
                var greenState = getNodeGreenState();
                var grayStateG = getNodeGrayoutState();
                var hlStateG   = getNodeHighlightState();
                var cyanStateG = getNodeCyanState();
                nodes.forEach(function(node) {
                    if (allOn) {
                        delete greenState[node.id];
                    } else {
                        // 緑ON時はグレーアウト・ハイライト・水色を解除（相互排他）
                        delete grayStateG[node.id];
                        delete hlStateG[node.id];
                        delete cyanStateG[node.id];
                        greenState[node.id] = true;
                    }
                });
                setNodeGreenState(greenState);
                setNodeGrayoutState(grayStateG);
                setNodeHighlightState(hlStateG);
                setNodeCyanState(cyanStateG);
                saveState();
                showToast(allOn ? '緑を解除しました' : '緑にしました');
                render();
            } else {
                showToast('ノードを選択してください');
            }
        });
    }

    // 水色ハイライトフローティングボタン
    var cyanBtn = document.getElementById('cyanFloatBtn');
    if (cyanBtn) {
        cyanBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            var nodes = getSelectedNodes();
            if (nodes.length > 0) {
                var allOn = nodes.every(function(node) { return isNodeCyan(node.id); });
                var cyanState = getNodeCyanState();
                var grayState2 = getNodeGrayoutState();
                var hlState2 = getNodeHighlightState();
                var greenState2 = getNodeGreenState();
                nodes.forEach(function(node) {
                    if (allOn) {
                        delete cyanState[node.id];
                    } else {
                        // 水色ON時はグレーアウト・ハイライト・緑を解除（相互排他）
                        delete grayState2[node.id];
                        delete hlState2[node.id];
                        delete greenState2[node.id];
                        cyanState[node.id] = true;
                    }
                });
                setNodeCyanState(cyanState);
                setNodeGrayoutState(grayState2);
                setNodeHighlightState(hlState2);
                setNodeGreenState(greenState2);
                saveState();
                showToast(allOn ? '水色を解除しました' : '水色にしました');
                render();
            } else {
                showToast('ノードを選択してください');
            }
        });
    }

    // リンク挿入フローティングボタン
    var linkBtn = document.getElementById('linkFloatBtn');
    if (linkBtn) {
        linkBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            openLinkModal();
        });
    }
    initLinkModal();
    updateLinkButtonState();

    // 赤文字フローティングボタン
    var redTextBtn = document.getElementById('redTextFloatBtn');
    if (redTextBtn) {
        redTextBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            var nodes = getSelectedNodes();
            if (nodes.length > 0) {
                // 1つでもOFFがあれば全部ON、全部ONなら全部OFF
                var allOn = nodes.every(function(node) { return isNodeRedText(node.id); });
                var rtState = getNodeRedTextState();
                nodes.forEach(function(node) {
                    if (allOn) {
                        delete rtState[node.id];
                    } else {
                        rtState[node.id] = true;
                    }
                });
                setNodeRedTextState(rtState);
                saveState();
                showToast(allOn ? '赤文字を解除しました' : '赤文字にしました');
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
    // グレーアウト非表示トグルの初期状態を復元（デフォルトON = 非表示）
    var savedHideGrayout = localStorage.getItem('mindmap_hideGrayout');
    var hideGrayoutInput = document.getElementById('toggleHideGrayoutInput');
    if (hideGrayoutInput) {
        hideGrayoutInput.checked = (savedHideGrayout === null) ? true : (savedHideGrayout === 'true');
    }
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

    // Title date mode toggle
    var titleDateInput = document.getElementById('titleDateToggleInput');
    if (titleDateInput) {
        titleDateInput.checked = getTitleDateMode();
        titleDateInput.addEventListener('change', function() {
            setTitleDateMode(this.checked);
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

    // Toggle switch: グレーアウト非表示 ON/OFF
    var hideGrayoutToggle = document.getElementById('toggleHideGrayoutInput');
    if (hideGrayoutToggle) {
        hideGrayoutToggle.addEventListener('change', function() {
            try { localStorage.setItem('mindmap_hideGrayout', this.checked ? 'true' : 'false'); } catch(e) {}
            renderSidebarTree();
        });
    }

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
            setCtxMenuTargetMapId(null);
        }
    });
}

export function updateUrlParam(mapId) {
    var url = new URL(window.location);
    url.searchParams.set('id', mapId);
    history.replaceState(null, '', url);
}

export function updatePageTitle() {
    var meta = findMetaById(currentMapId);
    document.title = meta ? meta.name + ' - マインドマップ' : 'マインドマップ';
}
