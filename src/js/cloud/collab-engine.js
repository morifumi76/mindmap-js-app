// クラウド版: 共同編集エンジン
// ----------------------------------------
// Supabase Realtime（Broadcast + Presence）でノード操作を「操作単位」で同期する。
// マップ全体JSONの上書き合戦（消し合い事故）を避けるため、共同編集中の同期は
// すべてこのエンジン経由のイベント（add / text / del / move の4種）で行う。
//
// 仕組みの要点:
// - 送信側: saveState() 後に「前回同期時のツリー」と「現在のツリー」を差分比較して
//   操作イベントを導出する（どの操作経路＝ペースト・複製・取り込みでも漏れなく拾える）
// - 受信側: イベントを自分の mindMapData に適用して再描画。編集中なら編集状態を保持する
// - Undo: 共同編集中は「自分の操作ログ＋逆操作」方式（相手の操作は巻き戻さない）
// - 通信部分は window._supa（storage-supabase.js）に集約。ローカル版では
//   window._supa が存在しないため、このモジュールは一切動作しない
import { deepClone, showToast } from '../utils.js';
import {
    currentMapId,
    editingNodeId,
    getNodeCyanState,
    getNodeGrayoutState,
    getNodeGreenState,
    getNodeHighlightState,
    getNodeRedTextState,
    mindMapData,
    setEditingNodeId,
    setNodeCyanState,
    setNodeGrayoutState,
    setNodeGreenState,
    setNodeHighlightState,
    setNodeRedTextState
} from '../state.js';
import { findMetaById, getMapDataKey, isSharedReadonly } from '../storage.js';
import { render } from '../render.js';

// 色状態（5種）の取得・設定関数の対応表。色の同期イベント（t:'color'）で使う
var COLOR_KINDS = {
    grayout:   { get: getNodeGrayoutState,   set: setNodeGrayoutState },
    highlight: { get: getNodeHighlightState, set: setNodeHighlightState },
    cyan:      { get: getNodeCyanState,      set: setNodeCyanState },
    green:     { get: getNodeGreenState,     set: setNodeGreenState },
    redtext:   { get: getNodeRedTextState,   set: setNodeRedTextState }
};

// ---- セッション状態 ----
var session = null; // { shareId, isOwner, handle, clientId, nickname, color, mapLocalId }
var lastSyncedTree = null;   // 前回同期時点のツリー（差分の基準）
var lastSyncedExtras = null; // 前回同期時点の色5種＋関連線（JSON文字列で保持）
var reconnectTimer = null;   // 自前の再接続タイマー
var undoStack = [];          // 自分の操作ログ [{ops, inverses}]
var redoStack = [];
var MAX_OP_LOG = 100;
var applyingRemote = false;  // 受信イベント適用中は差分送信しない
var textDebounceTimers = {}; // nodeId → タイマー（入力中の300msデバウンス送信）
var TEXT_DEBOUNCE_MS = 300;
var guestSaveTimer = null;   // ゲストのDB保存デバウンス
var GUEST_SAVE_MS = 800;
var presencePeers = {};      // clientId → { name, color, editing }
var tickTimer = null;
var lastPresenceEditing = null;
var reconnectBannerEl = null;

// 参加者の色パレット（重複しにくい順番で割り当て）
var COLLAB_COLORS = ['#d9730d', '#0b6e99', '#0f7b6c', '#6940a5', '#ad1a72', '#e03e3e', '#dfab01', '#37352f'];

function makeClientId() {
    var saved = null;
    try { saved = sessionStorage.getItem('collab-client-id'); } catch (e) {}
    if (saved) return saved;
    var id = 'c' + Math.random().toString(36).slice(2, 10);
    try { sessionStorage.setItem('collab-client-id', id); } catch (e) {}
    return id;
}

export function isCollabActive() {
    return !!session;
}

export function getCollabSession() {
    return session;
}

// ========================================
// ツリー操作ヘルパー
// ========================================

// id → { node, parent, index } の索引を作る
function indexTree(root) {
    var idx = {};
    (function walk(n, parent, i) {
        idx[n.id] = { node: n, parentId: parent ? parent.id : null, index: i };
        for (var k = 0; k < n.children.length; k++) walk(n.children[k], n, k);
    })(root, null, 0);
    return idx;
}

