// ========================================
// Node Drag & Drop (Reparenting)
// ========================================

function startNodeDrag(nodeId, clientX, clientY, nodeEl) {
    if (nodeId === 'root') return;
    var startTime = Date.now();
    nodeDragState.didDrag = false;

    function onMouseMove(e) {
        var moved = Math.abs(e.clientX - clientX) > 5 || Math.abs(e.clientY - clientY) > 5;
        var elapsed = Date.now() - startTime;
        if (moved && elapsed > 150 && !nodeDragState.isDragging) {
            nodeDragState.isDragging = true;
            nodeDragState.didDrag = true;
            nodeDragState.nodeId = nodeId;
            if (selectedNodeIds.has(nodeId) && selectedNodeIds.size > 1) {
                var ids = [];
                selectedNodeIds.forEach(function(id) { if (id !== 'root') ids.push(id); });
                nodeDragState.draggedNodeIds = ids;
            } else {
                nodeDragState.draggedNodeIds = [nodeId];
            }
            createDragGhost(nodeEl, e.clientX, e.clientY, nodeDragState.draggedNodeIds.length);
            nodeDragState.draggedNodeIds.forEach(function(id) {
                var el = document.querySelector('[data-id="' + id + '"]');
                if (el) el.classList.add('dragging');
            });
        }
        if (nodeDragState.isDragging) {
            updateNodeDrag(e.clientX, e.clientY);
        }
    }

    function onMouseUp(e) {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        if (nodeDragState.isDragging) {
            endNodeDrag();
        }
    }

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
}

function createDragGhost(nodeEl, clientX, clientY, count) {
    var existing = document.querySelector('.drag-ghost');
    if (existing) existing.remove();
    var ghost = nodeEl.cloneNode(true);
    ghost.classList.add('drag-ghost');
    ghost.classList.remove('selected', 'dragging');
    ghost.style.left = clientX + 'px';
    ghost.style.top = clientY + 'px';
    ghost.style.transform = 'translate(-50%, -50%)';
    ghost.style.position = 'fixed';
    ghost.style.width = nodeEl.offsetWidth + 'px';
    if (count > 1) {
        var badge = document.createElement('span');
        badge.style.cssText = 'position:absolute;top:-8px;right:-8px;background:#e53935;color:white;border-radius:50%;width:24px;height:24px;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:bold;';
        badge.textContent = count;
        ghost.appendChild(badge);
    }
    document.body.appendChild(ghost);
}

function updateNodeDrag(clientX, clientY) {
    if (!nodeDragState.isDragging) return;
    var ghost = document.querySelector('.drag-ghost');
    if (ghost) { ghost.style.left = clientX + 'px'; ghost.style.top = clientY + 'px'; }
    document.querySelectorAll('.node').forEach(function(el) {
        el.classList.remove('drag-over-child', 'drag-over-before', 'drag-over-after');
    });
    var target = getDropTarget(clientX, clientY);
    nodeDragState.targetNodeId = target ? target.nodeId : null;
    nodeDragState.targetPosition = target ? target.position : null;
    if (target) {
        var tEl = document.querySelector('[data-id="' + target.nodeId + '"]');
        if (tEl) tEl.classList.add('drag-over-' + target.position);
    }
}

function getDropTarget(clientX, clientY) {
    var elements = document.elementsFromPoint(clientX, clientY);
    var draggedIds = nodeDragState.draggedNodeIds || [nodeDragState.nodeId];
    for (var i = 0; i < elements.length; i++) {
        var el = elements[i];
        if (!el.classList.contains('node') || el.classList.contains('drag-ghost')) continue;
        var tid = el.dataset.id;
        if (draggedIds.indexOf(tid) >= 0) continue;
        var isDesc = false;
        for (var j = 0; j < draggedIds.length; j++) {
            if (isDescendant(draggedIds[j], tid)) { isDesc = true; break; }
        }
        if (isDesc) continue;
        var rect = el.getBoundingClientRect();
        var relY = clientY - rect.top;
        var h = rect.height;
        if (tid === 'root') return { nodeId: tid, position: 'child' };
        if (relY < h * 0.25) return { nodeId: tid, position: 'before' };
        if (relY > h * 0.75) return { nodeId: tid, position: 'after' };
        return { nodeId: tid, position: 'child' };
    }
    return null;
}

function endNodeDrag() {
    if (!nodeDragState.isDragging) return;
    var ghost = document.querySelector('.drag-ghost');
    if (ghost) ghost.remove();
    document.querySelectorAll('.node').forEach(function(el) {
        el.classList.remove('dragging', 'drag-over-child', 'drag-over-before', 'drag-over-after');
    });
    if (nodeDragState.targetNodeId && nodeDragState.targetPosition) {
        moveNodes(
            nodeDragState.draggedNodeIds || [nodeDragState.nodeId],
            nodeDragState.targetNodeId,
            nodeDragState.targetPosition
        );
    }
    nodeDragState.isDragging = false;
    nodeDragState.nodeId = null;
    nodeDragState.draggedNodeIds = null;
    nodeDragState.targetNodeId = null;
    nodeDragState.targetPosition = null;
    render();
}

function moveNodes(nodeIds, targetId, position) {
    if (!nodeIds || nodeIds.length === 0) return;
    var targetResult = findNode(targetId);
    if (!targetResult) return;
    var filtered = filterTopLevelNodes(nodeIds);
    if (filtered.length === 0) return;
    var nodesToMove = [];
    for (var i = 0; i < filtered.length; i++) {
        var nr = findNode(filtered[i]);
        if (nr && nr.parent) nodesToMove.push({ id: filtered[i], data: nr.node, parent: nr.parent, index: nr.index });
    }
    nodesToMove.sort(function(a, b) { return a.parent === b.parent ? b.index - a.index : 0; });
    for (var i = 0; i < nodesToMove.length; i++) {
        var cur = findNode(nodesToMove[i].id);
        if (cur && cur.parent) cur.parent.children.splice(cur.index, 1);
    }
    nodesToMove.reverse();
    if (position === 'child') {
        for (var i = 0; i < nodesToMove.length; i++) {
            var tr = findNode(targetId);
            if (tr) tr.node.children.push(nodesToMove[i].data);
        }
    } else if (position === 'before') {
        for (var i = 0; i < nodesToMove.length; i++) {
            var tr = findNode(targetId);
            if (tr && tr.parent) tr.parent.children.splice(tr.index, 0, nodesToMove[i].data);
        }
    } else if (position === 'after') {
        nodesToMove.reverse();
        for (var i = 0; i < nodesToMove.length; i++) {
            var tr = findNode(targetId);
            if (tr && tr.parent) tr.parent.children.splice(tr.index + 1, 0, nodesToMove[i].data);
        }
    }
    saveState();
    selectedNodeIds.clear();
    for (var i = 0; i < nodesToMove.length; i++) selectedNodeIds.add(nodesToMove[i].id);
    lastSelectedNodeId = nodesToMove[0] ? nodesToMove[0].id : null;
}

