// ========================================
// History Management (Undo/Redo)
// ========================================

function saveState() {
    undoHistory = undoHistory.slice(0, undoIndex + 1);
    undoHistory.push({
        data: deepClone(mindMapData),
        grayout: deepClone(getNodeGrayoutState()),
        highlight: deepClone(getNodeHighlightState())
    });
    if (undoHistory.length > MAX_HISTORY) {
        undoHistory.shift();
    } else {
        undoIndex++;
    }
}

function resetMindMap() {
    // Function removed - no longer needed
}

function undo() {
    if (undoIndex > 0) {
        undoIndex--;
        var snapshot = undoHistory[undoIndex];
        mindMapData = deepClone(snapshot.data);
        setNodeGrayoutState(deepClone(snapshot.grayout || {}));
        setNodeHighlightState(deepClone(snapshot.highlight || {}));
        render();
        showToast('元に戻しました');
    }
}

function redo() {
    if (undoIndex < undoHistory.length - 1) {
        undoIndex++;
        var snapshot = undoHistory[undoIndex];
        mindMapData = deepClone(snapshot.data);
        setNodeGrayoutState(deepClone(snapshot.grayout || {}));
        setNodeHighlightState(deepClone(snapshot.highlight || {}));
        render();
        showToast('やり直しました');
    }
}

