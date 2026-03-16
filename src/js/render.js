// ========================================
// Rendering
// ========================================

function render() {
    var container = document.getElementById('canvasInner');
    var svg = document.getElementById('linesSvg');
    container.querySelectorAll('.node').forEach(function(n) { n.remove(); });
    svg.innerHTML = '';

    // Pass 1: Measure actual node dimensions by creating temporary elements
    var nodeDims = measureNodeDimensions(mindMapData.root, container);

    // Pass 2: Layout with actual dimensions
    var positions = {};
    layoutNodes(mindMapData.root, positions, 0, 0, 1, nodeDims);

    // Pass 3: Render nodes and lines
    renderNodes(mindMapData.root, container, positions);
    renderLines(mindMapData.root, svg, positions);
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
    for (var i = 0; i < visibleChildren.length; i++) {
        var ch = childHeights[i];
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

function renderNodes(node, container, positions) {
    var pos = positions[node.id];
    if (!pos) return;
    var el = document.createElement('div');
    el.className = 'node' + (node.id === 'root' ? ' root' : '') + (isNodeGrayedOut(node.id) ? ' grayed-out' : '') + (isNodeHighlighted(node.id) ? ' highlighted' : '');
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
                    for (var i = mn; i <= mx; i++) selectedNodeIds.add(allNodes[i].id);
                    lastSelectedNodeId = nodeData.id;
                    updateSelectionDisplay();
                }
            } else if (e.shiftKey) {
                finishEditing();
                rangeSelectNode(nodeData.id);
            } else if (cmdKey) {
                finishEditing();
                toggleSelectNode(nodeData.id);
            } else {
                // Normal click -> enter edit mode directly
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
    var collapsed = isNodeCollapsed(node.id);
    var visibleChildren = collapsed ? [] : node.children;
    for (var i = 0; i < visibleChildren.length; i++) {
        var child = visibleChildren[i];
        var cp = positions[child.id];
        if (!cp) continue;
        var sx = pp.x + pp.width + off, sy = pp.y + off;
        var ex = cp.x + off, ey = cp.y + off;
        var mx = sx + (ex - sx) / 2;
        var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', 'M ' + sx + ' ' + sy + ' C ' + mx + ' ' + sy + ', ' + mx + ' ' + ey + ', ' + ex + ' ' + ey);
        path.setAttribute('class', 'connection-line');
        svg.appendChild(path);
        renderLines(child, svg, positions);
    }
}

// ========================================
// View Controls
// ========================================

function updateView() {
    var inner = document.getElementById('canvasInner');
    inner.style.transform = 'translate(' + viewState.panX + 'px, ' + viewState.panY + 'px) scale(' + viewState.zoom + ')';
}

function resetView() {
    var container = document.getElementById('canvasContainer');
    viewState.zoom = 1;
    viewState.panX = container.clientWidth / 2 - 75;
    viewState.panY = container.clientHeight / 2;
    updateView();
}

