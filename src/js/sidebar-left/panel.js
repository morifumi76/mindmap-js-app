// 左サイドバー: パネルの開閉
import { adjustCanvasForSidebars } from '../sidebar-right.js';
import { LEFT_SIDEBAR_DEFAULT, sbState } from './state.js';

export function openLeftSidebar(width) {
    var sidebar = document.getElementById('leftSidebar');
    var floatToggle = document.getElementById('leftSidebarFloatToggle');
    var toggleBtn = document.getElementById('leftSidebarToggle');
    var w = width || LEFT_SIDEBAR_DEFAULT;
    sidebar.style.width = w + 'px';
    sidebar.classList.remove('collapsed', 'peek');
    sbState.isOpen = true;
    if (floatToggle) floatToggle.classList.remove('show');
    if (toggleBtn) toggleBtn.textContent = '«';
    adjustCanvasForSidebars();
}

export function closeLeftSidebar() {
    var sidebar = document.getElementById('leftSidebar');
    var floatToggle = document.getElementById('leftSidebarFloatToggle');
    var toggleBtn = document.getElementById('leftSidebarToggle');
    sidebar.classList.add('collapsed');
    sidebar.classList.remove('peek');
    sbState.isOpen = false;
    if (floatToggle) floatToggle.classList.add('show');
    if (toggleBtn) toggleBtn.textContent = '»';
    adjustCanvasForSidebars();
}
