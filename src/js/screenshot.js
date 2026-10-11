import { currentMapId, isVerticalLayout, viewState } from './state.js';
import { findMetaById } from './storage.js';
import { showToast } from './utils.js';

// ========================================
// スクリーンショット（マップ全体を1枚のPNGに書き出す）
// ========================================
// 画面に描画済みの #canvasInner（ノード・接続線・関連線・関連線メモ）を複製し、
// ページのCSSごと SVG の foreignObject に包んで画像化 → canvas でPNG化する。
// 画面と同じDOM・同じCSSを使うので、色・赤文字・折り返し・縦書きモードの見た目が一致する。
// 折りたたまれた枝は描画されていないので、自然に「今の見た目どおり」になる。
// ズーム・パンは複製側で打ち消すため、画面の表示状態には左右されない。

var PADDING = 40;          // マップ外周の余白（px, 等倍時）
var SCALE = 2;             // 書き出し倍率（高解像度）
var MAX_SIDE = 16384;      // canvas の一辺の上限（主要ブラウザ共通）
// canvas の総ピクセル数の上限。Safari は約1677万px、Chrome等はもっと大きい
var IS_SAFARI = /AppleWebKit/.test(navigator.userAgent) && !/Chrome|Chromium|Edg/.test(navigator.userAgent);
var MAX_AREA = IS_SAFARI ? 16777216 : 100000000;

// 複製から取り除く「操作中だけの見た目」のクラス（選択枠・ドラッグ表示など）
var TRANSIENT_CLASSES = ['selected', 'editing', 'dragging', 'drag-over-child', 'drag-over-before',
    'drag-over-after', 'relation-drop-target', 'relation-drop-invalid'];

