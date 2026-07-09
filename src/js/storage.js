import { currentMapId, mindMapData } from './state.js';

// ========================================
// Multi-Map Storage Layer
// ========================================

var META_KEY = 'mindmap-meta';
var ID_COUNTER_KEY = 'mindmap-id-counter';
var LAST_ACTIVE_KEY = 'mindmap-last-active-id';
var OLD_STORAGE_KEY = 'mindmap_data_v2'; // legacy key for migration

// 共有URL閲覧モード、または共同編集のゲスト参加中は true。
// どちらも「閲覧者・ゲストの localStorage を一切汚さない」ためのガードに使う
// （ゲストの編集はメモリ上の mindMapData と Realtime 同期だけで完結する）
export function isSharedReadonly() {
    return !!((window._isReadOnly || window._collabGuest) && window._sharedMeta);
}

export function getMapDataKey(mapId) {
    return 'mindmap-data-' + mapId;
}

export function getMetaList() {
    // 共有モードはメモリ上のメタリストを返す（localStorage を読まない）
    if (isSharedReadonly()) {
        return JSON.parse(JSON.stringify(window._sharedMeta));
    }
    try {
        var raw = localStorage.getItem(META_KEY);
        if (raw) return JSON.parse(raw);
    } catch(e) {}
    return [];
}

export function saveMetaList(metaList) {
    // 共有モードでは localStorage を絶対に書き換えない
    if (isSharedReadonly()) return;
    try { localStorage.setItem(META_KEY, JSON.stringify(metaList)); } catch(e) {}
}

export function getNextMapId() {
    if (isSharedReadonly()) return 0; // 新規ID不要
    var counter = parseInt(localStorage.getItem(ID_COUNTER_KEY), 10) || 0;
    counter++;
    try { localStorage.setItem(ID_COUNTER_KEY, String(counter)); } catch(e) {}
    return counter;
}

export function setLastActiveId(mapId) {
    if (isSharedReadonly()) return;
    try { localStorage.setItem(LAST_ACTIVE_KEY, String(mapId)); } catch(e) {}
}

export function getLastActiveId() {
    if (isSharedReadonly()) return window._sharedMapId || null;
    return parseInt(localStorage.getItem(LAST_ACTIVE_KEY), 10) || null;
}

export function findMetaById(mapId) {
    var list = getMetaList();
    for (var i = 0; i < list.length; i++) {
        if (String(list[i].id) === String(mapId)) return list[i];
    }
    return null;
}

export function nowISO() {
    return new Date().toISOString();
}

var SORT_MODE_KEY = 'mindmap-sort-mode';
var COLLAPSE_STATE_KEY = 'mindmap-collapse-state';
var TITLE_DATE_MODE_KEY = 'mindmap-title-date-mode';

export function getSortMode() {
    return localStorage.getItem(SORT_MODE_KEY) || 'none';
}
export function setSortMode(mode) {
    if (isSharedReadonly()) return;
    try { localStorage.setItem(SORT_MODE_KEY, mode); } catch(e) {}
}

// 「タイトルに日付」モード（ON時、新規作成タイトルが YYYYMMDD_ になる）。初期値は OFF。
export function getTitleDateMode() {
    return localStorage.getItem(TITLE_DATE_MODE_KEY) === 'on';
}
export function setTitleDateMode(on) {
    if (isSharedReadonly()) return;
    try { localStorage.setItem(TITLE_DATE_MODE_KEY, on ? 'on' : 'off'); } catch(e) {}
}
// 端末ローカルの今日の日付を YYYYMMDD 形式（ゼロ埋め）で返す
function getTodayDatePrefix() {
    var d = new Date();
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return y + m + day;
}
// 新規マップのデフォルトタイトル（モードONなら YYYYMMDD_、OFFなら 無題のマップ）
export function getDefaultNewMapName() {
    return getTitleDateMode() ? (getTodayDatePrefix() + '_') : '無題のマップ';
}
export function getCollapseState() {
    try {
        var raw = localStorage.getItem(COLLAPSE_STATE_KEY);
        if (raw) return JSON.parse(raw);
    } catch(e) {}
    return {};
}
export function setCollapseState(state) {
    if (isSharedReadonly()) return;
    try { localStorage.setItem(COLLAPSE_STATE_KEY, JSON.stringify(state)); } catch(e) {}
}

