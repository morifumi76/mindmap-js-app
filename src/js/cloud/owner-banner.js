// クラウド版: オーナー画面の共有状態バナー
// 開いているマップの共有がONの間、画面上部に帯を表示して
// 「このマップは今も外部から見られる状態」であることを常に示す。
// 色は左サイドバーのマップ名の色分けと統一（青=閲覧専用共有 / オレンジ=共同編集ON）。
// ゲスト・閲覧専用ビューには既に専用バナーがあるため、オーナー画面でのみ表示する。
// 要素はローカル版のHTMLに残さないよう動的に生成する（collab-guest-banner と同じ方針）。
import { currentMapId } from '../state.js';
import { getMetaList } from '../storage.js';
import { showToast } from '../utils.js';
import { buildShareUrl } from './share-dialog.js';

var COPIED_LABEL_MS = 2000; // 「✓ コピーしました」を表示しておく時間

export function updateOwnerShareBanner() {
    // クラウド版のオーナー画面のみ対象
    var meta = null;
    if (window._supa && !window._isReadOnly && !window._collabGuest && currentMapId) {
        var list = getMetaList();
        for (var i = 0; i < list.length; i++) {
            if (list[i].id === currentMapId && list[i].type === 'page') {
                meta = list[i];
                break;
            }
        }
    }
    var shared = !!(meta && meta.isPublic);
    var collab = !!(shared && meta.allowCollab);

    var banner = document.getElementById('ownerShareBanner');
    if (!shared) {
        if (banner) banner.remove();
        document.body.classList.remove('owner-share-mode');
        return;
    }
    if (!banner) banner = createBanner();
    banner.className = 'owner-share-banner' + (collab ? ' owner-share-banner--collab' : '');
    banner.querySelector('.owner-share-banner-text').textContent = collab
        ? '🤝 共同編集モード — 共有URLから参加したゲストと同時編集できます'
        : '🔗 共有中 — このマップは閲覧専用URLで公開されています';
    document.body.classList.add('owner-share-mode');
}

// バナー本体（文言＋「URLをコピー」ボタン）を作る
function createBanner() {
    var banner = document.createElement('div');
    banner.id = 'ownerShareBanner';
    var text = document.createElement('span');
    text.className = 'owner-share-banner-text';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'ownerShareCopyBtn';
    btn.className = 'owner-share-banner-copy';
    btn.textContent = 'URLをコピー';
    btn.addEventListener('click', function() { copyShareUrl(btn); });
    banner.appendChild(text);
    banner.appendChild(btn);
    document.body.appendChild(banner);
    return banner;
}

// 開いているマップの共有URLを取得する（手元のメタ情報にあればそれを、無ければサーバーに問い合わせ）
function getCurrentShareUrl() {
    var list = getMetaList();
    for (var i = 0; i < list.length; i++) {
        if (list[i].id === currentMapId && list[i].shareId) {
            return Promise.resolve(buildShareUrl(list[i].shareId));
        }
    }
    return window._supa.getShareInfo(currentMapId).then(function(info) {
        if (!info || !info.share_id) throw new Error('共有URLが見つかりません');
        return buildShareUrl(info.share_id);
    });
}

// クリップボードへ書き込む。Safari はサーバー問い合わせを待ってからだと書き込みを拒否するため、
// URL の Promise をそのまま ClipboardItem に渡す（非対応ブラウザは writeText）
function writeUrlToClipboard(urlPromise) {
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard && navigator.clipboard.write) {
        var blobPromise = urlPromise.then(function(url) { return new Blob([url], { type: 'text/plain' }); });
        return navigator.clipboard.write([new ClipboardItem({ 'text/plain': blobPromise })]);
    }
    return urlPromise.then(function(url) { return navigator.clipboard.writeText(url); });
}

function copyShareUrl(btn) {
    writeUrlToClipboard(getCurrentShareUrl()).then(function() {
        showToast('URLをコピーしました');
        btn.textContent = '✓ コピーしました';
        clearTimeout(btn._resetTid);
        btn._resetTid = setTimeout(function() { btn.textContent = 'URLをコピー'; }, COPIED_LABEL_MS);
    }).catch(function(err) {
        console.error('[owner-banner] copy failed', err);
        showToast('URLのコピーに失敗しました');
    });
}

// マップ一覧の再描画（マップ切替・共有トグル・初期表示のすべてで走る）から
// 呼び出せるよう window 経由で公開する（storage.js の _supaQueueSync と同じ方式）
window._updateOwnerShareBanner = updateOwnerShareBanner;