// ファイル名: YYYY-MM-DD_マップ名.png（ファイル名に使えない文字は _ に置換）
export function buildScreenshotFileName(mapName, date) {
    var d = date || new Date();
    var ymd = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    var name = String(mapName || '').replace(/[\\/:*?"<>|\r\n\t]/g, '_').trim() || 'マインドマップ';
    return ymd + '_' + name + '.png';
}

function currentMapName() {
    var meta = findMetaById(currentMapId);
    return meta ? meta.name : '';
}

// #canvasInner 内の描画物が占める範囲（canvasInner のローカル座標）を求める
function measureContentBounds(inner) {
    var origin = inner.getBoundingClientRect();
    var zoom = viewState.zoom || 1;
    var targets = inner.querySelectorAll('.node, .node-collapse-indicator, .relation-label, #linesSvg .connection-line, #linesSvg .relation-line');
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (var i = 0; i < targets.length; i++) {
        var el = targets[i];
        if (el.classList.contains('relation-label') && !el.textContent) continue; // 空メモは書き出さない
        var r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        minX = Math.min(minX, (r.left - origin.left) / zoom);
        minY = Math.min(minY, (r.top - origin.top) / zoom);
        maxX = Math.max(maxX, (r.right - origin.left) / zoom);
        maxY = Math.max(maxY, (r.bottom - origin.top) / zoom);
    }
    if (minX === Infinity) return null;
    return { minX: minX, minY: minY, maxX: maxX, maxY: maxY };
}

// ページ内の全CSSルールを1つの文字列に（ビルド後は全てインライン<style>なので読める）
function collectCss() {
    var out = [];
    for (var i = 0; i < document.styleSheets.length; i++) {
        var rules;
        try { rules = document.styleSheets[i].cssRules; } catch (e) { continue; }
        if (!rules) continue;
        for (var j = 0; j < rules.length; j++) out.push(rules[j].cssText);
    }
    // 画像内ではアニメーションとノードの影を無効化
    // （Safari は拡大時に影を灰色の四角として描いてしまうため、全ブラウザで影なしに揃える）
    out.push('.node{transition:none !important;box-shadow:none !important;}');
    return out.join('\n');
}

// 書き出し用に複製したDOMから、操作中だけの要素・見た目を取り除く
function cleanClone(clone) {
    var endpoints = clone.querySelector('#endpointsSvg');
    if (endpoints) endpoints.innerHTML = '';
    clone.querySelectorAll('.relation-endpoint, .relation-line-hit, .relation-line.preview, .lasso-rect, .node-junction-hitarea').forEach(function(el) { el.remove(); });
    clone.querySelectorAll('.relation-label').forEach(function(el) {
        if (!el.textContent) el.remove();
        el.removeAttribute('contenteditable');
    });
    clone.querySelectorAll('[contenteditable]').forEach(function(el) { el.removeAttribute('contenteditable'); });
    TRANSIENT_CLASSES.forEach(function(cls) {
        clone.querySelectorAll('.' + cls).forEach(function(el) { el.classList.remove(cls); });
    });
    // id の重複を避ける（画像内でしか使わないので外す）
    clone.removeAttribute('id');
    clone.querySelectorAll('[id]').forEach(function(el) { el.removeAttribute('id'); });
}

// 書き出し倍率：基本 2倍、canvas の上限を超えるときだけ下げる
export function computeExportScale(width, height) {
    var s = SCALE;
    s = Math.min(s, MAX_SIDE / width, MAX_SIDE / height);
    s = Math.min(s, Math.sqrt(MAX_AREA / (width * height)));
    return s;
}

function loadImage(src) {
    return new Promise(function(resolve, reject) {
        var img = new Image();
        img.onload = function() { resolve(img); };
        img.onerror = function() { reject(new Error('画像の生成に失敗しました')); };
        img.src = src;
    });
}

// マップ全体を PNG の Blob にする
export function renderMapToPngBlob() {
    var inner = document.getElementById('canvasInner');
    var bounds = inner && measureContentBounds(inner);
    if (!bounds) return Promise.reject(new Error('書き出すノードがありません'));

    var width = Math.ceil(bounds.maxX - bounds.minX + PADDING * 2);
    var height = Math.ceil(bounds.maxY - bounds.minY + PADDING * 2);
    var scale = computeExportScale(width, height);
    var outW = Math.max(1, Math.floor(width * scale));
    var outH = Math.max(1, Math.floor(height * scale));

    var clone = inner.cloneNode(true);
    cleanClone(clone);
    clone.style.transform = 'translate(' + (PADDING - bounds.minX) + 'px, ' + (PADDING - bounds.minY) + 'px)';
    clone.style.left = '0';
    clone.style.top = '0';

    var bodyStyle = getComputedStyle(document.body);
    var wrapper = document.createElement('div');
    wrapper.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
    // 縦書きモードの中央揃え等は .vertical-layout 配下のセレクタで効くので同じクラスを付ける
    if (isVerticalLayout()) wrapper.className = 'vertical-layout';
    // 拡大は viewBox ではなく CSS の scale で行う（Safari は foreignObject に viewBox の拡大を適用しないため）
    wrapper.style.cssText = 'position:relative;overflow:hidden;background:#ffffff;' +
        'width:' + width + 'px;height:' + height + 'px;' +
        'transform:scale(' + (outW / width) + ',' + (outH / height) + ');transform-origin:0 0;' +
        'font-family:' + bodyStyle.fontFamily.replace(/"/g, '\'') + ';font-size:' + bodyStyle.fontSize + ';' +
        'line-height:' + bodyStyle.lineHeight + ';color:' + bodyStyle.color + ';';
    var style = document.createElement('style');
    style.textContent = collectCss();
    wrapper.appendChild(style);
    wrapper.appendChild(clone);

    var xhtml = new XMLSerializer().serializeToString(wrapper);
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + outW + '" height="' + outH + '">' +
        '<foreignObject x="0" y="0" width="' + outW + '" height="' + outH + '">' + xhtml + '</foreignObject></svg>';
    var src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);

    return loadImage(src).then(function(img) {
        var canvas = document.createElement('canvas');
        canvas.width = outW;
        canvas.height = outH;
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, outW, outH);
        ctx.drawImage(img, 0, 0, outW, outH);
        return new Promise(function(resolve, reject) {
            canvas.toBlob(function(blob) {
                if (blob) resolve(blob);
                else reject(new Error('画像の生成に失敗しました'));
            }, 'image/png');
        });
    });
}

// クリップボードへコピー。Safari はユーザー操作の直後に write() を呼ぶ必要があるため、
// Blob の完成を待たずに Promise のまま ClipboardItem に渡す
function copyScreenshotToClipboard() {
    if (!navigator.clipboard || !navigator.clipboard.write || typeof ClipboardItem === 'undefined') {
        showToast('このブラウザは画像のコピーに対応していません。ファイルとして保存してください', 3500);
        return Promise.resolve();
    }
    var blobPromise = renderMapToPngBlob();
    return navigator.clipboard.write([new ClipboardItem({ 'image/png': blobPromise })]).then(function() {
        showToast('クリップボードにコピーしました');
    }).catch(function(err) {
        console.error('[screenshot] copy failed', err);
        showToast('コピーに失敗しました: ' + (err && err.message ? err.message : err), 3500);
    });
}

function downloadBlob(blob, fileName) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
}

