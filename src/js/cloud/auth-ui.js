// クラウド版: 認証UI（ログイン/パスワード設定/ローディング/ログアウト）
import { flushSupabaseSyncImmediate } from './sync.js';

// ---- Login screen ----
export function showLoginScreen() {
    var overlay = document.getElementById('authOverlay');
    if (overlay) overlay.classList.add('show');
}

export function hideLoginScreen() {
    var overlay = document.getElementById('authOverlay');
    if (overlay) overlay.classList.remove('show');
}

// ---- Set Password screen (招待制フロー) ----
// 招待リンク経由のフロー中か（boot が設定し、パスワード設定完了時に解除される）
export var authFlow = { isInvite: false };

export function showSetPasswordScreen() {
    var overlay = document.getElementById('setPasswordOverlay');
    if (overlay) overlay.classList.add('show');
}

function hideSetPasswordScreen() {
    var overlay = document.getElementById('setPasswordOverlay');
    if (overlay) overlay.classList.remove('show');
}

export function initSetPasswordForm() {
    var form = document.getElementById('setPasswordForm');
    if (!form) return;
    form.addEventListener('submit', function(e) {
        e.preventDefault();
        var pw       = document.getElementById('newPassword').value;
        var confirm  = document.getElementById('confirmPassword').value;
        var errorEl  = document.getElementById('setPasswordError');
        var btn      = document.getElementById('setPasswordBtn');
        errorEl.textContent = '';

        if (pw.length < 8) {
            errorEl.textContent = 'パスワードは8文字以上で入力してください';
            return;
        }
        if (pw !== confirm) {
            errorEl.textContent = 'パスワードが一致しません';
            return;
        }

        btn.disabled = true;
        btn.textContent = '設定中...';

        window._supa.updatePassword(pw).then(function() {
            // パスワード設定成功 → サインアウトしてログイン画面へ
            authFlow.isInvite = false;
            return window._supa.logout();
        }).then(function() {
            hideSetPasswordScreen();
            // URLハッシュをクリーンアップ
            if (window.history.replaceState) {
                window.history.replaceState(null, '', window.location.pathname + window.location.search);
            }
            // 成功メッセージを表示してログイン画面へ
            showLoginScreen();
            var errorEl = document.getElementById('loginError');
            if (errorEl) {
                errorEl.style.color = '#2e7d32';
                errorEl.textContent = 'パスワードを設定しました。ログインしてください。';
            }
        }).catch(function(err) {
            errorEl.textContent = 'パスワードの設定に失敗しました: ' + (err.message || err);
            btn.disabled = false;
            btn.textContent = 'パスワードを設定';
        });
    });
}

// ---- Loading overlay ----
export function showLoading() {
    var el = document.getElementById('loadingOverlay');
    if (el) el.classList.add('show');
}

export function hideLoading() {
    var el = document.getElementById('loadingOverlay');
    if (el) el.classList.remove('show');
}

// 認証エラーの種類に応じたメッセージを返す
function getAuthErrorMessage(err) {
    if (!navigator.onLine) {
        return 'インターネット接続が確認できません。接続状況をご確認ください。';
    }
    var msg = (err && (err.message || err.error_description)) || '';
    var lc  = msg.toLowerCase();
    if (lc.indexOf('invalid login') !== -1 || lc.indexOf('invalid_credentials') !== -1) {
        return 'メールアドレスまたはパスワードが正しくありません。';
    }
    if (lc.indexOf('email not confirmed') !== -1) {
        return 'メールアドレスの確認が完了していません。受信メールの確認リンクをクリックしてください。';
    }
    if (lc.indexOf('network') !== -1 || lc.indexOf('failed to fetch') !== -1) {
        return 'サーバーに接続できませんでした。しばらくしてから再度お試しください。';
    }
    if (lc.indexOf('rate limit') !== -1 || (err && err.status === 429)) {
        return 'ログイン試行回数が多すぎます。しばらく待ってから再度お試しください。';
    }
    return 'ログインに失敗しました。' + (msg ? '（' + msg + '）' : '');
}

// ---- Login form ----
export function initLoginForm() {
    var form = document.getElementById('loginForm');
    if (!form) return;
    form.addEventListener('submit', function(e) {
        e.preventDefault();
        var email    = document.getElementById('loginEmail').value.trim();
        var password = document.getElementById('loginPassword').value;
        var errorEl  = document.getElementById('loginError');
        var btn      = document.getElementById('loginBtn');
        errorEl.textContent = '';
        errorEl.style.color = '';
        btn.disabled    = true;
        btn.textContent = 'ログイン中...';
        window._supa.login(email, password).catch(function(err) {
            errorEl.textContent = getAuthErrorMessage(err);
            btn.disabled    = false;
            btn.textContent = 'ログイン';
        });
    });
}

// ---- Logout button ----
export function initLogoutButton() {
    var btn = document.getElementById('logoutBtn');
    if (!btn) return;
    btn.addEventListener('click', function() {
        if (!confirm('ログアウトしますか？')) return;
        // ログアウト前に保留中の保存を Supabase へ強制フラッシュしてから logout する
        // （直前2秒以内の編集がクラウドに届かず消える事故を防ぐ）
        flushSupabaseSyncImmediate().then(function() {
            return window._supa.logout();
        }).then(function() {
            // Clear Supabase-related localStorage
            var toRemove = [];
            for (var i = 0; i < localStorage.length; i++) {
                var k = localStorage.key(i);
                if (k && (
                    k === 'mindmap-meta' || k === 'mindmap-id-counter' || k === 'mindmap-last-active-id' ||
                    k.startsWith('mindmap-data-') || k.startsWith('mindmap-supabase-')
                )) { toRemove.push(k); }
            }
            toRemove.forEach(function(k) { localStorage.removeItem(k); });
            window.location.reload();
        });
    });
}

// ---- Show logout button after login ----
export function showLogoutButton() {
    var footer = document.getElementById('leftSidebarFooter');
    if (footer) footer.style.display = '';
}
