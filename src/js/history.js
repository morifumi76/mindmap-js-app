import {
    MAX_HISTORY,
    getNodeGrayoutState,
    getNodeHighlightState,
    isVerticalLayout,
    mindMapData,
    setMindMapData,
    setNodeGrayoutState,
    setNodeHighlightState,
    setUndoHistory,
    setUndoIndex,
    setVerticalLayout,
    undoHistory,
    undoIndex
} from './state.js';
import { deepClone, showToast } from './utils.js';
import { render } from './render.js';

// ========================================
// History Management (Undo/Redo)
// ========================================

export function saveState() {
    setUndoHistory(undoHistory.slice(0, undoIndex + 1));
    undoHistory.push({
        data: deepClone(mindMapData),
        grayout: deepClone(getNodeGrayoutState()),
        highlight: deepClone(getNodeHighlightState())
    });
    if (undoHistory.length > MAX_HISTORY) {
        undoHistory.shift();
    } else {
        setUndoIndex(undoIndex + 1);
    }
}

export function undo() {
    if (undoIndex > 0) {
        setUndoIndex(undoIndex - 1);
        var snapshot = undoHistory[undoIndex];
        // 縦表示モードはUndo/Redoの対象外：スナップショット復元後も現在の表示モードを維持する
        var keepVertical = isVerticalLayout();
        setMindMapData(deepClone(snapshot.data));
        setVerticalLayout(keepVertical);
        setNodeGrayoutState(deepClone(snapshot.grayout || {}));
        setNodeHighlightState(deepClone(snapshot.highlight || {}));
        render();
        showToast('元に戻しました');
    }
}

export function redo() {
    if (undoIndex < undoHistory.length - 1) {
        setUndoIndex(undoIndex + 1);
        var snapshot = undoHistory[undoIndex];
        // 縦表示モードはUndo/Redoの対象外：スナップショット復元後も現在の表示モードを維持する
        var keepVertical = isVerticalLayout();
        setMindMapData(deepClone(snapshot.data));
        setVerticalLayout(keepVertical);
        setNodeGrayoutState(deepClone(snapshot.grayout || {}));
        setNodeHighlightState(deepClone(snapshot.highlight || {}));
        render();
        showToast('やり直しました');
    }
}

