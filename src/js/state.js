import { showToast } from './utils.js';
import { isSharedReadonly } from './storage.js';
import { findNode } from './nodes.js';
import { render } from './render.js';

// ========================================
// Global State
// ========================================

export const levelIcons = {
    hiyoko: { 1: '🐔', 2: '🐤', 3: '🐣', 4: '🥚' }
    // family mode removed
};

export let mindMapData = {
    root: {
        id: 'root',
        text: '中心テーマ',
        children: []
    }
};

export let currentMapId = null; // Currently active map ID

export let selectedNodeIds = new Set();
export let lastSelectedNodeId = null;
export let selectionAnchorId = null; // Anchor node for Shift+Arrow range selection
export let editingNodeId = null;

export let viewState = {
    zoom: 1,
    panX: 0,
    panY: 0,
    isPanning: false,
    startX: 0,
    startY: 0
};

export let undoHistory = [];
export let undoIndex = -1;
export const MAX_HISTORY = 50;


// Node collapse state: { [nodeId]: true/false } - per map, saved in localStorage
var NODE_COLLAPSE_KEY_PREFIX = 'mindmap-node-collapse-';

// Node grey-out state: { [nodeId]: true/false } - per map, saved in localStorage
var NODE_GRAYOUT_KEY_PREFIX = 'mindmap-node-grayout-';
export function getNodeGrayoutState() {
    if (!currentMapId) return {};
    // 共有モード: 埋め込まれた _grayout から取得（localStorage は触らない）
    if (typeof isSharedReadonly === 'function' && isSharedReadonly()) {
        return (window._sharedData && window._sharedData._grayout) || {};
    }
    try {
        var raw = localStorage.getItem(NODE_GRAYOUT_KEY_PREFIX + currentMapId);
        if (raw) return JSON.parse(raw);
    } catch(e) {}
    return {};
}
export function setNodeGrayoutState(state) {
    if (!currentMapId) return;
    if (typeof isSharedReadonly === 'function' && isSharedReadonly()) return;
    try { localStorage.setItem(NODE_GRAYOUT_KEY_PREFIX + currentMapId, JSON.stringify(state)); } catch(e) {}
}
export function isNodeGrayedOut(nodeId) {
    var state = getNodeGrayoutState();
    return state[nodeId] === true;
}
export function toggleNodeGrayout(nodeId) {
    if (!nodeId) return;
    var grayState = getNodeGrayoutState();
    if (grayState[nodeId]) {
        // Already grayed out → remove grayout
        delete grayState[nodeId];
        setNodeGrayoutState(grayState);
        showToast('グレーアウトを解除しました');
    } else {
        // Applying grayout → remove highlight if present (mutual exclusion)
        var hlState = getNodeHighlightState();
        if (hlState[nodeId]) {
            delete hlState[nodeId];
            setNodeHighlightState(hlState);
        }
        grayState[nodeId] = true;
        setNodeGrayoutState(grayState);
        showToast('グレーアウトしました');
    }
    render();
}
// Check if a node is a descendant of any grayed-out node
export function isDescendantOfGrayedOut(nodeId) {
    // Walk up the tree from nodeId, check if any ancestor is grayed out
    var result = findNode(nodeId);
    if (!result) return false;
    var parentResult = result.parent;
    while (parentResult) {
        if (isNodeGrayedOut(parentResult.id)) return true;
        var pr = findNode(parentResult.id);
        parentResult = pr ? pr.parent : null;
    }
    return false;
}
// Check if a node or any of its ancestors is grayed out
export function isNodeOrAncestorGrayedOut(nodeId) {
    return isNodeGrayedOut(nodeId) || isDescendantOfGrayedOut(nodeId);
}

