// テスト用 Supabase モックアダプター
// 本物の storage-supabase.js と同じ契約（window._supa）を、ネットワーク通信なしで実装する。
// クラウド版 app-init.js の glue（認証フロー・同期・共有・保存ステータス）を
// テストするためのもので、BUILD_TEST=1 のときだけ dist/test.html に組み込まれる。
//
// テスト用アカウント: test@example.com / test1234
// 共有マップ: shareId 'mockshare-valid' のみ有効
(function() {
    'use strict';

    var SESSION_KEY = 'mock-supa-session';
    var authCallbacks = [];

    // テストからの検証用: アダプターへの呼び出し履歴
    window._supaMockCalls = [];
    function record(fn, args) {
        window._supaMockCalls.push({ fn: fn, args: Array.prototype.slice.call(args) });
    }

    function getSession() {
        try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch (e) { return null; }
    }

    function fireAuthChange(user, event) {
        // 本物の onAuthStateChange と同様に非同期で通知する
        setTimeout(function() {
            authCallbacks.forEach(function(cb) { cb(user, event); });
        }, 0);
    }

    // 共有状態（enableShare/disableShare で変化）
    var shares = {}; // localId → shareId

    window._supa = {
        login: function(email, password) {
            record('login', arguments);
            if (email === 'test@example.com' && password === 'test1234') {
                var user = { id: 'mock-user-1', email: email };
                localStorage.setItem(SESSION_KEY, JSON.stringify(user));
                fireAuthChange(user, 'SIGNED_IN');
                return Promise.resolve(user);
            }
            return Promise.reject(new Error('Invalid login credentials'));
        },

        logout: function() {
            record('logout', arguments);
            localStorage.removeItem(SESSION_KEY);
            fireAuthChange(null, 'SIGNED_OUT');
            return Promise.resolve();
        },

        getCurrentUser: function() {
            return Promise.resolve(getSession());
        },

        onAuthStateChange: function(callback) {
            authCallbacks.push(callback);
            return function() {
                var i = authCallbacks.indexOf(callback);
                if (i !== -1) authCallbacks.splice(i, 1);
            };
        },

        updatePassword: function() {
            record('updatePassword', arguments);
            return Promise.resolve({});
        },

        isInviteHash: function() {
            var hash = window.location.hash;
            return hash.indexOf('type=invite') !== -1 || hash.indexOf('type=signup') !== -1;
        },

        // 新規ユーザー扱い（クラウドにデータなし）。ローカルの初期化フローに任せる
        loadUserData: function() {
            record('loadUserData', arguments);
            return Promise.resolve(false);
        },

        saveMap: function(localId) {
            record('saveMap', arguments);
            return Promise.resolve();
        },
        deleteMap: function(localId) {
            record('deleteMap', arguments);
            return Promise.resolve();
        },
        saveFolder: function(localId) {
            record('saveFolder', arguments);
            return Promise.resolve();
        },
        deleteFolder: function(localId) {
            record('deleteFolder', arguments);
            return Promise.resolve();
        },

        enableShare: function(localId) {
            record('enableShare', arguments);
            var shareId = 'mockshare-' + localId;
            shares[localId] = shareId;
            return Promise.resolve(shareId);
        },
        disableShare: function(localId) {
            record('disableShare', arguments);
            delete shares[localId];
            return Promise.resolve();
        },
        getShareInfo: function(localId) {
            return Promise.resolve(
                shares[localId]
                    ? { is_public: true, share_id: shares[localId] }
                    : { is_public: false, share_id: null }
            );
        },

        fetchSharedMap: function(shareId) {
            record('fetchSharedMap', arguments);
            if (shareId === 'mockshare-valid') {
                return Promise.resolve({
                    name: '共有テストマップ',
                    is_public: true,
                    data: { root: { id: 'root', text: '共有された中心テーマ', children: [
                        { id: 'shared1', text: '共有ノード1', children: [] }
                    ] } }
                });
            }
            return Promise.resolve(null);
        },

        migrateFromLocalStorage: function() {
            record('migrateFromLocalStorage', arguments);
            return Promise.resolve({ migrated: 0 });
        },

        getSupabaseMapId: function(localId) {
            return 'mock-uuid-' + localId;
        },

        // 移行ダイアログを出さない（移行済み扱い）
        isMigrated: function() { return true; }
    };
})();
