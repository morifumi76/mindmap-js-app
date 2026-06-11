// 関連線: SVG 描画
import { connectionMode, mindMapData, selectedRelationId } from '../state.js';
import {
    RELATION_SVG_OFFSET,
    buildRelationPathD,
    computeRelationGeometry,
    getEdgePointTowards,
    getNodeRectFromPositions
} from './geometry.js';
import { renderRelationLabels } from './labels.js';
import { ensureRelationsArray } from './model.js';

// 関連線をSVGに描画する（render() の終盤から呼ばれる）
// 線本体は背景レイヤー（svg = linesSvg）、端点ドットはノードより前面のレイヤー（endpointsSvg）に分けて描画
export function renderRelations(svg, positions) {
    ensureRelationsArray();
    var endpointsSvg = document.getElementById('endpointsSvg');
    var rels = mindMapData.relations;
    for (var i = 0; i < rels.length; i++) {
        var rel = rels[i];
        var geom = computeRelationGeometry(rel, positions);
        // 仕様7: 端のいずれかが折りたたまれて非表示なら描画しない
        if (!geom) continue;
        var d = buildRelationPathD(geom);
        var isSelected = (selectedRelationId === rel.id);

        // クリック判定用の透明な太いパス（仕様: 8〜10px幅）
        var hitPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        hitPath.setAttribute('d', d);
        hitPath.setAttribute('class', 'relation-line-hit');
        hitPath.setAttribute('data-rel-id', rel.id);
        svg.appendChild(hitPath);

        // 見た目の本体
        var visPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        visPath.setAttribute('d', d);
        var cls = 'relation-line';
        if (isSelected) cls += ' selected';
        visPath.setAttribute('class', cls);
        visPath.setAttribute('data-rel-id', rel.id);
        svg.appendChild(visPath);

        // 端点の丸ポチ（双方のノード側に1つずつ。線と同じグリーン）— ノードより前面に表示するため別SVGに描画
        // data-side でどちら側の端点（fromNodeId 側 / toNodeId 側）かを識別
        if (endpointsSvg) {
            var endA = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            endA.setAttribute('cx', String(geom.p1.x + RELATION_SVG_OFFSET));
            endA.setAttribute('cy', String(geom.p1.y + RELATION_SVG_OFFSET));
            endA.setAttribute('r', '3.5');
            endA.setAttribute('class', 'relation-endpoint' + (isSelected ? ' selected' : ''));
            endA.setAttribute('data-rel-id', rel.id);
            endA.setAttribute('data-side', 'from');
            endpointsSvg.appendChild(endA);

            var endB = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            endB.setAttribute('cx', String(geom.p2.x + RELATION_SVG_OFFSET));
            endB.setAttribute('cy', String(geom.p2.y + RELATION_SVG_OFFSET));
            endB.setAttribute('r', '3.5');
            endB.setAttribute('class', 'relation-endpoint' + (isSelected ? ' selected' : ''));
            endB.setAttribute('data-rel-id', rel.id);
            endB.setAttribute('data-side', 'to');
            endpointsSvg.appendChild(endB);
        }
    }

    // 接続待機モード中ならプレビュー線も描画
    if (connectionMode.active && connectionMode.fromNodeId) {
        renderConnectionPreview(svg, positions);
    }

    // メモラベルを描画（label が非空のものだけ）
    renderRelationLabels(positions);
}

// 接続待機モード中のプレビュー線（元ノードからマウス位置へ）
export function renderConnectionPreview(svg, positions) {
    var fromRect = getNodeRectFromPositions(positions, connectionMode.fromNodeId);
    if (!fromRect) return;
    var mx = connectionMode.mouseCanvasX;
    var my = connectionMode.mouseCanvasY;
    var p1 = getEdgePointTowards(fromRect.left, fromRect.top, fromRect.right, fromRect.bottom, mx, my);
    var off = RELATION_SVG_OFFSET;
    var d = 'M ' + (p1.x + off) + ' ' + (p1.y + off) + ' L ' + (mx + off) + ' ' + (my + off);
    var preview = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    preview.setAttribute('d', d);
    preview.setAttribute('class', 'relation-line preview');
    svg.appendChild(preview);
}