function findInTree(root, nodeId) {
    var found = null;
    (function walk(n, parent, i) {
        if (found) return;
        if (n.id === nodeId) { found = { node: n, parent: parent, index: i }; return; }
        for (var k = 0; k < n.children.length; k++) walk(n.children[k], n, k);
    })(root, null, 0);
    return found;
}

// ========================================
// 差分検出（前回同期ツリー vs 現在ツリー → 操作イベント列）
// ========================================
function diffTrees(oldRoot, newRoot) {
    var oldIdx = indexTree(oldRoot);
    var newIdx = indexTree(newRoot);
    var ops = [];       // 送信する操作
    var inverses = [];  // 対応する逆操作（自分のUndo用）

    // 追加: 新にあって旧にないノード。親も新規なら親側のサブツリー送信に含まれるので
    // 「親が既存ノード」のものだけをトップレベル追加として送る
    for (var id in newIdx) {
        if (oldIdx[id]) continue;
        var e = newIdx[id];
        if (e.parentId && !oldIdx[e.parentId] && e.parentId !== 'root') continue; // 親ごと追加される
        ops.push({ t: 'add', parentId: e.parentId, index: e.index, node: deepClone(e.node) });
        inverses.push({ t: 'del', nodeId: id });
    }

    // 削除: 旧にあって新にないノード（親が残っているものだけトップレベル削除）
    for (id in oldIdx) {
        if (newIdx[id]) continue;
        e = oldIdx[id];
        if (e.parentId && !newIdx[e.parentId] && e.parentId !== 'root') continue;
        ops.push({ t: 'del', nodeId: id });
        inverses.push({ t: 'add', parentId: e.parentId, index: e.index, node: deepClone(e.node) });
    }

    // 移動・テキスト・リンク変更: 両方に存在するノード
    for (id in newIdx) {
        if (!oldIdx[id]) continue;
        var o = oldIdx[id], n = newIdx[id];
        if (o.node.text !== n.node.text) {
            ops.push({ t: 'text', nodeId: id, text: n.node.text });
            inverses.push({ t: 'text', nodeId: id, text: o.node.text });
        }
        // ハイパーリンクの設定・変更・削除も同期する
        if (JSON.stringify(o.node.hyperlink || null) !== JSON.stringify(n.node.hyperlink || null)) {
            ops.push({ t: 'link', nodeId: id, hyperlink: n.node.hyperlink ? deepClone(n.node.hyperlink) : null });
            inverses.push({ t: 'link', nodeId: id, hyperlink: o.node.hyperlink ? deepClone(o.node.hyperlink) : null });
        }
        if (o.parentId !== n.parentId) {
            ops.push({ t: 'move', nodeId: id, parentId: n.parentId, index: n.index });
            inverses.push({ t: 'move', nodeId: id, parentId: o.parentId, index: o.index });
        } else if (o.parentId === n.parentId && o.index !== n.index) {
            // 同じ親内の並び替え: 生存兄弟同士の相対順が変わった場合のみ move 扱い
            // （兄弟の追加・削除によるインデックスずれは移動ではない）
            if (siblingOrderChanged(oldIdx, newIdx, id, n.parentId)) {
                ops.push({ t: 'move', nodeId: id, parentId: n.parentId, index: n.index });
                inverses.push({ t: 'move', nodeId: id, parentId: o.parentId, index: o.index });
            }
        }
    }
    return { ops: ops, inverses: inverses };
}

// 同一親内で、新旧どちらにも存在する兄弟の相対順が変わったかを判定する
function siblingOrderChanged(oldIdx, newIdx, nodeId, parentId) {
    function survivors(idx) {
        var arr = [];
        for (var id in idx) {
            if (idx[id].parentId === parentId && oldIdx[id] && newIdx[id]) {
                arr.push({ id: id, index: idx[id].index });
            }
        }
        arr.sort(function(a, b) { return a.index - b.index; });
        return arr.map(function(x) { return x.id; });
    }
    var oldOrder = survivors(oldIdx);
    var newOrder = survivors(newIdx);
    return oldOrder.indexOf(nodeId) !== newOrder.indexOf(nodeId);
}

