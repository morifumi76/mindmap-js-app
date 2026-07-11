// 関連線: 座標・アンカー・パス形状の計算
import { viewState } from '../state.js';

// ========================================
// Relations (ノード間関連線・フリー接続)
// ========================================
// データ構造: mindMapData.relations = [
//   { id: 'rel-xxxx', fromNodeId: 'node-aaa', toNodeId: 'node-bbb', controlPoint: {x, y} | null }
// ]
// controlPoint は「両端の中点からのオフセット (dx, dy)」を保持する（仕様8）。
// 直線時は null（または微小値）で表現。

// SVGの座標オフセット。線用SVGは中央が原点になるよう全座標に +5000 して描く。
// 親子接続線（render.js）と関連線の両方でこの1定数を共有する
export var SVG_OFFSET = 5000;

// 制御点が「中点」とみなされる近さの閾値（ピクセル）
var RELATION_STRAIGHT_THRESHOLD = 1.5;

// 矩形の中心から (targetX, targetY) に向かう線が矩形境界と交わる点を返す
export function getEdgePointTowards(left, top, right, bottom, targetX, targetY) {
    var cx = (left + right) / 2;
    var cy = (top + bottom) / 2;
    var dx = targetX - cx;
    var dy = targetY - cy;
    if (dx === 0 && dy === 0) return { x: cx, y: cy };
    var halfW = (right - left) / 2;
    var halfH = (bottom - top) / 2;
    var absDx = Math.abs(dx);
    var absDy = Math.abs(dy);
    // 縦・横どちらの辺に当たるかを判定
    var scaleX = absDx > 0 ? halfW / absDx : Infinity;
    var scaleY = absDy > 0 ? halfH / absDy : Infinity;
    var scale = Math.min(scaleX, scaleY);
    return { x: cx + dx * scale, y: cy + dy * scale };
}

// positions[id] = {x, y, width, height} から矩形情報を返す
// （render側のyは縦中心、xは左端）
export function getNodeRectFromPositions(positions, nodeId) {
    var p = positions && positions[nodeId];
    if (!p) return null;
    return {
        left: p.x,
        top: p.y - p.height / 2,
        right: p.x + p.width,
        bottom: p.y + p.height / 2,
        cx: p.x + p.width / 2,
        cy: p.y
    };
}

// カーソル（キャンバス内座標）がどのノードの矩形内にあるかを調べ、そのノードIDを返す。
// どのノードにも乗っていなければ null。つなぎ替え先の判定に使う。
// positions[id] = {x, y, width, height}（render側と同じ。yは縦中心、xは左端）
export function findNodeIdAtCanvasPoint(positions, x, y) {
    if (!positions) return null;
    for (var id in positions) {
        if (!Object.prototype.hasOwnProperty.call(positions, id)) continue;
        var rect = getNodeRectFromPositions(positions, id);
        if (!rect) continue;
        if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
            return id;
        }
    }
    return null;
}

// ノード矩形の上下左右のアンカーポイントを返す
export function getAnchorPoint(rect, anchor) {
    var cx = (rect.left + rect.right) / 2;
    var cy = (rect.top + rect.bottom) / 2;
    switch (anchor) {
        case 'top':    return { x: cx, y: rect.top };
        case 'bottom': return { x: cx, y: rect.bottom };
        case 'left':   return { x: rect.left, y: cy };
        case 'right':  return { x: rect.right, y: cy };
    }
    return null;
}

// マウス座標（キャンバス内）から、ノードの上下左右どのアンカーが最寄りかを返す
export function computeNearestAnchor(rect, mouseX, mouseY) {
    var cx = (rect.left + rect.right) / 2;
    var cy = (rect.top + rect.bottom) / 2;
    var dx = mouseX - cx;
    var dy = mouseY - cy;
    if (Math.abs(dx) >= Math.abs(dy)) {
        return dx >= 0 ? 'right' : 'left';
    }
    return dy >= 0 ? 'bottom' : 'top';
}

// 関連線の幾何情報を計算（描画にもクリック判定にも使う）
// rel.fromAnchor / rel.toAnchor が指定されていればそのアンカー位置、なければ自動計算（既存挙動）
export function computeRelationGeometry(rel, positions) {
    var fromRect = getNodeRectFromPositions(positions, rel.fromNodeId);
    var toRect = getNodeRectFromPositions(positions, rel.toNodeId);
    if (!fromRect || !toRect) return null;
    var p1 = rel.fromAnchor
        ? getAnchorPoint(fromRect, rel.fromAnchor)
        : getEdgePointTowards(fromRect.left, fromRect.top, fromRect.right, fromRect.bottom, toRect.cx, toRect.cy);
    var p2 = rel.toAnchor
        ? getAnchorPoint(toRect, rel.toAnchor)
        : getEdgePointTowards(toRect.left, toRect.top, toRect.right, toRect.bottom, fromRect.cx, fromRect.cy);
    if (!p1 || !p2) return null;
    var midX = (p1.x + p2.x) / 2;
    var midY = (p1.y + p2.y) / 2;
    var offX = rel.controlPoint ? rel.controlPoint.x : 0;
    var offY = rel.controlPoint ? rel.controlPoint.y : 0;
    var ctrlX = midX + offX; // ユーザーが見る制御点（曲線が通る点）
    var ctrlY = midY + offY;
    var isStraight = Math.abs(offX) < RELATION_STRAIGHT_THRESHOLD && Math.abs(offY) < RELATION_STRAIGHT_THRESHOLD;
    // 二次ベジェの制御点 B は、曲線が ctrlX,ctrlY を通るように B = 2*ctrl - mid と置く
    var bezX = 2 * ctrlX - midX;
    var bezY = 2 * ctrlY - midY;
    return {
        p1: p1, p2: p2,
        midX: midX, midY: midY,
        ctrlX: ctrlX, ctrlY: ctrlY,
        bezX: bezX, bezY: bezY,
        isStraight: isStraight
    };
}

export function buildRelationPathD(geom) {
    var off = SVG_OFFSET;
    if (geom.isStraight) {
        return 'M ' + (geom.p1.x + off) + ' ' + (geom.p1.y + off) +
               ' L ' + (geom.p2.x + off) + ' ' + (geom.p2.y + off);
    }
    return 'M ' + (geom.p1.x + off) + ' ' + (geom.p1.y + off) +
           ' Q ' + (geom.bezX + off) + ' ' + (geom.bezY + off) +
           ' ' + (geom.p2.x + off) + ' ' + (geom.p2.y + off);
}

// マウス座標（ページ座標）をキャンバス内座標に変換する
export function clientToCanvasCoords(clientX, clientY) {
    var container = document.getElementById('canvasContainer');
    var rect = container.getBoundingClientRect();
    var x = (clientX - rect.left - viewState.panX) / viewState.zoom;
    var y = (clientY - rect.top - viewState.panY) / viewState.zoom;
    return { x: x, y: y };
}
