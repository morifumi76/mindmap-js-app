// クラウド版: 共有URLの検出と閲覧専用モード／共同編集ゲスト参加
import { init } from '../init.js';
import { showToast } from '../utils.js';
import { startCollabSession, stopCollabSession } from './collab-engine.js';

// ---- Share URL detection ----
export function getShareIdFromUrl() {
    var path = window.location.pathname;
    var match = path.match(/\/share\/([^/?#]+)/);
    if (match) return match[1];
    var params = new URLSearchParams(window.location.search);
    return params.get('share') || null;
}

// ---- Read-only mode (shared map) ----
function enterReadOnlyMode() {
    window._isReadOnly = true;
    var banner = document.getElementById('readonlyBanner');
    if (banner) banner.classList.add('show');
    document.body.classList.add('readonly-mode');
    hideOwnerOnlyUi();
}

// 左サイドバーと、閲覧者・ゲストには不要なお気に入り星ボタンを非表示にする
function hideOwnerOnlyUi() {
    ['leftSidebar', 'leftSidebarHoverZone', 'leftSidebarFloatToggle', 'canvasStarBtn'].forEach(function(id) {
        var el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });
}

// 共有マップは localStorage に一切書き込まずメモリ上にだけ保持する。
// （別タブでログイン中のユーザーの localStorage を上書きする事故を防ぐ）
function setupSharedMemoryState(result) {
    window._sharedMeta = [
        { id: 1, name: '未分類', type: 'folder', order: 999999, isDefault: true, createdAt: '', updatedAt: '' },
        { id: 2, name: result.name, type: 'page', folderId: 1, order: 0, createdAt: '', updatedAt: '' }
    ];
    window._sharedData = result.data;
    window._sharedMapId = 2;
}

// ---- 共同編集ゲストとして参加 ----
function enterCollabGuestMode(shareId, result) {
    window._collabGuest = true;
    window._isReadOnly = false;
    setupSharedMemoryState(result);
    hideOwnerOnlyUi();

    // オーナーが共同編集をOFFにしたら、即座に閲覧専用へ切り替える
    window._collabOnEnded = function() {
        stopCollabSession();
        window._collabGuest = false;
        enterReadOnlyMode();
        if (typeof showToast === 'function') showToast('共同編集が終了しました');
    };

    init();

    // ニックネームは sessionStorage に保持（リロード時に聞き直さない）。
    // 保存済みなら即参加、未保存なら入力ダイアログを表示してから参加する。
    // 未入力のまま参加した場合は presence 同期後に「ゲストN」で自動採番される
    var saved = null;
    try { saved = sessionStorage.getItem('collab-nickname'); } catch (e) {}
    if (saved) {
        startCollabSession({ shareId: shareId, isOwner: false, nickname: saved });
    } else {
        showNicknameDialog(function(nickname) {
            if (nickname) {
                try { sessionStorage.setItem('collab-nickname', nickname); } catch (e) {}
            }
            startCollabSession({ shareId: shareId, isOwner: false, nickname: nickname });
        });
    }
}

// ニックネーム入力ダイアログ。「参加する」で入力値（未入力なら null）をコールバックへ渡す
function showNicknameDialog(onJoin) {
    var overlay = document.getElementById('nicknameOverlay');
    var input = document.getElementById('nicknameInput');
    var joinBtn = document.getElementById('nicknameJoinBtn');
    if (!overlay || !input || !joinBtn) { onJoin(null); return; }

    function join() {
        overlay.classList.remove('show');
        onJoin(input.value.trim() || null);
    }
    joinBtn.addEventListener('click', join, { once: true });
    input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && !e.isComposing) {
            e.preventDefault();
            e.stopPropagation();
            joinBtn.click();
        }
    });
    overlay.classList.add('show');
    setTimeout(function() { input.focus(); }, 0);
}

// ---- Handle shared map access ----
export function handleSharedAccess(shareId) {
    window._supa.fetchSharedMap(shareId).then(function(result) {
        if (!result || !result.data) {
            document.body.innerHTML = [
                '<div style="display:flex;align-items:center;justify-content:center;',
                'height:100vh;font-family:Meiryo UI,Meiryo,sans-serif;',
                'color:#37352f;font-size:16px;">',
                'このマップは共有されていません',
                '</div>'
            ].join('');
            return;
        }
        if (result.allow_collab) {
            // 共同編集モード: ログイン不要でゲストとして編集参加
            enterCollabGuestMode(shareId, result);
        } else {
            // 従来どおりの閲覧専用モード（変更なし）
            setupSharedMemoryState(result);
            enterReadOnlyMode();
            init();
        }
    }).catch(function() {
        document.body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:Meiryo UI,Meiryo,sans-serif;color:#37352f;font-size:16px;">マップの読み込みに失敗しました</div>';
    });
}