// ========================================
// 操作イベントの適用（受信側・逆操作の適用にも使う）
// 削除済みノードへの操作は仕様どおり黙って無視する
// ========================================
function applyOp(root, op) {
    if (op.t === 'add') {
        if (findInTree(root, op.node.id)) return false; // 重複追加は無視
        var parent = op.parentId ? findInTree(root, op.parentId) : null;
        var parentNode = parent ? parent.node : root;
        if (op.parentId && !parent) return false; // 親が消えていたら無視
        var idx = Math.min(Math.max(op.index || 0, 0), parentNode.children.length);
        parentNode.children.splice(idx, 0, deepClone(op.node));
        return true;
    }
    if (op.t === 'del') {
        var r = findInTree(root, op.nodeId);
        if (!r || !r.parent) return false;
        r.parent.children.splice(r.index, 1);
        return true;
    }
    if (op.t === 'text') {
        r = findInTree(root, op.nodeId);
        if (!r) return false;
        r.node.text = op.text;
        return true;
    }
    if (op.t === 'move') {
        r = findInTree(root, op.nodeId);
        if (!r || !r.parent) return false;
        var dest = op.parentId ? findInTree(root, op.parentId) : null;
        var destNode = dest ? dest.node : root;
        if (op.parentId && !dest) return false;
        // 自分の子孫への移動はツリーを壊すため無視
        if (findInTree(r.node, destNode.id)) return false;
        r.parent.children.splice(r.index, 1);
        var di = Math.min(Math.max(op.index || 0, 0), destNode.children.length);
        destNode.children.splice(di, 0, r.node);
        return true;
    }
    if (op.t === 'link') {
        r = findInTree(root, op.nodeId);
        if (!r) return false;
        if (op.hyperlink) r.node.hyperlink = deepClone(op.hyperlink);
        else delete r.node.hyperlink;
        return true;
    }
    return false;
}

// ========================================
// 全操作共通の適用（受信・Undo・Redoで使用）。
// ツリー系は mindMapData と lastSyncedTree の両方へ、色・関連線は状態ストアへ適用する
// ========================================
function applyOpEverywhere(op) {
    if (op.t === 'color') {
        var kind = COLOR_KINDS[op.kind];
        if (!kind) return false;
        kind.set(deepClone(op.state || {}));
        if (lastSyncedExtras) lastSyncedExtras[op.kind] = JSON.stringify(op.state || {});
        return true;
    }
    if (op.t === 'rel') {
        mindMapData.relations = deepClone(op.relations || []);
        if (lastSyncedExtras) lastSyncedExtras.relations = JSON.stringify(op.relations || []);
        return true;
    }
    var changed = applyOp(mindMapData.root, op);
    if (changed) applyOp(lastSyncedTree, op); // 相手の変更は自分の差分に含めない
    return changed;
}

// 色5種＋関連線の現在値をJSON文字列のスナップショットとして集める
function collectExtras() {
    var extras = {};
    for (var kind in COLOR_KINDS) {
        extras[kind] = JSON.stringify(COLOR_KINDS[kind].get() || {});
    }
    extras.relations = JSON.stringify((mindMapData && mindMapData.relations) || []);
    return extras;
}

// ========================================
// 編集状態を保ったまま再描画する
// 受信イベントの適用は自分の編集中にも起こるため、編集テキストとフォーカスを退避・復元する
// ========================================
function renderPreservingEditing() {
    var editId = editingNodeId;
    var draftText = null;
    if (editId) {
        var el = document.querySelector('[data-id="' + editId + '"] .node-text');
        if (el) draftText = el.innerText;
    }
    render();
    if (editId && findInTree(mindMapData.root, editId)) {
        var nodeEl = document.querySelector('[data-id="' + editId + '"]');
        var textEl = nodeEl ? nodeEl.querySelector('.node-text') : null;
        if (textEl) {
            if (draftText !== null) textEl.innerText = draftText;
            nodeEl.classList.add('editing');
            nodeEl.style.width = 'auto';
            textEl.contentEditable = 'true';
            textEl.focus();
            var range = document.createRange();
            range.selectNodeContents(textEl);
            range.collapse(false); // キャレットは末尾へ
            var sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
        }
    } else if (editId) {
        // 編集中のノードが相手の操作で消えた → 編集状態を破棄
        setEditingNodeId(null);
    }
    decorateEditingOutlines();
}

