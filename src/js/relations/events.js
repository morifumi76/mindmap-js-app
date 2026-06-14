// 関連線: イベント結線
import { saveState } from '../history.js';
import { render } from '../render.js';
import {
    connectionMode,
    lastRelationClickInfo,
    lastRenderedPositions,
    relationCtrlDragState,
    relationEndpointDragState
} from '../state.js';
import { showToast } from '../utils.js';
import { handleConnectButtonClick, updateConnectionPreviewOnly } from './connection.js';
import {
    clientToCanvasCoords,
    computeNearestAnchor,
    findNodeIdAtCanvasPoint,
    getAnchorPoint,
    getEdgePointTowards,
    getNodeRectFromPositions
} from './geometry.js';
import { finishAnyRelationLabelEditing, pendingLabelEdit, startRelationLabelEditing } from './labels.js';
import { showRelationContextMenu } from './menu.js';
import {
    findRelation,
    reconnectRelationEndpoint,
    relationExistsBetween,
    wouldCreateRelationCycle
} from './model.js';
import { selectRelation } from './selection.js';

// つなぎ替えプレビュー中の見た目を反映する。
// 別ノードに乗っているとき、つなぎ替え先ノードを枠でハイライトし、無効なら線とノードを赤くする。
// render() でDOMは毎回作り直されるので、render()の直後に呼ぶ前提。
function applyReconnectPreviewVisual(relId, targetId, valid) {
    var line = document.querySelector('.relation-line[data-rel-id="' + relId + '"]');
    if (line) line.classList.toggle('invalid', !valid);
    var node = document.querySelector('.node[data-id="' + targetId + '"]');
    if (node) node.classList.add(valid ? 'relation-drop-target' : 'relation-drop-invalid');
}

// 無効なつなぎ替えを試みたとき、対象の線を一瞬赤く点滅させる。
function flashRelationInvalid(relId) {
    var line = document.querySelector('.relation-line[data-rel-id="' + relId + '"]');
    if (!line) return;
    line.classList.add('invalid');
    setTimeout(function() {
        var el = document.querySelector('.relation-line[data-rel-id="' + relId + '"]');
        if (el) el.classList.remove('invalid');
    }, 600);
}

// ========================================
// イベントハンドラの初期化
// ========================================
var relationsEventsInitialized = false;

