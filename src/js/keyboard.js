import {
    editingNodeId,
    getFastMode,
    getNodeCyanState,
    getNodeGrayoutState,
    getNodeGreenState,
    getNodeHighlightState,
    getNodePinkState,
    getNodeRedTextState,
    isNodeCyan,
    isNodeGrayedOut,
    isNodeGreen,
    isNodeHighlighted,
    isNodePink,
    isNodeRedText,
    isVerticalLayout,
    selectedNodeIds,
    selectedRelationId,
    setEditingNodeId,
    setNodeCyanState,
    setNodeGrayoutState,
    setNodeGreenState,
    setNodeHighlightState,
    setNodePinkState,
    setNodeRedTextState,
    toggleNodeCollapse
} from './state.js';
import { isImeRelatedKey, showToast } from './utils.js';
import { redo, saveState, undo } from './history.js';
import {
    addChildNode,
    addSiblingNode,
    deleteNode,
    deleteSelectedNodes,
    demoteSelection,
    findNode,
    moveSelectionDown,
    moveSelectionUp,
    promoteSelection
} from './nodes.js';
import {
    clearSelection,
    getSelectedNodeId,
    getSelectedNodes,
    goToParent,
    navigateDown,
    navigateLeft,
    navigateRight,
    navigateUp,
    shiftNavigateDown,
    shiftNavigateUp
} from './selection.js';
import { finishEditing, startEditing } from './editing.js';
import { copySelectedNodes, cutSelectedNodes, pasteNode, selectAll } from './clipboard.js';
import { render } from './render.js';
import { cancelConnectionMode, deleteSelectedRelation, isConnectionModeActive } from './relations/index.js';
import { isLinkModalOpen, openLinkModal } from './link-modal.js';

// ========================================
// Keyboard Handler
// ========================================

// 背景色系の装飾（グレーアウト・ハイライト・緑・水色・ピンク）の対応表。
// 1ノード1色の相互排他：どれかをONにすると他の背景色は自動で外れる。
// ツールバーのドットボタン（init.js）とキーボードショートカットの両方から使う
var BG_COLOR_KINDS = {
    grayout:   { get: getNodeGrayoutState,   set: setNodeGrayoutState,   is: isNodeGrayedOut,   onMsg: 'グレーアウトしました', offMsg: 'グレーアウトを解除しました' },
    highlight: { get: getNodeHighlightState, set: setNodeHighlightState, is: isNodeHighlighted, onMsg: 'ハイライトしました',   offMsg: 'ハイライトを解除しました' },
    green:     { get: getNodeGreenState,     set: setNodeGreenState,     is: isNodeGreen,       onMsg: '緑にしました',         offMsg: '緑を解除しました' },
    cyan:      { get: getNodeCyanState,      set: setNodeCyanState,      is: isNodeCyan,        onMsg: '水色にしました',       offMsg: '水色を解除しました' },
    pink:      { get: getNodePinkState,      set: setNodePinkState,      is: isNodePink,        onMsg: 'ピンクにしました',     offMsg: 'ピンクを解除しました' }
};

// 選択中の全ノードに指定の背景色を適用する共通処理。
// 全ノードがON済みなら解除、そうでなければON（他の背景色は相互排他で外す）。
// 戻り値: ノード未選択で何もしなかったとき false（ボタン側の案内トースト用）
function applyBgColorToSelection(kind) {
    var nodes = getSelectedNodes();
    if (nodes.length === 0) return false;
    var target = BG_COLOR_KINDS[kind];
    var allOn = nodes.every(function(node) { return target.is(node.id); });
    var states = {};
    var k;
    for (k in BG_COLOR_KINDS) states[k] = BG_COLOR_KINDS[k].get();
    nodes.forEach(function(node) {
        if (allOn) {
            delete states[kind][node.id];
        } else {
            for (var other in BG_COLOR_KINDS) delete states[other][node.id];
            states[kind][node.id] = true;
        }
    });
    for (k in BG_COLOR_KINDS) BG_COLOR_KINDS[k].set(states[k]);
    render();
    saveState();
    showToast(allOn ? target.offMsg : target.onMsg);
    return true;
}

