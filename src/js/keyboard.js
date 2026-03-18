// ========================================
// Keyboard Handler
// ========================================

// 選択中の全ノードにグレーアウトを適用（ボタンと同じ複数選択対応ロジック）
function applyGrayoutToSelection() {
    var nodes = getSelectedNodes();
    if (nodes.length === 0) return;
    var allOn = nodes.every(function(node) { return isNodeGrayedOut(node.id); });
    var grayState = getNodeGrayoutState();
    var hlState   = getNodeHighlightState();
    nodes.forEach(function(node) {
        if (allOn) {
            delete grayState[node.id];
        } else {
            delete hlState[node.id];
            grayState[node.id] = true;
        }
    });
    setNodeGrayoutState(grayState);
    setNodeHighlightState(hlState);
    saveState();
    showToast(allOn ? 'グレーアウトを解除しました' : 'グレーアウトしました');
}

// 選択中の全ノードにハイライトを適用（ボタンと同じ複数選択対応ロジック）
function applyHighlightToSelection() {
    var nodes = getSelectedNodes();
    if (nodes.length === 0) return;
    var allOn = nodes.every(function(node) { return isNodeHighlighted(node.id); });
    var hlState   = getNodeHighlightState();
    var grayState = getNodeGrayoutState();
    nodes.forEach(function(node) {
        if (allOn) {
            delete hlState[node.id];
        } else {
            delete grayState[node.id];
            hlState[node.id] = true;
        }
    });
    setNodeHighlightState(hlState);
    setNodeGrayoutState(grayState);
    saveState();
    showToast(allOn ? 'ハイライトを解除しました' : 'ハイライトしました');
}

