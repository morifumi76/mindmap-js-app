// ========================================
// Supabase Entry Point (bundled by esbuild)
// Exposes window._supa
// ========================================

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://aobeqireuzbovcrgbzqj.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFvYmVxaXJldXpib3ZjcmdienFqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM3MzYyMzAsImV4cCI6MjA4OTMxMjIzMH0.xecJ7YzpVmxnf1W16WulhJKEF0c-QKLFrMk0KUxRMTA';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ---- Key prefixes for local ID ↔ Supabase UUID mapping ----
const MAP_KEY_PREFIX    = 'mindmap-supabase-map-';
const FOLDER_KEY_PREFIX = 'mindmap-supabase-folder-';
const MIGRATED_KEY      = 'mindmap-migrated-supabase';

// ---- 未同期キュー（クラッシュ・離脱対策） ----
// 編集が発生したら同期書き込みでマーカーを立て、Supabase保存成功で消す。
// 次回ページ起動時にマーカーが残っていれば、データロード前にリプレイして追いつく。
const PENDING_KEY = 'mindmap-pending-sync';

function markPendingSync(localId) {
    try {
        const p = JSON.parse(localStorage.getItem(PENDING_KEY) || '{}');
        p[String(localId)] = 1;
        localStorage.setItem(PENDING_KEY, JSON.stringify(p));
    } catch(e) {}
}
function clearPendingSync(localId) {
    try {
        const p = JSON.parse(localStorage.getItem(PENDING_KEY) || '{}');
        delete p[String(localId)];
        localStorage.setItem(PENDING_KEY, JSON.stringify(p));
    } catch(e) {}
}

// クライアント側で UUID v4 を生成（通信中断でも UUID が保持されるよう、insert 前に確定させるため）
function generateUuid() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// ---- Auth ----
async function login(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data.user;
}

async function logout() {
    await supabase.auth.signOut();
}

async function getCurrentUser() {
    const { data: { user } } = await supabase.auth.getUser();
    return user;
}

function onAuthStateChange(callback) {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
        callback(session ? session.user : null, event);
    });
    return () => subscription.unsubscribe();
}

async function updatePassword(newPassword) {
    const { data, error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) throw error;
    return data;
}

// 招待リンクか判定（URLハッシュに type=invite が含まれる）
function isInviteHash() {
    var hash = window.location.hash;
    return hash.indexOf('type=invite') !== -1 || hash.indexOf('type=signup') !== -1;
}

// ---- ID mapping helpers ----
function getSupabaseMapId(localId) {
    return localStorage.getItem(MAP_KEY_PREFIX + localId);
}
function setSupabaseMapId(localId, uuid) {
    localStorage.setItem(MAP_KEY_PREFIX + localId, uuid);
}
function getSupabaseFolderId(localId) {
    return localStorage.getItem(FOLDER_KEY_PREFIX + localId);
}
function setSupabaseFolderId(localId, uuid) {
    localStorage.setItem(FOLDER_KEY_PREFIX + localId, uuid);
}

// ---- Clear mindmap localStorage (keep UI prefs) ----
function clearMindmapData() {
    const toRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key) continue;
        if (
            key === 'mindmap-meta' ||
            key === 'mindmap-id-counter' ||
            key === 'mindmap-last-active-id' ||
            key.startsWith('mindmap-data-') ||
            key.startsWith('mindmap-node-grayout-') ||
            key.startsWith('mindmap-node-highlight-') ||
            key.startsWith('mindmap-node-cyan-') ||
            key.startsWith('mindmap-node-redtext-') ||
            key.startsWith('mindmap-supabase-map-') ||
            key.startsWith('mindmap-supabase-folder-')
        ) {
            toRemove.push(key);
        }
    }
    toRemove.forEach(k => localStorage.removeItem(k));
}

