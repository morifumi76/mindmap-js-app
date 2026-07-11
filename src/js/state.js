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


// ========================================
// ノード装飾状態の共通ストア
// グレーアウト／ハイライト／水色／緑／赤文字／折りたたみは、いずれも
// 「{ ノードID: true } の辞書をマップ単位で localStorage に保存する」仕組み。
// 共有・共同編集モードでは localStorage を汚さず、メモリ上の共有データ
// (window._sharedData) を使う。その読み書きロジックをここに1本化する。
// ========================================
// opts.guestReadsShared:
//   true  … 読み取りは共同編集ゲストのときだけ共有データを使う（折りたたみ用。
//            閲覧専用の共有ビューでは見る人ごとの localStorage を使い、各自で開閉できる）
//   false … 読み取りは共有モード全般（閲覧専用・ゲスト共通）で共有データを使う
function makeDecorationStore(keyPrefix, sharedField, opts) {
    opts = opts || {};

    // ---- 読み取りキャッシュ（同一イベントサイクル内のみ有効） ----
    // render() は1回の描画で「ノード数 × 装飾数」回 get() を呼ぶため、そのたびに
    // localStorage の読み出し + JSON解析をするとマップが大きいほど二乗で遅くなる。
    // 解析結果を1イベントサイクルの間だけ保持し、サイクル終了時にマイクロタスクで
    // 自動破棄する。外部からの直接書き込み（クラウド初回読み込み等）は必ず別サイクル
    // で起きるため、古いキャッシュが残ることはない。同一サイクル内の set() は
    // キャッシュも同時に更新するので不整合にならない。
    var cached = null; // { mapId, data } または null
    var clearScheduled = false;
    function cacheAndScheduleClear(data) {
        cached = { mapId: currentMapId, data: data };
        if (clearScheduled) return;
        clearScheduled = true;
        Promise.resolve().then(function() {
            cached = null;
            clearScheduled = false;
        });
    }

    function get() {
        if (!currentMapId) return {};
        if (cached && cached.mapId === currentMapId) return cached.data;
        var data = readFresh();
        cacheAndScheduleClear(data);
        return data;
    }
    function readFresh() {
        if (opts.guestReadsShared) {
            if (window._collabGuest && window._sharedData) {
                return window._sharedData[sharedField] || {};
            }
        } else if (typeof isSharedReadonly === 'function' && isSharedReadonly()) {
            return (window._sharedData && window._sharedData[sharedField]) || {};
        }
        try {
            var raw = localStorage.getItem(keyPrefix + currentMapId);
            if (raw) return JSON.parse(raw);
        } catch(e) {}
        return {};
    }
    function set(state) {
        if (!currentMapId) return;
        cacheAndScheduleClear(state);
        // 共同編集ゲスト: メモリ上の共有データにだけ書く（localStorageを汚さない・同期はcollab-engine経由）
        if (window._collabGuest && window._sharedData) { window._sharedData[sharedField] = state; return; }
        if (typeof isSharedReadonly === 'function' && isSharedReadonly()) return;
        try { localStorage.setItem(keyPrefix + currentMapId, JSON.stringify(state)); } catch(e) {}
    }
    function is(nodeId) {
        return get()[nodeId] === true;
    }
    return { get: get, set: set, is: is };
}

var grayoutStore   = makeDecorationStore('mindmap-node-grayout-', '_grayout');
var highlightStore = makeDecorationStore('mindmap-node-highlight-', '_highlight');
var cyanStore      = makeDecorationStore('mindmap-node-cyan-', '_cyan');
var greenStore     = makeDecorationStore('mindmap-node-green-', '_green');
var redTextStore   = makeDecorationStore('mindmap-node-redtext-', '_redtext');
var collapseStore  = makeDecorationStore('mindmap-node-collapse-', '_collapse', { guestReadsShared: true });

// グレーアウトとハイライトは相互排他（片方を付けるともう片方は外れる）
function toggleExclusiveDecoration(store, otherStore, nodeId, onMsg, offMsg) {
    if (!nodeId) return;
    var state = store.get();
    if (state[nodeId]) {
        delete state[nodeId];
        store.set(state);
        showToast(offMsg);
    } else {
        var other = otherStore.get();
        if (other[nodeId]) {
            delete other[nodeId];
            otherStore.set(other);
        }
        state[nodeId] = true;
        store.set(state);
        showToast(onMsg);
    }
    render();
}

