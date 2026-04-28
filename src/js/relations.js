// ========================================
// Relations (ノード間関連線・フリー接続)
// ========================================
// データ構造: mindMapData.relations = [
//   { id: 'rel-xxxx', fromNodeId: 'node-aaa', toNodeId: 'node-bbb', controlPoint: {x, y} | null }
// ]
// controlPoint は「両端の中点からのオフセット (dx, dy)」を保持する（仕様8）。
// 直線時は null（または微小値）で表現。

// SVGの座標オフセット（既存の親子接続線と揃える）
var RELATION_SVG_OFFSET = 5000;
// 制御点が「中点」とみなされる近さの閾値（ピクセル）
var RELATION_STRAIGHT_THRESHOLD = 1.5;

function ensureRelationsArray() {
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

function findRelation(relationId) {
    var arr = getRelations();
    for (var i = 0; i < arr.length; i++) {
        if (arr[i].id === relationId) return arr[i];
    }
    return null;
}

function addRelation(fromId, toId) {
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

function removeRelationById(relationId) {
    ensureRelationsArray();
    var arr = mindMapData.relations;
    for (var i = 0; i < arr.length; i++) {
        if (arr[i].id === relationId) {
            arr.splice(i, 1);
            break;
        }
    }
    if (selectedRelationId === relationId) selectedRelationId = null;
}

// ノードが削除されたときに、そのノードを端点とする関連線も削除する
function removeRelationsForNode(nodeId) {
    ensureRelationsArray();
    var arr = mindMapData.relations;
    var i = 0;
    while (i < arr.length) {
        if (arr[i].fromNodeId === nodeId || arr[i].toNodeId === nodeId) {
            if (selectedRelationId === arr[i].id) selectedRelationId = null;
            arr.splice(i, 1);
        } else {
            i++;
        }
    }
}

// 矩形の中心から (targetX, targetY) に向かう線が矩形境界と交わる点を返す
function getEdgePointTowards(left, top, right, bottom, targetX, targetY) {
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
function getNodeRectFromPositions(positions, nodeId) {
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

// ノード矩形の上下左右のアンカーポイントを返す
function getAnchorPoint(rect, anchor) {
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
function computeNearestAnchor(rect, mouseX, mouseY) {
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
function computeRelationGeometry(rel, positions) {
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

function buildRelationPathD(geom) {
    var off = RELATION_SVG_OFFSET;
    if (geom.isStraight) {
        return 'M ' + (geom.p1.x + off) + ' ' + (geom.p1.y + off) +
               ' L ' + (geom.p2.x + off) + ' ' + (geom.p2.y + off);
    }
    return 'M ' + (geom.p1.x + off) + ' ' + (geom.p1.y + off) +
           ' Q ' + (geom.bezX + off) + ' ' + (geom.bezY + off) +
           ' ' + (geom.p2.x + off) + ' ' + (geom.p2.y + off);
}

// 関連線をSVGに描画する（render() の終盤から呼ばれる）
// 線本体は背景レイヤー（svg = linesSvg）、端点ドットはノードより前面のレイヤー（endpointsSvg）に分けて描画
function renderRelations(svg, positions) {
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

// 関連線のメモラベル（中央に配置されたHTML div）を描画する
function renderRelationLabels(positions) {
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
    var newText = (labelEl.textContent || '').replace(/​/g, ''); // ゼロ幅スペース除去
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
function startRelationLabelEditing(relationId) {
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
function finishAnyRelationLabelEditing() {
    var labels = document.querySelectorAll('.relation-label');
    for (var i = 0; i < labels.length; i++) {
        if (document.activeElement === labels[i]) {
            labels[i].blur();
        }
    }
}

// 接続待機モード中のプレビュー線（元ノードからマウス位置へ）
function renderConnectionPreview(svg, positions) {
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

// マウス座標（ページ座標）をキャンバス内座標に変換する
function clientToCanvasCoords(clientX, clientY) {
    var container = document.getElementById('canvasContainer');
    var rect = container.getBoundingClientRect();
    var x = (clientX - rect.left - viewState.panX) / viewState.zoom;
    var y = (clientY - rect.top - viewState.panY) / viewState.zoom;
    return { x: x, y: y };
}

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

function cancelConnectionMode() {
    if (!connectionMode.active) return;
    connectionMode.active = false;
    connectionMode.fromNodeId = null;
    document.body.classList.remove('connection-mode');
    var btn = document.getElementById('connectFloatBtn');
    if (btn) btn.classList.remove('active');
    render();
}

function isConnectionModeActive() {
    return !!(connectionMode && connectionMode.active);
}

// 接続先ノードへ接続を確定する
function completeConnection(toNodeId) {
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

// ========================================
// 関連線の選択・削除
// ========================================
function selectRelation(relationId) {
    if (selectedRelationId === relationId) return; // 既に選択中なら何もしない（DOMを変更しない）
    selectedRelationId = relationId;
    // ノード選択は解除する（相互排他）
    selectedNodeIds.clear();
    lastSelectedNodeId = null;
    selectionAnchorId = null;
    document.querySelectorAll('.node.selected').forEach(function(el) {
        el.classList.remove('selected');
    });
    if (typeof updateLinkButtonState === 'function') updateLinkButtonState();
    // render() は呼ばず、SVG内のクラス・制御点だけ差分更新
    updateRelationVisualSelection();
}

function clearSelectedRelation() {
    if (selectedRelationId) {
        selectedRelationId = null;
        updateRelationVisualSelection();
    }
}

// 関連線の選択状態（.selected クラス）だけをDOMに反映する。
// render() でSVGパスを破棄せず、要素のIDが変わらないため、ブラウザのクリック判定が継続して動く。
function updateRelationVisualSelection() {
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

function deleteSelectedRelationWithConfirm() {
    if (!selectedRelationId) return;
    if (!confirm('この関連線を削除しますか？')) return;
    deleteSelectedRelation();
}

function deleteSelectedRelation() {
    if (!selectedRelationId) return;
    var id = selectedRelationId;
    removeRelationById(id);
    saveState();
    render();
    // 取り消し操作のヒントを長めに表示（誤削除に気付きやすくする）
    var undoKey = /Mac/.test(navigator.platform) ? '⌘Z' : 'Ctrl+Z';
    showToast('関連線を削除しました（' + undoKey + ' で取り消し）', 5000);
}

// ========================================
// イベントハンドラの初期化
// ========================================
var relationsEventsInitialized = false;

function initRelationsEvents() {
    if (relationsEventsInitialized) return;
    relationsEventsInitialized = true;

    var svg = document.getElementById('linesSvg');
    var endpointsSvg = document.getElementById('endpointsSvg');
    var canvas = document.getElementById('canvas');
    var canvasContainer = document.getElementById('canvasContainer');

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
            if (pendingRelationLabelEditTimer) {
                clearTimeout(pendingRelationLabelEditTimer);
                pendingRelationLabelEditTimer = null;
                pendingRelationLabelEditRelId = null;
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
                if (pendingRelationLabelEditTimer) clearTimeout(pendingRelationLabelEditTimer);
                pendingRelationLabelEditRelId = relIdE;
                pendingRelationLabelEditTimer = setTimeout(function() {
                    var rid = pendingRelationLabelEditRelId;
                    pendingRelationLabelEditTimer = null;
                    pendingRelationLabelEditRelId = null;
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
                if (pendingRelationLabelEditTimer) clearTimeout(pendingRelationLabelEditTimer);
                pendingRelationLabelEditRelId = relIdJustClicked;
                pendingRelationLabelEditTimer = setTimeout(function() {
                    var rid = pendingRelationLabelEditRelId;
                    pendingRelationLabelEditTimer = null;
                    pendingRelationLabelEditRelId = null;
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

// 接続ボタンが押されたときの分岐処理
function handleConnectButtonClick() {
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
function updateConnectionPreviewOnly() {
    var svg = document.getElementById('linesSvg');
    if (!svg) return;
    var existing = svg.querySelector('.relation-line.preview');
    if (existing) existing.parentNode.removeChild(existing);
    if (!lastRenderedPositions) return;
    renderConnectionPreview(svg, lastRenderedPositions);
}

// ========================================
// 関連線用コンテキストメニュー（ダブルクリックで表示）
// ========================================
function showRelationContextMenu(relationId, clientX, clientY) {
    var menu = ensureRelationCtxMenuEl();
    menu.dataset.relId = relationId;
    menu.style.left = clientX + 'px';
    menu.style.top = clientY + 'px';
    menu.classList.add('show');
    // 直後に来る click（mousedown起源）で閉じてしまうのを防ぐ
    menu.dataset._justShown = '1';
}

function hideRelationContextMenu() {
    var menu = document.getElementById('relationCtxMenu');
    if (menu) menu.classList.remove('show');
}

function ensureRelationCtxMenuEl() {
    var menu = document.getElementById('relationCtxMenu');
    if (menu) return menu;
    menu = document.createElement('div');
    menu.id = 'relationCtxMenu';
    menu.className = 'ctx-menu relation-ctx-menu';
    var item = document.createElement('div');
    item.className = 'ctx-menu-item danger';
    item.textContent = '取り消し';
    item.addEventListener('click', function(e) {
        e.stopPropagation();
        var relId = menu.dataset.relId;
        hideRelationContextMenu();
        if (!relId) return;
        removeRelationById(relId);
        saveState();
        render();
        showToast('関連線を削除しました');
    });
    menu.appendChild(item);
    document.body.appendChild(menu);
    // 画面のどこかをクリックしたら閉じる。
    // ただし「メニューを表示した直後に来る同じmousedown起源のclick」では閉じない（dataset._justShownフラグ方式）
    document.addEventListener('click', function(e) {
        if (menu.dataset._justShown === '1') {
            menu.dataset._justShown = '0';
            return;
        }
        if (!menu.contains(e.target)) {
            hideRelationContextMenu();
        }
    });
    return menu;
}
