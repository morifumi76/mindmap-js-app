// ========================================
// Utility Functions
// ========================================

function generateId() {
    return 'node_' + (++nodeIdCounter) + '_' + Date.now();
}

function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
}

function showToast(message, duration) {
    duration = duration || 2000;
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toast._tid);
    toast._tid = setTimeout(function() {
        toast.classList.remove('show');
    }, duration);
}

// ----------------------------------------------------------------------
// 日本語IME（変換）まわりのキーガード
// ----------------------------------------------------------------------
// 日本語IMEで「変換確定」のEnterを押したとき、本来は確定だけしたいのに
// 「送信／編集終了」処理まで一緒に発火してしまう問題を防ぐためのヘルパー。
//
// 3層の判定で誤発火を防ぐ：
//   1) e.isComposing が true       … 変換中
//   2) e.keyCode === 229          … 古いブラウザ互換（IME変換のキーコード）
//   3) compositionend 直後のEnter  … Safari 等で keydown が compositionend
//                                    の後に発火し isComposing=false になる
//                                    ケース。時刻差で判定（50ms以内）。
//
// 使い方:
//   element.addEventListener('keydown', function(e) {
//       if (e.key === 'Enter') {
//           if (isImeRelatedKey(e)) return; // ← 変換確定のEnterは無視
//           // ここから送信処理 …
//       }
//   });
// ----------------------------------------------------------------------
var _lastCompositionEndAt = 0;
// document レベルで compositionend を追跡（個々の入力欄で listener を貼る必要なし）
document.addEventListener('compositionend', function() {
    _lastCompositionEndAt = Date.now();
}, true);

function isImeRelatedKey(e) {
    if (!e) return false;
    if (e.isComposing) return true;
    if (e.keyCode === 229) return true; // 互換性のため
    // composition 終了直後（同一イベントループ）に発火した Enter も IME確定の影響と見なす
    if (Date.now() - _lastCompositionEndAt < 50) return true;
    return false;
}
