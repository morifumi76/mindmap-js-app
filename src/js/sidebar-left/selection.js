// 左サイドバー: 項目の選択状態
import { sbState, sidebarSelectedIds } from './state.js';

// ---- Sidebar Selection Helpers ----
export function clearSidebarSelection() {
    sidebarSelectedIds.clear();
    sbState.lastSelectedId = null;
    sbState.anchorId = null;
    document.querySelectorAll('#mapList .map-item.sidebar-selected').forEach(function(el) {
        el.classList.remove('sidebar-selected');
    });
}

export function updateSidebarSelectionDisplay() {
    document.querySelectorAll('#mapList .map-item').forEach(function(el) {
        el.classList.toggle('sidebar-selected', sidebarSelectedIds.has(el.dataset.mapId));
    });
}

export function sidebarRangeSelect(targetId) {
    if (!sbState.anchorId) {
        sidebarSelectedIds.add(targetId);
        sbState.lastSelectedId = targetId;
        sbState.anchorId = targetId;
        updateSidebarSelectionDisplay();
        return;
    }
    var items = Array.from(document.querySelectorAll('#mapList .map-item'));
    var ids = items.map(function(el) { return el.dataset.mapId; });
    var ai = ids.indexOf(sbState.anchorId);
    var ti = ids.indexOf(targetId);
    if (ai === -1 || ti === -1) {
        sidebarSelectedIds.add(targetId);
        sbState.lastSelectedId = targetId;
        updateSidebarSelectionDisplay();
        return;
    }
    var mn = Math.min(ai, ti), mx = Math.max(ai, ti);
    sidebarSelectedIds.clear();
    for (var i = mn; i <= mx; i++) {
        if (ids[i]) sidebarSelectedIds.add(ids[i]);
    }
    sbState.lastSelectedId = targetId;
    updateSidebarSelectionDisplay();
}
