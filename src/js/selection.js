// ========================================
// Selection & Navigation
// ========================================

function selectNode(nodeId) {
    clearSelection();
    if (nodeId) {
        selectedNodeIds.add(nodeId);
        lastSelectedNodeId = nodeId;
        selectionAnchorId = nodeId;
        updateSelectionDisplay();
        scrollNodeIntoView(nodeId);
    }
}

function clearSelection() {
    selectedNodeIds.clear();
    lastSelectedNodeId = null;
    selectionAnchorId = null;
    document.querySelectorAll('.node.selected').forEach(function(el) {
        el.classList.remove('selected');
    });
    document.querySelectorAll('.sidebar-preview-line.active').forEach(function(el) {
        el.classList.remove('active');
    });
}

function updateSelectionDisplay() {
    document.querySelectorAll('.node').forEach(function(el) {
        el.classList.toggle('selected', selectedNodeIds.has(el.dataset.id));
    });
    // Sync sidebar preview highlight
    document.querySelectorAll('.sidebar-preview-line').forEach(function(el) {
        el.classList.toggle('active', selectedNodeIds.has(el.getAttribute('data-sid')));
    });
}

function toggleSelectNode(nodeId) {
    if (selectedNodeIds.has(nodeId)) {
        selectedNodeIds.delete(nodeId);
    } else {
        selectedNodeIds.add(nodeId);
    }
    lastSelectedNodeId = nodeId;
    updateSelectionDisplay();
}

function rangeSelectNode(nodeId) {
    if (!lastSelectedNodeId) { selectNode(nodeId); return; }
    // Preserve the anchor: if no anchor yet, use lastSelectedNodeId
    if (!selectionAnchorId) selectionAnchorId = lastSelectedNodeId;
    var allNodes = getAllNodesInOrder();
    var si = -1, ei = -1;
    for (var i = 0; i < allNodes.length; i++) {
        if (allNodes[i].id === selectionAnchorId) si = i;
        if (allNodes[i].id === nodeId) ei = i;
    }
    if (si === -1 || ei === -1) { selectNode(nodeId); return; }
    var mn = Math.min(si, ei), mx = Math.max(si, ei);
    selectedNodeIds.clear();
    for (var i = mn; i <= mx; i++) {
        selectedNodeIds.add(allNodes[i].id);
    }
    lastSelectedNodeId = nodeId;
    // Keep selectionAnchorId unchanged so further Shift+clicks extend from original anchor
    updateSelectionDisplay();
}

function getSelectedNodeId() {
    if (selectedNodeIds.size === 0) return null;
    return lastSelectedNodeId || selectedNodeIds.values().next().value;
}

function getSelectedNodes() {
    var nodes = [];
    selectedNodeIds.forEach(function(id) {
        var r = findNode(id);
        if (r) nodes.push(r.node);
    });
    return nodes;
}

// Collect all nodes at a given depth level in tree-walk (visual) order
function getNodesAtLevel(targetLevel, node, currentLevel) {
    if (node === undefined) node = mindMapData.root;
    if (currentLevel === undefined) currentLevel = 1;
    var result = [];
    if (currentLevel === targetLevel) {
        result.push(node);
        return result;
    }
    for (var i = 0; i < node.children.length; i++) {
        var childResults = getNodesAtLevel(targetLevel, node.children[i], currentLevel + 1);
        for (var j = 0; j < childResults.length; j++) {
            result.push(childResults[j]);
        }
    }
    return result;
}

// Navigate UP: cross-parent, same depth level
function navigateUp() {
    var cid = getSelectedNodeId();
    if (!cid) { selectNode('root'); return; }
    var level = getNodeLevel(cid);
    if (!level || level <= 1) return; // root has no same-level peers
    var nodesAtLevel = getNodesAtLevel(level);
    var idx = -1;
    for (var i = 0; i < nodesAtLevel.length; i++) {
        if (nodesAtLevel[i].id === cid) { idx = i; break; }
    }
    if (idx > 0) {
        selectNode(nodesAtLevel[idx - 1].id);
    }
}

