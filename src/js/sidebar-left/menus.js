// 左サイドバー: コンテキストメニュー
import { setCtxMenuTargetMapId } from '../state.js';
import { findMetaById } from '../storage.js';

// ---- Context Menus ----
export function showContextMenu(mapId, anchorEl) {
    hideAllContextMenus();
    setCtxMenuTargetMapId(mapId);
    var cm = document.getElementById('ctxMenu');
    // Show share item only if logged in (Supabase available)
    var shareItem = cm.querySelector('[data-action="share"]');
    if (shareItem) shareItem.style.display = window._supa ? '' : 'none';
    var rect = anchorEl.getBoundingClientRect();
    cm.style.top = rect.bottom + 4 + 'px';
    cm.style.left = rect.left + 'px';
    cm.classList.add('show');
    var cmRect = cm.getBoundingClientRect();
    if (cmRect.right > window.innerWidth) cm.style.left = (window.innerWidth - cmRect.width - 8) + 'px';
    if (cmRect.bottom > window.innerHeight) cm.style.top = (rect.top - cmRect.height - 4) + 'px';
    document.querySelectorAll('.map-item-menu-btn.open').forEach(function(el) { el.classList.remove('open'); });
    anchorEl.classList.add('open');
}

export function showFolderContextMenu(folderId, anchorEl) {
    hideAllContextMenus();
    setCtxMenuTargetMapId(folderId);
    var meta = findMetaById(folderId);
    var cm = document.getElementById('ctxMenuFolder');
    // Hide rename, add-subfolder, and delete for 未分類
    var renameItem = cm.querySelector('[data-action="folder-rename"]');
    var addSubfolderItem = cm.querySelector('[data-action="folder-add-subfolder"]');
    var deleteItem = cm.querySelector('[data-action="folder-delete"]');
    if (renameItem) renameItem.style.display = (meta && meta.isDefault) ? 'none' : '';
    if (addSubfolderItem) addSubfolderItem.style.display = (meta && meta.isDefault) ? 'none' : '';
    if (deleteItem) deleteItem.style.display = (meta && meta.isDefault) ? 'none' : '';

    var rect = anchorEl.getBoundingClientRect();
    cm.style.top = rect.bottom + 4 + 'px';
    cm.style.left = rect.left + 'px';
    cm.classList.add('show');
    var cmRect = cm.getBoundingClientRect();
    if (cmRect.right > window.innerWidth) cm.style.left = (window.innerWidth - cmRect.width - 8) + 'px';
    if (cmRect.bottom > window.innerHeight) cm.style.top = (rect.top - cmRect.height - 4) + 'px';
    document.querySelectorAll('.map-item-menu-btn.open').forEach(function(el) { el.classList.remove('open'); });
    anchorEl.classList.add('open');
}

export function showAreaContextMenu(clientX, clientY) {
    hideAllContextMenus();
    var cm = document.getElementById('ctxMenuArea');
    cm.style.top = clientY + 'px';
    cm.style.left = clientX + 'px';
    cm.classList.add('show');
    var cmRect = cm.getBoundingClientRect();
    if (cmRect.right > window.innerWidth) cm.style.left = (window.innerWidth - cmRect.width - 8) + 'px';
    if (cmRect.bottom > window.innerHeight) cm.style.top = (clientY - cmRect.height) + 'px';
}

function hideAllContextMenus() {
    document.querySelectorAll('.ctx-menu.show').forEach(function(el) { el.classList.remove('show'); });
    setCtxMenuTargetMapId(null);
}