// Node grey-out state: { [nodeId]: true } - per map, saved in localStorage
export function getNodeGrayoutState() { return grayoutStore.get(); }
export function setNodeGrayoutState(state) { grayoutStore.set(state); }
export function isNodeGrayedOut(nodeId) { return grayoutStore.is(nodeId); }
export function toggleNodeGrayout(nodeId) {
    toggleExclusiveDecoration(grayoutStore, highlightStore, nodeId,
        'グレーアウトしました', 'グレーアウトを解除しました');
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

// Node highlight state: { [nodeId]: true } - per map, saved in localStorage
export function getNodeHighlightState() { return highlightStore.get(); }
export function setNodeHighlightState(state) { highlightStore.set(state); }
export function isNodeHighlighted(nodeId) { return highlightStore.is(nodeId); }
export function toggleNodeHighlight(nodeId) {
    toggleExclusiveDecoration(highlightStore, grayoutStore, nodeId,
        'ハイライトしました', 'ハイライトを解除しました');
}

// Node cyan state: { [nodeId]: true } - per map, saved in localStorage
export function getNodeCyanState() { return cyanStore.get(); }
export function setNodeCyanState(state) { cyanStore.set(state); }
export function isNodeCyan(nodeId) { return cyanStore.is(nodeId); }

// Node green state: { [nodeId]: true } - per map, saved in localStorage
export function getNodeGreenState() { return greenStore.get(); }
export function setNodeGreenState(state) { greenStore.set(state); }
export function isNodeGreen(nodeId) { return greenStore.is(nodeId); }

// Node red-text state: { [nodeId]: true } - per map, saved in localStorage
export function getNodeRedTextState() { return redTextStore.get(); }
export function setNodeRedTextState(state) { redTextStore.set(state); }
export function isNodeRedText(nodeId) { return redTextStore.is(nodeId); }

// ノードのハイパーリンク情報は node.hyperlink として mindMapData に保存される（Supabase/localStorageに自動同期）
function getNodeHyperlink(nodeId) {
    var r = findNode(nodeId);
    if (!r || !r.node) return null;
    return r.node.hyperlink || null;
}
export function isNodeLinked(nodeId) {
    return !!getNodeHyperlink(nodeId);
}

// Node collapse state: { [nodeId]: true } - per map, saved in localStorage
// （折りたたみは各自ローカル・同期対象外。ゲストのみメモリ上の共有データを使う）
export function getNodeCollapseState() { return collapseStore.get(); }
export function setNodeCollapseState(state) { collapseStore.set(state); }
export function isNodeCollapsed(nodeId) { return collapseStore.is(nodeId); }
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
    moved: false,
    origNodeId: null,       // ドラッグ開始時にこの端点が付いていたノード（つなぎ替え失敗時に戻す）
    origAnchor: null,       // ドラッグ開始時のアンカー（接続面）
    hoverTargetId: null,    // 今プレビューでつなぎ替え先にしているノード（別ノードに乗っているとき）
    hoverValid: false       // そのつなぎ替えが有効か（無効なら赤表示・ドロップで戻す）
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
// 縦表示モード（Vertical Layout）
// ルートを最上部に置き、子ノードを下へ展開する家系図型レイアウト。
// フラグはマップデータ本体（mindMapData.isVertical）に保存されるため、
// マップごとに保持され、共有先のユーザーにも同じモードで表示される。
// フラグを持たない既存マップは横レイアウト（false）として扱う。
// ========================================
export function isVerticalLayout() {
    return !!(mindMapData && mindMapData.isVertical === true);
}
export function setVerticalLayout(on) {
    if (!mindMapData) return;
    if (on) {
        mindMapData.isVertical = true;
    } else {
        // OFF時はフラグ自体を消し、既存マップのデータ形状を元のまま保つ
        delete mindMapData.isVertical;
    }
    syncVerticalModeUI();
}
export function syncVerticalModeUI() {
    // 高速モードと同じトグルボタンUI（ON/OFFスイッチ）に状態を反映する
    var on = isVerticalLayout();
    var toggleEl = document.getElementById('verticalModeToggle');
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
