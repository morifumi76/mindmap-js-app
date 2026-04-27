// ========================================
// App Startup: Auth / Share routing / Migration
// (Vanilla JS — loaded after supabase bundle)
// ========================================

(function() {
    'use strict';

    var saveDebounceTimer = null;
    var saveIndicatorHideTimer = null;

    // ---- Save indicator ----
    function showSaveIndicator(text) {
        var el = document.getElementById('saveIndicator');
        if (!el) return;
        el.textContent = text;
        el.classList.add('show');
        clearTimeout(saveIndicatorHideTimer);
        if (text === '保存済み') {
            saveIndicatorHideTimer = setTimeout(function() {
                el.classList.remove('show');
            }, 2000);
        }
    }

    // ---- Supabase debounced sync (called from storage.js hook) ----
    // 保留中の同期対象マップID（フラッシュ時に参照）
    var pendingSyncMapId = null;
    // デバウンス時間（短いほどデータロスのリスクが減る／長いほど通信回数が減る）
    var SAVE_DEBOUNCE_MS = 800;

    window._supaQueueSync = function(localId) {
        if (!window._supa) return;
        clearTimeout(saveDebounceTimer);
        pendingSyncMapId = localId;
        // 通信前に未同期マーカーを localStorage に書く（同期書き込みなので即座に永続化）
        // → タブを閉じても次回起動時に拾われる
        try {
            var p = JSON.parse(localStorage.getItem('mindmap-pending-sync') || '{}');
            p[String(localId)] = 1;
            localStorage.setItem('mindmap-pending-sync', JSON.stringify(p));
        } catch(e) {}
        showSaveIndicator('保存中...');
        saveDebounceTimer = setTimeout(function() {
            saveDebounceTimer = null;
            var idToSync = pendingSyncMapId;
            pendingSyncMapId = null;
            doSupabaseSync(idToSync);
        }, SAVE_DEBOUNCE_MS);
    };

    // 保留中のデバウンス保存を即時実行する（離脱時・マップ切替時・ログアウト時に使用）
    // 戻り値: Supabase 保存完了の Promise（保留が無い場合は即解決）
    function flushSupabaseSyncImmediate() {
        if (!saveDebounceTimer) return Promise.resolve();
        clearTimeout(saveDebounceTimer);
        saveDebounceTimer = null;
        var idToSync = pendingSyncMapId;
        pendingSyncMapId = null;
        if (!idToSync) return Promise.resolve();
        return doSupabaseSync(idToSync);
    }
    // 他モジュール（sidebar-left.js など）から呼び出せるよう公開
    window._supaFlushSync = flushSupabaseSyncImmediate;

    function doSupabaseSync(localId) {
        if (!window._supa || !localId) return Promise.resolve();
        return window._supa.getCurrentUser().then(function(user) {
            if (!user) return;
            var metaList;
            try { metaList = JSON.parse(localStorage.getItem('mindmap-meta') || '[]'); } catch(e) { metaList = []; }
            var meta = null;
            for (var i = 0; i < metaList.length; i++) {
                if (metaList[i].id === localId) { meta = metaList[i]; break; }
            }
            if (!meta || meta.type !== 'page') return;
            var data;
            try { data = JSON.parse(localStorage.getItem('mindmap-data-' + localId)); } catch(e) { return; }
            if (!data) return;
            // グレーアウト・ハイライト・水色・赤文字状態をデータに含めてSupabaseへ保存
            try {
                var gray = localStorage.getItem('mindmap-node-grayout-' + localId);
                var hl   = localStorage.getItem('mindmap-node-highlight-' + localId);
                var cy   = localStorage.getItem('mindmap-node-cyan-' + localId);
                var rt   = localStorage.getItem('mindmap-node-redtext-' + localId);
                data._grayout   = gray  ? JSON.parse(gray)  : {};
                data._highlight = hl    ? JSON.parse(hl)    : {};
                data._cyan      = cy    ? JSON.parse(cy)    : {};
                data._redtext   = rt    ? JSON.parse(rt)    : {};
                data._starred   = !!meta.starred;
                data._starOrder = meta.starOrder || 0;
            } catch(e) {}
            return window._supa.saveMap(localId, meta.name, data, meta.folderId).then(function() {
                showSaveIndicator('保存済み');
            }).catch(function() {
                showSaveIndicator('⚠️ 保存失敗（ローカルに保存済み）');
                clearTimeout(saveIndicatorHideTimer);
                saveIndicatorHideTimer = setTimeout(function() {
                    document.getElementById('saveIndicator').classList.remove('show');
                }, 3000);
            });
        });
    }

    // ---- 離脱時の強制保存 ----
    // タブを閉じる・リロード・別ページ遷移・PC スリープ等で
    // デバウンス中の保存が消えないよう即時フラッシュする
    window.addEventListener('pagehide', function() { flushSupabaseSyncImmediate(); });
    window.addEventListener('beforeunload', function() { flushSupabaseSyncImmediate(); });
    document.addEventListener('visibilitychange', function() {
        if (document.visibilityState === 'hidden') flushSupabaseSyncImmediate();
    });

    // ---- Share URL detection ----
    function getShareIdFromUrl() {
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
        // Hide left sidebar completely
        ['leftSidebar', 'leftSidebarHoverZone', 'leftSidebarFloatToggle'].forEach(function(id) {
            var el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });
    }

    // ---- Login screen ----
    function showLoginScreen() {
        var overlay = document.getElementById('authOverlay');
        if (overlay) overlay.classList.add('show');
    }

    function hideLoginScreen() {
        var overlay = document.getElementById('authOverlay');
        if (overlay) overlay.classList.remove('show');
    }

    // ---- Set Password screen (招待制フロー) ----
    var _isInviteFlow = false;

    function showSetPasswordScreen() {
        var overlay = document.getElementById('setPasswordOverlay');
        if (overlay) overlay.classList.add('show');
    }

    function hideSetPasswordScreen() {
        var overlay = document.getElementById('setPasswordOverlay');
        if (overlay) overlay.classList.remove('show');
    }

    function initSetPasswordForm() {
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
                _isInviteFlow = false;
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
    function showLoading() {
        var el = document.getElementById('loadingOverlay');
        if (el) el.classList.add('show');
    }

    function hideLoading() {
        var el = document.getElementById('loadingOverlay');
        if (el) el.classList.remove('show');
    }

    // ---- Login form ----
    function initLoginForm() {
        var form = document.getElementById('loginForm');
        console.log('[DEBUG] initLoginForm called, form:', form);
        if (!form) return;
        form.addEventListener('submit', function(e) {
            e.preventDefault();
            var email    = document.getElementById('loginEmail').value.trim();
            var password = document.getElementById('loginPassword').value;
            var errorEl  = document.getElementById('loginError');
            var btn      = document.getElementById('loginBtn');
            console.log('[DEBUG] login attempt, email:', email);
            console.log('[DEBUG] window._supa exists:', !!window._supa);
            errorEl.textContent = '';
            errorEl.style.color = '';
            btn.disabled    = true;
            btn.textContent = 'ログイン中...';
            window._supa.login(email, password).then(function(user) {
                console.log('[DEBUG] login success, user:', user);
            }).catch(function(err) {
                console.error('[DEBUG] login error:', err);
                errorEl.textContent = 'メールアドレスまたはパスワードが正しくありません';
                btn.disabled    = false;
                btn.textContent = 'ログイン';
            });
        });
    }

    // ---- Migration dialog ----
    function checkAndShowMigration() {
        if (!window._supa || window._supa.isMigrated()) return;
        var metaList;
        try { metaList = JSON.parse(localStorage.getItem('mindmap-meta') || '[]'); } catch(e) { metaList = []; }
        var pages   = metaList.filter(function(m) { return m.type === 'page'; });
        var folders = metaList.filter(function(m) { return m.type === 'folder' && !m.isDefault; });
        if (pages.length === 0) return;
        var overlay  = document.getElementById('migrationOverlay');
        var countEl  = document.getElementById('migrationCount');
        if (!overlay) return;
        if (countEl) {
            var txt = 'マップ数: ' + pages.length + '件';
            if (folders.length > 0) txt += '　フォルダ数: ' + folders.length + '件';
            countEl.textContent = txt;
        }
        overlay.classList.add('show');
    }

    function initMigrationDialog() {
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

    // ---- Share dialog ----
    var shareDialogTargetId = null; // showShareDialog で開いたマップのID

    function initShareDialog() {
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

    // ---- Logout button ----
    function initLogoutButton() {
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
    function showLogoutButton() {
        var footer = document.getElementById('leftSidebarFooter');
        if (footer) footer.style.display = '';
    }

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

    // ---- Handle shared map access ----
    function handleSharedAccess(shareId) {
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
            // Pre-load the shared map data into localStorage under a temp ID
            try {
                localStorage.setItem('mindmap-meta', JSON.stringify([
                    { id: 1, name: '未分類', type: 'folder', order: 999999, isDefault: true, createdAt: '', updatedAt: '' },
                    { id: 2, name: result.name, type: 'page', folderId: 1, order: 0, createdAt: '', updatedAt: '' }
                ]));
                localStorage.setItem('mindmap-id-counter', '2');
                localStorage.setItem('mindmap-last-active-id', '2');
                localStorage.setItem('mindmap-data-2', JSON.stringify(result.data));
                localStorage.setItem('mindmap-migrated-v4', '1');
            } catch(e) {}
            enterReadOnlyMode();
            init();
        }).catch(function() {
            document.body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:Meiryo UI,Meiryo,sans-serif;color:#37352f;font-size:16px;">マップの読み込みに失敗しました</div>';
        });
    }

    // ---- Main DOMContentLoaded handler ----
    document.addEventListener('DOMContentLoaded', function() {
        console.log('[DEBUG] DOMContentLoaded fired');
        console.log('[DEBUG] window._supa exists:', !!window._supa);

        if (!window._supa) {
            console.warn('[DEBUG] Supabase bundle not loaded — running without auth');
            init();
            return;
        }

        initLoginForm();
        initSetPasswordForm();
        initMigrationDialog();
        initShareDialog();
        initLogoutButton();

        // 招待リンク判定（URLハッシュに type=invite が含まれるか）
        _isInviteFlow = window._supa.isInviteHash();

        // Check for shared URL first
        var shareId = getShareIdFromUrl();
        console.log('[DEBUG] shareId from URL:', shareId);
        if (shareId) {
            handleSharedAccess(shareId);
            return;
        }

        // Check auth state
        console.log('[DEBUG] checking current user...');
        window._supa.getCurrentUser().then(function(user) {
            console.log('[DEBUG] getCurrentUser result:', user);
            if (user) {
                handleLoggedIn();
            } else {
                console.log('[DEBUG] no user, showing login screen');
                showLoginScreen();
            }
        }).catch(function(err) {
            console.error('[DEBUG] getCurrentUser error:', err);
            showLoginScreen();
        });

        // Watch for auth changes (login/logout)
        // appInitialized が true のときはトークンリフレッシュによる誤再初期化を防ぐ
        window._supa.onAuthStateChange(function(user, event) {
            console.log('[DEBUG] onAuthStateChange fired, user:', user, 'event:', event);
            if (user) {
                // 招待フロー: セッション確立後にパスワード設定画面を表示
                if (_isInviteFlow) {
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

})();