// 各色のショートカット／ボタン用ラッパー（init.js のドットボタンからも使う）
export function applyGrayoutToSelection()   { return applyBgColorToSelection('grayout'); }
export function applyHighlightToSelection() { return applyBgColorToSelection('highlight'); }
export function applyGreenToSelection()     { return applyBgColorToSelection('green'); }
export function applyCyanToSelection()      { return applyBgColorToSelection('cyan'); }
export function applyPinkToSelection()      { return applyBgColorToSelection('pink'); }

// 選択中の全ノードに赤文字を適用（Cmd+Opt+A）。
// 赤文字は文字色なので背景色とは独立（相互排他の対象外）
export function applyRedTextToSelection() {
    var nodes = getSelectedNodes();
    if (nodes.length === 0) return false;
    var allOn = nodes.every(function(node) { return isNodeRedText(node.id); });
    var rtState = getNodeRedTextState();
    nodes.forEach(function(node) {
        if (allOn) {
            delete rtState[node.id];
        } else {
            rtState[node.id] = true;
        }
    });
    setNodeRedTextState(rtState);
    render();
    saveState();
    showToast(allOn ? '赤文字を解除しました' : '赤文字にしました');
    return true;
}

export function handleKeyDown(e) {
    // リンク設定モーダル表示中は、モーダル内の handler（input/button）のみで処理する
    if (typeof isLinkModalOpen === 'function' && isLinkModalOpen()) return;

    // 接続待機モード中：Escでキャンセル（他のキーは通常処理に通す）
    if (typeof isConnectionModeActive === 'function' && isConnectionModeActive() && e.key === 'Escape') {
        e.preventDefault();
        cancelConnectionMode();
        return;
    }

    // Read-only mode: only allow zoom/pan shortcuts, block all editing
    if (window._isReadOnly) {
        var isMacRO = /Mac/.test(navigator.platform);
        var cmdKeyRO = isMacRO ? e.metaKey : e.ctrlKey;
        // Allow Cmd+/Ctrl+= (zoom in), Cmd+- (zoom out), Cmd+0 (reset)
        if (cmdKeyRO && (e.key === '=' || e.key === '+' || e.key === '-' || e.key === '0')) return;
        e.preventDefault();
        return;
    }

    var isMac = /Mac/.test(navigator.platform);
    var cmdKey = isMac ? e.metaKey : e.ctrlKey;

    // ツリーナビのテキスト編集欄にフォーカスがある間は、アプリのショートカットを一切処理せず
    // ブラウザ標準の入力（文字入力・削除・コピー/ペースト・Undo/Redo）に任せる
    var activeEl = document.activeElement;
    if (activeEl && activeEl.id === 'sidebarTreeEditor') {
        return;
    }

    // If focus is in a rename input field in My Maps sidebar, do NOT handle shortcuts
    if (activeEl && (activeEl.classList.contains('map-item-rename-input') ||
        (activeEl.classList.contains('map-item-name') && activeEl.contentEditable === 'true'))) {
        // Allow default behavior for the rename input (Enter/Escape は input の listener で処理)。
        // ただし Cmd+V / Cmd+X は、ノードを操作したつもりの誤発火がリネーム入力に
        // 混ざる事故が報告されているため、ここで preventDefault してブラウザ既定の
        // ペースト・カット動作を完全に止める（クリップボード内容がページ名に
        // 流入するのを防ぐ）。 Cmd+C は通常通り（テキスト選択コピー）許可。
        var _isMacRen = /Mac/.test(navigator.platform);
        var _cmdRen = _isMacRen ? e.metaKey : e.ctrlKey;
        if (_cmdRen && (e.key === 'v' || e.key === 'V' || e.key === 'x' || e.key === 'X')) {
            e.preventDefault();
        }
        return;
    }
    // 関連線のメモラベル編集中：キーをアプリショートカットに使わない（Backspaceで関連線削除しない、等）
    if (activeEl && activeEl.classList && activeEl.classList.contains('relation-label')) {
        return;
    }

    // If sidebar navigation mode is active, let the sidebar handle these keys
    if (window.sidebarNavigationMode) {
        var _sbKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'F2', 'Delete', 'Backspace'];
        if (_sbKeys.indexOf(e.key) !== -1) return;
        var _isMacSB = /Mac/.test(navigator.platform);
        var _cmdSB = _isMacSB ? e.metaKey : e.ctrlKey;
        if (_cmdSB && ['c','C','v','V','x','X','z','Z','y','Y'].indexOf(e.key) !== -1) return;
    }

    // While editing
    if (editingNodeId) {
        // IME入力中・変換確定直後のキーは無視する（ Safari 等での誤発火防止）
        if (isImeRelatedKey(e)) return;

        // 色ショートカット：編集中でも編集を確定してから色を適用する
        // 特に Option+Cmd+M は Mac のウィンドウ最小化と衝突するため、
        // 編集中でも先に preventDefault を呼んで OS の動作を抑える。
        if (e.altKey && cmdKey) {
            if (e.code === 'KeyG') { e.preventDefault(); finishEditing(); applyGrayoutToSelection();   return; }
            if (e.code === 'KeyY') { e.preventDefault(); finishEditing(); applyHighlightToSelection(); return; }
            if (e.code === 'KeyB') { e.preventDefault(); finishEditing(); applyCyanToSelection();      return; }
            if (e.code === 'KeyM') { e.preventDefault(); finishEditing(); applyGreenToSelection();     return; }
            if (e.code === 'KeyP') { e.preventDefault(); finishEditing(); applyPinkToSelection();      return; }
            if (e.code === 'KeyA') { e.preventDefault(); finishEditing(); applyRedTextToSelection();   return; }
        }

        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey
            && typeof getFastMode === 'function' && getFastMode()) {
            // 高速モード Cmd/Ctrl+Enter: 編集確定のみ（兄弟ノードは追加しない／空でも残す）。
            // proactive な「ここで打ち止め」操作。IME変換中は上の isImeRelatedKey で早期returnされるため、
            // ここに来るのは確定済みの状態のみ。
            e.preventDefault();
            finishEditing();
        } else if (e.key === 'Enter' && !e.shiftKey) {
            // OFF時の Cmd/Ctrl+Enter もここに流れる（既存挙動：finishEditing のみ）
            e.preventDefault();
            if (typeof getFastMode === 'function' && getFastMode() && !e.metaKey && !e.ctrlKey && !e.altKey) {
                // 高速モード：編集確定後、同階層に兄弟ノードを自動追加して編集モードへ突入。
                // ただしルートノード編集時はルート階層に兄弟を作らない（仕様）。
                // 新ノードのテキストは空文字にすることで、Escでそのまま破棄できるようにする。
                var prevId = editingNodeId;
                var prevInfo = findNode(prevId);
                finishEditing();
                if (isVerticalLayout()) {
                    // 縦書きモード：Enterは「下へ降りる」＝子ノードを追加（ルートからも可）
                    addChildNode(prevId, '', true);
                } else if (prevInfo && prevInfo.parent) {
                    addSiblingNode(prevId, '', true, false);
                }
            } else {
                finishEditing();
            }
        } else if (e.key === 'Enter' && e.shiftKey) {
            // Shift+Enter: insert line break
            e.preventDefault();
            var sel = window.getSelection();
            var nodeEl = document.querySelector('[data-id="' + editingNodeId + '"]');
            var textEl = nodeEl ? nodeEl.querySelector('.node-text') : null;
            if (sel.rangeCount && textEl && textEl.contains(sel.getRangeAt(0).commonAncestorContainer)) {
                var range = sel.getRangeAt(0);
                range.deleteContents();
                var br = document.createElement('br');
                range.insertNode(br);
                // Insert a zero-width space after <br> so cursor has a text node to land in
                var textNode = document.createTextNode('\u200B');
                br.parentNode.insertBefore(textNode, br.nextSibling);
                // Move cursor into the text node after <br>
                range = document.createRange();
                range.setStart(textNode, 1);
                range.setEnd(textNode, 1);
                sel.removeAllRanges();
                sel.addRange(range);
            }
        } else if (e.key === 'Escape') {
            e.preventDefault();
            if (typeof getFastMode === 'function' && getFastMode()) {
                // 高速モード：空ノードは破棄、テキストありは編集確定
                var _editId = editingNodeId;
                var _nodeEl = document.querySelector('[data-id="' + _editId + '"]');
                var _textEl = _nodeEl ? _nodeEl.querySelector('.node-text') : null;
                // ゼロ幅スペース（Shift+Enter改行時にキャレット用に挿入される）を除いて空判定する
                var _currentText = _textEl ? _textEl.textContent.replace(/\u200b/g, '').trim() : '';
                if (_currentText === '' && _editId !== 'root') {
                    // 編集モードを抜けてからノード削除（finishEditing は呼ばずに直接後始末）
                    if (_textEl) {
                        _textEl.contentEditable = 'false';
                        _nodeEl.classList.remove('editing');
                    }
                    setEditingNodeId(null);
                    deleteNode(_editId);
                } else {
                    finishEditing();
                }
            } else {
                finishEditing();
            }
        } else if (e.key === 'Tab') {
            e.preventDefault();
            finishEditing();
            if (e.shiftKey) { goToParent(); }
            else {
                var cid = getSelectedNodeId();
                if (cid) {
                    // 縦書きモード：Tabは「横に増やす」＝兄弟ノードを追加。横表示は従来どおり子を追加
                    if (isVerticalLayout()) addSiblingNode(cid);
                    else addChildNode(cid);
                }
            }
        } else if (cmdKey && (e.key === 'z' || e.key === 'Z')) {
            e.preventDefault(); finishEditing(); undo();
        } else if (cmdKey && (e.key === 'y' || e.key === 'Y')) {
            e.preventDefault(); finishEditing(); redo();
        }
        return;
    }

    var currentId = getSelectedNodeId();

    // Mac では Option+G/Y を押すと e.key が特殊文字になるため、
    // e.code で物理キーを判定してグレーアウト・ハイライトを処理する
    if (e.altKey && cmdKey) {
        if (e.code === 'KeyG') {
            e.preventDefault();
            applyGrayoutToSelection();
            return;
        }
        if (e.code === 'KeyY') {
            e.preventDefault();
            applyHighlightToSelection();
            return;
        }
        if (e.code === 'KeyB') {
            e.preventDefault();
            applyCyanToSelection();
            return;
        }
        if (e.code === 'KeyM') {
            e.preventDefault();
            applyGreenToSelection();
            return;
        }
        if (e.code === 'KeyA') {
            e.preventDefault();
            applyRedTextToSelection();
            return;
        }
        if (e.code === 'KeyK') {
            // Option+Cmd+K – open hyperlink modal for selected node
            e.preventDefault();
            if (typeof openLinkModal === 'function') openLinkModal();
            return;
        }
    }

    // 縦表示モードでは矢印キーを見た目の方向に読み替える（90度回転）。
    // 縦表示: ↑=親へ / ↓=子へ / ←→=同階層の左右移動。
    // Option（場所移動・階層変更）や Shift（範囲選択）付きも同じ読み替えが適用されるため、
    // 「押した方向にノードが動く／選択が伸びる」という見た目との一致が全修飾キーで保たれる。
    var navKey = e.key;
    if (isVerticalLayout()) {
        var verticalArrowMap = {
            ArrowUp: 'ArrowLeft',    // 上 → 親へ（横表示の←相当）
            ArrowDown: 'ArrowRight', // 下 → 子へ（横表示の→相当）
            ArrowLeft: 'ArrowUp',    // 左 → 前の兄弟へ（横表示の↑相当）
            ArrowRight: 'ArrowDown'  // 右 → 次の兄弟へ（横表示の↓相当）
        };
        if (verticalArrowMap[navKey]) navKey = verticalArrowMap[navKey];
    }

    switch (navKey) {
        case 'Enter':
            e.preventDefault();
            if (typeof getFastMode === 'function' && getFastMode()) {
                // 高速モード：選択中ノードを編集モードに突入させる（HHKB等F2なしユーザー向け）。
                // ON 時の選択モードでは Shift+Enter は無効化（仕様）。
                if (currentId && !e.shiftKey) startEditing(currentId);
            } else if (isVerticalLayout()) {
                // 縦書きモード：Enterは「下へ降りる」＝子ノードを追加（Shiftの有無は区別しない）
                if (currentId) addChildNode(currentId);
            } else {
                // 既存仕様：Shift+Enter は上に、通常の Enter は下に同階層ノードを追加
                if (currentId) addSiblingNode(currentId, undefined, undefined, e.shiftKey);
            }
            break;
        case 'Tab':
            e.preventDefault();
            if (e.shiftKey) goToParent();
            else if (currentId) {
                // 縦書きモード：Tabは「横に増やす」＝兄弟ノードを追加。横表示は従来どおり子を追加
                if (isVerticalLayout()) addSiblingNode(currentId);
                else addChildNode(currentId);
            }
            break;
        case 'Delete':
        case 'Backspace':
            e.preventDefault();
            // 関連線が選択されていれば、それを削除（確認ダイアログなし）
            if (typeof selectedRelationId !== 'undefined' && selectedRelationId) {
                deleteSelectedRelation();
                break;
            }
            if (selectedNodeIds.size > 1) deleteSelectedNodes();
            else if (currentId && currentId !== 'root') deleteNode(currentId);
            break;
        case 'F2':
            e.preventDefault();
            if (currentId) startEditing(currentId);
            break;
        case 'ArrowUp':
            e.preventDefault();
            // Option(Alt)+↑ で場所移動（メモ帳編集モードと統一）。複数選択時はまとめて移動
            if (e.altKey) { moveSelectionUp(currentId); }
            else if (e.shiftKey) { shiftNavigateUp(); }
            else navigateUp();
            break;
        case 'ArrowDown':
            e.preventDefault();
            // Option(Alt)+↓ で場所移動。複数選択時はまとめて移動
            if (e.altKey) { moveSelectionDown(currentId); }
            else if (e.shiftKey) { shiftNavigateDown(); }
            else navigateDown();
            break;
        case 'ArrowLeft':
            e.preventDefault();
            // Option(Alt)+← で親子移動（階層を1つ上げる＝外へ）。複数選択時はまとめて移動
            if (e.altKey) { promoteSelection(currentId); }
            else navigateLeft();
            break;
        case 'ArrowRight':
            e.preventDefault();
            // Option(Alt)+→ で親子移動（階層を1つ下げる＝直前の兄弟の子へ）。複数選択時はまとめて移動
            if (e.altKey) { demoteSelection(currentId); }
            else navigateRight();
            break;
        case 'z': case 'Z':
            if (cmdKey) { e.preventDefault(); undo(); }
            break;
        case 'y': case 'Y':
            if (e.altKey && cmdKey) {
                // Option+Cmd+Y (Mac) or Alt+Ctrl+Y (Windows) – toggle highlight
                e.preventDefault();
                applyHighlightToSelection();
            } else if (cmdKey) {
                e.preventDefault(); redo();
            }
            break;
        case 'a': case 'A':
            if (e.altKey && cmdKey) {
                // Option+Cmd+A – toggle red text（e.code で処理済みのためここには到達しないが念のため）
                e.preventDefault();
                applyRedTextToSelection();
            } else if (cmdKey) {
                e.preventDefault(); selectAll();
            }
            break;
        case 'c': case 'C':
            if (cmdKey) { e.preventDefault(); copySelectedNodes(); }
            break;
        case 'v': case 'V':
            if (cmdKey) { e.preventDefault(); pasteNode(); }
            break;
        case 'x': case 'X':
            if (cmdKey) { e.preventDefault(); cutSelectedNodes(); }
            break;
        case '.':
            if (cmdKey) {
                e.preventDefault();
                if (currentId) toggleNodeCollapse(currentId);
            }
            break;
        case 'g': case 'G':
            // Option+Cmd+G (Mac) or Alt+Ctrl+G (Windows) – toggle grayout
            if (e.altKey && cmdKey) {
                e.preventDefault();
                applyGrayoutToSelection();
            }
            break;
        case 'Escape':
            clearSelection();
            break;
    }
}

