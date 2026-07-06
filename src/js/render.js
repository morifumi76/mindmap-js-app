import {
    editingNodeId,
    isNodeCollapsed,
    isNodeCyan,
    isNodeGrayedOut,
    isNodeGreen,
    isNodeHighlighted,
    isNodeRedText,
    isVerticalLayout,
    lastSelectedNodeId,
    mindMapData,
    nodeDragState,
    selectedNodeIds,
    setLastRenderedPositions,
    setLastSelectedNodeId,
    syncVerticalModeUI,
    toggleNodeCollapse,
    viewState
} from './state.js';
import { saveToLocalStorage } from './storage.js';
import { getAllNodesInOrder } from './nodes.js';
import { rangeSelectNode, selectNode, toggleSelectNode, updateSelectionDisplay } from './selection.js';
import { finishEditing, startEditing } from './editing.js';
import { startNodeDrag } from './drag.js';
import { completeConnection, isConnectionModeActive, renderRelations } from './relations/index.js';
import { updateZoomDisplay } from './canvas-interaction.js';
import { renderSidebarTree } from './sidebar-right.js';

// ========================================
// Rendering
// ========================================

export function render() {
    var container = document.getElementById('canvasInner');
    var svg = document.getElementById('linesSvg');
    var endpointsSvg = document.getElementById('endpointsSvg');
    container.querySelectorAll('.node').forEach(function(n) { n.remove(); });
    svg.innerHTML = '';
    if (endpointsSvg) endpointsSvg.innerHTML = '';

    // 縦表示モード：折りたたみ●の位置などCSSで切り替えるためのクラスと、チェックボックス表示を同期
    var vertical = isVerticalLayout();
    var canvasContainer = document.getElementById('canvasContainer');
    if (canvasContainer) canvasContainer.classList.toggle('vertical-layout', vertical);
    syncVerticalModeUI();

    // Pass 1: Measure actual node dimensions by creating temporary elements
    var nodeDims = measureNodeDimensions(mindMapData.root, container);

    // Pass 2: Layout with actual dimensions
    var positions = {};
    if (vertical) {
        layoutNodesVertical(mindMapData.root, positions, 0, 0, 1, nodeDims);
    } else {
        layoutNodes(mindMapData.root, positions, 0, 0, 1, nodeDims);
    }

    // Pass 3: Render nodes and lines
    renderNodes(mindMapData.root, container, positions);
    renderLines(mindMapData.root, svg, positions);
    // 関連線（フリー接続）の描画。ノード追従はpositionsベースなので自動で追従する
    if (typeof renderRelations === 'function') {
        renderRelations(svg, positions);
    }
    // 直近の位置情報を関連線まわり（制御点ドラッグ等）から参照できるよう保存
    setLastRenderedPositions(positions);
    updateSelectionDisplay();
    updateView();
    // Auto-save to localStorage after every render (post-mutation state)
    saveToLocalStorage();
    // Update sidebar tree in real-time
    renderSidebarTree();
}

// Measure actual rendered width AND height of each node's text
function measureNodeDimensions(rootNode, container) {
    var dims = {};
    // Create a measurer that exactly mirrors the .node DOM structure
    var measurer = document.createElement('div');
    measurer.className = 'node';
    measurer.style.position = 'absolute';
    measurer.style.visibility = 'hidden';
    measurer.style.pointerEvents = 'none';
    // Don't set transform since we just need dimensions
    var measurerText = document.createElement('span');
    measurerText.className = 'node-text';
    measurer.appendChild(measurerText);
    container.appendChild(measurer);

    function measure(node) {
        // Render \n as <br> for accurate measurement
        if (node.text.indexOf('\n') >= 0) {
            measurerText.innerHTML = node.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
        } else {
            measurerText.textContent = node.text;
        }
        // Root nodes have larger font
        if (node.id === 'root') {
            measurer.classList.add('root');
        } else {
            measurer.classList.remove('root');
        }
        // Collapse indicator is now outside the node (absolute-positioned), no extra space needed
        dims[node.id] = { width: measurer.offsetWidth, height: measurer.offsetHeight };
        for (var i = 0; i < node.children.length; i++) {
            measure(node.children[i]);
        }
    }
    measure(rootNode);
    container.removeChild(measurer);
    return dims;
}