// ========================================
// 送信側: saveState() 後の差分検出 → Broadcast
// ========================================
function onLocalSave() {
    if (!session || applyingRemote || !mindMapData || !mindMapData.root) return;
    if (!lastSyncedTree) {
        lastSyncedTree = deepClone(mindMapData.root);
        lastSyncedExtras = collectExtras();
        return;
    }
    var d = diffTrees(lastSyncedTree, mindMapData.root);

    // 色（5種）・関連線の変更も操作イベントとして拾う
    var extras = collectExtras();
    for (var kind in COLOR_KINDS) {
        if (lastSyncedExtras[kind] !== extras[kind]) {
            d.ops.push({ t: 'color', kind: kind, state: JSON.parse(extras[kind]) });
            d.inverses.push({ t: 'color', kind: kind, state: JSON.parse(lastSyncedExtras[kind]) });
        }
    }
    if (lastSyncedExtras.relations !== extras.relations) {
        d.ops.push({ t: 'rel', relations: JSON.parse(extras.relations) });
        d.inverses.push({ t: 'rel', relations: JSON.parse(lastSyncedExtras.relations) });
    }

    if (d.ops.length === 0) return;
    for (var i = 0; i < d.ops.length; i++) {
        var op = d.ops[i];
        op.sender = session.clientId;
        op.ts = Date.now();
        session.handle.sendOp(op);
    }
    undoStack.push({ ops: d.ops, inverses: d.inverses });
    if (undoStack.length > MAX_OP_LOG) undoStack.shift();
    redoStack = [];
    lastSyncedTree = deepClone(mindMapData.root);
    lastSyncedExtras = extras;
    persistAfterOwnEdit();
}

// 入力中のテキストを300msデバウンスでライブ送信する（1文字ごとに送らない）。
// lastSyncedTree は更新しない＝編集確定時の差分で最終テキストが正しく確定・Undo記録される
function onEditingInput(e) {
    if (!session) return;
    var textEl = e.target && e.target.closest ? e.target.closest('.node-text[contenteditable="true"]') : null;
    if (!textEl) return;
    var nodeEl = textEl.closest('.node');
    if (!nodeEl) return;
    var nodeId = nodeEl.dataset.id;
    clearTimeout(textDebounceTimers[nodeId]);
    textDebounceTimers[nodeId] = setTimeout(function() {
        delete textDebounceTimers[nodeId];
        if (!session) return;
        var el = document.querySelector('[data-id="' + nodeId + '"] .node-text');
        if (!el) return;
        var text = el.innerText.replace(/\u200B/g, '');
        session.handle.sendOp({ t: 'text', nodeId: nodeId, text: text, sender: session.clientId, ts: Date.now(), live: true });
    }, TEXT_DEBOUNCE_MS);
}

// ========================================
// 受信側
// ========================================
function onRemoteOp(op) {
    if (!session || !op || op.sender === session.clientId) return;
    // イベントが届いた＝接続は生きている。切断バナーが出ていたら復旧処理を行う
    noteConnectionAlive();
    applyingRemote = true;
    try {
        // 自分が編集中のノードへのライブテキストは適用しない（後勝ち: 自分の確定が勝つ）
        if (!(op.t === 'text' && op.live && editingNodeId === op.nodeId)) {
            var changed = applyOpEverywhere(op);
            if (changed) {
                renderPreservingEditing();
                persistAfterRemoteOp();
            }
        }
    } finally {
        applyingRemote = false;
    }
}

// ========================================
// 永続化（設計: 直近に編集した人だけが保存する）
// ========================================
function persistAfterOwnEdit() {
    if (session.isOwner) {
        // オーナーは既存の自動保存（storage.js → sync.js のデバウンス）に乗る。ここでは何もしない
        return;
    }
    // ゲストは share_id 経由でデバウンス保存。
    // 色状態（メモリ上）は data の _grayout 等へマージして保存する（オーナーの保存形式と同じ）
    clearTimeout(guestSaveTimer);
    guestSaveTimer = setTimeout(function() {
        guestSaveTimer = null;
        if (!session) return;
        var data = deepClone(mindMapData);
        data._grayout   = deepClone(getNodeGrayoutState());
        data._highlight = deepClone(getNodeHighlightState());
        data._cyan      = deepClone(getNodeCyanState());
        data._green     = deepClone(getNodeGreenState());
        data._redtext   = deepClone(getNodeRedTextState());
        delete data._collapse; // 折りたたみは各自ローカル（DBに保存しない）
        window._supa.updateSharedMapData(session.shareId, data).catch(function() {});
    }, GUEST_SAVE_MS);
}

