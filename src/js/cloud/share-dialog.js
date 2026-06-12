// クラウド版: 共有ダイアログ（共有リンクの発行・解除）
import { renderMapList } from '../sidebar-left/render.js';
import { saveToLocalStorage } from '../storage.js';
import { showToast } from '../utils.js';

// ---- Share dialog ----
var shareDialogTargetId = null; // showShareDialog で開いたマップのID

export function initShareDialog() {
    var overlay     = document.getElementById('shareOverlay');
    var closeBtn    = document.getElementById('shareCloseBtn');
    var toggleInput = document.getElementById('shareToggleInput');
    var urlBox      = document.getElementById('shareUrlBox');
    var urlInput    = document.getElementById('shareUrlInput');
    var copyBtn     = document.getElementById('shareUrlCopyBtn');
    if (!overlay) return;

    if (closeBtn) {
        closeBtn.addEventListener('click', function() {
            overlay.classList.remove('show');
        });
    }

    if (copyBtn) {
        copyBtn.addEventListener('click', function() {
            if (!urlInput.value) return;
            navigator.clipboard.writeText(urlInput.value).then(function() {
                if (typeof showToast === 'function') showToast('URLをコピーしました');
            });
        });
    }

    if (toggleInput) {
        toggleInput.addEventListener('change', function() {
            var mapId = shareDialogTargetId; // 開いたダイアログの対象マップIDを使用
            if (!mapId) return;
            if (toggleInput.checked) {
                // Save first to ensure map is in Supabase
                if (typeof saveToLocalStorage === 'function') saveToLocalStorage();
                var uuid = window._supa.getSupabaseMapId(mapId);
                if (!uuid) {
                    // Need to sync first
                    var metaList;
                    try { metaList = JSON.parse(localStorage.getItem('mindmap-meta') || '[]'); } catch(e2) { metaList = []; }
                    var meta = null;
                    for (var i = 0; i < metaList.length; i++) {
                        if (metaList[i].id === mapId) { meta = metaList[i]; break; }
                    }
                    var data;
                    try { data = JSON.parse(localStorage.getItem('mindmap-data-' + mapId)); } catch(e3) { data = null; }
                    if (!meta || !data) {
                        toggleInput.checked = false;
                        if (typeof showToast === 'function') showToast('⚠️ 先に保存してください');
                        return;
                    }
                    window._supa.saveMap(mapId, meta.name, data, meta.folderId).then(function() {
                        return window._supa.enableShare(mapId);
                    }).then(function(shareId) {
                        setShareUrl(shareId, urlInput, urlBox);
                        updateLocalShareMeta(mapId, true, shareId);
                    }).catch(function() {
                        toggleInput.checked = false;
                        if (typeof showToast === 'function') showToast('共有の設定に失敗しました');
                    });
                } else {
                    window._supa.enableShare(mapId).then(function(shareId) {
                        setShareUrl(shareId, urlInput, urlBox);
                        updateLocalShareMeta(mapId, true, shareId);
                    }).catch(function() {
                        toggleInput.checked = false;
                        if (typeof showToast === 'function') showToast('共有の設定に失敗しました');
                    });
                }
            } else {
                window._supa.disableShare(mapId).then(function() {
                    urlBox.classList.remove('show');
                    urlInput.value = '';
                    updateLocalShareMeta(mapId, false, null);
                }).catch(function() {
                    toggleInput.checked = true;
                    if (typeof showToast === 'function') showToast('共有の解除に失敗しました');
                });
            }
        });
    }
}

function setShareUrl(shareId, urlInput, urlBox) {
    var base = window.location.origin + window.location.pathname.replace(/\/share\/.*$/, '');
    urlInput.value = base.replace(/\/$/, '') + '/share/' + shareId;
    urlBox.classList.add('show');
}

function updateLocalShareMeta(localId, isPublic, shareId) {
    try {
        var metaList = JSON.parse(localStorage.getItem('mindmap-meta') || '[]');
        for (var i = 0; i < metaList.length; i++) {
            if (metaList[i].id === localId) {
                metaList[i].isPublic = isPublic;
                metaList[i].shareId  = shareId;
                break;
            }
        }
        localStorage.setItem('mindmap-meta', JSON.stringify(metaList));
    } catch(e) {}
    // サイドバーのマップ名カラーを即時反映
    if (typeof renderMapList === 'function') renderMapList();
}

// Called from sidebar-left.js share action
window.showShareDialog = function(localId) {
    if (!window._supa) { if (typeof showToast === 'function') showToast('ログインが必要です'); return; }
    var overlay     = document.getElementById('shareOverlay');
    var toggleInput = document.getElementById('shareToggleInput');
    var urlBox      = document.getElementById('shareUrlBox');
    var urlInput    = document.getElementById('shareUrlInput');
    if (!overlay) return;
    shareDialogTargetId = localId; // トグルハンドラが参照するIDをセット
    // Reset
    if (toggleInput) toggleInput.checked = false;
    if (urlBox) urlBox.classList.remove('show');
    if (urlInput) urlInput.value = '';
    // Load current share state
    window._supa.getShareInfo(localId).then(function(info) {
        if (info && info.is_public && info.share_id) {
            if (toggleInput) toggleInput.checked = true;
            setShareUrl(info.share_id, urlInput, urlBox);
        }
    });
    overlay.classList.add('show');
};
