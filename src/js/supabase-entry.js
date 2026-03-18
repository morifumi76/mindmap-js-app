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
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
        callback(session ? session.user : null);
    });
    return () => subscription.unsubscribe();
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
            key.startsWith('mindmap-supabase-map-') ||
            key.startsWith('mindmap-supabase-folder-')
        ) {
            toRemove.push(key);
        }
    }
    toRemove.forEach(k => localStorage.removeItem(k));
}

// ---- Load all user data from Supabase into localStorage ----
async function loadUserData() {
    const user = await getCurrentUser();
    if (!user) return false;

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

    // Process folders
    const folderLocalIds = {}; // uuid → localId
    for (const f of folders) {
        const localId = nextId();
        folderLocalIds[f.id] = localId;
        setSupabaseFolderId(localId, f.id);
        metaList.push({
            id: localId,
            name: f.name,
            type: 'folder',
            order: f.sort_order || 0,
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
    for (const m of maps) {
        const localId = nextId();
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
            shareId: m.share_id
        });
        if (m.data) {
            try { localStorage.setItem('mindmap-data-' + localId, JSON.stringify(m.data)); } catch(e) {}
        }
        if (firstPageLocalId === null) firstPageLocalId = localId;
    }

    try { localStorage.setItem('mindmap-meta', JSON.stringify(metaList)); } catch(e) {}
    try { localStorage.setItem('mindmap-id-counter', String(idCounter)); } catch(e) {}
    try { localStorage.setItem('mindmap-migrated-v4', '1'); } catch(e) {}
    if (firstPageLocalId !== null) {
        try { localStorage.setItem('mindmap-last-active-id', String(firstPageLocalId)); } catch(e) {}
    }

    return true;
}

// ---- Save map to Supabase ----
async function saveMap(localId, name, data, localFolderId) {
    const user = await getCurrentUser();
    if (!user) return;

    const supabaseMapId = getSupabaseMapId(localId);
    const supabaseFolderId = localFolderId ? getSupabaseFolderId(localFolderId) : null;

    if (supabaseMapId) {
        const { error } = await supabase.from('maps').update({
            name,
            data,
            folder_id: supabaseFolderId
        }).eq('id', supabaseMapId);
        if (error) throw error;
    } else {
        const { data: newMap, error } = await supabase.from('maps').insert({
            user_id: user.id,
            name,
            data,
            folder_id: supabaseFolderId
        }).select().single();
        if (error) throw error;
        setSupabaseMapId(localId, newMap.id);
    }
}

// ---- Delete map from Supabase ----
async function deleteMap(localId) {
    const uuid = getSupabaseMapId(localId);
    if (!uuid) return;
    await supabase.from('maps').delete().eq('id', uuid);
    localStorage.removeItem(MAP_KEY_PREFIX + localId);
}

// ---- Save folder to Supabase ----
async function saveFolder(localId, name, sortOrder) {
    const user = await getCurrentUser();
    if (!user) return;

    const uuid = getSupabaseFolderId(localId);
    if (uuid) {
        await supabase.from('folders').update({ name, sort_order: sortOrder || 0 }).eq('id', uuid);
    } else {
        const { data: newF, error } = await supabase.from('folders').insert({
            user_id: user.id,
            name,
            sort_order: sortOrder || 0
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

    for (const f of folders) {
        const { data: newF, error } = await supabase.from('folders').insert({
            user_id: user.id,
            name: f.name,
            sort_order: f.order || 0
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