// Navigate DOWN: cross-parent, same depth level
function navigateDown() {
    var cid = getSelectedNodeId();
    if (!cid) { selectNode('root'); return; }
    var level = getNodeLevel(cid);
    if (!level || level <= 1) return;
    var nodesAtLevel = getNodesAtLevel(level);
    var idx = -1;
    for (var i = 0; i < nodesAtLevel.length; i++) {
        if (nodesAtLevel[i].id === cid) { idx = i; break; }
    }
    if (idx >= 0 && idx < nodesAtLevel.length - 1) {
        selectNode(nodesAtLevel[idx + 1].id);
    }
}

// Shift+Arrow range selection: extend/shrink from anchor along same depth
function shiftNavigateUp() {
    var cid = getSelectedNodeId();
    if (!cid) return;
    if (!selectionAnchorId) selectionAnchorId = cid;
    var level = getNodeLevel(cid);
    if (!level || level <= 1) return;
    var nodesAtLevel = getNodesAtLevel(level);
    var curIdx = -1;
    for (var i = 0; i < nodesAtLevel.length; i++) {
        if (nodesAtLevel[i].id === cid) { curIdx = i; break; }
    }
    if (curIdx <= 0) return;
    var newEndId = nodesAtLevel[curIdx - 1].id;
    applyRangeAtLevel(nodesAtLevel, selectionAnchorId, newEndId);
    lastSelectedNodeId = newEndId;
    scrollNodeIntoView(newEndId);
}

function shiftNavigateDown() {
    var cid = getSelectedNodeId();
    if (!cid) return;
    if (!selectionAnchorId) selectionAnchorId = cid;
    var level = getNodeLevel(cid);
    if (!level || level <= 1) return;
    var nodesAtLevel = getNodesAtLevel(level);
    var curIdx = -1;
    for (var i = 0; i < nodesAtLevel.length; i++) {
        if (nodesAtLevel[i].id === cid) { curIdx = i; break; }
    }
    if (curIdx < 0 || curIdx >= nodesAtLevel.length - 1) return;
    var newEndId = nodesAtLevel[curIdx + 1].id;
    applyRangeAtLevel(nodesAtLevel, selectionAnchorId, newEndId);
    lastSelectedNodeId = newEndId;
    scrollNodeIntoView(newEndId);
}

// Select all nodes between anchor and end within the given level-node list
function applyRangeAtLevel(nodesAtLevel, anchorId, endId) {
    var ai = -1, ei = -1;
    for (var i = 0; i < nodesAtLevel.length; i++) {
        if (nodesAtLevel[i].id === anchorId) ai = i;
        if (nodesAtLevel[i].id === endId) ei = i;
    }
    if (ai === -1 || ei === -1) return;
    var mn = Math.min(ai, ei), mx = Math.max(ai, ei);
    selectedNodeIds.clear();
    for (var i = mn; i <= mx; i++) {
        selectedNodeIds.add(nodesAtLevel[i].id);
    }
    updateSelectionDisplay();
}

// Navigate LEFT: go to parent
function navigateLeft() {
    var cid = getSelectedNodeId();
    if (!cid) { selectNode('root'); return; }
    var r = findNode(cid);
    if (r && r.parent) selectNode(r.parent.id);
}

// Navigate RIGHT: go to first child
function navigateRight() {
    var cid = getSelectedNodeId();
    if (!cid) { selectNode('root'); return; }
    var r = findNode(cid);
    if (r && r.node.children.length > 0) {
        selectNode(r.node.children[0].id);
    }
}

function goToParent() {
    var cid = getSelectedNodeId();
    if (!cid || cid === 'root') return;
    var r = findNode(cid);
    if (r && r.parent) selectNode(r.parent.id);
}

function scrollNodeIntoView(nodeId) {
    var nodeEl = document.querySelector('[data-id="' + nodeId + '"]');
    if (!nodeEl) return;
    var container = document.getElementById('canvasContainer');
    var rect = nodeEl.getBoundingClientRect();
    var cRect = container.getBoundingClientRect();
    var margin = 60;
    var dx = 0, dy = 0;
    if (rect.left < cRect.left + margin) dx = cRect.left + margin - rect.left;
    else if (rect.right > cRect.right - margin) dx = cRect.right - margin - rect.right;
    if (rect.top < cRect.top + margin) dy = cRect.top + margin - rect.top;
    else if (rect.bottom > cRect.bottom - margin - 80) dy = cRect.bottom - margin - 80 - rect.bottom;
    if (dx !== 0 || dy !== 0) {
        viewState.panX += dx;
        viewState.panY += dy;
        updateView();
    }
}