// ---- Helper: ensure 未分類 folder exists ----
// 未分類フォルダは廃止済み。互換のため関数は残し、単に metaList をそのまま返す。
// 既存呼び出し箇所は順次撤去予定。
export function ensureDefaultFolder(metaList) {
    return metaList;
}

export function getDefaultFolderId(metaList) {
    if (!metaList) metaList = getMetaList();
    for (var i = 0; i < metaList.length; i++) {
        if (metaList[i].type === 'folder' && metaList[i].isDefault) return metaList[i].id;
    }
    return null;
}

// 旧仕様で残っている "未分類"（isDefault: true）フォルダを取り除き、
// 配下のページはトップレベル（folderId = null）に救出する。
// - ローカル metaList を即時更新
// - Supabase 側へは「対象ページの folder_id を null に更新 → フォルダ削除」を非同期で実施
// - 冪等：未分類フォルダが存在しなければ何もしない
export function cleanupDefaultFolders() {
    if (typeof isSharedReadonly === 'function' && isSharedReadonly()) return;
    var metaList = getMetaList();
    var defaultIds = [];
    for (var i = 0; i < metaList.length; i++) {
        var m = metaList[i];
        if (m && m.type === 'folder' && m.isDefault) defaultIds.push(m.id);
    }
    if (defaultIds.length === 0) return;

    // 配下ページを集めて folderId を null に救出
    var rescuedPages = [];
    for (i = 0; i < metaList.length; i++) {
        var p = metaList[i];
        if (p.type === 'page' && defaultIds.indexOf(p.folderId) !== -1) {
            p.folderId = null;
            rescuedPages.push(p);
        }
    }
    // 未分類フォルダ自身を metaList から除去
    var filtered = [];
    for (i = 0; i < metaList.length; i++) {
        if (defaultIds.indexOf(metaList[i].id) === -1) filtered.push(metaList[i]);
    }
    saveMetaList(filtered);

    // Supabase 同期（best-effort、失敗しても次回起動で再試行される）
    if (window._supa) {
        // ① 救出ページの folder_id を null に更新（先にやらないと外部キー制約で folder の削除が失敗する可能性がある）
        var pageUpdatePromises = [];
        for (i = 0; i < rescuedPages.length; i++) {
            var pg = rescuedPages[i];
            try {
                var raw = localStorage.getItem(getMapDataKey(pg.id));
                var data = raw ? JSON.parse(raw) : null;
                if (data) {
                    pageUpdatePromises.push(
                        window._supa.saveMap(pg.id, pg.name, data, null).catch(function(){})
                    );
                }
            } catch(e) {}
        }
        // ② すべてのページ更新が完了してから未分類フォルダを Supabase からも削除
        Promise.all(pageUpdatePromises).then(function() {
            for (var j = 0; j < defaultIds.length; j++) {
                try { window._supa.deleteFolder(defaultIds[j]).catch(function(){}); } catch(e) {}
            }
        });
    }
}

