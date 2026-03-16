// ========================================
// Copy, Cut & Paste
// ========================================

function copySelectedNodes() {
    if (selectedNodeIds.size === 0) return;
    if (selectedNodeIds.size === 1) {
        var id = getSelectedNodeId();
        var r = findNode(id);
        if (r) {
            clipboard = deepClone(r.node);
            clipboardIsCut = false;
            showToast('コピーしました');
        }
    } else {
        var topLevel = filterTopLevelNodes(Array.from(selectedNodeIds));
        var nodes = [];
        for (var i = 0; i < topLevel.length; i++) {
            var r = findNode(topLevel[i]);
            if (r) nodes.push(deepClone(r.node));
        }
        if (nodes.length > 0) {
            clipboard = nodes;
            clipboardIsCut = false;
            showToast(nodes.length + '個のノードをコピーしました');
        }
    }
}

function cutSelectedNodes() {
    if (selectedNodeIds.size === 0) return;
    var ids = [];
    selectedNodeIds.forEach(function(id) { if (id !== 'root') ids.push(id); });
    if (ids.length === 0) {
        showToast('ルートノードは切り取れません');
        return;
    }
    var topLevel = filterTopLevelNodes(ids);
    var nodes = [];
    for (var i = 0; i < topLevel.length; i++) {
        var r = findNode(topLevel[i]);
        if (r) nodes.push(deepClone(r.node));
    }
    if (nodes.length === 0) return;
    clipboard = nodes.length === 1 ? nodes[0] : nodes;
    clipboardIsCut = true;

    var lastParent = null;
    for (var i = 0; i < topLevel.length; i++) {
        var r = findNode(topLevel[i]);
        if (r && r.parent) {
            lastParent = r.parent;
            r.parent.children.splice(r.index, 1);
        }
    }
    saveState();
    selectedNodeIds.clear();
    if (lastParent && lastParent.children.length > 0) {
        selectNode(lastParent.children[0].id);
    } else if (lastParent) {
        selectNode(lastParent.id);
    } else {
        selectNode('root');
    }
    render();
    showToast(topLevel.length + '個のノードを切り取りました');
}

function pasteNode() {
    var cid = getSelectedNodeId();
    if (!clipboard || !cid) return;
    var r = findNode(cid);
    if (!r) return;
    function reassignIds(node) {
        node.id = generateId();
        if (node.children) {
            for (var i = 0; i < node.children.length; i++) reassignIds(node.children[i]);
        }
    }
    if (Array.isArray(clipboard)) {
        for (var i = 0; i < clipboard.length; i++) {
            var cloned = deepClone(clipboard[i]);
            reassignIds(cloned);
            r.node.children.push(cloned);
        }
        saveState();
        render();
        showToast(clipboard.length + '個のノードをペーストしました');
    } else {
        var cloned = deepClone(clipboard);
        reassignIds(cloned);
        r.node.children.push(cloned);
        saveState();
        render();
        selectNode(cloned.id);
        showToast('ペーストしました');
    }
    if (clipboardIsCut) {
        clipboard = null;
        clipboardIsCut = false;
    }
}

function selectAll() {
    var allNodes = getAllNodesInOrder();
    if (selectedNodeIds.size === allNodes.length) {
        clearSelection();
    } else {
        finishEditing();
        selectedNodeIds.clear();
        for (var i = 0; i < allNodes.length; i++) {
            selectedNodeIds.add(allNodes[i].id);
        }
        lastSelectedNodeId = allNodes[0] ? allNodes[0].id : null;
        updateSelectionDisplay();
    }
}

function filterTopLevelNodes(nodeIds) {
    var result = [];
    for (var i = 0; i < nodeIds.length; i++) {
        var nid = nodeIds[i];
        if (nid === 'root') continue;
        var hasAncestor = false;
        for (var j = 0; j < nodeIds.length; j++) {
            if (nodeIds[j] !== nid && isDescendant(nodeIds[j], nid)) {
                hasAncestor = true;
                break;
            }
        }
        if (!hasAncestor) result.push(nid);
    }
    return result;
}

function isDescendant(ancestorId, nodeId) {
    var r = findNode(ancestorId);
    if (!r) return false;
    function check(node) {
        for (var i = 0; i < node.children.length; i++) {
            if (node.children[i].id === nodeId) return true;
            if (check(node.children[i])) return true;
        }
        return false;
    }
    return check(r.node);
}

// ========================================
// Copy to Clipboard (Floating Button)
// ========================================

function getCurrentCopyText() {
    var format = document.getElementById('copyFormat').value;
    var border = document.getElementById('copyBorder').value;
    var useBorder = (border === 'border');
    return generateCopyText(mindMapData.root, 0, [], format, useBorder);
}

function copyToClipboard() {
    var text = getCurrentCopyText();

    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function() {
            showToast('✅ コピーしました');
        }).catch(function() {
            fallbackCopy(text);
        });
    } else {
        fallbackCopy(text);
    }
}

function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0;left:-9999px;';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch(e) {}
    document.body.removeChild(ta);
    showToast('✅ コピーしました');
}



function generateCopyText(node, level, parentContinues, format, useBorder) {
    // Skip grayed-out nodes and their descendants from copy
    if (level > 0 && isNodeGrayedOut(node.id)) return '';

    var result = '';
    var iconLevel = Math.min(level + 1, 4);
    var icons = levelIcons[format];
    var icon = icons ? (icons[iconLevel] + ' ') : '';

    // ---- Root (level 0) ----
    if (level === 0) {
        result = icon + node.text + '\n';
    } else {
        // Build the prefix from ancestor continuation info
        var prefix = '';
        for (var i = 0; i < level - 1; i++) {
            if (useBorder) {
                prefix += parentContinues[i] ? '│  ' : '   ';
            } else {
                prefix += '  ';
            }
        }
        // Connector for this node
        var isLast = (parentContinues[level - 1] === false);
        var connector;
        if (useBorder) {
            connector = isLast ? '└─ ' : '├─ ';
        } else {
            connector = '  ';
        }
        result = prefix + connector + icon + node.text + '\n';
    }

    // ---- Children (skip if node is collapsed OR grayed out) ----
    if (!isNodeCollapsed(node.id) && !isNodeGrayedOut(node.id)) {
        // Get visible children, excluding grayed-out ones and their descendants
        var visibleChildren = [];
        for (var ci = 0; ci < node.children.length; ci++) {
            if (!isNodeGrayedOut(node.children[ci].id)) {
                visibleChildren.push(node.children[ci]);
            }
        }
        for (var i = 0; i < visibleChildren.length; i++) {
            var isLastChild = (i === visibleChildren.length - 1);
            var newContinues = parentContinues.slice();
            newContinues.push(!isLastChild);
            result += generateCopyText(visibleChildren[i], level + 1, newContinues, format, useBorder);
        }

        // ---- Separator blank line between sibling groups (border mode only) ----
        if (useBorder && level > 0 && visibleChildren.length > 0) {
            var amILast = (parentContinues[level - 1] === false);
            if (!amILast) {
                var sep = '';
                for (var i = 0; i < level - 1; i++) {
                    sep += parentContinues[i] ? '│  ' : '   ';
                }
                sep += '│';
                result += sep + '\n';
            }
        }
    }
    return result;
}

