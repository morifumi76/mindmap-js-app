// 関連線: 選択と削除
import { saveState } from '../history.js';
import { updateLinkButtonState } from '../link-modal.js';
import { render } from '../render.js';
import {
    selectedNodeIds,
    selectedRelationId,
    setLastSelectedNodeId,
    setSelectedRelationId,
    setSelectionAnchorId
} from '../state.js';
import { showToast } from '../utils.js';
import { removeRelationById } from './model.js';

// ========================================
// 関連線の選択・削除
// ========================================
export function selectRelation(relationId) {
    if (selectedRelationId === relationId) return; // 既に選択中なら何もしない（DOMを変更しない）
    setSelectedRelationId(relationId);
    // ノード選択は解除する（相互排他）
    selectedNodeIds.clear();
    setLastSelectedNodeId(null);
    setSelectionAnchorId(null);
    document.querySelectorAll('.node.selected').forEach(function(el) {
        el.classList.remove('selected');
    });
    if (typeof updateLinkButtonState === 'function') updateLinkButtonState();
    // render() は呼ばず、SVG内のクラス・制御点だけ差分更新
    updateRelationVisualSelection();
}

// 関連線の選択状態（.selected クラス）だけをDOMに反映する。
// render() でSVGパスを破棄せず、要素のIDが変わらないため、ブラウザのクリック判定が継続して動く。
export function updateRelationVisualSelection() {
    var svg = document.getElementById('linesSvg');
    if (!svg) return;
    // 関連線本体の .selected クラスを更新（linesSvg 内）
    var lines = svg.querySelectorAll('.relation-line');
    for (var j = 0; j < lines.length; j++) {
        var rid = lines[j].getAttribute('data-rel-id');
        if (rid && rid === selectedRelationId) {
            lines[j].classList.add('selected');
        } else {
            lines[j].classList.remove('selected');
        }
    }
    // 端点ドット（.relation-endpoint）の選択ハイライト — endpointsSvg にあるので document 全体から取得
    var endpoints = document.querySelectorAll('.relation-endpoint');
    for (var k = 0; k < endpoints.length; k++) {
        var rid2 = endpoints[k].getAttribute('data-rel-id');
        if (rid2 && rid2 === selectedRelationId) {
            endpoints[k].classList.add('selected');
        } else {
            endpoints[k].classList.remove('selected');
        }
    }
}

export function deleteSelectedRelationWithConfirm() {
    if (!selectedRelationId) return;
    if (!confirm('この関連線を削除しますか？')) return;
    deleteSelectedRelation();
}

export function deleteSelectedRelation() {
    if (!selectedRelationId) return;
    var id = selectedRelationId;
    removeRelationById(id);
    saveState();
    render();
    // 取り消し操作のヒントを長めに表示（誤削除に気付きやすくする）
    var undoKey = /Mac/.test(navigator.platform) ? '⌘Z' : 'Ctrl+Z';
    showToast('関連線を削除しました（' + undoKey + ' で取り消し）', 5000);
}
