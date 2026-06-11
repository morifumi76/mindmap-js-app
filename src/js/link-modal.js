// ノードのハイパーリンク設定モーダル（init.js から分離）
import { saveState } from './history.js';
import { findNode } from './nodes.js';
import { render } from './render.js';
import { getSelectedNodeId } from './selection.js';
import { isNodeLinked } from './state.js';
import { isImeRelatedKey, showToast } from './utils.js';

// ========================================
// Link Modal (ハイパーリンク設定モーダル)
// ========================================
var linkModalInitialized = false;

// 選択状態に応じてリンクボタンを活性/非活性・リンク設定済み表示を切り替え
export function updateLinkButtonState() {
    var btn = document.getElementById('linkFloatBtn');
    if (!btn) return;
    var id = getSelectedNodeId();
    if (!id) {
        btn.disabled = true;
        btn.classList.remove('has-link');
        return;
    }
    btn.disabled = false;
    if (isNodeLinked(id)) {
        btn.classList.add('has-link');
    } else {
        btn.classList.remove('has-link');
    }
}

// URL形式を正規化（httpスキームがなければ https:// を補完）
function normalizeLinkUrl(raw) {
    if (!raw) return '';
    var url = raw.trim();
    if (!url) return '';
    if (!/^https?:\/\//i.test(url)) {
        url = 'https://' + url;
    }
    return url;
}

// http(s) のURLとして有効か判定
function isValidHttpUrl(url) {
    if (!url) return false;
    if (!/^https?:\/\/[^\s]+\.[^\s]+/i.test(url)) return false;
    try {
        new URL(url);
        return true;
    } catch (e) {
        return false;
    }
}

function validateLinkModalInput() {
    var urlInput = document.getElementById('linkModalUrl');
    var okBtn = document.getElementById('linkModalOk');
    if (!urlInput || !okBtn) return false;
    var normalized = normalizeLinkUrl(urlInput.value);
    var valid = isValidHttpUrl(normalized);
    okBtn.disabled = !valid;
    return valid;
}

export function openLinkModal() {
    var nodeId = getSelectedNodeId();
    if (!nodeId) {
        showToast('ノードを選択してください');
        return;
    }
    var r = findNode(nodeId);
    if (!r || !r.node) return;
    var existing = r.node.hyperlink || null;

    var overlay = document.getElementById('linkModalOverlay');
    var textInput = document.getElementById('linkModalText');
    var urlInput = document.getElementById('linkModalUrl');
    var deleteBtn = document.getElementById('linkModalDelete');
    var errorEl = document.getElementById('linkModalError');
    if (!overlay || !textInput || !urlInput) return;

    textInput.value = existing ? (existing.displayText || r.node.text) : r.node.text;
    urlInput.value = existing ? existing.url : '';
    deleteBtn.style.display = existing ? '' : 'none';
    errorEl.textContent = '';
    overlay.dataset.nodeId = nodeId;
    overlay.style.display = 'flex';

    validateLinkModalInput();
    setTimeout(function() {
        urlInput.focus();
        urlInput.select();
    }, 0);
}

function closeLinkModal() {
    var overlay = document.getElementById('linkModalOverlay');
    if (overlay) overlay.style.display = 'none';
}

export function isLinkModalOpen() {
    var overlay = document.getElementById('linkModalOverlay');
    return !!(overlay && overlay.style.display === 'flex');
}

function submitLinkModal() {
    var overlay = document.getElementById('linkModalOverlay');
    var nodeId = overlay ? overlay.dataset.nodeId : null;
    var textInput = document.getElementById('linkModalText');
    var urlInput = document.getElementById('linkModalUrl');
    var errorEl = document.getElementById('linkModalError');
    if (!nodeId || !textInput || !urlInput) return;

    var normalized = normalizeLinkUrl(urlInput.value);
    if (!isValidHttpUrl(normalized)) {
        errorEl.textContent = '有効なURLを入力してください';
        return;
    }

    var r = findNode(nodeId);
    if (!r || !r.node) { closeLinkModal(); return; }

    var displayText = (textInput.value || '').trim() || r.node.text;
    r.node.hyperlink = { url: normalized, displayText: displayText };
    saveState();
    render();
    updateLinkButtonState();
    closeLinkModal();
    showToast('リンクを設定しました');
}

function deleteLinkFromModal() {
    var overlay = document.getElementById('linkModalOverlay');
    var nodeId = overlay ? overlay.dataset.nodeId : null;
    if (!nodeId) { closeLinkModal(); return; }
    var r = findNode(nodeId);
    if (!r || !r.node) { closeLinkModal(); return; }
    if (!r.node.hyperlink) { closeLinkModal(); return; }
    delete r.node.hyperlink;
    saveState();
    render();
    updateLinkButtonState();
    closeLinkModal();
    showToast('リンクを削除しました');
}

export function initLinkModal() {
    if (linkModalInitialized) return;
    linkModalInitialized = true;

    var overlay = document.getElementById('linkModalOverlay');
    var urlInput = document.getElementById('linkModalUrl');
    var textInput = document.getElementById('linkModalText');
    var okBtn = document.getElementById('linkModalOk');
    var cancelBtn = document.getElementById('linkModalCancel');
    var deleteBtn = document.getElementById('linkModalDelete');
    var errorEl = document.getElementById('linkModalError');
    if (!overlay) return;

    // URL入力の変更でバリデーション
    if (urlInput) {
        urlInput.addEventListener('input', function() {
            if (errorEl) errorEl.textContent = '';
            validateLinkModalInput();
        });
        // Enter: テキスト選択中→選択解除（カーソル末尾へ）、選択なし→確定
        urlInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                // IME変換中・変換確定直後のEnterはモーダル送信しない
                if (isImeRelatedKey(e)) return;
                e.preventDefault();
                if (urlInput.selectionStart !== urlInput.selectionEnd) {
                    urlInput.selectionStart = urlInput.selectionEnd = urlInput.value.length;
                    return;
                }
                validateLinkModalInput();
                if (!okBtn.disabled) submitLinkModal();
            }
        });
    }
    if (textInput) {
        // テキスト名でEnter → URL未入力ならURL欄へ、選択中なら解除、それ以外は確定
        textInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                // IME変換中・変換確定直後のEnterはモーダル送信しない
                if (isImeRelatedKey(e)) return;
                e.preventDefault();
                if (urlInput && !urlInput.value.trim()) {
                    urlInput.focus();
                    return;
                }
                if (textInput.selectionStart !== textInput.selectionEnd) {
                    textInput.selectionStart = textInput.selectionEnd = textInput.value.length;
                    return;
                }
                validateLinkModalInput();
                if (!okBtn.disabled) submitLinkModal();
            }
        });
    }

    if (okBtn) okBtn.addEventListener('click', submitLinkModal);
    if (cancelBtn) cancelBtn.addEventListener('click', closeLinkModal);
    if (deleteBtn) deleteBtn.addEventListener('click', deleteLinkFromModal);

    // オーバーレイ外クリックで閉じる
    overlay.addEventListener('mousedown', function(e) {
        if (e.target === overlay) closeLinkModal();
    });

    // Escキーで閉じる（モーダル表示中のみ）
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && isLinkModalOpen()) {
            e.stopPropagation();
            closeLinkModal();
        }
    }, true);
}

// DOMContentLoaded is handled by app-init.js (which calls init() after auth check)
