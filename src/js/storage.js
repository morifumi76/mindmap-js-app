// ========================================
// Multi-Map Storage Layer
// ========================================

var META_KEY = 'mindmap-meta';
var ID_COUNTER_KEY = 'mindmap-id-counter';
var LAST_ACTIVE_KEY = 'mindmap-last-active-id';
var OLD_STORAGE_KEY = 'mindmap_data_v2'; // legacy key for migration

function getMapDataKey(mapId) {
    return 'mindmap-data-' + mapId;
}

function getMetaList() {
    try {
        var raw = localStorage.getItem(META_KEY);
        if (raw) return JSON.parse(raw);
    } catch(e) {}
    return [];
}

function saveMetaList(metaList) {
    try { localStorage.setItem(META_KEY, JSON.stringify(metaList)); } catch(e) {}
}

function getNextMapId() {
    var counter = parseInt(localStorage.getItem(ID_COUNTER_KEY), 10) || 0;
    counter++;
    try { localStorage.setItem(ID_COUNTER_KEY, String(counter)); } catch(e) {}
    return counter;
}

function setLastActiveId(mapId) {
    try { localStorage.setItem(LAST_ACTIVE_KEY, String(mapId)); } catch(e) {}
}

function getLastActiveId() {
    return parseInt(localStorage.getItem(LAST_ACTIVE_KEY), 10) || null;
}

function findMetaById(mapId) {
    var list = getMetaList();
    for (var i = 0; i < list.length; i++) {
        if (list[i].id === mapId) return list[i];
    }
    return null;
}

function nowISO() {
    return new Date().toISOString();
}

var SORT_MODE_KEY = 'mindmap-sort-mode';
var COLLAPSE_STATE_KEY = 'mindmap-collapse-state';

function getSortMode() {
    return localStorage.getItem(SORT_MODE_KEY) || 'none';
}
function setSortMode(mode) {
    try { localStorage.setItem(SORT_MODE_KEY, mode); } catch(e) {}
}
function getCollapseState() {
    try {
        var raw = localStorage.getItem(COLLAPSE_STATE_KEY);
        if (raw) return JSON.parse(raw);
    } catch(e) {}
    return {};
}
function setCollapseState(state) {
    try { localStorage.setItem(COLLAPSE_STATE_KEY, JSON.stringify(state)); } catch(e) {}
}

// ---- Helper: ensure 未分類 folder exists ----
function ensureDefaultFolder(metaList) {
    var hasDefault = false;
    for (var i = 0; i < metaList.length; i++) {
        if (metaList[i].type === 'folder' && metaList[i].isDefault) {
            hasDefault = true;
            break;
        }
    }
    if (!hasDefault) {
        var folderId = getNextMapId();
        var now = nowISO();
        metaList.push({
            id: folderId,
            name: '未分類',
            type: 'folder',
            order: 999999, // always last
            createdAt: now,
            updatedAt: now,
            isDefault: true
        });
    }
    return metaList;
}

function getDefaultFolderId(metaList) {
    if (!metaList) metaList = getMetaList();
    for (var i = 0; i < metaList.length; i++) {
        if (metaList[i].type === 'folder' && metaList[i].isDefault) return metaList[i].id;
    }
    return null;
}

// ---- Migration from old single-map storage ----
function migrateIfNeeded() {
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
            for (var i = 0; i < existing.length; i++) {
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
        // Ensure all entries have type field and 未分類 exists
        var needsRepair = false;
        for (var i = 0; i < existing.length; i++) {
            if (!existing[i].type) {
                existing[i].type = 'page';
                needsRepair = true;
            }
        }
        existing = ensureDefaultFolder(existing);
        // Ensure all pages have a folderId
        var defId = getDefaultFolderId(existing);
        for (var i = 0; i < existing.length; i++) {
            if (existing[i].type === 'page' && !existing[i].folderId) {
                existing[i].folderId = defId;
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

    var now = nowISO();
    var initialMeta = [];

    // Create 未分類 folder
    var defaultFolderId = getNextMapId();
    initialMeta.push({
        id: defaultFolderId,
        name: '未分類',
        type: 'folder',
        order: 999999,
        createdAt: now,
        updatedAt: now,
        isDefault: true
    });

    if (oldData) {
        // Migrate existing data as page in 未分類
        var mapId = getNextMapId();
        var mapName = oldData.root.text || '無題のマップ';
        initialMeta.push({ id: mapId, name: mapName, type: 'page', folderId: defaultFolderId, order: 0, createdAt: now, updatedAt: now });
        saveMetaList(initialMeta);
        try { localStorage.setItem(getMapDataKey(mapId), JSON.stringify(oldData)); } catch(e) {}
        setLastActiveId(mapId);
        try { localStorage.removeItem(OLD_STORAGE_KEY); } catch(e) {}
    } else {
        // No existing data: create initial empty page in 未分類
        var mapId = getNextMapId();
        var defaultData = { root: { id: 'root', text: '中心テーマ', children: [] } };
        initialMeta.push({ id: mapId, name: '無題のマップ', type: 'page', folderId: defaultFolderId, order: 0, createdAt: now, updatedAt: now });
        saveMetaList(initialMeta);
        try { localStorage.setItem(getMapDataKey(mapId), JSON.stringify(defaultData)); } catch(e) {}
        setLastActiveId(mapId);
    }
    try { localStorage.setItem('mindmap-migrated-v4', '1'); } catch(e) {}
}

// ---- Save / Load for current map ----
function saveToLocalStorage() {
    if (!currentMapId) return;
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
}

function loadMapData(mapId) {
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