// ---- 未同期キューをリプレイする ----
// 前回のセッションで Supabase に届かなかった編集を、
// データロード前に再送信して追いつかせる
async function replayPendingSyncs() {
    let pending;
    try {
        pending = JSON.parse(localStorage.getItem(PENDING_KEY) || '{}');
    } catch(e) { return; }
    const ids = pending ? Object.keys(pending) : [];
    if (ids.length === 0) return;

    let metaList;
    try {
        metaList = JSON.parse(localStorage.getItem('mindmap-meta') || '[]');
    } catch(e) { return; }

    for (const localIdStr of ids) {
        const localId = parseInt(localIdStr, 10);
        if (!localId) continue;
        const meta = metaList.find(m => m.id === localId && m.type === 'page');
        if (!meta) { clearPendingSync(localId); continue; }
        let data;
        try {
            data = JSON.parse(localStorage.getItem('mindmap-data-' + localId));
        } catch(e) { continue; }
        if (!data) { clearPendingSync(localId); continue; }
        try {
            const gray = localStorage.getItem('mindmap-node-grayout-' + localId);
            const hl   = localStorage.getItem('mindmap-node-highlight-' + localId);
            const cy   = localStorage.getItem('mindmap-node-cyan-' + localId);
            const rt   = localStorage.getItem('mindmap-node-redtext-' + localId);
            data._grayout   = gray  ? JSON.parse(gray)  : {};
            data._highlight = hl    ? JSON.parse(hl)    : {};
            data._cyan      = cy    ? JSON.parse(cy)    : {};
            data._redtext   = rt    ? JSON.parse(rt)    : {};
            data._starred   = !!meta.starred;
            data._starOrder = meta.starOrder || 0;
        } catch(e) {}
        try {
            await saveMap(localId, meta.name, data, meta.folderId);
        } catch(e) {
            // ネットワーク失敗等：マーカーは残したまま次回起動時に再試行
            return;
        }
    }
}

// ---- Load all user data from Supabase into localStorage ----
async function loadUserData() {
    const user = await getCurrentUser();
    if (!user) return false;

    // 前回の未同期分を先にリプレイして Supabase へ追いつかせる
    // （タブクローズ・リロード・クラッシュ・オフライン中の編集を救う）
    try { await replayPendingSyncs(); } catch(e) {}

    // 現在開いているマップのSupabase UUIDを保存（ID再採番後に復元するため）
    const prevLastLocalId = parseInt(localStorage.getItem('mindmap-last-active-id'), 10) || null;
    const prevLastSupabaseUuid = prevLastLocalId ? getSupabaseMapId(prevLastLocalId) : null;

    // URLの ?id=X もリロード前の local ID。clearMindmapData の前に対応する Supabase UUID を捕捉しておく
    // （再採番後に古い ?id=X が別マップを指してしまう不具合を防ぐ）
    let urlIdSupabaseUuid = null;
    let urlIdParsed = null;
    try {
        const _urlParams = new URLSearchParams(window.location.search);
        const _raw = _urlParams.get('id');
        urlIdParsed = _raw ? parseInt(_raw, 10) : null;
        if (urlIdParsed) urlIdSupabaseUuid = getSupabaseMapId(urlIdParsed);
    } catch(e) {}

    const [{ data: folders, error: fErr }, { data: maps, error: mErr }] = await Promise.all([
        supabase.from('folders').select('*').eq('user_id', user.id).order('sort_order'),
        supabase.from('maps').select('*').eq('user_id', user.id).order('updated_at', { ascending: false })
    ]);
    if (fErr) throw fErr;
    if (mErr) throw mErr;

    // New user with no data
    if (folders.length === 0 && maps.length === 0) return false;

    clearMindmapData();

    const metaList = [];
    let idCounter = 0;
    const nextId = () => ++idCounter;

    // Process folders — 2パス方式で parentFolderId を正しく復元する
    // Pass 1: 全フォルダに localId を採番し、UUID ↔ localId マップを作る
    const folderLocalIds = {}; // uuid → localId
    for (const f of folders) {
        const localId = nextId();
        folderLocalIds[f.id] = localId;
        setSupabaseFolderId(localId, f.id);
    }
    // Pass 2: parentFolderId を含めて metaList に追加
    for (const f of folders) {
        const localId = folderLocalIds[f.id];
        metaList.push({
            id: localId,
            name: f.name,
            type: 'folder',
            order: f.sort_order || 0,
            parentFolderId: f.parent_folder_id ? (folderLocalIds[f.parent_folder_id] || null) : null,
            createdAt: f.created_at,
            updatedAt: f.created_at,
            isDefault: f.name === '未分類' ? true : undefined
        });
    }

    // Ensure 未分類 folder exists locally
    let defaultFolderId = null;
    for (const m of metaList) {
        if (m.type === 'folder' && m.isDefault) { defaultFolderId = m.id; break; }
    }
    if (!defaultFolderId) {
        // Create 未分類 in Supabase and locally
        const { data: newF } = await supabase
            .from('folders')
            .insert({ user_id: user.id, name: '未分類', sort_order: 999999 })
            .select().single();
        if (newF) {
            const localId = nextId();
            folderLocalIds[newF.id] = localId;
            setSupabaseFolderId(localId, newF.id);
            defaultFolderId = localId;
            metaList.push({ id: localId, name: '未分類', type: 'folder', order: 999999, createdAt: newF.created_at, updatedAt: newF.created_at, isDefault: true });
        }
    }

    // Process maps
    let firstPageLocalId = null;
    const mapSupabaseToLocal = {}; // Supabase UUID → 新しいローカルID
    for (const m of maps) {
        const localId = nextId();
        mapSupabaseToLocal[m.id] = localId;
        setSupabaseMapId(localId, m.id);
        const fLocalId = m.folder_id ? (folderLocalIds[m.folder_id] || defaultFolderId) : defaultFolderId;
        metaList.push({
            id: localId,
            name: m.name,
            type: 'page',
            folderId: fLocalId,
            order: 0,
            createdAt: m.created_at,
            updatedAt: m.updated_at,
            isPublic: m.is_public,
            shareId: m.share_id,
            starred: !!(m.data && m.data._starred),
            starOrder: (m.data && m.data._starOrder) || 0
        });
        if (m.data) {
            // グレーアウト・ハイライト状態をlocalStorageに復元してからデータ本体を保存
            try {
                if (m.data._grayout)   localStorage.setItem('mindmap-node-grayout-'   + localId, JSON.stringify(m.data._grayout));
                if (m.data._highlight) localStorage.setItem('mindmap-node-highlight-' + localId, JSON.stringify(m.data._highlight));
                if (m.data._cyan)      localStorage.setItem('mindmap-node-cyan-'      + localId, JSON.stringify(m.data._cyan));
                if (m.data._redtext)   localStorage.setItem('mindmap-node-redtext-'   + localId, JSON.stringify(m.data._redtext));
            } catch(e) {}
            try { localStorage.setItem('mindmap-data-' + localId, JSON.stringify(m.data)); } catch(e) {}
        }
        if (firstPageLocalId === null) firstPageLocalId = localId;
    }

    try { localStorage.setItem('mindmap-meta', JSON.stringify(metaList)); } catch(e) {}
    try { localStorage.setItem('mindmap-id-counter', String(idCounter)); } catch(e) {}
    try { localStorage.setItem('mindmap-migrated-v4', '1'); } catch(e) {}

    // 前回開いていたマップを優先して復元。なければ最初のページを使う
    const restoredLastActiveId = (prevLastSupabaseUuid && mapSupabaseToLocal[prevLastSupabaseUuid])
        ? mapSupabaseToLocal[prevLastSupabaseUuid]
        : firstPageLocalId;
    if (restoredLastActiveId !== null) {
        try { localStorage.setItem('mindmap-last-active-id', String(restoredLastActiveId)); } catch(e) {}
    }

    // URLの ?id=X を再採番後の新しい local ID に更新する
    // （URL 側は古い local ID のままだと、init() が URL 優先で別マップを開いてしまうため）
    try {
        if (urlIdSupabaseUuid && mapSupabaseToLocal[urlIdSupabaseUuid]) {
            const newLocalId = mapSupabaseToLocal[urlIdSupabaseUuid];
            if (newLocalId !== urlIdParsed) {
                const _u = new URL(window.location.href);
                _u.searchParams.set('id', String(newLocalId));
                window.history.replaceState(null, '', _u.toString());
            }
        } else if (urlIdParsed !== null) {
            // URLのIDに対応するマップが見つからない（削除済み等）→ URL から id を除去
            const _u = new URL(window.location.href);
            _u.searchParams.delete('id');
            window.history.replaceState(null, '', _u.toString());
        }
    } catch(e) {}

    return true;
}