function layoutNodes(node, positions, x, y, level, nodeDims) {
    if (x === undefined) x = 0;
    if (y === undefined) y = 0;
    if (level === undefined) level = 1;
    var dims = (nodeDims && nodeDims[node.id]) ? nodeDims[node.id] : { width: 150, height: 40 };
    var nodeWidth = dims.width;
    var nodeHeight = dims.height;
    var hGap = 40, vGap = 16;
    var collapsed = isNodeCollapsed(node.id);
    var visibleChildren = collapsed ? [] : node.children;
    var totalH = 0, childHeights = [];
    for (var i = 0; i < visibleChildren.length; i++) {
        var ch = calcSubtreeHeight(visibleChildren[i], vGap, nodeDims);
        childHeights.push(ch);
        totalH += ch;
    }
    if (visibleChildren.length > 1) totalH += (visibleChildren.length - 1) * vGap;
    positions[node.id] = { x: x, y: y, width: nodeWidth, height: nodeHeight, level: level };
    var childX = x + nodeWidth + hGap;
    var childY = y - totalH / 2;
    for (i = 0; i < visibleChildren.length; i++) {
        ch = childHeights[i];
        var centerY = childY + ch / 2;
        layoutNodes(visibleChildren[i], positions, childX, centerY, level + 1, nodeDims);
        childY += ch + vGap;
    }
    return positions;
}

function calcSubtreeHeight(node, gap, nodeDims) {
    var dims = (nodeDims && nodeDims[node.id]) ? nodeDims[node.id] : { width: 150, height: 40 };
    var nodeHeight = dims.height;
    if (node.children.length === 0 || isNodeCollapsed(node.id)) return nodeHeight;
    var total = 0;
    for (var i = 0; i < node.children.length; i++) {
        total += calcSubtreeHeight(node.children[i], gap, nodeDims);
    }
    total += (node.children.length - 1) * gap;
    return Math.max(nodeHeight, total);
}

// 縦表示モードのレイアウト：横レイアウト（layoutNodes）の90度回転版。
// ルートを最上部に置き、子は1段下・兄弟は左右に並ぶ。親は子ノード群の水平中央の真上。
// 引数 cx はノードの水平中央、topY はノードの上端。
// positions に格納する座標形式（x=左端, y=上下中央）は横レイアウトと完全に同一なので、
// ドラッグ・関連線・投げ縄・ツリーナビ等の既存機能はそのまま動く。
function layoutNodesVertical(node, positions, cx, topY, level, nodeDims) {
    if (cx === undefined) cx = 0;
    if (topY === undefined) topY = 0;
    if (level === undefined) level = 1;
    var dims = (nodeDims && nodeDims[node.id]) ? nodeDims[node.id] : { width: 150, height: 40 };
    var nodeWidth = dims.width;
    var nodeHeight = dims.height;
    // 横レイアウトの hGap=40（親子間）/ vGap=16（兄弟間）を方向だけ入れ替えて同じ視覚的密度にする
    var levelGap = 40, siblingGap = 16;
    var collapsed = isNodeCollapsed(node.id);
    var visibleChildren = collapsed ? [] : node.children;
    var totalW = 0, childWidths = [];
    for (var i = 0; i < visibleChildren.length; i++) {
        var cw = calcSubtreeWidth(visibleChildren[i], siblingGap, nodeDims);
        childWidths.push(cw);
        totalW += cw;
    }
    if (visibleChildren.length > 1) totalW += (visibleChildren.length - 1) * siblingGap;
    positions[node.id] = { x: cx - nodeWidth / 2, y: topY + nodeHeight / 2, width: nodeWidth, height: nodeHeight, level: level };
    var childTopY = topY + nodeHeight + levelGap;
    var childX = cx - totalW / 2;
    for (i = 0; i < visibleChildren.length; i++) {
        cw = childWidths[i];
        var centerX = childX + cw / 2;
        layoutNodesVertical(visibleChildren[i], positions, centerX, childTopY, level + 1, nodeDims);
        childX += cw + siblingGap;
    }
    return positions;
}

