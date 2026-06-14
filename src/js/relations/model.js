// 関連線: データモデル操作（mindMapData.relations の CRUD）
import { mindMapData, selectedRelationId, setSelectedRelationId } from '../state.js';

export function ensureRelationsArray() {
    if (!mindMapData.relations) {
        mindMapData.relations = [];
    }
}

function generateRelationId() {
    return 'rel-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 100000).toString(36);
}

function getRelations() {
    ensureRelationsArray();
    return mindMapData.relations;
}

export function findRelation(relationId) {
    var arr = getRelations();
    for (var i = 0; i < arr.length; i++) {
        if (arr[i].id === relationId) return arr[i];
    }
    return null;
}

export function addRelation(fromId, toId) {
    ensureRelationsArray();
    var rel = {
        id: generateRelationId(),
        fromNodeId: fromId,
        toNodeId: toId,
        controlPoint: null
    };
    mindMapData.relations.push(rel);
    return rel;
}

export function removeRelationById(relationId) {
    ensureRelationsArray();
    var arr = mindMapData.relations;
    for (var i = 0; i < arr.length; i++) {
        if (arr[i].id === relationId) {
            arr.splice(i, 1);
            break;
        }
    }
    if (selectedRelationId === relationId) setSelectedRelationId(null);
}

// 2つのノードの間に既に関連線があるか（向きは問わない）。exceptId は判定から除外する関連線ID。
// 「重複接続禁止」のチェックに使う。
export function relationExistsBetween(aId, bId, exceptId) {
    var arr = getRelations();
    for (var i = 0; i < arr.length; i++) {
        var r = arr[i];
        if (r.id === exceptId) continue;
        if ((r.fromNodeId === aId && r.toNodeId === bId) ||
            (r.fromNodeId === bId && r.toNodeId === aId)) {
            return true;
        }
    }
    return false;
}

// from→to の関連線を引いたときに、関連線だけをたどって循環（ループ）ができるか。
// to から from→to の向きでたどって from に戻れるなら循環。exceptId は付け替え中の線自身を除外。
export function wouldCreateRelationCycle(fromId, toId, exceptId) {
    var arr = getRelations();
    var visited = {};
    var stack = [toId];
    while (stack.length > 0) {
        var cur = stack.pop();
        if (cur === fromId) return true; // from に戻れた＝循環
        if (visited[cur]) continue;
        visited[cur] = true;
        for (var i = 0; i < arr.length; i++) {
            var r = arr[i];
            if (r.id === exceptId) continue;
            if (r.fromNodeId === cur) stack.push(r.toNodeId);
        }
    }
    return false;
}

// 関連線の端点を別ノードへつなぎ替える。検証してOKなら付け替え、NGなら理由を返す。
// side: 'from' | 'to'（どちらの端点を動かすか）, newNodeId: つなぎ替え先のノードID
// 戻り値: { ok: true } または { ok: false, reason: '...' }
export function reconnectRelationEndpoint(relationId, side, newNodeId) {
    var rel = findRelation(relationId);
    if (!rel) return { ok: false, reason: '対象の関連線が見つかりません' };
    var fromId = side === 'from' ? newNodeId : rel.fromNodeId;
    var toId = side === 'to' ? newNodeId : rel.toNodeId;
    if (fromId === toId) return { ok: false, reason: '自分自身にはつなげません' };
    if (relationExistsBetween(fromId, toId, relationId)) {
        return { ok: false, reason: 'すでに接続されています' };
    }
    if (wouldCreateRelationCycle(fromId, toId, relationId)) {
        return { ok: false, reason: '循環するためつなげません' };
    }
    if (side === 'from') {
        rel.fromNodeId = newNodeId;
        rel.fromAnchor = null; // 付け替え後は自動で向きを決める
    } else {
        rel.toNodeId = newNodeId;
        rel.toAnchor = null;
    }
    return { ok: true };
}

// ノードが削除されたときに、そのノードを端点とする関連線も削除する
export function removeRelationsForNode(nodeId) {
    ensureRelationsArray();
    var arr = mindMapData.relations;
    var i = 0;
    while (i < arr.length) {
        if (arr[i].fromNodeId === nodeId || arr[i].toNodeId === nodeId) {
            if (selectedRelationId === arr[i].id) setSelectedRelationId(null);
            arr.splice(i, 1);
        } else {
            i++;
        }
    }
}
