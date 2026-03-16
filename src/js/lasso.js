// ========================================
// Lasso (Rectangle) Selection
// ========================================

function startLasso(clientX, clientY) {
    lassoState.active = true;
    lassoState.didSelect = false;
    lassoState.startX = clientX;
    lassoState.startY = clientY;
    lassoState.currentX = clientX;
    lassoState.currentY = clientY;
    var rect = document.getElementById('lassoRect');
    rect.style.display = 'block';
    rect.style.left = clientX + 'px';
    rect.style.top = clientY + 'px';
    rect.style.width = '0px';
    rect.style.height = '0px';
}

function updateLasso(clientX, clientY) {
    if (!lassoState.active) return;
    lassoState.currentX = clientX;
    lassoState.currentY = clientY;
    var x = Math.min(lassoState.startX, clientX);
    var y = Math.min(lassoState.startY, clientY);
    var w = Math.abs(clientX - lassoState.startX);
    var h = Math.abs(clientY - lassoState.startY);
    var rect = document.getElementById('lassoRect');
    rect.style.left = x + 'px';
    rect.style.top = y + 'px';
    rect.style.width = w + 'px';
    rect.style.height = h + 'px';
}

function endLasso() {
    if (!lassoState.active) return;
    lassoState.active = false;
    var rect = document.getElementById('lassoRect');
    rect.style.display = 'none';

    var x1 = Math.min(lassoState.startX, lassoState.currentX);
    var y1 = Math.min(lassoState.startY, lassoState.currentY);
    var x2 = Math.max(lassoState.startX, lassoState.currentX);
    var y2 = Math.max(lassoState.startY, lassoState.currentY);

    // Require minimum size to avoid treating clicks as lasso
    if (Math.abs(x2 - x1) < 8 && Math.abs(y2 - y1) < 8) return;

    clearSelection();
    document.querySelectorAll('.node').forEach(function(el) {
        var r = el.getBoundingClientRect();
        var cx = r.left + r.width / 2;
        var cy = r.top + r.height / 2;
        if (cx >= x1 && cx <= x2 && cy >= y1 && cy <= y2) {
            selectedNodeIds.add(el.dataset.id);
        }
    });
    if (selectedNodeIds.size > 0) {
        lastSelectedNodeId = selectedNodeIds.values().next().value;
        updateSelectionDisplay();
        lassoState.didSelect = true;
        showToast(selectedNodeIds.size + '個のノードを選択しました');
    }
}