function persistAfterRemoteOp() {
    // 受信オペでは DB 保存しない（直近編集者が保存する方式）。
    // ただしオーナーはローカルコピーだけ最新化しておく（離脱時フラッシュが古いデータを送らないように）
    if (session.isOwner && currentMapId && !isSharedReadonly()) {
        try { localStorage.setItem(getMapDataKey(currentMapId), JSON.stringify(mindMapData)); } catch (e) {}
    }
}

// ========================================
// プレゼンス（参加者リスト・編集中ノード）
// ========================================
function onPresenceSync(state) {
    presencePeers = {};
    for (var key in state) {
        var metas = state[key];
        if (metas && metas.length > 0) presencePeers[key] = metas[metas.length - 1];
    }
    // ニックネーム未入力のゲスト: 既存の「ゲストN」の最大値+1 で自動採番する（初回同期時のみ）
    if (session && session.autoName) {
        session.autoName = false;
        var maxN = 0;
        for (var k in presencePeers) {
            if (k === session.clientId) continue;
            var m = /^ゲスト(\d+)$/.exec(presencePeers[k].name || '');
            if (m && parseInt(m[1], 10) > maxN) maxN = parseInt(m[1], 10);
        }
        session.nickname = 'ゲスト' + (maxN + 1);
        try { sessionStorage.setItem('collab-nickname', session.nickname); } catch (e) {}
        session.handle.updatePresence({ name: session.nickname, color: session.color, editing: null });
    }
    renderAvatars();
    decorateEditingOutlines();
}

function renderAvatars() {
    var box = document.getElementById('collabAvatars');
    if (!session) { if (box) box.remove(); return; }
    if (!box) {
        box = document.createElement('div');
        box.id = 'collabAvatars';
        box.className = 'collab-avatars';
        document.body.appendChild(box);
    }
    box.innerHTML = '';
    var row = document.createElement('div');
    row.className = 'collab-avatar-row';
    var keys = Object.keys(presencePeers);
    for (var i = 0; i < keys.length; i++) {
        var p = presencePeers[keys[i]];
        var av = document.createElement('div');
        av.className = 'collab-avatar';
        av.style.background = p.color || '#999';
        av.textContent = (p.name || '?').charAt(0);
        av.title = p.name || '';
        row.appendChild(av);
    }
    box.appendChild(row);
    // オーナー画面: アバターの下に小さくオレンジで「共同編集中」を表示する
    if (session.isOwner) {
        var label = document.createElement('div');
        label.className = 'collab-status-label';
        label.textContent = '共同編集中';
        box.appendChild(label);
    }
}

// 「誰がどのノードを編集中か」の色枠＋名前ラベルを描画する
function decorateEditingOutlines() {
    document.querySelectorAll('.collab-editing-label').forEach(function(el) { el.remove(); });
    document.querySelectorAll('.node[data-collab-outline]').forEach(function(el) {
        el.style.boxShadow = '';
        el.removeAttribute('data-collab-outline');
    });
    if (!session) return;
    for (var key in presencePeers) {
        if (key === session.clientId) continue;
        var p = presencePeers[key];
        if (!p.editing) continue;
        var nodeEl = document.querySelector('.node[data-id="' + p.editing + '"]');
        if (!nodeEl) continue;
        nodeEl.style.boxShadow = '0 0 0 2px ' + (p.color || '#999');
        nodeEl.setAttribute('data-collab-outline', '1');
        var label = document.createElement('div');
        label.className = 'collab-editing-label';
        label.textContent = p.name || '';
        label.style.background = p.color || '#999';
        nodeEl.appendChild(label);
    }
}

// 定期処理: 自分の編集中ノードをPresenceへ反映＋色枠の再描画（render で消えるため）
function tick() {
    if (!session) return;
    var editing = editingNodeId || null;
    if (editing !== lastPresenceEditing) {
        lastPresenceEditing = editing;
        session.handle.updatePresence({
            name: session.nickname,
            color: session.color,
            editing: editing
        });
    }
    decorateEditingOutlines();
}

// ========================================
// 接続状態（再接続バナーと自前の再接続管理）
// Supabase側の自動復帰でSUBSCRIBED通知が再発火しないケースがあるため、
// ①切断検知後は3秒ごとにチャンネルへ入り直す ②イベント受信も「復旧の証拠」として扱う
// ========================================
function onStatusChange(status) {
    if (!session) return;
    if (status === 'SUBSCRIBED') {
        handleRecovered();
    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        session.hadDisconnect = true;
        showReconnectBanner();
        scheduleReconnect();
    }
}

