// クラウド版: 保存ステータス表示（保存済み/保存中/未保存/オフライン）
// ---- Save indicator (常時表示・状態管理) ----
// state: 'saved' | 'saving' | 'pending' | 'error' | 'offline'
var SAVE_STATE_CLASS = {
    saved:   '',                // デフォルトの緑ドット
    saving:  'save-saving',
    pending: 'save-pending',
    error:   'save-error',
    offline: 'save-offline'
};

var SAVE_STATE_TEXT = {
    saved:   '保存済み',
    saving:  '保存中...',
    pending: '未保存の変更',
    error:   '保存失敗（再試行します）',
    offline: 'オフライン'
};

export function setSaveStatus(state) {
    if (!Object.prototype.hasOwnProperty.call(SAVE_STATE_CLASS, state)) return;
    // オフライン時は他の状態より優先（オフラインなら何度同期しても無駄なので明示）
    if (!navigator.onLine && state !== 'pending' && state !== 'offline') {
        state = 'offline';
    }
    var el = document.getElementById('saveIndicator');
    if (!el) return;
    // すべての状態クラスをクリアして1つだけ付ける
    el.className = '';
    if (SAVE_STATE_CLASS[state]) el.classList.add(SAVE_STATE_CLASS[state]);
    el.textContent = SAVE_STATE_TEXT[state];
}

// 後方互換: 旧 showSaveIndicator 呼び出しを新APIにブリッジ
export function showSaveIndicator(text) {
    if (text === '保存中...')        setSaveStatus('saving');
    else if (text === '保存済み')    setSaveStatus('saved');
    else if (text && text.indexOf('保存失敗') !== -1) setSaveStatus('error');
}

// オンライン/オフライン状態の変化を反映
window.addEventListener('online', function() {
    // オフライン中に未同期なら pending へ
    var pending = false;
    try {
        var p = JSON.parse(localStorage.getItem('mindmap-pending-sync') || '{}');
        pending = Object.keys(p).length > 0;
    } catch(e) {}
    setSaveStatus(pending ? 'pending' : 'saved');
});

window.addEventListener('offline', function() { setSaveStatus('offline'); });