function handleKeyDown(e) {
    // Read-only mode: only allow zoom/pan shortcuts, block all editing
    if (window._isReadOnly) {
        var isMacRO = /Mac/.test(navigator.platform);
        var cmdKeyRO = isMacRO ? e.metaKey : e.ctrlKey;
        // Allow Cmd+/Ctrl+= (zoom in), Cmd+- (zoom out), Cmd+0 (reset)
        if (cmdKeyRO && (e.key === '=' || e.key === '+' || e.key === '-' || e.key === '0')) return;
        e.preventDefault();
        return;
    }

    var isMac = /Mac/.test(navigator.platform);
    var cmdKey = isMac ? e.metaKey : e.ctrlKey;

    // If focus is in a rename input field in My Maps sidebar, do NOT handle shortcuts
    var activeEl = document.activeElement;
    if (activeEl && (activeEl.classList.contains('map-item-rename-input') ||
        (activeEl.classList.contains('map-item-name') && activeEl.contentEditable === 'true'))) {
        // Allow default behavior for the rename input
        // Only handle Enter/Escape which are handled by the input's own listener
        return;
    }

    // While editing
    if (editingNodeId) {
        // IME入力中（ローマ字→日本語変換）のキーは無視する
        if (e.isComposing || e.keyCode === 229) return;

        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            finishEditing();
        } else if (e.key === 'Enter' && e.shiftKey) {
            // Shift+Enter: insert line break
            e.preventDefault();
            var sel = window.getSelection();
            var nodeEl = document.querySelector('[data-id="' + editingNodeId + '"]');
            var textEl = nodeEl ? nodeEl.querySelector('.node-text') : null;
            if (sel.rangeCount && textEl && textEl.contains(sel.getRangeAt(0).commonAncestorContainer)) {
                var range = sel.getRangeAt(0);
                range.deleteContents();
                var br = document.createElement('br');
                range.insertNode(br);
                // Insert a zero-width space after <br> so cursor has a text node to land in
                var textNode = document.createTextNode('\u200B');
                br.parentNode.insertBefore(textNode, br.nextSibling);
                // Move cursor into the text node after <br>
                range = document.createRange();
                range.setStart(textNode, 1);
                range.setEnd(textNode, 1);
                sel.removeAllRanges();
                sel.addRange(range);
            }
        } else if (e.key === 'Escape') {
            e.preventDefault();
            finishEditing();
        } else if (e.key === 'Tab') {
            e.preventDefault();
            finishEditing();
            if (e.shiftKey) { goToParent(); }
            else { var cid = getSelectedNodeId(); if (cid) addChildNode(cid); }
        } else if (cmdKey && (e.key === 'z' || e.key === 'Z')) {
            e.preventDefault(); finishEditing(); undo();
        } else if (cmdKey && (e.key === 'y' || e.key === 'Y')) {
            e.preventDefault(); finishEditing(); redo();
        }
        return;
    }

    var currentId = getSelectedNodeId();

    // Mac では Option+G/Y を押すと e.key が特殊文字になるため、
    // e.code で物理キーを判定してグレーアウト・ハイライトを処理する
    if (e.altKey && cmdKey) {
        if (e.code === 'KeyG') {
            e.preventDefault();
            applyGrayoutToSelection();
            return;
        }
        if (e.code === 'KeyY') {
            e.preventDefault();
            applyHighlightToSelection();
            return;
        }
    }

    switch (e.key) {
        case 'Enter':
            e.preventDefault();
            if (currentId) addSiblingNode(currentId);
            break;
        case 'Tab':
            e.preventDefault();
            if (e.shiftKey) goToParent();
            else if (currentId) addChildNode(currentId);
            break;
        case 'Delete':
        case 'Backspace':
            e.preventDefault();
            if (selectedNodeIds.size > 1) deleteSelectedNodes();
            else if (currentId && currentId !== 'root') deleteNode(currentId);
            break;
        case 'F2':
            e.preventDefault();
            if (currentId) startEditing(currentId);
            break;
        case 'ArrowUp':
            e.preventDefault();
            if (cmdKey) { if (currentId) moveNodeUp(currentId); }
            else if (e.shiftKey) { shiftNavigateUp(); }
            else navigateUp();
            break;
        case 'ArrowDown':
            e.preventDefault();
            if (cmdKey) { if (currentId) moveNodeDown(currentId); }
            else if (e.shiftKey) { shiftNavigateDown(); }
            else navigateDown();
            break;
        case 'ArrowLeft':
            e.preventDefault();
            if (cmdKey) { if (currentId) promoteNode(currentId); }
            else navigateLeft();
            break;
        case 'ArrowRight':
            e.preventDefault();
            if (cmdKey) { if (currentId) demoteNode(currentId); }
            else navigateRight();
            break;
        case 'z': case 'Z':
            if (cmdKey) { e.preventDefault(); undo(); }
            break;
        case 'y': case 'Y':
            if (e.altKey && cmdKey) {
                // Option+Cmd+Y (Mac) or Alt+Ctrl+Y (Windows) – toggle highlight
                e.preventDefault();
                applyHighlightToSelection();
            } else if (cmdKey) {
                e.preventDefault(); redo();
            }
            break;
        case 'a': case 'A':
            if (cmdKey) { e.preventDefault(); selectAll(); }
            break;
        case 'c': case 'C':
            if (cmdKey) { e.preventDefault(); copySelectedNodes(); }
            break;
        case 'v': case 'V':
            if (cmdKey) { e.preventDefault(); pasteNode(); }
            break;
        case 'x': case 'X':
            if (cmdKey) { e.preventDefault(); cutSelectedNodes(); }
            break;
        case '.':
            if (cmdKey) {
                e.preventDefault();
                if (currentId) toggleNodeCollapse(currentId);
            }
            break;
        case 'g': case 'G':
            // Option+Cmd+G (Mac) or Alt+Ctrl+G (Windows) – toggle grayout
            if (e.altKey && cmdKey) {
                e.preventDefault();
                applyGrayoutToSelection();
            }
            break;
        case 'Escape':
            clearSelection();
            break;
    }
}