// 部分木（subtree）の必要幅を再帰計算する。calcSubtreeHeight の縦横対称版。
// ノード幅はテキスト長で可変なので、これで兄弟間・いとこ間の重なりを防ぐ。
function calcSubtreeWidth(node, gap, nodeDims) {
    var dims = (nodeDims && nodeDims[node.id]) ? nodeDims[node.id] : { width: 150, height: 40 };
    var nodeWidth = dims.width;
    if (node.children.length === 0 || isNodeCollapsed(node.id)) return nodeWidth;
    var total = 0;
    for (var i = 0; i < node.children.length; i++) {
        total += calcSubtreeWidth(node.children[i], gap, nodeDims);
    }
    total += (node.children.length - 1) * gap;
    return Math.max(nodeWidth, total);
}

function renderNodes(node, container, positions) {
    var pos = positions[node.id];
    if (!pos) return;
    var el = document.createElement('div');
    el.className = 'node' + (node.id === 'root' ? ' root' : '') + (isNodeGrayedOut(node.id) ? ' grayed-out' : '') + (isNodeHighlighted(node.id) ? ' highlighted' : '') + (isNodeGreen(node.id) ? ' green-hl' : '') + (isNodeCyan(node.id) ? ' cyan-hl' : '') + (isNodeRedText(node.id) ? ' red-text' : '') + (node.hyperlink && node.hyperlink.url ? ' has-link' : '');
    el.dataset.id = node.id;
    el.style.left = pos.x + 'px';
    el.style.top = pos.y + 'px';
    el.style.width = pos.width + 'px';
    el.style.transform = 'translateY(-50%)';
    var textEl = document.createElement('span');
    textEl.className = 'node-text';
    // Render \n as <br> for display
    if (node.text.indexOf('\n') >= 0) {
        textEl.innerHTML = node.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
    } else {
        textEl.textContent = node.text;
    }
    el.appendChild(textEl);

    // Collapse indicator (shown only when collapsed) and junction hit area
    // Both are absolute-positioned at the right edge of the node (connection junction)
    if (node.id !== 'root' && node.children.length > 0) {
        if (isNodeCollapsed(node.id)) {
            // Show collapse indicator dot when collapsed
            var collapseIndicator = document.createElement('span');
            collapseIndicator.className = 'node-collapse-indicator';
            collapseIndicator.title = '展開 (Cmd+.)';
            collapseIndicator.addEventListener('click', function(e) {
                e.stopPropagation();
                toggleNodeCollapse(node.id);
            });
            el.appendChild(collapseIndicator);
        }

        // Always add a hit area at the junction for click-to-toggle
        var hitArea = document.createElement('span');
        hitArea.className = 'node-junction-hitarea';
        hitArea.title = isNodeCollapsed(node.id) ? '展開 (Cmd+.)' : '折りたたむ (Cmd+.)';
        hitArea.addEventListener('click', function(e) {
            e.stopPropagation();
            toggleNodeCollapse(node.id);
        });
        el.appendChild(hitArea);
    }

    // Use a closure to capture node reference
    (function(nodeData, nodeElement) {

        // Click handler: default to editing mode
        nodeElement.addEventListener('click', function(e) {
            e.stopPropagation();

            // If a drag just occurred, suppress click
            if (nodeDragState.didDrag) {
                nodeDragState.didDrag = false;
                return;
            }

            // 接続待機モード中：クリックされたノードを接続先として確定
            if (typeof isConnectionModeActive === 'function' && isConnectionModeActive()) {
                completeConnection(nodeData.id);
                return;
            }

            var isMac = /Mac/.test(navigator.platform);
            var cmdKey = isMac ? e.metaKey : e.ctrlKey;

            if (cmdKey && e.shiftKey) {
                finishEditing();
                var allNodes = getAllNodesInOrder();
                var si = -1, ei = -1;
                for (var i = 0; i < allNodes.length; i++) {
                    if (allNodes[i].id === lastSelectedNodeId) si = i;
                    if (allNodes[i].id === nodeData.id) ei = i;
                }
                if (si !== -1 && ei !== -1) {
                    var mn = Math.min(si, ei), mx = Math.max(si, ei);
                    for (i = mn; i <= mx; i++) selectedNodeIds.add(allNodes[i].id);
                    setLastSelectedNodeId(nodeData.id);
                    updateSelectionDisplay();
                }
            } else if (e.shiftKey) {
                finishEditing();
                rangeSelectNode(nodeData.id);
            } else if (cmdKey) {
                // リンク設定済みノードではCmd+クリックで編集モードへ（URL発火させずに編集）
                if (nodeData.hyperlink && nodeData.hyperlink.url) {
                    finishEditing();
                    selectNode(nodeData.id);
                    startEditing(nodeData.id);
                } else {
                    finishEditing();
                    toggleSelectNode(nodeData.id);
                }
            } else {
                // Normal click: リンクありなら新タブで開く、なければ編集モード
                if (nodeData.hyperlink && nodeData.hyperlink.url) {
                    finishEditing();
                    selectNode(nodeData.id);
                    window.open(nodeData.hyperlink.url, '_blank', 'noopener,noreferrer');
                    return;
                }
                if (editingNodeId === nodeData.id) return;
                finishEditing();
                selectNode(nodeData.id);
                startEditing(nodeData.id);
            }
        });

        // Double-click: enter edit mode (for when already selected but not editing)
        nodeElement.addEventListener('dblclick', function(e) {
            e.stopPropagation();
            startEditing(nodeData.id);
        });

        // Mousedown: start potential drag (only left button, no modifiers, not editing)
        nodeElement.addEventListener('mousedown', function(e) {
            if (e.button !== 0) return;
            if (editingNodeId) return;
            if (e.metaKey || e.ctrlKey || e.shiftKey) return;
            // 接続待機モード中はドラッグせず、クリック側で接続確定を処理する
            if (typeof isConnectionModeActive === 'function' && isConnectionModeActive()) {
                e.preventDefault();
                e.stopPropagation();
                return;
            }
            e.preventDefault();
            e.stopPropagation();
            startNodeDrag(nodeData.id, e.clientX, e.clientY, nodeElement);
        });

    })(node, el);

    container.appendChild(el);
    var collapsed = isNodeCollapsed(node.id);
    var visibleChildren = collapsed ? [] : node.children;
    for (var i = 0; i < visibleChildren.length; i++) {
        renderNodes(visibleChildren[i], container, positions);
    }
}

