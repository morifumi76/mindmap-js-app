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
import { handleConnectButtonClick, updateConnectionPreviewOnly } from './connection.js';
import {
    clientToCanvasCoords,
    computeNearestAnchor,
    getAnchorPoint,
    getEdgePointTowards,
    getNodeRectFromPositions
} from './geometry.js';
import { finishAnyRelationLabelEditing, pendingLabelEdit, startRelationLabelEditing } from './labels.js';
import { showRelationContextMenu } from './menu.js';
import { findRelation } from './model.js';
import { selectRelation } from './selection.js';

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
            // 端点ドラッグ：4スナップで接続位置を切り替える
            var side = t.getAttribute('data-side'); // 'from' or 'to'
            relationEndpointDragState.active = true;
            relationEndpointDragState.relationId = relId;
            relationEndpointDragState.side = side || 'from';
            relationEndpointDragState.startClientX = e.clientX;
            relationEndpointDragState.startClientY = e.clientY;
            relationEndpointDragState.moved = false;
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

        // 端点ドラッグ：4スナップでアンカー位置を更新
        if (relationEndpointDragState.active && relationEndpointDragState.relationId) {
            if (!relationEndpointDragState.moved) {
                var dxe = e.clientX - relationEndpointDragState.startClientX;
                var dye = e.clientY - relationEndpointDragState.startClientY;
                if (dxe * dxe + dye * dye < 9) return;
                relationEndpointDragState.moved = true;
            }
            var relE = findRelation(relationEndpointDragState.relationId);
            if (!relE) return;
            var nodeIdE = relationEndpointDragState.side === 'from' ? relE.fromNodeId : relE.toNodeId;
            var rectE = lastRenderedPositions ? getNodeRectFromPositions(lastRenderedPositions, nodeIdE) : null;
            if (!rectE) return;
            var coordsE = clientToCanvasCoords(e.clientX, e.clientY);
            var newAnchor = computeNearestAnchor(rectE, coordsE.x, coordsE.y);
            if (relationEndpointDragState.side === 'from') {
                if (relE.fromAnchor !== newAnchor) {
                    relE.fromAnchor = newAnchor;
                    render();
                }
            } else {
                if (relE.toAnchor !== newAnchor) {
                    relE.toAnchor = newAnchor;
                    render();
                }
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
            relationEndpointDragState.active = false;
            relationEndpointDragState.relationId = null;
            relationEndpointDragState.side = null;
            relationEndpointDragState.moved = false;
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
}