// ---- Migration from old single-map storage ----
export function migrateIfNeeded() {
    // 共有モードでは migration を走らせない（localStorage を一切触らない）
    if (isSharedReadonly()) return;
    // v4 migration: convert old parentId/order schema to folder/page schema
    var existing = getMetaList();
    if (existing.length > 0 && !localStorage.getItem('mindmap-migrated-v4')) {
        // Detect old schema: entries without 'type' field
        var needsMigration = false;
        for (var i = 0; i < existing.length; i++) {
            if (!existing[i].type) { needsMigration = true; break; }
        }

        if (needsMigration) {
            var now = nowISO();
            var newMeta = [];

            // Identify old parents (parentId === null with children) and children
            var parentIds = {};
            var childrenOf = {};
            for (i = 0; i < existing.length; i++) {
                var m = existing[i];
                if (m.parentId === undefined || m.parentId === null) {
                    parentIds[m.id] = m;
                } else {
                    if (!childrenOf[m.parentId]) childrenOf[m.parentId] = [];
                    childrenOf[m.parentId].push(m);
                }
            }

            // Create 未分類 folder first
            var defaultFolderId = getNextMapId();
            newMeta.push({
                id: defaultFolderId,
                name: '未分類',
                type: 'folder',
                order: 999999,
                createdAt: now,
                updatedAt: now,
                isDefault: true
            });

            var folderOrder = 0;
            for (var pid in parentIds) {
                var pm = parentIds[pid];
                var hadChildren = childrenOf[pid] && childrenOf[pid].length > 0;

                if (hadChildren) {
                    // Old parent with children: convert to folder
                    // Check if parent itself has mindmap data
                    var parentData = loadMapData(pm.id);
                    var folderId;

                    // Create folder from the old parent
                    folderId = getNextMapId();
                    newMeta.push({
                        id: folderId,
                        name: pm.name || '新しいフォルダ',
                        type: 'folder',
                        order: folderOrder++,
                        createdAt: pm.createdAt || now,
                        updatedAt: pm.updatedAt || now
                    });

                    // If parent had mindmap data, also create a page for it inside the folder
                    if (parentData && parentData.root) {
                        var pageId = getNextMapId();
                        newMeta.push({
                            id: pageId,
                            name: pm.name || '無題のマップ',
                            type: 'page',
                            folderId: folderId,
                            order: 0,
                            createdAt: pm.createdAt || now,
                            updatedAt: pm.updatedAt || now
                        });
                        // Copy the mindmap data to new page ID
                        try { localStorage.setItem(getMapDataKey(pageId), JSON.stringify(parentData)); } catch(e) {}
                    }
                    // Remove old parent's mindmap data key
                    try { localStorage.removeItem(getMapDataKey(pm.id)); } catch(e) {}

                    // Convert children to pages in this folder
                    var children = childrenOf[pid];
                    for (var ci = 0; ci < children.length; ci++) {
                        var cm = children[ci];
                        newMeta.push({
                            id: cm.id,
                            name: cm.name || '無題のマップ',
                            type: 'page',
                            folderId: folderId,
                            order: (parentData ? 1 : 0) + ci,
                            createdAt: cm.createdAt || now,
                            updatedAt: cm.updatedAt || now
                        });
                    }
                } else {
                    // Old parent without children: convert to page in 未分類
                    newMeta.push({
                        id: pm.id,
                        name: pm.name || '無題のマップ',
                        type: 'page',
                        folderId: defaultFolderId,
                        order: folderOrder++,
                        createdAt: pm.createdAt || now,
                        updatedAt: pm.updatedAt || now
                    });
                }
            }

            // Handle orphan children (whose parentId doesn't match any parent)
            for (var cpid in childrenOf) {
                if (!parentIds[cpid]) {
                    var orphans = childrenOf[cpid];
                    for (var oi = 0; oi < orphans.length; oi++) {
                        newMeta.push({
                            id: orphans[oi].id,
                            name: orphans[oi].name || '無題のマップ',
                            type: 'page',
                            folderId: defaultFolderId,
                            order: 1000 + oi,
                            createdAt: orphans[oi].createdAt || now,
                            updatedAt: orphans[oi].updatedAt || now
                        });
                    }
                }
            }

            saveMetaList(newMeta);
            setSortMode('none');
        }

        try { localStorage.setItem('mindmap-migrated-v4', '1'); } catch(e) {}
        return; // skip old migration below
    }

    // v4 flag already set but ensure schema is correct
    if (localStorage.getItem('mindmap-migrated-v4') && existing.length > 0) {
        // 未分類は廃止済み。type 欠落のみ補修する（folderId が無いページはトップレベル扱い）
        var needsRepair = false;
        for (i = 0; i < existing.length; i++) {
            if (!existing[i].type) {
                existing[i].type = 'page';
                needsRepair = true;
            }
        }
        if (needsRepair) saveMetaList(existing);
        return;
    }

    // If meta already exists (with v4 flag), skip old migration
    if (localStorage.getItem(META_KEY)) return;

    var oldData = null;
    try {
        var raw = localStorage.getItem(OLD_STORAGE_KEY);
        if (raw) {
            var parsed = JSON.parse(raw);
            if (parsed && parsed.root && parsed.root.id === 'root') {
                oldData = parsed;
            }
        }
    } catch(e) {}

    now = nowISO();
    var initialMeta = [];

    // 新規ユーザー初期化：未分類フォルダは作らず、最初のページをトップレベル（folderId = null）に置く
    if (oldData) {
        // 旧データを移行してトップレベルに配置
        var mapId = getNextMapId();
        var mapName = oldData.root.text || '無題のマップ';
        initialMeta.push({ id: mapId, name: mapName, type: 'page', folderId: null, order: 0, createdAt: now, updatedAt: now });
        saveMetaList(initialMeta);
        try { localStorage.setItem(getMapDataKey(mapId), JSON.stringify(oldData)); } catch(e) {}
        setLastActiveId(mapId);
        try { localStorage.removeItem(OLD_STORAGE_KEY); } catch(e) {}
    } else {
        // 既存データなし：空ページをトップレベルに作成
        mapId = getNextMapId();
        var defaultData = { root: { id: 'root', text: '中心テーマ', children: [] } };
        initialMeta.push({ id: mapId, name: '無題のマップ', type: 'page', folderId: null, order: 0, createdAt: now, updatedAt: now });
        saveMetaList(initialMeta);
        try { localStorage.setItem(getMapDataKey(mapId), JSON.stringify(defaultData)); } catch(e) {}
        setLastActiveId(mapId);
    }
    try { localStorage.setItem('mindmap-migrated-v4', '1'); } catch(e) {}
}

