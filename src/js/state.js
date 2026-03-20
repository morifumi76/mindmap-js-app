// ========================================
// Global State
// ========================================

const levelIcons = {
    hiyoko: { 1: '🐔', 2: '🐤', 3: '🐣', 4: '🥚' }
    // family mode removed
};

let mindMapData = {
    root: {
        id: 'root',
        text: '中心テーマ',
        children: []
    }
};

let currentMapId = null; // Currently active map ID

let selectedNodeIds = new Set();
let lastSelectedNodeId = null;
let selectionAnchorId = null; // Anchor node for Shift+Arrow range selection
let editingNodeId = null;

let viewState = {
    zoom: 1,
    panX: 0,
    panY: 0,
    isPanning: false,
    startX: 0,
    startY: 0
};

let undoHistory = [];
let undoIndex = -1;
const MAX_HISTORY = 50;

let clipboard = null;
let clipboardIsCut = false;

let nodeIdCounter = 0;

// Node collapse state: { [nodeId]: true/false } - per map, saved in localStorage
var NODE_COLLAPSE_KEY_PREFIX = 'mindmap-node-collapse-';

// Node grey-out state: { [nodeId]: true/false } - per map, saved in localStorage
var NODE_GRAYOUT_KEY_PREFIX = 'mindmap-node-grayout-';
function getNodeGrayoutState() {
    if (!currentMapId) return {};
    try {
        var raw = localStorage.getItem(NODE_GRAYOUT_KEY_PREFIX + currentMapId);
        if (raw) return JSON.parse(raw);
    } catch(e) {}
    return {};
}
function setNodeGrayoutState(state) {
    if (!currentMapId) return;
    try { localStorage.setItem(NODE_GRAYOUT_KEY_PREFIX + currentMapId, JSON.stringify(state)); } catch(e) {}
}
function isNodeGrayedOut(nodeId) {
    var state = getNodeGrayoutState();
    return state[nodeId] === true;
}
function toggleNodeGrayout(nodeId) {
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
function isDescendantOfGrayedOut(nodeId) {
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
function isNodeOrAncestorGrayedOut(nodeId) {
    return isNodeGrayedOut(nodeId) || isDescendantOfGrayedOut(nodeId);
}

// Node highlight state: { [nodeId]: true/false } - per map, saved in localStorage
var NODE_HIGHLIGHT_KEY_PREFIX = 'mindmap-node-highlight-';
function getNodeHighlightState() {
    if (!currentMapId) return {};
    try {
        var raw = localStorage.getItem(NODE_HIGHLIGHT_KEY_PREFIX + currentMapId);
        if (raw) return JSON.parse(raw);
    } catch(e) {}
    return {};
}
function setNodeHighlightState(state) {
    if (!currentMapId) return;
    try { localStorage.setItem(NODE_HIGHLIGHT_KEY_PREFIX + currentMapId, JSON.stringify(state)); } catch(e) {}
}
function isNodeHighlighted(nodeId) {
    var state = getNodeHighlightState();
    return state[nodeId] === true;
}
function toggleNodeHighlight(nodeId) {
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
function getNodeCollapseState() {
    if (!currentMapId) return {};
    try {
        var raw = localStorage.getItem(NODE_COLLAPSE_KEY_PREFIX + currentMapId);
        if (raw) return JSON.parse(raw);
    } catch(e) {}
    return {};
}
function setNodeCollapseState(state) {
    if (!currentMapId) return;
    try { localStorage.setItem(NODE_COLLAPSE_KEY_PREFIX + currentMapId, JSON.stringify(state)); } catch(e) {}
}
function isNodeCollapsed(nodeId) {
    var state = getNodeCollapseState();
    return state[nodeId] === true;
}
function toggleNodeCollapse(nodeId) {
    if (nodeId === 'root') return; // root cannot be collapsed
    var node = findNode(nodeId);
    if (!node || !node.node.children || node.node.children.length === 0) return; // only nodes with children
    var state = getNodeCollapseState();
    state[nodeId] = !state[nodeId];
    setNodeCollapseState(state);
    render();
}
function expandAllNodes() {
    setNodeCollapseState({});
    render();
    showToast('すべてのノードを展開しました');
}

function collapseAllNodes() {
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
let nodeDragState = {
    isDragging: false,
    didDrag: false,
    nodeId: null,
    draggedNodeIds: null,
    targetNodeId: null,
    targetPosition: null
};

// Lasso selection state
let lassoState = {
    active: false,
    didSelect: false,
    startX: 0,
    startY: 0,
    currentX: 0,
    currentY: 0
};

// Context menu state
let ctxMenuTargetMapId = null;

