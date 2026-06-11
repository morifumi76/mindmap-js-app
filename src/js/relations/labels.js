// 関連線: メモラベルの描画と編集
import { saveState } from '../history.js';
import { render } from '../render.js';
import { lastRenderedPositions, mindMapData } from '../state.js';
import { isImeRelatedKey } from '../utils.js';
import { computeRelationGeometry } from './geometry.js';
import { ensureRelationsArray, findRelation } from './model.js';

// ラベル編集の保留状態（シングルクリック→ダブルクリック判定用。events.js とも共有）
export const pendingLabelEdit = { timer: null, relId: null };

// 関連線のメモラベル（中央に配置されたHTML div）を描画する
export function renderRelationLabels(positions) {
    var container = document.getElementById('canvasInner');
    if (!container) return;
    // 既存のラベルを除去（編集中のものは render() を呼ばない設計なので問題ない）
    var oldLabels = container.querySelectorAll('.relation-label');
    for (var li = 0; li < oldLabels.length; li++) {
        oldLabels[li].parentNode.removeChild(oldLabels[li]);
    }
    ensureRelationsArray();
    var rels = mindMapData.relations;
    for (var i = 0; i < rels.length; i++) {
        var rel = rels[i];
        // ラベルが空ならDOMに置かない（クリック時に startRelationLabelEditing が動的生成）
        if (!rel.label) continue;
        var geom = computeRelationGeometry(rel, positions);
        if (!geom) continue;
        var labelEl = createRelationLabelElement(rel, geom, false);
        container.appendChild(labelEl);
    }
}

// メモラベルのDOM要素を生成（編集モード初期化はせず、必要時に focus() を呼ぶ）
function createRelationLabelElement(rel, geom, isEditing) {
    var labelEl = document.createElement('div');
    labelEl.className = 'relation-label';
    labelEl.setAttribute('data-rel-id', rel.id);
    labelEl.setAttribute('contenteditable', 'true');
    labelEl.style.left = geom.ctrlX + 'px';
    labelEl.style.top = geom.ctrlY + 'px';
    labelEl.textContent = rel.label || '';
    if (!rel.label) labelEl.classList.add('empty-placeholder');
    attachRelationLabelHandlers(labelEl, rel.id);
    return labelEl;
}

function attachRelationLabelHandlers(labelEl, relationId) {
    labelEl.addEventListener('mousedown', function(e) {
        // ラベル内クリックは線のドラッグに繋げない
        e.stopPropagation();
    });
    labelEl.addEventListener('click', function(e) {
        e.stopPropagation();
    });
    labelEl.addEventListener('dblclick', function(e) {
        // ラベル内のダブルクリックは選択操作のためのもの。線の取り消しメニューには繋げない
        e.stopPropagation();
    });
    labelEl.addEventListener('focus', function() {
        labelEl.classList.remove('empty-placeholder');
    });
    labelEl.addEventListener('blur', function() {
        commitRelationLabelEdit(labelEl, relationId);
    });
    labelEl.addEventListener('keydown', function(e) {
        // メモ編集中のキー入力はドキュメント側の handleKeyDown に届けない
        // （Backspace で関連線が消える、Tab で新しいノードが作られる等の事故防止）
        e.stopPropagation();
        if (e.key === 'Enter' && !e.shiftKey) {
            // IME変換中・変換確定直後のEnterは編集終了しない
            if (isImeRelatedKey(e)) return;
            e.preventDefault();
            labelEl.blur();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            labelEl.blur();
        }
        // Shift+Enter: そのまま改行
    });
}

// ラベル編集の確定（テキスト保存／空なら削除）
function commitRelationLabelEdit(labelEl, relationId) {
    var rel = findRelation(relationId);
    if (!rel) {
        if (labelEl && labelEl.parentNode) labelEl.parentNode.removeChild(labelEl);
        return;
    }
    var newText = (labelEl.textContent || '').replace(/\u200b/g, ''); // ゼロ幅スペース除去
    // 末尾の改行は素直にtrim、内部の改行は維持
    newText = newText.replace(/\n+$/, '').replace(/^\n+/, '');
    var oldText = rel.label || '';
    if (newText === oldText) {
        if (!newText) {
            // 空のまま離脱 → ラベル要素は除去
            if (labelEl.parentNode) labelEl.parentNode.removeChild(labelEl);
        } else {
            // テキスト変更なし → 表示用に戻すだけ
            labelEl.classList.remove('empty-placeholder');
        }
        return;
    }
    if (newText) {
        rel.label = newText;
    } else {
        delete rel.label;
    }
    saveState();
    // 次のレンダーでラベルが正規化されるため、ここでは render() を呼ぶ
    render();
}

// 線をシングルクリックしたときに呼ばれる：ラベルを表示してフォーカス
export function startRelationLabelEditing(relationId) {
    var rel = findRelation(relationId);
    if (!rel) return;
    var positions = lastRenderedPositions;
    if (!positions) return;
    var geom = computeRelationGeometry(rel, positions);
    if (!geom) return;
    // 既に同じ関連線のラベルがDOM上にあればフォーカスだけする
    var container = document.getElementById('canvasInner');
    var existing = container.querySelector('.relation-label[data-rel-id="' + relationId + '"]');
    var labelEl = existing;
    if (!labelEl) {
        labelEl = createRelationLabelElement(rel, geom, true);
        container.appendChild(labelEl);
    }
    // フォーカス＋カーソルを末尾に
    labelEl.focus();
    try {
        var range = document.createRange();
        range.selectNodeContents(labelEl);
        range.collapse(false);
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
    } catch (e) {}
}

// 編集中のラベルを強制的に確定して閉じる（取り消しメニュー表示時などに使用）
export function finishAnyRelationLabelEditing() {
    var labels = document.querySelectorAll('.relation-label');
    for (var i = 0; i < labels.length; i++) {
        if (document.activeElement === labels[i]) {
            labels[i].blur();
        }
    }
}