export function initRelationsEvents() {
    if (relationsEventsInitialized) return;
    relationsEventsInitialized = true;

    var svg = document.getElementById('linesSvg');
    var endpointsSvg = document.getElementById('endpointsSvg');

    // 関連線本体・端点ドット — どれを掴んでも即ドラッグで曲げられる
    // mousedownで選択＋ドラッグ準備、mousemoveで一定距離動いたら制御点更新、mouseupで保存
    // 同じ関連線を400ms以内に2回mousedownしたらダブルクリック扱いで「取り消し」メニュー表示
    var relationMousedownHandler = function(e) {
        if (e.button !== 0) return; // 左クリックのみ
        var t = e.target;
        if (!t || !t.classList) return;
        var isLine = t.classList.contains('relation-line-hit') || t.classList.contains('relation-line');
        var isEndpoint = t.classList.contains('relation-endpoint');
        if (!isLine && !isEndpoint) return;
        if (connectionMode.active) return; // 接続待機モード中は無視
        var relId = t.getAttribute('data-rel-id');
        if (!relId) return;
        e.preventDefault();
        e.stopPropagation();

        // 手動ダブルクリック判定 → 取り消しメニューを表示
        var now = Date.now();
        if (lastRelationClickInfo.relId === relId && (now - lastRelationClickInfo.time) < 400) {
            lastRelationClickInfo.time = 0;
            lastRelationClickInfo.relId = null;
            // ドラッグ準備をキャンセル
            relationCtrlDragState.active = false;
            relationCtrlDragState.relationId = null;
            relationCtrlDragState.moved = false;
            // 待機中のメモ編集タイマーがあればキャンセル（ラベル表示前に取り消しメニューを優先）
            if (pendingLabelEdit.timer) {
                clearTimeout(pendingLabelEdit.timer);
                pendingLabelEdit.timer = null;
                pendingLabelEdit.relId = null;
            }
            // 既に開いているラベル編集があれば確定して閉じる
            finishAnyRelationLabelEditing();
            showRelationContextMenu(relId, e.clientX, e.clientY);
            return;
        }
        lastRelationClickInfo.time = now;
        lastRelationClickInfo.relId = relId;

        // 選択（render()は呼ばずに見た目だけ差分更新する）
        selectRelation(relId);

        if (isEndpoint) {
            // 端点ドラッグ：別ノードに乗せれば「つなぎ替え」、同じノード上なら従来の「接続面の変更」
            var side = t.getAttribute('data-side'); // 'from' or 'to'
            var relForDrag = findRelation(relId);
            relationEndpointDragState.active = true;
            relationEndpointDragState.relationId = relId;
            relationEndpointDragState.side = side || 'from';
            relationEndpointDragState.startClientX = e.clientX;
            relationEndpointDragState.startClientY = e.clientY;
            relationEndpointDragState.moved = false;
            relationEndpointDragState.hoverTargetId = null;
            relationEndpointDragState.hoverValid = false;
            // つなぎ替えに失敗したときに戻せるよう、開始時のノードとアンカーを覚えておく
            if (relForDrag) {
                relationEndpointDragState.origNodeId = side === 'to' ? relForDrag.toNodeId : relForDrag.fromNodeId;
                relationEndpointDragState.origAnchor = side === 'to' ? (relForDrag.toAnchor || null) : (relForDrag.fromAnchor || null);
            }
        } else {
            // 線本体ドラッグ：曲線を曲げる（既存挙動）
            relationCtrlDragState.active = true;
            relationCtrlDragState.relationId = relId;
            relationCtrlDragState.startClientX = e.clientX;
            relationCtrlDragState.startClientY = e.clientY;
            relationCtrlDragState.moved = false;
        }
    };
    // 線本体は linesSvg、端点ドットは endpointsSvg にあるので両方に同じハンドラを登録
    svg.addEventListener('mousedown', relationMousedownHandler);
    if (endpointsSvg) endpointsSvg.addEventListener('mousedown', relationMousedownHandler);

    // ドラッグ中のマウス追従、および接続待機モード中のプレビュー追従
    document.addEventListener('mousemove', function(e) {
        if (relationCtrlDragState.active && relationCtrlDragState.relationId) {
            // しきい値（3px）以下の微動はクリックとみなしてドラッグ扱いしない
            if (!relationCtrlDragState.moved) {
                var dxs = e.clientX - relationCtrlDragState.startClientX;
                var dys = e.clientY - relationCtrlDragState.startClientY;
                if (dxs * dxs + dys * dys < 9) return;
                relationCtrlDragState.moved = true;
            }
            var rel = findRelation(relationCtrlDragState.relationId);
            if (!rel) return;
            var coords = clientToCanvasCoords(e.clientX, e.clientY);
            var positions = lastRenderedPositions;
            var fromRect = positions ? getNodeRectFromPositions(positions, rel.fromNodeId) : null;
            var toRect = positions ? getNodeRectFromPositions(positions, rel.toNodeId) : null;
            if (!fromRect || !toRect) return;
            // アンカーが指定されていればその位置、なければ自動計算（描画時と同じロジックを使う）
            var p1 = rel.fromAnchor
                ? getAnchorPoint(fromRect, rel.fromAnchor)
                : getEdgePointTowards(fromRect.left, fromRect.top, fromRect.right, fromRect.bottom, toRect.cx, toRect.cy);
            var p2 = rel.toAnchor
                ? getAnchorPoint(toRect, rel.toAnchor)
                : getEdgePointTowards(toRect.left, toRect.top, toRect.right, toRect.bottom, fromRect.cx, fromRect.cy);
            if (!p1 || !p2) return;
            var midX = (p1.x + p2.x) / 2;
            var midY = (p1.y + p2.y) / 2;
            rel.controlPoint = { x: coords.x - midX, y: coords.y - midY };
            render();
            return;
        }

        // 端点ドラッグ：別ノードに乗せれば「つなぎ替え」プレビュー、同じノードなら「接続面の変更」
        if (relationEndpointDragState.active && relationEndpointDragState.relationId) {
            if (!relationEndpointDragState.moved) {
                var dxe = e.clientX - relationEndpointDragState.startClientX;
                var dye = e.clientY - relationEndpointDragState.startClientY;
                if (dxe * dxe + dye * dye < 9) return;
                relationEndpointDragState.moved = true;
            }
            var relE = findRelation(relationEndpointDragState.relationId);
            if (!relE) return;
            var sideE = relationEndpointDragState.side;
            var origNodeIdE = relationEndpointDragState.origNodeId;
            var coordsE = clientToCanvasCoords(e.clientX, e.clientY);
            // まず動かしている端点を開始ノードへ戻し、毎フレーム同じ状態から判定する
            if (sideE === 'from') relE.fromNodeId = origNodeIdE;
            else relE.toNodeId = origNodeIdE;

            var targetId = findNodeIdAtCanvasPoint(lastRenderedPositions, coordsE.x, coordsE.y);

            if (targetId && targetId !== origNodeIdE) {
                // 別ノードの上 → つなぎ替えプレビュー
                var otherId = sideE === 'from' ? relE.toNodeId : relE.fromNodeId;
                var newFrom = sideE === 'from' ? targetId : otherId;
                var newTo = sideE === 'from' ? otherId : targetId;
                var relIdE2 = relationEndpointDragState.relationId;
                var valid = (newFrom !== newTo) &&
                    !relationExistsBetween(newFrom, newTo, relIdE2) &&
                    !wouldCreateRelationCycle(newFrom, newTo, relIdE2);
                // 端点を仮にターゲットへ付け替え（アンカーは自動向き）
                if (sideE === 'from') { relE.fromNodeId = targetId; relE.fromAnchor = null; }
                else { relE.toNodeId = targetId; relE.toAnchor = null; }
                relationEndpointDragState.hoverTargetId = targetId;
                relationEndpointDragState.hoverValid = valid;
                render();
                applyReconnectPreviewVisual(relIdE2, targetId, valid);
            } else {
                // 同じノード上／空白 → 従来の接続面（アンカー）変更
                relationEndpointDragState.hoverTargetId = null;
                relationEndpointDragState.hoverValid = false;
                var rectE = lastRenderedPositions ? getNodeRectFromPositions(lastRenderedPositions, origNodeIdE) : null;
                if (rectE) {
                    var newAnchor = computeNearestAnchor(rectE, coordsE.x, coordsE.y);
                    if (sideE === 'from') relE.fromAnchor = newAnchor;
                    else relE.toAnchor = newAnchor;
                }
                render();
            }
            return;
        }

        if (connectionMode.active) {
            var c = clientToCanvasCoords(e.clientX, e.clientY);
            connectionMode.mouseCanvasX = c.x;
            connectionMode.mouseCanvasY = c.y;
            // プレビュー線だけを更新（再描画は重いので、プレビュー要素だけ動的更新）
            updateConnectionPreviewOnly();
        }
    });

    document.addEventListener('mouseup', function(e) {
        // 端点ドラッグの終了
        if (relationEndpointDragState.active) {
            var didMoveE = relationEndpointDragState.moved;
            var relIdE = relationEndpointDragState.relationId;
            var sideE2 = relationEndpointDragState.side;
            var origNodeIdE2 = relationEndpointDragState.origNodeId;
            var origAnchorE2 = relationEndpointDragState.origAnchor;
            var hoverTargetIdE = relationEndpointDragState.hoverTargetId;
            relationEndpointDragState.active = false;
            relationEndpointDragState.relationId = null;
            relationEndpointDragState.side = null;
            relationEndpointDragState.moved = false;
            relationEndpointDragState.origNodeId = null;
            relationEndpointDragState.origAnchor = null;
            relationEndpointDragState.hoverTargetId = null;
            relationEndpointDragState.hoverValid = false;

            // 別ノードにドロップした → つなぎ替えを確定（無効なら元に戻す）
            if (hoverTargetIdE) {
                var relU = findRelation(relIdE);
                if (relU) {
                    // いったん開始ノードへ完全に戻してから、正式APIで検証＆確定する
                    if (sideE2 === 'from') { relU.fromNodeId = origNodeIdE2; relU.fromAnchor = origAnchorE2; }
                    else { relU.toNodeId = origNodeIdE2; relU.toAnchor = origAnchorE2; }
                    var res = reconnectRelationEndpoint(relIdE, sideE2, hoverTargetIdE);
                    render();
                    if (res.ok) {
                        saveState();
                    } else {
                        flashRelationInvalid(relIdE);
                        showToast(res.reason, 2500);
                    }
                }
                return;
            }

            if (didMoveE) {
                saveState();
            } else if (relIdE) {
                // ドラッグなし＝端点シングルクリック → 線本体クリックと同じくメモ編集をスケジュール
                if (pendingLabelEdit.timer) clearTimeout(pendingLabelEdit.timer);
                pendingLabelEdit.relId = relIdE;
                pendingLabelEdit.timer = setTimeout(function() {
                    var rid = pendingLabelEdit.relId;
                    pendingLabelEdit.timer = null;
                    pendingLabelEdit.relId = null;
                    if (rid) startRelationLabelEditing(rid);
                }, 280);
            }
            return;
        }

        if (relationCtrlDragState.active) {
            var didMove = relationCtrlDragState.moved;
            var relIdJustClicked = relationCtrlDragState.relationId;
            relationCtrlDragState.active = false;
            relationCtrlDragState.relationId = null;
            relationCtrlDragState.moved = false;
            if (didMove) {
                // 実際にドラッグして曲線が変わった場合のみ履歴に記録
                saveState();
            } else if (relIdJustClicked) {
                // ドラッグなし＝シングルクリック扱い。ダブルクリック検出（400ms）を待ってからメモ編集を起動
                if (pendingLabelEdit.timer) clearTimeout(pendingLabelEdit.timer);
                pendingLabelEdit.relId = relIdJustClicked;
                pendingLabelEdit.timer = setTimeout(function() {
                    var rid = pendingLabelEdit.relId;
                    pendingLabelEdit.timer = null;
                    pendingLabelEdit.relId = null;
                    if (rid) startRelationLabelEditing(rid);
                }, 280);
            }
        }
    });

    // ダブルクリックは mousedown 内の手動判定で処理する（DOM入れ替えに強い実装）

    // 接続ボタン
    var connectBtn = document.getElementById('connectFloatBtn');
    if (connectBtn) {
        connectBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            handleConnectButtonClick();
        });
    }

    // テスト・連携用につなぎ替え関連の関数を公開する
    window.reconnectRelationEndpoint = function(relId, side, newNodeId) {
        var res = reconnectRelationEndpoint(relId, side, newNodeId);
        if (res.ok) {
            saveState();
            render();
        }
        return res;
    };
    window.relationExistsBetween = relationExistsBetween;
    window.wouldCreateRelationCycle = wouldCreateRelationCycle;
}
