import {
    MAX_HISTORY,
    getNodeCyanState,
    getNodeGrayoutState,
    getNodeGreenState,
    getNodeHighlightState,
    getNodePinkState,
    getNodeRedTextState,
    isVerticalLayout,
    mindMapData,
    setMindMapData,
    setNodeCyanState,
    setNodeGrayoutState,
    setNodeGreenState,
    setNodeHighlightState,
    setNodePinkState,
    setNodeRedTextState,
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
    // 色状態は6色すべてを含める（漏れると Ctrl+Z でその色だけ戻らないバグになる）
    undoHistory.push({
        data: deepClone(mindMapData),
        grayout: deepClone(getNodeGrayoutState()),
        highlight: deepClone(getNodeHighlightState()),
        cyan: deepClone(getNodeCyanState()),
        green: deepClone(getNodeGreenState()),
        pink: deepClone(getNodePinkState()),
        redtext: deepClone(getNodeRedTextState())
    });
    if (undoHistory.length > MAX_HISTORY) {
        undoHistory.shift();
    } else {
        setUndoIndex(undoIndex + 1);
    }
    // 共同編集中: 直前の同期ツリーとの差分を操作イベントとして送信する
    // （クラウド版の collab-engine が window 経由で登録。ローカル版では未定義のため何もしない）
    if (window._collabEngine && window._collabEngine.isActive()) {
        window._collabEngine.onLocalSave();
    }
}

// スナップショットの内容を現在の状態へ書き戻す（undo / redo 共通）
function restoreSnapshot(snapshot) {
    // 縦表示モードはUndo/Redoの対象外：スナップショット復元後も現在の表示モードを維持する
    var keepVertical = isVerticalLayout();
    setMindMapData(deepClone(snapshot.data));
    setVerticalLayout(keepVertical);
    setNodeGrayoutState(deepClone(snapshot.grayout || {}));
    setNodeHighlightState(deepClone(snapshot.highlight || {}));
    setNodeCyanState(deepClone(snapshot.cyan || {}));
    setNodeGreenState(deepClone(snapshot.green || {}));
    setNodePinkState(deepClone(snapshot.pink || {}));
    setNodeRedTextState(deepClone(snapshot.redtext || {}));
    render();
}

export function undo() {
    // 共同編集中: スナップショット復元だと相手の操作まで巻き戻してしまうため、
    // 「自分の操作ログ＋逆操作」方式（collab-engine 側）に委譲する
    if (window._collabEngine && window._collabEngine.isActive()) {
        window._collabEngine.undo();
        return;
    }
    if (undoIndex > 0) {
        setUndoIndex(undoIndex - 1);
        restoreSnapshot(undoHistory[undoIndex]);
        showToast('元に戻しました');
    }
}

export function redo() {
    if (window._collabEngine && window._collabEngine.isActive()) {
        window._collabEngine.redo();
        return;
    }
    if (undoIndex < undoHistory.length - 1) {
        setUndoIndex(undoIndex + 1);
        restoreSnapshot(undoHistory[undoIndex]);
        showToast('やり直しました');
    }
}