// Node highlight state: { [nodeId]: true/false } - per map, saved in localStorage
var NODE_HIGHLIGHT_KEY_PREFIX = 'mindmap-node-highlight-';
export function getNodeHighlightState() {
    if (!currentMapId) return {};
    if (typeof isSharedReadonly === 'function' && isSharedReadonly()) {
        return (window._sharedData && window._sharedData._highlight) || {};
    }
    try {
        var raw = localStorage.getItem(NODE_HIGHLIGHT_KEY_PREFIX + currentMapId);
        if (raw) return JSON.parse(raw);
    } catch(e) {}
    return {};
}
export function setNodeHighlightState(state) {
    if (!currentMapId) return;
    if (typeof isSharedReadonly === 'function' && isSharedReadonly()) return;
    try { localStorage.setItem(NODE_HIGHLIGHT_KEY_PREFIX + currentMapId, JSON.stringify(state)); } catch(e) {}
}
export function isNodeHighlighted(nodeId) {
    var state = getNodeHighlightState();
    return state[nodeId] === true;
}
export function toggleNodeHighlight(nodeId) {
    if (!nodeId) return;
    var hlState = getNodeHighlightState();
    if (hlState[nodeId]) {
        // Already highlighted → remove highlight
        delete hlState[nodeId];
        setNodeHighlightState(hlState);
        showToast('ハイライトを解除しました');
    } else {
        // Applying highlight → remove grayout if present (mutual exclusion)
        var grayState = getNodeGrayoutState();
        if (grayState[nodeId]) {
            delete grayState[nodeId];
            setNodeGrayoutState(grayState);
        }
        hlState[nodeId] = true;
        setNodeHighlightState(hlState);
        showToast('ハイライトしました');
    }
    render();
}
// Node cyan state: { [nodeId]: true } - per map, saved in localStorage
var NODE_CYAN_KEY_PREFIX = 'mindmap-node-cyan-';
export function getNodeCyanState() {
    if (!currentMapId) return {};
    if (typeof isSharedReadonly === 'function' && isSharedReadonly()) {
        return (window._sharedData && window._sharedData._cyan) || {};
    }
    try {
        var raw = localStorage.getItem(NODE_CYAN_KEY_PREFIX + currentMapId);
        if (raw) return JSON.parse(raw);
    } catch(e) {}
    return {};
}
export function setNodeCyanState(state) {
    if (!currentMapId) return;
    if (typeof isSharedReadonly === 'function' && isSharedReadonly()) return;
    try { localStorage.setItem(NODE_CYAN_KEY_PREFIX + currentMapId, JSON.stringify(state)); } catch(e) {}
}
export function isNodeCyan(nodeId) {
    var state = getNodeCyanState();
    return state[nodeId] === true;
}

// Node green state: { [nodeId]: true } - per map, saved in localStorage
var NODE_GREEN_KEY_PREFIX = 'mindmap-node-green-';
export function getNodeGreenState() {
    if (!currentMapId) return {};
    if (typeof isSharedReadonly === 'function' && isSharedReadonly()) {
        return (window._sharedData && window._sharedData._green) || {};
    }
    try {
        var raw = localStorage.getItem(NODE_GREEN_KEY_PREFIX + currentMapId);
        if (raw) return JSON.parse(raw);
    } catch(e) {}
    return {};
}
export function setNodeGreenState(state) {
    if (!currentMapId) return;
    if (typeof isSharedReadonly === 'function' && isSharedReadonly()) return;
    try { localStorage.setItem(NODE_GREEN_KEY_PREFIX + currentMapId, JSON.stringify(state)); } catch(e) {}
}
export function isNodeGreen(nodeId) {
    var state = getNodeGreenState();
    return state[nodeId] === true;
}

// Node red-text state: { [nodeId]: true } - per map, saved in localStorage
var NODE_REDTEXT_KEY_PREFIX = 'mindmap-node-redtext-';
export function getNodeRedTextState() {
    if (!currentMapId) return {};
    if (typeof isSharedReadonly === 'function' && isSharedReadonly()) {
        return (window._sharedData && window._sharedData._redtext) || {};
    }
    try {
        var raw = localStorage.getItem(NODE_REDTEXT_KEY_PREFIX + currentMapId);
        if (raw) return JSON.parse(raw);
    } catch(e) {}
    return {};
}
export function setNodeRedTextState(state) {
    if (!currentMapId) return;
    if (typeof isSharedReadonly === 'function' && isSharedReadonly()) return;
    try { localStorage.setItem(NODE_REDTEXT_KEY_PREFIX + currentMapId, JSON.stringify(state)); } catch(e) {}
}
export function isNodeRedText(nodeId) {
    var state = getNodeRedTextState();
    return state[nodeId] === true;
}

// ノードのハイパーリンク情報は node.hyperlink として mindMapData に保存される（Supabase/localStorageに自動同期）
function getNodeHyperlink(nodeId) {
    var r = findNode(nodeId);
    if (!r || !r.node) return null;
    return r.node.hyperlink || null;
}
function setNodeHyperlink(nodeId, link) {
    var r = findNode(nodeId);
    if (!r || !r.node) return;
    if (link && link.url) {
        r.node.hyperlink = {
            url: link.url,
            displayText: link.displayText || r.node.text
        };
    } else {
        delete r.node.hyperlink;
    }
}
export function isNodeLinked(nodeId) {
    return !!getNodeHyperlink(nodeId);
}

export function getNodeCollapseState() {
    if (!currentMapId) return {};
    try {
        var raw = localStorage.getItem(NODE_COLLAPSE_KEY_PREFIX + currentMapId);
        if (raw) return JSON.parse(raw);
    } catch(e) {}
    return {};
}
export function setNodeCollapseState(state) {
    if (!currentMapId) return;
    if (typeof isSharedReadonly === 'function' && isSharedReadonly()) return;
    try { localStorage.setItem(NODE_COLLAPSE_KEY_PREFIX + currentMapId, JSON.stringify(state)); } catch(e) {}
}
export function isNodeCollapsed(nodeId) {
    var state = getNodeCollapseState();
    return state[nodeId] === true;
}
export function toggleNodeCollapse(nodeId) {
    if (nodeId === 'root') return; // root cannot be collapsed
    var node = findNode(nodeId);
    if (!node || !node.node.children || node.node.children.length === 0) return; // only nodes with children
    var state = getNodeCollapseState();
    state[nodeId] = !state[nodeId];
    setNodeCollapseState(state);
    render();
}
export function expandAllNodes() {
    setNodeCollapseState({});
    render();
    showToast('すべてのノードを展開しました');
}