// ファイルとして保存。対応ブラウザ（Chrome/Edge）は「名前を付けて保存」ダイアログ、
// それ以外はダウンロードフォルダへ保存。ダイアログはユーザー操作の直後に開く必要があるので画像生成より先に呼ぶ
function saveScreenshotToFile() {
    var fileName = buildScreenshotFileName(currentMapName());
    if (typeof window.showSaveFilePicker === 'function') {
        var handlePromise;
        try {
            handlePromise = window.showSaveFilePicker({
                suggestedName: fileName,
                types: [{ description: 'PNG画像', accept: { 'image/png': ['.png'] } }]
            });
        } catch (e) {
            handlePromise = Promise.reject(e);
        }
        return handlePromise.then(function(handle) {
            return renderMapToPngBlob().then(function(blob) {
                return handle.createWritable().then(function(writable) {
                    return writable.write(blob).then(function() { return writable.close(); });
                });
            }).then(function() {
                showToast('画像を保存しました');
            });
        }).catch(function(err) {
            if (err && err.name === 'AbortError') return; // ダイアログでキャンセル
            console.error('[screenshot] save failed', err);
            showToast('保存に失敗しました: ' + (err && err.message ? err.message : err), 3500);
        });
    }
    return renderMapToPngBlob().then(function(blob) {
        downloadBlob(blob, fileName);
        showToast('画像を保存しました');
    }).catch(function(err) {
        console.error('[screenshot] save failed', err);
        showToast('保存に失敗しました: ' + (err && err.message ? err.message : err), 3500);
    });
}

// ----------------------------------------
// 選択ダイアログ（クリップボードにコピー / ファイルとして保存 / キャンセル）
// ----------------------------------------
function getOverlay() { return document.getElementById('screenshotModalOverlay'); }

export function isScreenshotModalOpen() {
    var overlay = getOverlay();
    return !!overlay && overlay.style.display !== 'none';
}

export function openScreenshotModal() {
    var overlay = getOverlay();
    if (!overlay) return;
    overlay.style.display = 'flex';
    var first = document.getElementById('screenshotCopyBtn');
    if (first) first.focus();
}

export function closeScreenshotModal() {
    var overlay = getOverlay();
    if (overlay) overlay.style.display = 'none';
}

export function initScreenshot() {
    var btn = document.getElementById('screenshotFloatBtn');
    var overlay = getOverlay();
    if (!btn || !overlay) return; // ローカル版はボタン・ダイアログごと削除されている

    btn.addEventListener('click', function(e) {
        e.stopPropagation();
        openScreenshotModal();
    });
    document.getElementById('screenshotCopyBtn').addEventListener('click', function() {
        closeScreenshotModal();
        copyScreenshotToClipboard();
    });
    document.getElementById('screenshotSaveBtn').addEventListener('click', function() {
        closeScreenshotModal();
        saveScreenshotToFile();
    });
    document.getElementById('screenshotCancelBtn').addEventListener('click', closeScreenshotModal);
    overlay.addEventListener('mousedown', function(e) {
        if (e.target === overlay) closeScreenshotModal();
    });
    // 表示中はマップ側のショートカット（Enterでノード追加等）を止める。
    // Esc は閉じる。Enter/Space/Tab はボタン本来の動作（押下・フォーカス移動）のまま
    document.addEventListener('keydown', function(e) {
        if (!isScreenshotModalOpen()) return;
        e.stopPropagation();
        if (e.key === 'Escape') {
            e.preventDefault();
            closeScreenshotModal();
        }
    }, true);
}
