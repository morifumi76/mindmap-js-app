// 左サイドバーのモジュール内共有状態
// ========================================
// Left Sidebar: My Maps Management
// ========================================

// ---- Sidebar Multi-Selection State ----
// 左サイドバーの可変状態（分割後の各サブモジュールから共有するためオブジェクトに集約）
export var sbState = {
    lastSelectedId: null, // 最後に選択した項目ID
    anchorId: null, // Shift選択のアンカー
    clipboard: null, // { mode: 'copy'|'cut', ids: [] }
    history: [], // メタ操作の undo 履歴
    historyPos: -1, // 履歴ポインタ
    isOpen: false, // パネル開閉状態
    peekTimeout: null, // ホバーピーク用タイマー
    initialized: false, // 初期化済みフラグ
};

export var sidebarSelectedIds = new Set();

// Flag: true while keyboard focus is logically "inside" the sidebar list
window.sidebarNavigationMode = false;

// Clipboard for sidebar copy/paste/cut


// Undo/Redo history (metaList snapshots)
export var SIDEBAR_HISTORY_MAX = 30;

export var LEFT_SIDEBAR_OPEN_MIN = 200;

export var LEFT_SIDEBAR_DEFAULT = 240;

export var LEFT_SIDEBAR_KEY = 'mindmap_left_sidebar_width';

// ---- Map Drag & Drop State ----
export var mapDragState = {
    draggingId: null,
    draggingIds: null,  // 複数選択ドラッグ時の全ID配列
    draggingType: null, // 'folder' or 'page'
    dropTarget: null
};
