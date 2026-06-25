import { isNodeCollapsed, mindMapData, selectedNodeIds } from './state.js';
import { generateId, showToast } from './utils.js';
import { saveState } from './history.js';
import { selectNode } from './selection.js';
import { startEditing } from './editing.js';
import { filterTopLevelNodes } from './clipboard.js';
import { render } from './render.js';
import { removeRelationsForNode } from './relations/index.js';

// ========================================
// Node Operations
// ========================================

export function findNode(id, node, parent, index) {
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

export function getNodeLevel(id, node, level) {
    if (node === undefined) node = mindMapData.root;
    if (level === undefined) level = 1;
    if (node.id === id) return level;
    for (var i = 0; i < node.children.length; i++) {
        var result = getNodeLevel(id, node.children[i], level + 1);
        if (result) return result;
    }
    return null;
}

export function getAllNodesInOrder(node, result) {
    if (node === undefined) node = mindMapData.root;
    if (result === undefined) result = [];
    result.push(node);
    for (var i = 0; i < node.children.length; i++) {
        getAllNodesInOrder(node.children[i], result);
    }
    return result;
}

// Get only visible nodes (respecting collapse state)
export function getVisibleNodesInOrder(node, result) {
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

export function addChildNode(parentId, text, autoEdit) {
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

export function addSiblingNode(nodeId, text, autoEdit, insertBefore) {
    if (text === undefined) text = '新しいノード';
    if (autoEdit === undefined) autoEdit = true;
    if (insertBefore === undefined) insertBefore = false;
    var result = findNode(nodeId);
    if (!result || !result.parent) {
        return addChildNode(nodeId, text, autoEdit);
    }
    var newNode = { id: generateId(), text: text, children: [] };
    // insertBefore が true なら基準ノードの上（同じindex位置）、それ以外は下（index+1）
    var insertIndex = insertBefore ? result.index : result.index + 1;
    result.parent.children.splice(insertIndex, 0, newNode);
    saveState();
    render();
    selectNode(newNode.id);
    if (autoEdit) {
        setTimeout(function() { startEditing(newNode.id); }, 50);
    }
    return newNode;
}

export function deleteNode(nodeId) {
    if (nodeId === 'root') {
        showToast('ルートノードは削除できません');
        return false;
    }
    var result = findNode(nodeId);
    if (!result || !result.parent) return false;
    // 削除されるノードと、その全子孫の関連線を一緒に削除する
    if (typeof removeRelationsForNode === 'function') {
        var idsToCleanup = [];
        (function collectIds(n) {
            idsToCleanup.push(n.id);
            if (n.children) for (var i = 0; i < n.children.length; i++) collectIds(n.children[i]);
        })(result.node);
        for (var k = 0; k < idsToCleanup.length; k++) {
            removeRelationsForNode(idsToCleanup[k]);
        }
    }
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

export function deleteSelectedNodes() {
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
            // 削除対象ノード＋子孫の関連線を一緒に削除
            if (typeof removeRelationsForNode === 'function') {
                var ids2 = [];
                (function collectIds2(n) {
                    ids2.push(n.id);
                    if (n.children) for (var k = 0; k < n.children.length; k++) collectIds2(n.children[k]);
                })(r.node);
                for (var ki = 0; ki < ids2.length; ki++) {
                    removeRelationsForNode(ids2[ki]);
                }
            }
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

export function updateNodeText(nodeId, newText) {
    var result = findNode(nodeId);
    if (result && result.node.text !== newText) {
        result.node.text = newText;
        saveState();
    }
}

// 現在の選択（複数可、root除外）を集め、全て同じ親に属していれば
// { parent, indices(昇順), nodes(昇順) } を返す。選択が無ければ fallback（現在ノード）を使う。
// 親が異なる／見つからない場合は null（＝安全のため何もしない）。
function getSameParentSelection(fallbackNodeId) {
    var ids = [];
    selectedNodeIds.forEach(function(id) { if (id !== 'root') ids.push(id); });
    if (ids.length === 0 && fallbackNodeId && fallbackNodeId !== 'root') ids.push(fallbackNodeId);
    if (ids.length === 0) return null;

    var parent = null;
    var items = [];
    for (var i = 0; i < ids.length; i++) {
        var r = findNode(ids[i]);
        if (!r || !r.parent) return null;        // root などは対象外
        if (parent === null) parent = r.parent;
        else if (r.parent !== parent) return null; // 親が異なる → 中止
        items.push({ index: r.index, node: r.node });
    }
    items.sort(function(a, b) { return a.index - b.index; });
    return {
        parent: parent,
        indices: items.map(function(it) { return it.index; }),
        nodes: items.map(function(it) { return it.node; })
    };
}

// 選択（複数可）を1つ上/下へまとめて並び替える。相対順序は保つ。子はノードごと一緒に動く。
// dir: -1 = 上へ, +1 = 下へ
function moveSelection(dir, fallbackNodeId) {
    var sel = getSameParentSelection(fallbackNodeId);
    if (!sel) return;
    var s = sel.parent.children;
    var indices = sel.indices;

    if (dir < 0) {
        if (indices[0] <= 0) return; // 先頭が一番上なら動かさない
        for (var u = 0; u < indices.length; u++) {
            var iu = indices[u];
            var tmpU = s[iu - 1]; s[iu - 1] = s[iu]; s[iu] = tmpU;
        }
    } else {
        if (indices[indices.length - 1] >= s.length - 1) return; // 末尾が一番下なら動かさない
        for (var d = indices.length - 1; d >= 0; d--) {
            var idn = indices[d];
            var tmpD = s[idn + 1]; s[idn + 1] = s[idn]; s[idn] = tmpD;
        }
    }
    saveState();
    render();
}

export function moveSelectionUp(fallbackNodeId) { moveSelection(-1, fallbackNodeId); }
export function moveSelectionDown(fallbackNodeId) { moveSelection(1, fallbackNodeId); }

// 選択（複数可）を1階層下げて、隣の兄弟の子にする。相対順序は保つ。
// 入れる相手は「すぐ上の兄弟」を優先し、選択が一番上で上の兄弟がいない場合は
// 「すぐ下の兄弟」に入れる（見た目で隣にあるノードの子に入る、という直感に合わせる）。
export function demoteSelection(fallbackNodeId) {
    var sel = getSameParentSelection(fallbackNodeId);
    if (!sel) return;
    var parent = sel.parent, indices = sel.indices, nodes = sel.nodes;
    var firstIdx = indices[0];
    var lastIdx = indices[indices.length - 1];
    // 上の隣を優先、なければ下の隣を新しい親にする
    var target = null;
    if (firstIdx > 0) target = parent.children[firstIdx - 1];
    else if (lastIdx < parent.children.length - 1) target = parent.children[lastIdx + 1];
    if (!target) return;                           // 上にも下にも兄弟がいない（全選択など）
    if (selectedNodeIds.has(target.id)) return;    // 念のため（飛び選択の保険）
    // 親から取り除く（添字がずれないよう後ろから）
    for (var k = indices.length - 1; k >= 0; k--) parent.children.splice(indices[k], 1);
    // 隣の兄弟の子として、既存の子の後ろに順番どおり追加
    for (var m = 0; m < nodes.length; m++) target.children.push(nodes[m]);
    saveState();
    render();
}

// 選択（複数可）を1階層上げる（親の弟＝祖父母の子にする）。相対順序は保つ。
export function promoteSelection(fallbackNodeId) {
    var sel = getSameParentSelection(fallbackNodeId);
    if (!sel) return;
    var parent = sel.parent, indices = sel.indices, nodes = sel.nodes;
    if (parent.id === 'root') return;              // 最上位はこれ以上上げられない
    var gp = findNode(parent.id);
    if (!gp || !gp.parent) return;
    // 親から取り除く（後ろから）
    for (var k = indices.length - 1; k >= 0; k--) parent.children.splice(indices[k], 1);
    // 祖父母の中で「親の直後」に順番どおり差し込む
    var insertAt = gp.index + 1;
    for (var m = 0; m < nodes.length; m++) gp.parent.children.splice(insertAt + m, 0, nodes[m]);
    saveState();
    render();
}