// ---- お気に入りトグル ----
export function toggleFavorite(mapId) {
    var metaList = getMetaList();
    for (var i = 0; i < metaList.length; i++) {
        if (String(metaList[i].id) === String(mapId)) {
            metaList[i].starred = !metaList[i].starred;
            if (metaList[i].starred) {
                // お気に入り追加時: 末尾に配置（既存の最大 starOrder + 1）
                var maxSO = 0;
                for (var j = 0; j < metaList.length; j++) {
                    if (metaList[j].starred && metaList[j].starOrder > maxSO) maxSO = metaList[j].starOrder;
                }
                metaList[i].starOrder = maxSO + 1;
            }
            saveMetaList(metaList);
            // Supabaseにもstarred状態を同期
            if (typeof window._supaQueueSync === 'function' && !window._isReadOnly && !window._collabGuest) {
                window._supaQueueSync(mapId);
            }
            return metaList[i].starred;
        }
    }
    return false;
}

// ---- Save / Load for current map ----
export function saveToLocalStorage() {
    if (!currentMapId) return;
    // 共有モードでは絶対に localStorage を書き換えない
    if (isSharedReadonly()) return;
    try {
        localStorage.setItem(getMapDataKey(currentMapId), JSON.stringify(mindMapData));
    } catch(e) {}
    // Update meta updatedAt
    var metaList = getMetaList();
    for (var i = 0; i < metaList.length; i++) {
        if (metaList[i].id === currentMapId) {
            metaList[i].updatedAt = nowISO();
            break;
        }
    }
    saveMetaList(metaList);
    // Supabase debounced sync
    if (typeof window._supaQueueSync === 'function' && !window._isReadOnly && !window._collabGuest) {
        window._supaQueueSync(currentMapId);
    }
}

export function loadMapData(mapId) {
    // 共有モードはメモリ上のデータだけ返す
    if (isSharedReadonly()) {
        if (String(mapId) === String(window._sharedMapId) && window._sharedData) {
            return JSON.parse(JSON.stringify(window._sharedData));
        }
        return null;
    }
    try {
        var raw = localStorage.getItem(getMapDataKey(mapId));
        if (raw) {
            var parsed = JSON.parse(raw);
            if (parsed && parsed.root && parsed.root.id === 'root') {
                return parsed;
            }
        }
    } catch(e) {}
    return null;
}