// 切断後にイベントが届いた場合も復旧扱いにする（バナー消去＋最新データ取得）
function noteConnectionAlive() {
    if (session && session.hadDisconnect) handleRecovered();
}

function handleRecovered() {
    if (!session) return;
    hideReconnectBanner();
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
    if (!session.hadDisconnect) return;
    session.hadDisconnect = false;
    // 切断中に取りこぼした操作を埋めるため、DBから最新データを取り直してから同期を再開する
    window._supa.fetchSharedMap(session.shareId).then(function(result) {
        if (!result || !result.data || !session) return;
        applyingRemote = true;
        try {
            mindMapData.root = deepClone(result.data.root);
            if (result.data.relations) mindMapData.relations = deepClone(result.data.relations);
            hydrateColorsFromData(result.data);
            lastSyncedTree = deepClone(mindMapData.root);
            lastSyncedExtras = collectExtras();
            renderPreservingEditing();
        } finally {
            applyingRemote = false;
        }
    }).catch(function() {});
}

// 3秒ごとにチャンネルへ入り直す（成功すれば onStatus の SUBSCRIBED → handleRecovered が走る）
function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(function() {
        reconnectTimer = null;
        if (!session || !session.hadDisconnect) return;
        try { session.handle.leave(); } catch (e) {}
        session.handle = joinChannel();
        scheduleReconnect(); // 失敗に備えて次回分を予約（成功時は handleRecovered が解除）
    }, 3000);
}

// 取得した data の _grayout 等を現在の色状態ストアへ反映する
// （ゲスト=メモリ上の _sharedData、オーナー=localStorage）
function hydrateColorsFromData(data) {
    var mapping = { grayout: '_grayout', highlight: '_highlight', cyan: '_cyan', green: '_green', redtext: '_redtext' };
    for (var kind in mapping) {
        if (data[mapping[kind]]) COLOR_KINDS[kind].set(deepClone(data[mapping[kind]]));
    }
}

function showReconnectBanner() {
    if (reconnectBannerEl) return;
    reconnectBannerEl = document.createElement('div');
    reconnectBannerEl.className = 'collab-reconnect-banner';
    reconnectBannerEl.textContent = '接続が切れました。再接続中…';
    document.body.appendChild(reconnectBannerEl);
}

function hideReconnectBanner() {
    if (reconnectBannerEl) { reconnectBannerEl.remove(); reconnectBannerEl = null; }
}

// ========================================
// Undo / Redo（共同編集中: 自分の操作だけを巻き戻す）
// ========================================
export function collabUndo() {
    if (!session || undoStack.length === 0) { showToast('戻す操作がありません'); return; }
    var entry = undoStack.pop();
    applyingRemote = true;
    try {
        // 逆操作を逆順に適用（相手に消されたノード等は黙ってスキップ）
        for (var i = entry.inverses.length - 1; i >= 0; i--) {
            var inv = entry.inverses[i];
            if (applyOpEverywhere(inv)) {
                inv.sender = session.clientId;
                inv.ts = Date.now();
                session.handle.sendOp(inv);
            }
        }
        renderPreservingEditing();
        persistAfterOwnEditImmediateSafe();
    } finally {
        applyingRemote = false;
    }
    redoStack.push(entry);
    showToast('元に戻しました');
}

export function collabRedo() {
    if (!session || redoStack.length === 0) { showToast('やり直す操作がありません'); return; }
    var entry = redoStack.pop();
    applyingRemote = true;
    try {
        for (var i = 0; i < entry.ops.length; i++) {
            var op = entry.ops[i];
            if (applyOpEverywhere(op)) {
                op.ts = Date.now();
                session.handle.sendOp(op);
            }
        }
        renderPreservingEditing();
        persistAfterOwnEditImmediateSafe();
    } finally {
        applyingRemote = false;
    }
    undoStack.push(entry);
    showToast('やり直しました');
}

// Undo/Redo 直後の保存（オーナーは storage 経由、ゲストはデバウンス保存）
function persistAfterOwnEditImmediateSafe() {
    if (!session) return;
    if (session.isOwner) {
        if (currentMapId && !isSharedReadonly()) {
            try { localStorage.setItem(getMapDataKey(currentMapId), JSON.stringify(mindMapData)); } catch (e) {}
            if (typeof window._supaQueueSync === 'function') window._supaQueueSync(currentMapId);
        }
    } else {
        persistAfterOwnEdit();
    }
}

