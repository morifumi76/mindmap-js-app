// ========================================
// Initialization
// ========================================

var appInitialized = false;
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
    if (!appInitialized) {
        appInitialized = true;
        document.addEventListener('keydown', handleKeyDown);
        initCanvasInteraction();
        initZoomControl();
        document.getElementById('copyBtn').addEventListener('click', copyToClipboard);
        document.getElementById('expandAllBtn').addEventListener('click', expandAllNodes);
        document.getElementById('collapseAllBtn').addEventListener('click', collapseAllNodes);
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
                nodes.forEach(function(node) {
                    if (allOn) {
                        delete grayState[node.id];
                    } else {
                        // グレーアウトON時はハイライト・水色を解除（相互排他）
                        delete hlState[node.id];
                        delete cyanState0[node.id];
                        grayState[node.id] = true;
                    }
                });
                setNodeGrayoutState(grayState);
                setNodeHighlightState(hlState);
                setNodeCyanState(cyanState0);
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
                nodes.forEach(function(node) {
                    if (allOn) {
                        delete hlState[node.id];
                    } else {
                        // ハイライトON時はグレーアウト・水色を解除（相互排他）
                        delete grayState[node.id];
                        delete cyanState1[node.id];
                        hlState[node.id] = true;
                    }
                });
                setNodeHighlightState(hlState);
                setNodeGrayoutState(grayState);
                setNodeCyanState(cyanState1);
                saveState();
                showToast(allOn ? 'ハイライトを解除しました' : 'ハイライトしました');
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
                nodes.forEach(function(node) {
                    if (allOn) {
                        delete cyanState[node.id];
                    } else {
                        // 水色ON時はグレーアウト・ハイライトを解除（相互排他）
                        delete grayState2[node.id];
                        delete hlState2[node.id];
                        cyanState[node.id] = true;
                    }
                });
                setNodeCyanState(cyanState);
                setNodeGrayoutState(grayState2);
                setNodeHighlightState(hlState2);
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

// ========================================
// Link Modal (ハイパーリンク設定モーダル)
// ========================================
var linkModalInitialized = false;

// 選択状態に応じてリンクボタンを活性/非活性・リンク設定済み表示を切り替え
function updateLinkButtonState() {
    var btn = document.getElementById('linkFloatBtn');
    if (!btn) return;
    var id = getSelectedNodeId();
    if (!id) {
        btn.disabled = true;
        btn.classList.remove('has-link');
        return;
    }
    btn.disabled = false;
    if (isNodeLinked(id)) {
        btn.classList.add('has-link');
    } else {
        btn.classList.remove('has-link');
    }
}

// URL形式を正規化（httpスキームがなければ https:// を補完）
function normalizeLinkUrl(raw) {
    if (!raw) return '';
    var url = raw.trim();
    if (!url) return '';
    if (!/^https?:\/\//i.test(url)) {
        url = 'https://' + url;
    }
    return url;
}

// http(s) のURLとして有効か判定
function isValidHttpUrl(url) {
    if (!url) return false;
    if (!/^https?:\/\/[^\s]+\.[^\s]+/i.test(url)) return false;
    try {
        new URL(url);
        return true;
    } catch (e) {
        return false;
    }
}

function validateLinkModalInput() {
    var urlInput = document.getElementById('linkModalUrl');
    var okBtn = document.getElementById('linkModalOk');
    if (!urlInput || !okBtn) return false;
    var normalized = normalizeLinkUrl(urlInput.value);
    var valid = isValidHttpUrl(normalized);
    okBtn.disabled = !valid;
    return valid;
}

function openLinkModal() {
    var nodeId = getSelectedNodeId();
    if (!nodeId) {
        showToast('ノードを選択してください');
        return;
    }
    var r = findNode(nodeId);
    if (!r || !r.node) return;
    var existing = r.node.hyperlink || null;

    var overlay = document.getElementById('linkModalOverlay');
    var textInput = document.getElementById('linkModalText');
    var urlInput = document.getElementById('linkModalUrl');
    var deleteBtn = document.getElementById('linkModalDelete');
    var errorEl = document.getElementById('linkModalError');
    if (!overlay || !textInput || !urlInput) return;

    textInput.value = existing ? (existing.displayText || r.node.text) : r.node.text;
    urlInput.value = existing ? existing.url : '';
    deleteBtn.style.display = existing ? '' : 'none';
    errorEl.textContent = '';
    overlay.dataset.nodeId = nodeId;
    overlay.style.display = 'flex';

    validateLinkModalInput();
    setTimeout(function() {
        urlInput.focus();
        urlInput.select();
    }, 0);
}

function closeLinkModal() {
    var overlay = document.getElementById('linkModalOverlay');
    if (overlay) overlay.style.display = 'none';
}

function isLinkModalOpen() {
    var overlay = document.getElementById('linkModalOverlay');
    return !!(overlay && overlay.style.display === 'flex');
}

function submitLinkModal() {
    var overlay = document.getElementById('linkModalOverlay');
    var nodeId = overlay ? overlay.dataset.nodeId : null;
    var textInput = document.getElementById('linkModalText');
    var urlInput = document.getElementById('linkModalUrl');
    var errorEl = document.getElementById('linkModalError');
    if (!nodeId || !textInput || !urlInput) return;

    var normalized = normalizeLinkUrl(urlInput.value);
    if (!isValidHttpUrl(normalized)) {
        errorEl.textContent = '有効なURLを入力してください';
        return;
    }

    var r = findNode(nodeId);
    if (!r || !r.node) { closeLinkModal(); return; }

    var displayText = (textInput.value || '').trim() || r.node.text;
    r.node.hyperlink = { url: normalized, displayText: displayText };
    saveState();
    render();
    updateLinkButtonState();
    closeLinkModal();
    showToast('リンクを設定しました');
}

function deleteLinkFromModal() {
    var overlay = document.getElementById('linkModalOverlay');
    var nodeId = overlay ? overlay.dataset.nodeId : null;
    if (!nodeId) { closeLinkModal(); return; }
    var r = findNode(nodeId);
    if (!r || !r.node) { closeLinkModal(); return; }
    if (!r.node.hyperlink) { closeLinkModal(); return; }
    delete r.node.hyperlink;
    saveState();
    render();
    updateLinkButtonState();
    closeLinkModal();
    showToast('リンクを削除しました');
}

function initLinkModal() {
    if (linkModalInitialized) return;
    linkModalInitialized = true;

    var overlay = document.getElementById('linkModalOverlay');
    var urlInput = document.getElementById('linkModalUrl');
    var textInput = document.getElementById('linkModalText');
    var okBtn = document.getElementById('linkModalOk');
    var cancelBtn = document.getElementById('linkModalCancel');
    var deleteBtn = document.getElementById('linkModalDelete');
    var errorEl = document.getElementById('linkModalError');
    if (!overlay) return;

    // URL入力の変更でバリデーション
    if (urlInput) {
        urlInput.addEventListener('input', function() {
            if (errorEl) errorEl.textContent = '';
            validateLinkModalInput();
        });
        // Enter: テキスト選択中→選択解除（カーソル末尾へ）、選択なし→確定
        urlInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                if (urlInput.selectionStart !== urlInput.selectionEnd) {
                    urlInput.selectionStart = urlInput.selectionEnd = urlInput.value.length;
                    return;
                }
                validateLinkModalInput();
                if (!okBtn.disabled) submitLinkModal();
            }
        });
    }
    if (textInput) {
        // テキスト名でEnter → URL未入力ならURL欄へ、選択中なら解除、それ以外は確定
        textInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                if (urlInput && !urlInput.value.trim()) {
                    urlInput.focus();
                    return;
                }
                if (textInput.selectionStart !== textInput.selectionEnd) {
                    textInput.selectionStart = textInput.selectionEnd = textInput.value.length;
                    return;
                }
                validateLinkModalInput();
                if (!okBtn.disabled) submitLinkModal();
            }
        });
    }

    if (okBtn) okBtn.addEventListener('click', submitLinkModal);
    if (cancelBtn) cancelBtn.addEventListener('click', closeLinkModal);
    if (deleteBtn) deleteBtn.addEventListener('click', deleteLinkFromModal);

    // オーバーレイ外クリックで閉じる
    overlay.addEventListener('mousedown', function(e) {
        if (e.target === overlay) closeLinkModal();
    });

    // Escキーで閉じる（モーダル表示中のみ）
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && isLinkModalOpen()) {
            e.stopPropagation();
            closeLinkModal();
        }
    }, true);
}

// DOMContentLoaded is handled by app-init.js (which calls init() after auth check)

