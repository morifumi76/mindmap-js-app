// 関連線: コンテキストメニュー
import { saveState } from '../history.js';
import { render } from '../render.js';
import { showToast } from '../utils.js';
import { removeRelationById } from './model.js';

// ========================================
// 関連線用コンテキストメニュー（ダブルクリックで表示）
// ========================================
export function showRelationContextMenu(relationId, clientX, clientY) {
    var menu = ensureRelationCtxMenuEl();
    menu.dataset.relId = relationId;
    menu.style.left = clientX + 'px';
    menu.style.top = clientY + 'px';
    menu.classList.add('show');
    // 直後に来る click（mousedown起源）で閉じてしまうのを防ぐ
    menu.dataset._justShown = '1';
}

function hideRelationContextMenu() {
    var menu = document.getElementById('relationCtxMenu');
    if (menu) menu.classList.remove('show');
}

function ensureRelationCtxMenuEl() {
    var menu = document.getElementById('relationCtxMenu');
    if (menu) return menu;
    menu = document.createElement('div');
    menu.id = 'relationCtxMenu';
    menu.className = 'ctx-menu relation-ctx-menu';
    var item = document.createElement('div');
    item.className = 'ctx-menu-item danger';
    item.textContent = '取り消し';
    item.addEventListener('click', function(e) {
        e.stopPropagation();
        var relId = menu.dataset.relId;
        hideRelationContextMenu();
        if (!relId) return;
        removeRelationById(relId);
        saveState();
        render();
        showToast('関連線を削除しました');
    });
    menu.appendChild(item);
    document.body.appendChild(menu);
    // 画面のどこかをクリックしたら閉じる。
    // ただし「メニューを表示した直後に来る同じmousedown起源のclick」では閉じない（dataset._justShownフラグ方式）
    document.addEventListener('click', function(e) {
        if (menu.dataset._justShown === '1') {
            menu.dataset._justShown = '0';
            return;
        }
        if (!menu.contains(e.target)) {
            hideRelationContextMenu();
        }
    });
    return menu;
}