// ========================================
// セッションの開始・終了
// ========================================

// ゲストの自動採番（「ゲスト1」「ゲスト2」…）: 現在の参加者数から次の番号を割り当てる
export function nextGuestName() {
    var count = Object.keys(presencePeers).length;
    return 'ゲスト' + (count + 1);
}

export function startCollabSession(opts) {
    // opts: { shareId, isOwner, nickname, mapLocalId }
    // nickname が空のゲストは presence 同期後に「ゲストN」で自動採番される
    if (session) stopCollabSession();
    var clientId = makeClientId();
    var color = COLLAB_COLORS[Math.abs(hashCode(clientId)) % COLLAB_COLORS.length];
    session = {
        shareId: opts.shareId,
        isOwner: !!opts.isOwner,
        nickname: opts.nickname || 'ゲスト',
        autoName: !opts.nickname,
        color: color,
        clientId: clientId,
        mapLocalId: opts.mapLocalId || null,
        hadDisconnect: false,
        handle: null
    };
    lastSyncedTree = (mindMapData && mindMapData.root) ? deepClone(mindMapData.root) : null;
    lastSyncedExtras = collectExtras();
    undoStack = [];
    redoStack = [];
    presencePeers = {};
    session.handle = joinChannel();
    document.addEventListener('input', onEditingInput, true);
    tickTimer = setInterval(tick, 400);
    renderAvatars();
}

// 現在のセッション情報でRealtimeチャンネルへ参加する（初回参加・再接続の共通処理）
function joinChannel() {
    return window._supa.collabJoin(session.shareId, {
        clientId: session.clientId,
        presence: { name: session.nickname, color: session.color, editing: lastPresenceEditing },
        onOp: onRemoteOp,
        onPresence: onPresenceSync,
        onStatus: onStatusChange,
        onEnd: function() { if (window._collabOnEnded) window._collabOnEnded(); }
    });
}

export function stopCollabSession() {
    if (!session) return;
    try { session.handle.leave(); } catch (e) {}
    document.removeEventListener('input', onEditingInput, true);
    clearInterval(tickTimer);
    clearTimeout(guestSaveTimer);
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
    for (var k in textDebounceTimers) clearTimeout(textDebounceTimers[k]);
    textDebounceTimers = {};
    session = null;
    lastSyncedTree = null;
    lastSyncedExtras = null;
    presencePeers = {};
    hideReconnectBanner();
    var box = document.getElementById('collabAvatars');
    if (box) box.remove();
    decorateEditingOutlines();
}

// オーナーが共同編集を終了するとき: 終了イベントを全員に送ってから退室する
export function broadcastCollabEnd() {
    if (!session) return;
    try { session.handle.sendEnd(); } catch (e) {}
}

function hashCode(str) {
    var h = 0;
    for (var i = 0; i < str.length; i++) {
        h = ((h << 5) - h + str.charCodeAt(i)) | 0;
    }
    return h;
}

// ========================================
// オーナーの自動参加ウォッチャー
// 開いているマップが「共有ON＋共同編集ON」なら部屋に入り、
// 別マップへ切り替えたり共同編集がOFFになったら退室する
// ========================================
function ownerWatchTick() {
    if (window._collabGuest || window._isReadOnly) return; // ゲスト・閲覧ビューは対象外
    var meta = currentMapId ? findMetaById(currentMapId) : null;
    var want = !!(meta && meta.isPublic && meta.allowCollab && meta.shareId);
    if (session && session.isOwner) {
        if (!want || String(session.mapLocalId) !== String(currentMapId)) {
            stopCollabSession();
        }
    }
    if (!session && want) {
        startCollabSession({
            shareId: meta.shareId,
            isOwner: true,
            nickname: 'オーナー',
            mapLocalId: currentMapId
        });
    }
}

document.addEventListener('DOMContentLoaded', function() {
    if (!window._supa) return; // ローカル版では一切動作しない
    setInterval(ownerWatchTick, 1000);
});

// history.js から参照するフック（共通コード側は window 経由で疎結合にする）
window._collabEngine = {
    isActive: isCollabActive,
    onLocalSave: onLocalSave,
    undo: collabUndo,
    redo: collabRedo
};
