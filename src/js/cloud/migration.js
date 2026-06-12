// クラウド版: localStorage → Supabase 移行ダイアログ
import { renderMapList } from '../sidebar-left/render.js';
import { showToast } from '../utils.js';

// ---- Migration dialog ----
export function checkAndShowMigration() {
    if (!window._supa || window._supa.isMigrated()) return;
    var metaList;
    try { metaList = JSON.parse(localStorage.getItem('mindmap-meta') || '[]'); } catch(e) { metaList = []; }
    var pages   = metaList.filter(function(m) { return m.type === 'page'; });
    var folders = metaList.filter(function(m) { return m.type === 'folder' && !m.isDefault; });
    if (pages.length === 0) return;
    var overlay   = document.getElementById('migrationOverlay');
    var countEl   = document.getElementById('migrationCount');
    var accountEl = document.getElementById('migrationAccount');
    if (!overlay) return;
    if (countEl) {
        var txt = 'マップ数: ' + pages.length + '件';
        if (folders.length > 0) txt += '　フォルダ数: ' + folders.length + '件';
        countEl.textContent = txt;
    }
    // 移行先アカウントのメールアドレスを明示し、別アカウントへの誤混入を防ぐ
    if (accountEl) {
        accountEl.textContent = '移行先: 確認中...';
        window._supa.getCurrentUser().then(function(user) {
            if (user && user.email) {
                accountEl.textContent = '移行先アカウント: ' + user.email;
            } else {
                accountEl.textContent = '移行先: 不明（ログイン状態を確認してください）';
            }
        }).catch(function() {
            accountEl.textContent = '移行先: 不明';
        });
    }
    overlay.classList.add('show');
}

export function initMigrationDialog() {
    var overlay  = document.getElementById('migrationOverlay');
    var btnDo    = document.getElementById('migrationBtnDo');
    var btnLater = document.getElementById('migrationBtnLater');
    if (!overlay || !btnDo || !btnLater) return;

    btnDo.addEventListener('click', function() {
        btnDo.disabled    = true;
        btnDo.textContent = '移行中...';
        window._supa.migrateFromLocalStorage().then(function() {
            overlay.classList.remove('show');
            if (typeof showToast === 'function') showToast('✅ 移行が完了しました');
            return window._supa.loadUserData();
        }).then(function() {
            if (typeof renderMapList === 'function') renderMapList();
        }).catch(function() {
            btnDo.disabled    = false;
            btnDo.textContent = '移行する';
            if (typeof showToast === 'function') showToast('⚠️ 移行に失敗しました');
        });
    });

    btnLater.addEventListener('click', function() {
        overlay.classList.remove('show');
    });
}
