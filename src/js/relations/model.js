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
