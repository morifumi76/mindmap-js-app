import {
    editingNodeId,
    isNodeCollapsed,
    isNodeCyan,
    isNodeGrayedOut,
    isNodeGreen,
    isNodeHighlighted,
    isNodePink,
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
import { escapeHtmlWithBreaks } from './utils.js';
import { getAllNodesInOrder } from './nodes.js';
import { rangeSelectNode, selectNode, toggleSelectNode, updateSelectionDisplay } from './selection.js';
import { finishEditing, startEditing } from './editing.js';
import { startNodeDrag } from './drag.js';
import { completeConnection, isConnectionModeActive, renderRelations } from './relations/index.js';
import { SVG_OFFSET } from './relations/geometry.js';
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

// ノード寸法のキャッシュ。「同じテキスト・同じ種類（ルートか否か）なら大きさは同じ」
// なので、一度測った寸法を使い回してブラウザへの問い合わせ（強制レイアウト計算）を省く。
// 装飾クラス（グレーアウト等）は色のみで寸法に影響しないことを確認済み。
// Webフォントの読み込み完了で文字の実測幅が変わりうるため、その時点で全消しして測り直す。
var nodeDimsCache = new Map();
var NODE_DIMS_CACHE_MAX = 5000; // 念のための上限（超えたら全消しでリセット）
if (document.fonts && document.fonts.ready && document.fonts.ready.then) {
    document.fonts.ready.then(function() { nodeDimsCache.clear(); });
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
        // キャッシュ照会（キー = ルートか否か + テキスト。\x00 は区切り文字）
        var isRoot = (node.id === 'root');
        var cacheKey = (isRoot ? 'R\x00' : 'N\x00') + node.text;
        var cachedDims = nodeDimsCache.get(cacheKey);
        if (cachedDims) {
            dims[node.id] = cachedDims;
        } else {
            // Render \n as <br> for accurate measurement
            if (node.text.indexOf('\n') >= 0) {
                measurerText.innerHTML = escapeHtmlWithBreaks(node.text);
            } else {
                measurerText.textContent = node.text;
            }
            // Root nodes have larger font
            if (isRoot) {
                measurer.classList.add('root');
            } else {
                measurer.classList.remove('root');
            }
            // Collapse indicator is now outside the node (absolute-positioned), no extra space needed
            var measured = { width: measurer.offsetWidth, height: measurer.offsetHeight };
            dims[node.id] = measured;
            if (nodeDimsCache.size >= NODE_DIMS_CACHE_MAX) nodeDimsCache.clear();
            nodeDimsCache.set(cacheKey, measured);
        }
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

// 縦表示モードのレイアウト：Reingold-Tilford の考え方に基づく2パスの下から上方式。
// パス1（buildVerticalSubtree）で末端から部分木を相対座標で組み立て、
// 「親のX中心 = 左端の子の中心と右端の子の中心の中間点」に置く（組織図の配置ルール）。
// パス2（placeVerticalSubtree）で相対座標を絶対座標へ変換して positions に書き込む。
// positions に格納する座標形式（x=左端, y=上下中央）は横レイアウトと完全に同一なので、
// ドラッグ・関連線・投げ縄・ツリーナビ・接続線等の既存機能はそのまま動く。
function layoutNodesVertical(node, positions, cx, topY, level, nodeDims) {
    if (cx === undefined) cx = 0;
    if (topY === undefined) topY = 0;
    if (level === undefined) level = 1;
    // 横レイアウトの hGap=40（親子間）/ vGap=16（兄弟間）を方向だけ入れ替えて同じ視覚的密度にする
    var levelGap = 40, siblingGap = 16;
    var layout = buildVerticalSubtree(node, nodeDims, siblingGap);
    // 引数 cx はルートノードの水平中央なので、部分木の左端に読み替えて配置する
    placeVerticalSubtree(layout, positions, cx - layout.nodeCenter, topY, level, nodeDims, levelGap);
    return positions;
}

// パス1: 部分木を「左端=0」の相対座標で組み立てる（post-order＝末端から上へ）。
// 返り値: { node, width: 部分木の全幅, nodeCenter: このノードの中心X（相対）,
//           childLayouts: 子の相対レイアウト, childOffsets: 各子部分木の左端X（相対） }
function buildVerticalSubtree(node, nodeDims, siblingGap) {
    var dims = (nodeDims && nodeDims[node.id]) ? nodeDims[node.id] : { width: 150, height: 40 };
    var nodeWidth = dims.width;
    var visibleChildren = isNodeCollapsed(node.id) ? [] : node.children;
    if (visibleChildren.length === 0) {
        return { node: node, width: nodeWidth, nodeCenter: nodeWidth / 2, childLayouts: [], childOffsets: [] };
    }

    // 子の部分木をバウンディング幅＋一定間隔で左から詰めて並べる（枝同士は重ならない）
    var childLayouts = [];
    var childOffsets = [];
    var cursor = 0;
    for (var i = 0; i < visibleChildren.length; i++) {
        var cl = buildVerticalSubtree(visibleChildren[i], nodeDims, siblingGap);
        if (i > 0) cursor += siblingGap;
        childOffsets.push(cursor);
        childLayouts.push(cl);
        cursor += cl.width;
    }

    // 親の中心 = 左端の子の中心と右端の子の中心の中間点（子が1つならその真上）
    var firstCenter = childOffsets[0] + childLayouts[0].nodeCenter;
    var lastCenter = childOffsets[childOffsets.length - 1] + childLayouts[childLayouts.length - 1].nodeCenter;
    var nodeCenter = (firstCenter + lastCenter) / 2;

    // 親ノード自身が子の並びからはみ出す場合（親が幅広い等）は、はみ出し分も
    // 部分木の幅に含めて、隣の枝（いとこ）との重なりを防ぐ
    var left = Math.min(0, nodeCenter - nodeWidth / 2);
    var right = Math.max(cursor, nodeCenter + nodeWidth / 2);
    if (left < 0) {
        // 左へのはみ出し分だけ全体を右にずらし、相対座標の左端を0に保つ
        var shift = -left;
        nodeCenter += shift;
        for (i = 0; i < childOffsets.length; i++) childOffsets[i] += shift;
    }
    return { node: node, width: right - left, nodeCenter: nodeCenter, childLayouts: childLayouts, childOffsets: childOffsets };
}

// パス2: 相対レイアウトを絶対座標へ変換して positions に書き込む
function placeVerticalSubtree(layout, positions, leftX, topY, level, nodeDims, levelGap) {
    var node = layout.node;
    var dims = (nodeDims && nodeDims[node.id]) ? nodeDims[node.id] : { width: 150, height: 40 };
    positions[node.id] = {
        x: leftX + layout.nodeCenter - dims.width / 2,
        y: topY + dims.height / 2,
        width: dims.width,
        height: dims.height,
        level: level
    };
    var childTopY = topY + dims.height + levelGap;
    for (var i = 0; i < layout.childLayouts.length; i++) {
        placeVerticalSubtree(layout.childLayouts[i], positions, leftX + layout.childOffsets[i], childTopY, level + 1, nodeDims, levelGap);
    }
}

function renderNodes(node, container, positions) {
    var pos = positions[node.id];
    if (!pos) return;
    var el = document.createElement('div');
    el.className = 'node' + (node.id === 'root' ? ' root' : '') + (isNodeGrayedOut(node.id) ? ' grayed-out' : '') + (isNodeHighlighted(node.id) ? ' highlighted' : '') + (isNodeGreen(node.id) ? ' green-hl' : '') + (isNodeCyan(node.id) ? ' cyan-hl' : '') + (isNodePink(node.id) ? ' pink-hl' : '') + (isNodeRedText(node.id) ? ' red-text' : '') + (node.hyperlink && node.hyperlink.url ? ' has-link' : '');
    el.dataset.id = node.id;
    el.style.left = pos.x + 'px';
    el.style.top = pos.y + 'px';
    el.style.width = pos.width + 'px';
    el.style.transform = 'translateY(-50%)';
    var textEl = document.createElement('span');
    textEl.className = 'node-text';
    // Render \n as <br> for display
    if (node.text.indexOf('\n') >= 0) {
        textEl.innerHTML = escapeHtmlWithBreaks(node.text);
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
    var off = SVG_OFFSET;
    var vertical = isVerticalLayout();
    var collapsed = isNodeCollapsed(node.id);
    var visibleChildren = collapsed ? [] : node.children;

    // 縦表示：兄弟への水平線を同じ高さに揃えるため、親ごとにバスの高さを先に決める。
    // 親の下辺と「最も高い位置にある子の上辺」の中間（子の高さがバラバラでも全兄弟で共通）
    var busY = 0;
    if (vertical && visibleChildren.length > 0) {
        var parentBottom = pp.y + pp.height / 2;
        var minChildTop = Infinity;
        for (var k = 0; k < visibleChildren.length; k++) {
            var kp = positions[visibleChildren[k].id];
            if (kp && kp.y - kp.height / 2 < minChildTop) minChildTop = kp.y - kp.height / 2;
        }
        busY = (parentBottom + minChildTop) / 2 + off;
    }

    for (var i = 0; i < visibleChildren.length; i++) {
        var child = visibleChildren[i];
        var cp = positions[child.id];
        if (!cp) continue;
        var sx, sy, ex, ey, d;
        if (vertical) {
            // 縦表示：組織図風の直交線。親の下辺中央から真下→バスの高さで水平→子の上辺中央へ真下。
            // 親からの縦線は全兄弟で同じ座標に重なるため、見た目は1本の幹から分岐する形になる
            sx = pp.x + pp.width / 2 + off; sy = pp.y + pp.height / 2 + off;
            ex = cp.x + cp.width / 2 + off; ey = cp.y - cp.height / 2 + off;
            d = 'M ' + sx + ' ' + sy + ' L ' + sx + ' ' + busY + ' L ' + ex + ' ' + busY + ' L ' + ex + ' ' + ey;
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