export function collapseAllNodes() {
    var state = {};
    function collectCollapsible(node) {
        if (node.id !== 'root' && node.children && node.children.length > 0) {
            state[node.id] = true;
        }
        if (node.children) {
            for (var i = 0; i < node.children.length; i++) {
                collectCollapsible(node.children[i]);
            }
        }
    }
    if (mindMapData && mindMapData.root) {
        collectCollapsible(mindMapData.root);
    }
    setNodeCollapseState(state);
    render();
    showToast('すべてのノードを折りたたみました');
}

// Drag reparenting state
export let nodeDragState = {
    isDragging: false,
    didDrag: false,
    isDuplicating: false,
    nodeId: null,
    draggedNodeIds: null,
    targetNodeId: null,
    targetPosition: null
};

// Lasso selection state
export let lassoState = {
    active: false,
    didSelect: false,
    startX: 0,
    startY: 0,
    currentX: 0,
    currentY: 0
};

// Context menu state
export let ctxMenuTargetMapId = null;

// ノード間関連線（フリー接続）の状態管理
// connectionMode: 接続待機モード中かどうか・元ノード・現在のマウス位置（プレビュー用）
export let connectionMode = {
    active: false,
    fromNodeId: null,
    mouseCanvasX: 0,
    mouseCanvasY: 0
};
// 現在選択中の関連線ID（最大1本）
export let selectedRelationId = null;
// 関連線ドラッグ状態（点線本体・制御点どちらをつかんでも使う）
// active=true でmousedown済み、moved=true で実際に閾値以上動いた（曲線として確定）
export let relationCtrlDragState = {
    active: false,
    relationId: null,
    startClientX: 0,
    startClientY: 0,
    moved: false
};

// 関連線の端点ドラッグ状態（端点ポチをつかんで上下左右4スナップで動かす）
export let relationEndpointDragState = {
    active: false,
    relationId: null,
    side: null,             // 'from' | 'to'
    startClientX: 0,
    startClientY: 0,
    moved: false
};

// 手動ダブルクリック判定（render()でDOMが入れ替わることがあるため、ブラウザのdblclickイベントに頼らない）
export let lastRelationClickInfo = { time: 0, relId: null };

// シングルクリック→メモ入力欄の表示遅延タイマー（ダブルクリック検出と競合しないよう280ms後に起動）
// 直近renderでのノード位置（関連線描画やドラッグで参照する）
export let lastRenderedPositions = null;

// ========================================
// 高速モード（Fast Mode）
// Enter 連打で次のノードを自動作成する上級者向けキー操作モード。
// localStorage で永続化し、デフォルトは OFF（既存挙動）。
// ========================================
var FAST_MODE_STORAGE_KEY = 'mindmap.fastMode';
export function getFastMode() {
    try {
        return localStorage.getItem(FAST_MODE_STORAGE_KEY) === 'true';
    } catch (e) { return false; }
}
export function setFastMode(enabled) {
    try {
        localStorage.setItem(FAST_MODE_STORAGE_KEY, enabled ? 'true' : 'false');
    } catch (e) {}
    syncFastModeToggleUI();
}
export function syncFastModeToggleUI() {
    var on = getFastMode();
    var toggleEl = document.getElementById('fastModeToggle');
    if (toggleEl) {
        toggleEl.setAttribute('aria-checked', on ? 'true' : 'false');
        toggleEl.classList.toggle('on', on);
    }
}


// ========================================
// モジュール間 setter
// ESモジュールの import 束縛は読み取り専用のため、他モジュールからの
// 再代入はこの setter を経由する（読み取りは import した束縛をそのまま使える）
// ========================================
export function setMindMapData(v) { mindMapData = v; }
export function setCurrentMapId(v) { currentMapId = v; }
export function setEditingNodeId(v) { editingNodeId = v; }
export function setLastSelectedNodeId(v) { lastSelectedNodeId = v; }
export function setSelectionAnchorId(v) { selectionAnchorId = v; }
export function setSelectedRelationId(v) { selectedRelationId = v; }
export function setCtxMenuTargetMapId(v) { ctxMenuTargetMapId = v; }
export function setLastRenderedPositions(v) { lastRenderedPositions = v; }
export function setUndoHistory(v) { undoHistory = v; }
export function setUndoIndex(v) { undoIndex = v; }
