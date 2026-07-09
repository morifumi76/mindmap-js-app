// クラウド版: 共有ダイアログ（共有リンクの発行・解除・共同編集の許可）
import { renderMapList } from '../sidebar-left/render.js';
import { duplicateMapToFolder } from '../sidebar-left/history-clipboard.js';
import { findMetaById, saveToLocalStorage } from '../storage.js';
import { showToast } from '../utils.js';
import { broadcastCollabEnd, getCollabSession, stopCollabSession } from './collab-engine.js';

// ---- Share dialog ----
var shareDialogTargetId = null; // showShareDialog で開いたマップのID

export function initShareDialog() {
    var overlay     = document.getElementById('shareOverlay');
    var closeBtn    = document.getElementById('shareCloseBtn');
    var toggleInput = document.getElementById('shareToggleInput');
    var urlBox      = document.getElementById('shareUrlBox');
    var urlInput    = document.getElementById('shareUrlInput');
    var copyBtn     = document.getElementById('shareUrlCopyBtn');
    var collabInput = document.getElementById('collabToggleInput');
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
                        updateLocalShareMeta(mapId, true, shareId, false);
                        setCollabRowVisible(true, false);
                    }).catch(function() {
                        toggleInput.checked = false;
                        if (typeof showToast === 'function') showToast('共有の設定に失敗しました');
                    });
                } else {
                    // 共有ONのたびに新しい share_id を発行する（古いURLは無効になる＝流出対策）
                    window._supa.enableShare(mapId).then(function(shareId) {
                        setShareUrl(shareId, urlInput, urlBox);
                        updateLocalShareMeta(mapId, true, shareId, false);
                        setCollabRowVisible(true, false);
                    }).catch(function() {
                        toggleInput.checked = false;
                        if (typeof showToast === 'function') showToast('共有の設定に失敗しました');
                    });
                }
            } else {
                // 共有OFF: 共同編集も自動的にOFFへ戻す（消し忘れ事故の防止）
                var wasCollab = collabInput && collabInput.checked;
                window._supa.disableShare(mapId).then(function() {
                    if (wasCollab) return turnCollabOff(mapId);
                }).then(function() {
                    urlBox.classList.remove('show');
                    urlInput.value = '';
                    updateLocalShareMeta(mapId, false, null, false);
                    setCollabRowVisible(false, false);
                }).catch(function() {
                    toggleInput.checked = true;
                    if (typeof showToast === 'function') showToast('共有の解除に失敗しました');
                });
            }
        });
    }

    if (collabInput) {
        collabInput.addEventListener('change', function() {
            var mapId = shareDialogTargetId;
            if (!mapId) return;
            if (collabInput.checked) {
                // お守りバックアップ確認 → その後 allow_collab = true
                showBackupConfirm(mapId, function() {
                    window._supa.setCollabEnabled(mapId, true).then(function() {
                        var meta = findMetaById(mapId);
                        updateLocalShareMeta(mapId, true, meta ? meta.shareId : null, true);
                        if (typeof showToast === 'function') showToast('共同編集を開始しました');
                    }).catch(function() {
                        collabInput.checked = false;
                        if (typeof showToast === 'function') showToast('共同編集の設定に失敗しました');
                    });
                });
            } else {
                turnCollabOff(mapId).then(function() {
                    if (typeof showToast === 'function') showToast('共同編集を終了しました');
                }).catch(function() {
                    collabInput.checked = true;
                    if (typeof showToast === 'function') showToast('共同編集の解除に失敗しました');
                });
            }
        });
    }

    initBackupConfirmDialog();
}

// 共同編集をOFFにする共通処理:
// 参加中のゲストへ終了イベントを送ってから自分も退室し、DBのフラグを下ろす
function turnCollabOff(mapId) {
    var session = getCollabSession();
    if (session && session.isOwner) {
        broadcastCollabEnd();
        stopCollabSession();
    }
    return window._supa.setCollabEnabled(mapId, false).then(function() {
        var meta = findMetaById(mapId);
        updateLocalShareMeta(mapId, !!(meta && meta.isPublic), meta ? meta.shareId : null, false);
    });
}

// ---- お守りバックアップ確認ダイアログ ----
var backupResolve = null;

function initBackupConfirmDialog() {
    var overlay = document.getElementById('backupConfirmOverlay');
    var yesBtn = document.getElementById('backupYesBtn');
    var noBtn = document.getElementById('backupNoBtn');
    if (!overlay || !yesBtn || !noBtn) return;

    yesBtn.addEventListener('click', function() {
        overlay.classList.remove('show');
        if (backupResolve) { var r = backupResolve; backupResolve = null; r(true); }
    });
    noBtn.addEventListener('click', function() {
        overlay.classList.remove('show');
        if (backupResolve) { var r = backupResolve; backupResolve = null; r(false); }
    });
}

// 確認を表示し、「はい」なら複製バックアップを作ってから onProceed を呼ぶ。
// 「いいえ」は何もせず onProceed（自動バックアップはしない仕様）
function showBackupConfirm(mapId, onProceed) {
    var overlay = document.getElementById('backupConfirmOverlay');
    if (!overlay) { onProceed(); return; }
    overlay.classList.add('show');
    backupResolve = function(doBackup) {
        if (doBackup) {
            var meta = findMetaById(mapId);
            if (meta) {
                // 「{マップ名}_バックアップ_YYYY-MM-DD」で複製（既存の複製機能を流用・非公開で作成）
                var d = new Date();
                var dateStr = d.getFullYear() + '-' +
                    String(d.getMonth() + 1).padStart(2, '0') + '-' +
                    String(d.getDate()).padStart(2, '0');
                var backupName = meta.name + '_バックアップ_' + dateStr;
                duplicateMapToFolder(mapId, meta.folderId || null, backupName);
                if (typeof renderMapList === 'function') renderMapList();
                if (typeof showToast === 'function') showToast('バックアップを保存しました');
            }
        }
        onProceed();
    };
}

function setShareUrl(shareId, urlInput, urlBox) {
    var base = window.location.origin + window.location.pathname.replace(/\/share\/.*$/, '');
    urlInput.value = base.replace(/\/$/, '') + '/share/' + shareId;
    urlBox.classList.add('show');
}

// 共同編集トグル行の表示/状態を切り替える
function setCollabRowVisible(visible, checked) {
    var collabRow = document.getElementById('shareCollabRow');
    var collabInput = document.getElementById('collabToggleInput');
    if (collabRow) collabRow.classList.toggle('show', !!visible);
    if (collabInput) collabInput.checked = !!checked;
}

function updateLocalShareMeta(localId, isPublic, shareId, allowCollab) {
    try {
        var metaList = JSON.parse(localStorage.getItem('mindmap-meta') || '[]');
        for (var i = 0; i < metaList.length; i++) {
            if (metaList[i].id === localId) {
                metaList[i].isPublic = isPublic;
                metaList[i].shareId  = shareId;
                metaList[i].allowCollab = !!allowCollab;
                break;
            }
        }
        localStorage.setItem('mindmap-meta', JSON.stringify(metaList));
    } catch(e) {}
    // サイドバーのマップ名カラー（黒/青/オレンジ）を即時反映
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
    setCollabRowVisible(false, false);
    // Load current share state
    window._supa.getShareInfo(localId).then(function(info) {
        if (info && info.is_public && info.share_id) {
            if (toggleInput) toggleInput.checked = true;
            setShareUrl(info.share_id, urlInput, urlBox);
            setCollabRowVisible(true, !!info.allow_collab);
        }
    });
    overlay.classList.add('show');
};