// ---- Save map to Supabase ----
async function saveMap(localId, name, data, localFolderId) {
    const user = await getCurrentUser();
    if (!user) return;

    // 通信前に未同期マーカーを立てる（成功するまで残しておく）
    markPendingSync(localId);

    let supabaseMapId = getSupabaseMapId(localId);
    const supabaseFolderId = localFolderId ? getSupabaseFolderId(localFolderId) : null;

    // 新規マップは UUID をクライアント側で先に発行してから保存。
    // こうすると通信中断・タブクローズで insert が中断されても、
    // 次回リプレイ時に同じ UUID で upsert するため重複行が発生しない。
    if (!supabaseMapId) {
        supabaseMapId = generateUuid();
        setSupabaseMapId(localId, supabaseMapId);
    }

    const { error } = await supabase.from('maps').upsert({
        id: supabaseMapId,
        user_id: user.id,
        name,
        data,
        folder_id: supabaseFolderId
    });
    if (error) throw error;

    // 保存成功したのでマーカーを消す
    clearPendingSync(localId);
}

// ---- Delete map from Supabase ----
async function deleteMap(localId) {
    const uuid = getSupabaseMapId(localId);
    if (!uuid) return;
    await supabase.from('maps').delete().eq('id', uuid);
    localStorage.removeItem(MAP_KEY_PREFIX + localId);
}

