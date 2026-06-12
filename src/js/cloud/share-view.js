// クラウド版: 共有URLの検出と閲覧専用モード
import { init } from '../init.js';

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
    // Hide left sidebar completely
    ['leftSidebar', 'leftSidebarHoverZone', 'leftSidebarFloatToggle'].forEach(function(id) {
        var el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });
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
        // 共有マップは localStorage に一切書き込まずメモリ上にだけ保持する。
        // （別タブでログイン中のユーザーの localStorage を上書きする事故を防ぐ）
        window._sharedMeta = [
            { id: 1, name: '未分類', type: 'folder', order: 999999, isDefault: true, createdAt: '', updatedAt: '' },
            { id: 2, name: result.name, type: 'page', folderId: 1, order: 0, createdAt: '', updatedAt: '' }
        ];
        window._sharedData = result.data;
        window._sharedMapId = 2;
        enterReadOnlyMode();
        init();
    }).catch(function() {
        document.body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:Meiryo UI,Meiryo,sans-serif;color:#37352f;font-size:16px;">マップの読み込みに失敗しました</div>';
    });
}