function renderLines(node, svg, positions) {
    var pp = positions[node.id];
    if (!pp) return;
    var off = 5000;
    var vertical = isVerticalLayout();
    var collapsed = isNodeCollapsed(node.id);
    var visibleChildren = collapsed ? [] : node.children;
    for (var i = 0; i < visibleChildren.length; i++) {
        var child = visibleChildren[i];
        var cp = positions[child.id];
        if (!cp) continue;
        var sx, sy, ex, ey, d;
        if (vertical) {
            // 縦表示：親の下辺中央 → 子の上辺中央（positions の y は上下中央なので高さの半分で辺に変換）
            sx = pp.x + pp.width / 2 + off; sy = pp.y + pp.height / 2 + off;
            ex = cp.x + cp.width / 2 + off; ey = cp.y - cp.height / 2 + off;
            var my = sy + (ey - sy) / 2;
            d = 'M ' + sx + ' ' + sy + ' C ' + sx + ' ' + my + ', ' + ex + ' ' + my + ', ' + ex + ' ' + ey;
        } else {
            // 横表示：親の右辺中央 → 子の左辺中央（従来どおり）
            sx = pp.x + pp.width + off; sy = pp.y + off;
            ex = cp.x + off; ey = cp.y + off;
            var mx = sx + (ex - sx) / 2;
            d = 'M ' + sx + ' ' + sy + ' C ' + mx + ' ' + sy + ', ' + mx + ' ' + ey + ', ' + ex + ' ' + ey;
        }
        var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', d);
        path.setAttribute('class', 'connection-line');
        svg.appendChild(path);
        renderLines(child, svg, positions);
    }
}

// ========================================
// View Controls
// ========================================

export function updateView() {
    var inner = document.getElementById('canvasInner');
    inner.style.transform = 'translate(' + viewState.panX + 'px, ' + viewState.panY + 'px) scale(' + viewState.zoom + ')';
    if (typeof updateZoomDisplay === 'function') updateZoomDisplay();
}

export function resetView() {
    var container = document.getElementById('canvasContainer');
    viewState.zoom = 1;
    if (isVerticalLayout()) {
        // 縦表示：ルート（水平中央 x=0・上端 y=0）を上部中央に置き、ツリーが下へ見渡せる状態にする
        viewState.panX = container.clientWidth / 2;
        viewState.panY = 100;
    } else {
        viewState.panX = container.clientWidth / 2 - 75;
        viewState.panY = container.clientHeight / 2;
    }
    updateView();
}

