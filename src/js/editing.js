// ========================================
// Edit Mode
// ========================================

function startEditing(nodeId) {
    if (editingNodeId === nodeId) return;
    if (editingNodeId) finishEditing();
    editingNodeId = nodeId;
    // Select without clearing other selection state, just ensure this node is selected
    if (!selectedNodeIds.has(nodeId)) {
        selectNode(nodeId);
    }
    var nodeEl = document.querySelector('[data-id="' + nodeId + '"]');
    var textEl = nodeEl ? nodeEl.querySelector('.node-text') : null;
    if (textEl) {
        nodeEl.classList.add('editing');
        // Remove fixed width so node grows/shrinks with text in real-time
        nodeEl.style.width = 'auto';
        textEl.contentEditable = 'true';
        textEl.focus();
        var range = document.createRange();
        range.selectNodeContents(textEl);
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
    }
}

function finishEditing() {
    if (!editingNodeId) return;
    var prevEditingId = editingNodeId;
    var nodeEl = document.querySelector('[data-id="' + editingNodeId + '"]');
    var textEl = nodeEl ? nodeEl.querySelector('.node-text') : null;
    var textChanged = false;
    if (textEl) {
        // Convert innerHTML <br> tags to \n for storage
        var html = textEl.innerHTML;
        // Replace <br> variants with \n
        var newText = html.replace(/<br\s*\/?>/gi, '\n');
        // Strip any other HTML tags
        var tmp = document.createElement('div');
        tmp.innerHTML = newText;
        newText = tmp.textContent.replace(/\u200B/g, '').trim() || '空のノード';
        var result = findNode(editingNodeId);
        if (result && result.node.text !== newText) {
            textChanged = true;
        }
        updateNodeText(editingNodeId, newText);
        textEl.contentEditable = 'false';
        nodeEl.classList.remove('editing');
    }
    editingNodeId = null;
    // Re-render to recalculate layout when text changed
    if (textChanged) {
        render();
        // Re-select the previously edited node
        selectNode(prevEditingId);
    }
}

