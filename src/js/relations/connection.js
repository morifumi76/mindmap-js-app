// 関連線: 接続モード（ノード間を線で結ぶ操作）
import { finishEditing } from '../editing.js';
import { saveState } from '../history.js';
import { render } from '../render.js';
import { getSelectedNodeId } from '../selection.js';
import { connectionMode, lastRenderedPositions, selectedRelationId } from '../state.js';
import { showToast } from '../utils.js';
import { renderConnectionPreview } from './draw.js';
import { addRelation } from './model.js';
import { deleteSelectedRelationWithConfirm } from './selection.js';

// ========================================
// 接続待機モード制御
// ========================================
function startConnectionMode(fromNodeId) {
    if (!fromNodeId) return;
    if (typeof finishEditing === 'function') finishEditing();
    connectionMode.active = true;
    connectionMode.fromNodeId = fromNodeId;
    document.body.classList.add('connection-mode');
    var btn = document.getElementById('connectFloatBtn');
    if (btn) btn.classList.add('active');
    // プレビュー描画のために再描画
    render();
}

export function cancelConnectionMode() {
    if (!connectionMode.active) return;
    connectionMode.active = false;
    connectionMode.fromNodeId = null;
    document.body.classList.remove('connection-mode');
    var btn = document.getElementById('connectFloatBtn');
    if (btn) btn.classList.remove('active');
    render();
}

export function isConnectionModeActive() {
    return !!(connectionMode && connectionMode.active);
}

// 接続先ノードへ接続を確定する
export function completeConnection(toNodeId) {
    var fromId = connectionMode.fromNodeId;
    if (!fromId || !toNodeId) {
        cancelConnectionMode();
        return;
    }
    if (fromId === toNodeId) {
        // 同じノードクリックは無効（待機モードを継続）
        return;
    }
    addRelation(fromId, toNodeId);
    saveState();
    cancelConnectionMode();
    showToast('関連線を追加しました');
}

// 接続ボタンが押されたときの分岐処理
export function handleConnectButtonClick() {
    // 関連線が選択されている → 削除確認ダイアログ
    if (selectedRelationId) {
        deleteSelectedRelationWithConfirm();
        return;
    }
    // 既に待機モード中 → キャンセル
    if (connectionMode.active) {
        cancelConnectionMode();
        return;
    }
    // ノードが選択されている → 接続待機モードへ
    var nid = getSelectedNodeId();
    if (!nid) {
        showToast('先にノードを選択してください');
        return;
    }
    startConnectionMode(nid);
}

// プレビュー線だけを差分更新する（mousemove時のパフォーマンス向上）
export function updateConnectionPreviewOnly() {
    var svg = document.getElementById('linesSvg');
    if (!svg) return;
    var existing = svg.querySelector('.relation-line.preview');
    if (existing) existing.parentNode.removeChild(existing);
    if (!lastRenderedPositions) return;
    renderConnectionPreview(svg, lastRenderedPositions);
}
