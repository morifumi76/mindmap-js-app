// クラウド版: オーナー画面の共有状態バナー
// 開いているマップの共有がONの間、画面上部に帯を表示して
// 「このマップは今も外部から見られる状態」であることを常に示す。
// 色は左サイドバーのマップ名の色分けと統一（青=閲覧専用共有 / オレンジ=共同編集ON）。
// ゲスト・閲覧専用ビューには既に専用バナーがあるため、オーナー画面でのみ表示する。
// 要素はローカル版のHTMLに残さないよう動的に生成する（collab-guest-banner と同じ方針）。
import { currentMapId } from '../state.js';
import { getMetaList } from '../storage.js';

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
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'ownerShareBanner';
        document.body.appendChild(banner);
    }
    banner.className = 'owner-share-banner' + (collab ? ' owner-share-banner--collab' : '');
    banner.textContent = collab
        ? '🤝 共同編集モード — 共有URLから参加したゲストと同時編集できます'
        : '🔗 共有中 — このマップは閲覧専用URLで公開されています';
    document.body.classList.add('owner-share-mode');
}

// マップ一覧の再描画（マップ切替・共有トグル・初期表示のすべてで走る）から
// 呼び出せるよう window 経由で公開する（storage.js の _supaQueueSync と同じ方式）
window._updateOwnerShareBanner = updateOwnerShareBanner;
