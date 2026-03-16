// ========================================
// Keyboard Handler
// ========================================

function handleKeyDown(e) {
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
                if (currentId) { toggleNodeHighlight(currentId); saveState(); }
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
                if (currentId) { toggleNodeGrayout(currentId); saveState(); }
            }
            break;
        case 'Escape':
            clearSelection();
            break;
    }
}