// ---- Save folder to Supabase ----
async function saveFolder(localId, name, sortOrder, parentLocalId) {
    const user = await getCurrentUser();
    if (!user) return;

    const uuid = getSupabaseFolderId(localId);
    // parentLocalId が null/undefined の場合は null を明示的に送る
    const parentUuid = parentLocalId ? (getSupabaseFolderId(parentLocalId) || null) : null;

    if (uuid) {
        await supabase.from('folders').update({
            name,
            sort_order: sortOrder || 0,
            parent_folder_id: parentUuid
        }).eq('id', uuid);
    } else {
        const { data: newF, error } = await supabase.from('folders').insert({
            user_id: user.id,
            name,
            sort_order: sortOrder || 0,
            parent_folder_id: parentUuid
        }).select().single();
        if (error) throw error;
        setSupabaseFolderId(localId, newF.id);
    }
}

// ---- Delete folder from Supabase ----
async function deleteFolder(localId) {
    const uuid = getSupabaseFolderId(localId);
    if (!uuid) return;
    await supabase.from('folders').delete().eq('id', uuid);
    localStorage.removeItem(FOLDER_KEY_PREFIX + localId);
}

// ---- Share ----
function generateShareId() {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let id = '';
    for (let i = 0; i < 16; i++) id += chars[Math.floor(Math.random() * chars.length)];
    return id;
}

async function enableShare(localId) {
    const uuid = getSupabaseMapId(localId);
    if (!uuid) throw new Error('Map not synced to Supabase yet');
    const shareId = generateShareId();
    const { error } = await supabase.from('maps').update({ is_public: true, share_id: shareId }).eq('id', uuid);
    if (error) throw error;
    return shareId;
}

async function disableShare(localId) {
    const uuid = getSupabaseMapId(localId);
    if (!uuid) return;
    await supabase.from('maps').update({ is_public: false }).eq('id', uuid);
}

async function getShareInfo(localId) {
    const uuid = getSupabaseMapId(localId);
    if (!uuid) return null;
    const { data, error } = await supabase.from('maps').select('is_public, share_id').eq('id', uuid).single();
    if (error) return null;
    return data;
}

async function fetchSharedMap(shareId) {
    const { data, error } = await supabase
        .from('maps')
        .select('name, data, is_public')
        .eq('share_id', shareId)
        .eq('is_public', true)
        .single();
    if (error || !data) return null;
    return data;
}

// ---- Migration from localStorage to Supabase ----
async function migrateFromLocalStorage() {
    const user = await getCurrentUser();
    if (!user) return;
    if (localStorage.getItem(MIGRATED_KEY)) return;

    let metaList;
    try { metaList = JSON.parse(localStorage.getItem('mindmap-meta') || '[]'); } catch(e) { metaList = []; }

    const folders = metaList.filter(m => m.type === 'folder');
    const pages   = metaList.filter(m => m.type === 'page');

    // 親フォルダが子より先に登録されるようトポロジカルソート
    const folderMap = {};
    folders.forEach(f => folderMap[f.id] = f);
    const sortedFolders = [];
    const visited = new Set();
    function visitFolder(f) {
        if (visited.has(f.id)) return;
        visited.add(f.id);
        if (f.parentFolderId && folderMap[f.parentFolderId]) visitFolder(folderMap[f.parentFolderId]);
        sortedFolders.push(f);
    }
    folders.forEach(f => visitFolder(f));

    for (const f of sortedFolders) {
        const parentUuid = f.parentFolderId ? (getSupabaseFolderId(f.parentFolderId) || null) : null;
        const { data: newF, error } = await supabase.from('folders').insert({
            user_id: user.id,
            name: f.name,
            sort_order: f.order || 0,
            parent_folder_id: parentUuid
        }).select().single();
        if (!error && newF) setSupabaseFolderId(f.id, newF.id);
    }

    for (const p of pages) {
        let mapData = null;
        try { mapData = JSON.parse(localStorage.getItem('mindmap-data-' + p.id)); } catch(e) {}
        const supabaseFolderId = p.folderId ? getSupabaseFolderId(p.folderId) : null;
        const { data: newMap, error } = await supabase.from('maps').insert({
            user_id: user.id,
            name: p.name,
            data: mapData,
            folder_id: supabaseFolderId
        }).select().single();
        if (!error && newMap) setSupabaseMapId(p.id, newMap.id);
    }

    localStorage.setItem(MIGRATED_KEY, '1');
}

// ---- Expose to window ----
window._supa = {
    login,
    logout,
    getCurrentUser,
    onAuthStateChange,
    updatePassword,
    isInviteHash,
    loadUserData,
    saveMap,
    deleteMap,
    saveFolder,
    deleteFolder,
    enableShare,
    disableShare,
    getShareInfo,
    fetchSharedMap,
    migrateFromLocalStorage,
    getSupabaseMapId,
    isMigrated: () => !!localStorage.getItem(MIGRATED_KEY)
};
