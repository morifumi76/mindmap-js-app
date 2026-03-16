// ========================================
// Node Operations
// ========================================

function findNode(id, node, parent, index) {
    if (node === undefined) node = mindMapData.root;
    if (parent === undefined) parent = null;
    if (index === undefined) index = 0;
    if (node.id === id) return { node: node, parent: parent, index: index };
    for (var i = 0; i < node.children.length; i++) {
        var result = findNode(id, node.children[i], node, i);
        if (result) return result;
    }
    return null;
}

function getNodeLevel(id, node, level) {
    if (node === undefined) node = mindMapData.root;
    if (level === undefined) level = 1;
    if (node.id === id) return level;
    for (var i = 0; i < node.children.length; i++) {
        var result = getNodeLevel(id, node.children[i], level + 1);
        if (result) return result;
    }
    return null;
}

function getAllNodesInOrder(node, result) {
    if (node === undefined) node = mindMapData.root;
    if (result === undefined) result = [];
    result.push(node);
    for (var i = 0; i < node.children.length; i++) {
        getAllNodesInOrder(node.children[i], result);
    }
    return result;
}

// Get only visible nodes (respecting collapse state)
function getVisibleNodesInOrder(node, result) {
    if (node === undefined) node = mindMapData.root;
    if (result === undefined) result = [];
    result.push(node);
    if (!isNodeCollapsed(node.id)) {
        for (var i = 0; i < node.children.length; i++) {
            getVisibleNodesInOrder(node.children[i], result);
        }
    }
    return result;
}

function addChildNode(parentId, text, autoEdit) {
    if (text === undefined) text = '新しいノード';
    if (autoEdit === undefined) autoEdit = true;
    var result = findNode(parentId);
    if (!result) return null;
    var newNode = { id: generateId(), text: text, children: [] };
    result.node.children.push(newNode);
    saveState();
    render();
    selectNode(newNode.id);
    if (autoEdit) {
        setTimeout(function() { startEditing(newNode.id); }, 50);
    }
    return newNode;
}

function addSiblingNode(nodeId, text, autoEdit) {
    if (text === undefined) text = '新しいノード';
    if (autoEdit === undefined) autoEdit = true;
    var result = findNode(nodeId);
    if (!result || !result.parent) {
        return addChildNode(nodeId, text, autoEdit);
    }
    var newNode = { id: generateId(), text: text, children: [] };
    result.parent.children.splice(result.index + 1, 0, newNode);
    saveState();
    render();
    selectNode(newNode.id);
    if (autoEdit) {
        setTimeout(function() { startEditing(newNode.id); }, 50);
    }
    return newNode;
}

function deleteNode(nodeId) {
    if (nodeId === 'root') {
        showToast('ルートノードは削除できません');
        return false;
    }
    var result = findNode(nodeId);
    if (!result || !result.parent) return false;
    result.parent.children.splice(result.index, 1);
    saveState();
    if (result.parent.children.length > 0) {
        var idx = Math.min(result.index, result.parent.children.length - 1);
        selectNode(result.parent.children[idx].id);
    } else {
        selectNode(result.parent.id);
    }
    render();
    return true;
}

function deleteSelectedNodes() {
    if (selectedNodeIds.size === 0) return;
    var ids = [];
    selectedNodeIds.forEach(function(id) { if (id !== 'root') ids.push(id); });
    if (ids.length === 0) {
        showToast('ルートノードは削除できません');
        return;
    }
    var filtered = filterTopLevelNodes(ids);
    var lastParent = null;
    for (var i = 0; i < filtered.length; i++) {
        var r = findNode(filtered[i]);
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
    showToast(filtered.length + '個のノードを削除しました');
}

function updateNodeText(nodeId, newText) {
    var result = findNode(nodeId);
    if (result && result.node.text !== newText) {
        result.node.text = newText;
        saveState();
    }
}

function moveNodeUp(nodeId) {
    var result = findNode(nodeId);
    if (result && result.parent && result.index > 0) {
        var s = result.parent.children;
        var tmp = s[result.index - 1];
        s[result.index - 1] = s[result.index];
        s[result.index] = tmp;
        saveState();
        render();
    }
}

function moveNodeDown(nodeId) {
    var result = findNode(nodeId);
    if (result && result.parent && result.index < result.parent.children.length - 1) {
        var s = result.parent.children;
        var tmp = s[result.index];
        s[result.index] = s[result.index + 1];
        s[result.index + 1] = tmp;
        saveState();
        render();
    }
}

function promoteNode(nodeId) {
    var result = findNode(nodeId);
    if (!result || !result.parent || result.parent.id === 'root') return;
    var gpResult = findNode(result.parent.id);
    if (gpResult && gpResult.parent) {
        result.parent.children.splice(result.index, 1);
        gpResult.parent.children.splice(gpResult.index + 1, 0, result.node);
        saveState();
        render();
        selectNode(nodeId);
    }
}

function demoteNode(nodeId) {
    var result = findNode(nodeId);
    if (!result || !result.parent || result.index === 0) return;
    var prevSibling = result.parent.children[result.index - 1];
    result.parent.children.splice(result.index, 1);
    prevSibling.children.push(result.node);
    saveState();
    render();
    selectNode(nodeId);
}

