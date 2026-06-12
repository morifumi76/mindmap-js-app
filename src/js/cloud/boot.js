// クラウド版: 起動シーケンス（認証状態の判定と画面振り分け）
import { appInitialized, init } from '../init.js';
import {
    authFlow,
    hideLoading,
    hideLoginScreen,
    initLoginForm,
    initLogoutButton,
    initSetPasswordForm,
    showLoading,
    showLoginScreen,
    showLogoutButton,
    showSetPasswordScreen
} from './auth-ui.js';
import { checkAndShowMigration, initMigrationDialog } from './migration.js';
import { setSaveStatus } from './save-status.js';
import { initShareDialog } from './share-dialog.js';
import { getShareIdFromUrl, handleSharedAccess } from './share-view.js';

// ---- Handle logged-in state ----
// 一度だけ実行するためのフラグ（タブ復帰時のトークンリフレッシュによる再実行を防ぐ）
var _handleLoggedInCalled = false;

function handleLoggedIn() {
    if (_handleLoggedInCalled) return;
    _handleLoggedInCalled = true;
    showLoading();
    showLogoutButton();
    window._supa.loadUserData().then(function(hasData) {
        hideLoading();
        init();
        if (!hasData) {
            // Check if there's localStorage data to migrate
            checkAndShowMigration();
        }
    }).catch(function() {
        hideLoading();
        // Offline or error: fall back to localStorage
        init();
    });
}

// ---- Main DOMContentLoaded handler ----
document.addEventListener('DOMContentLoaded', function() {
    // 保存ステータスの初期表示
    // 未同期キューが残っていれば「未保存」、オフラインなら「オフライン」、それ以外は「保存済み」
    try {
        var pendingObj = JSON.parse(localStorage.getItem('mindmap-pending-sync') || '{}');
        if (!navigator.onLine) setSaveStatus('offline');
        else if (Object.keys(pendingObj).length > 0) setSaveStatus('pending');
        else setSaveStatus('saved');
    } catch(e) { setSaveStatus('saved'); }

    if (!window._supa) {
        // Supabase バンドル未ロード時は認証なしで起動
        init();
        return;
    }

    initLoginForm();
    initSetPasswordForm();
    initMigrationDialog();
    initShareDialog();
    initLogoutButton();

    // 招待リンク判定（URLハッシュに type=invite が含まれるか）
    authFlow.isInvite = window._supa.isInviteHash();

    // Check for shared URL first
    var shareId = getShareIdFromUrl();
    if (shareId) {
        handleSharedAccess(shareId);
        return;
    }

    // Check auth state
    window._supa.getCurrentUser().then(function(user) {
        if (user) {
            handleLoggedIn();
        } else {
            showLoginScreen();
        }
    }).catch(function() {
        showLoginScreen();
    });

    // Watch for auth changes (login/logout)
    // appInitialized が true のときはトークンリフレッシュによる誤再初期化を防ぐ
    window._supa.onAuthStateChange(function(user, event) {
        if (user) {
            // 招待フロー: セッション確立後にパスワード設定画面を表示
            if (authFlow.isInvite) {
                hideLoginScreen();
                showSetPasswordScreen();
                return;
            }
            hideLoginScreen();
            if (!appInitialized) {
                handleLoggedIn();
            }
        }
        // logout is handled by the logout button (page reload)
    });
});
