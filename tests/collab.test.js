// 共同編集モード（Realtime同期エンジン）のテスト — チェックポイント1相当
// 対象: dist/test.html（Realtimeは BroadcastChannel モックで再現。tests/mocks/supa-mock.js 参照）
// オーナー画面とゲスト画面を同一ブラウザ内に開き、双方向のリアルタイム反映を検証する
const { chromium } = require('playwright');
const { CLOUD_URL, CMD } = require('./helpers');

let pass = 0, fail = 0;
function assert(cond, msg) {
    if (cond) { pass++; console.log('  ✅ ' + msg); }
    else { fail++; console.log('  ❌ FAIL: ' + msg); }
}

(async () => {
    const browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const owner = await ctx.newPage();

    // ========================================
    // セットアップ: オーナーとしてログインし、共同編集ONのマップを開く
    // ========================================
    console.log('\n=== セットアップ: オーナーのログインとマップ準備 ===');
    await owner.goto(CLOUD_URL);
    await owner.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    await owner.reload();
    await owner.waitForTimeout(1000);
    await owner.fill('#loginEmail', 'test@example.com');
    await owner.fill('#loginPassword', 'test1234');
    await owner.click('#loginBtn');
    await owner.waitForTimeout(1500);

    // 共同編集ONのマップ（メタ＋データ）を直接シードしてリロード
    await owner.evaluate(() => {
        var data = { root: { id: 'root', text: '共同編集の中心テーマ', children: [
            { id: 'collab1', text: '共同ノード1', children: [] }
        ] } };
        var meta = [{ id: 1, name: '共同編集テストマップ', type: 'page', folderId: null, order: 0,
            createdAt: '', updatedAt: '', isPublic: true, shareId: 'mockshare-collab', allowCollab: true }];
        localStorage.setItem('mindmap-meta', JSON.stringify(meta));
        localStorage.setItem('mindmap-data-1', JSON.stringify(data));
        localStorage.setItem('mindmap-id-counter', '1');
        localStorage.setItem('mindmap-last-active-id', '1');
        localStorage.setItem('mindmap-migrated-v4', '1');
        // ゲストが fetchSharedMap で読む「DB上のデータ」も同じ内容にしておく
        localStorage.setItem('mock-collab-map-data', JSON.stringify(data));
    });
    await owner.reload();
    await owner.waitForSelector('.node', { state: 'attached', timeout: 10000 });
    await owner.waitForTimeout(1800); // オーナーの自動参加ウォッチャー（1秒間隔）を待つ

    const ownerJoined = await owner.evaluate(() => !!document.getElementById('collabAvatars'));
    assert(ownerJoined, 'オーナーが共同編集チャンネルに自動参加する（アバター表示）');

    // ========================================
    // Test 1: ゲスト参加（ログインなし・ニックネーム自動採番）
    // ========================================
    console.log('\n=== Test 1: ゲスト参加 ===');
    const guest = await ctx.newPage();
    await guest.goto(CLOUD_URL + '?share=mockshare-collab');
    // ニックネーム入力ダイアログが表示される
    await guest.waitForSelector('#nicknameOverlay.show', { timeout: 10000 });
    const dialogTitle = await guest.$eval('#nicknameOverlay .collab-modal-title', el => el.textContent);
    assert(dialogTitle.includes('共同編集モード'), 'ニックネーム入力ダイアログが表示される: ' + dialogTitle);
    // 未入力のまま「参加する」→ ゲストN の自動採番になるはず
    await guest.click('#nicknameJoinBtn');
    await guest.waitForSelector('.node', { state: 'attached', timeout: 10000 });
    await guest.waitForTimeout(1200);

    const guestState = await guest.evaluate(() => ({
        collabGuest: !!window._collabGuest,
        readonly: !!window._isReadOnly,
        rootText: (document.querySelector('.node.root .node-text') || {}).textContent || '',
        leftSidebarHidden: (document.getElementById('leftSidebar') || {}).style.display === 'none',
        starHidden: (document.getElementById('canvasStarBtn') || {}).style.display === 'none'
    }));
    assert(guestState.collabGuest, 'ゲストモードで参加している');
    assert(!guestState.readonly, '閲覧専用ではなく編集モード');
    assert(guestState.rootText === '共同編集の中心テーマ', 'DBの最新データが表示される: ' + guestState.rootText);
    assert(guestState.leftSidebarHidden && guestState.starHidden, 'オーナー用UI（マイマップ・お気に入り）は非表示');

    await guest.waitForTimeout(800);
    const guestName = await guest.evaluate(() => sessionStorage.getItem('collab-nickname'));
    assert(guestName === 'ゲスト1', 'ニックネーム未入力 → 「ゲスト1」に自動採番: ' + guestName);

    // 両画面にアバターが2つ表示される
    const ownerAvatars = await owner.evaluate(() => document.querySelectorAll('.collab-avatar').length);
    const guestAvatars = await guest.evaluate(() => document.querySelectorAll('.collab-avatar').length);
    assert(ownerAvatars === 2 && guestAvatars === 2, '両画面に参加者アバターが2つ表示される: owner=' + ownerAvatars + ' guest=' + guestAvatars);

    // ゲスト側: 編集可能で共有されていることが分かるオレンジのバナー
    const guestBanner = await guest.evaluate(() => {
        var b = document.getElementById('collabGuestBanner');
        return {
            exists: !!b,
            text: b ? b.textContent : '',
            bg: b ? getComputedStyle(b).backgroundColor : '',
            bodyClass: document.body.classList.contains('collab-guest-mode')
        };
    });
    assert(guestBanner.exists && guestBanner.text.includes('共同編集モード') && guestBanner.text.includes('編集できます'),
        'ゲストに「共同編集モード（編集可能）」バナーが表示される: ' + guestBanner.text);
    assert(guestBanner.bg === 'rgb(217, 115, 13)' && guestBanner.bodyClass,
        'バナーはオレンジ（#d9730d）でレイアウトも調整される');

    // オーナー側: アバターの下にオレンジで「共同編集中」ラベル
    const ownerLabel = await owner.evaluate(() => {
        var el = document.querySelector('.collab-status-label');
        return { text: el ? el.textContent : null, color: el ? getComputedStyle(el).color : null };
    });
    assert(ownerLabel.text === '共同編集中' && ownerLabel.color === 'rgb(217, 115, 13)',
        'オーナーのアバター下にオレンジで「共同編集中」ラベル: ' + JSON.stringify(ownerLabel));
    const guestHasLabel = await guest.evaluate(() => !!document.querySelector('.collab-status-label'));
    assert(!guestHasLabel, 'ゲスト側には「共同編集中」ラベルは出ない（バナーで表現）');

    // ========================================
    // Test 2: ノード追加の双方向同期
    // ========================================
    console.log('\n=== Test 2: ノード追加の同期 ===');
    // オーナー側で追加（collab1 を選択して Enter = 兄弟追加）
    await owner.click('.node[data-id="collab1"]');
    await owner.waitForTimeout(150);
    await owner.keyboard.press('Escape');
    await owner.waitForTimeout(150);
    await owner.keyboard.press('Enter');
    await owner.waitForTimeout(200);
    await owner.keyboard.type('オーナーが追加');
    await owner.keyboard.press('Escape');
    await owner.waitForTimeout(800);

    let guestSeesIt = await guest.evaluate(() => {
        var els = document.querySelectorAll('.node .node-text');
        return Array.from(els).some(e => e.textContent === 'オーナーが追加');
    });
    assert(guestSeesIt, 'オーナーの追加ノードがゲスト画面にリアルタイム反映される');

    // ゲスト側で追加
    await guest.click('.node[data-id="collab1"]');
    await guest.waitForTimeout(150);
    await guest.keyboard.press('Escape');
    await guest.waitForTimeout(150);
    await guest.keyboard.press('Enter');
    await guest.waitForTimeout(200);
    await guest.keyboard.type('ゲストが追加');
    await guest.keyboard.press('Escape');
    await guest.waitForTimeout(800);

    let ownerSeesIt = await owner.evaluate(() => {
        var els = document.querySelectorAll('.node .node-text');
        return Array.from(els).some(e => e.textContent === 'ゲストが追加');
    });
    assert(ownerSeesIt, 'ゲストの追加ノードがオーナー画面にリアルタイム反映される');

    // ========================================
    // Test 3: テキスト編集の同期（確定時）とライブ送信（300msデバウンス）
    // ========================================
    console.log('\n=== Test 3: テキスト編集の同期 ===');
    await guest.click('.node[data-id="collab1"]');
    await guest.waitForTimeout(200); // クリックで編集モードに入る
    await guest.keyboard.press(CMD + '+a');
    await guest.keyboard.type('ゲストが書き換え');
    // 編集確定前でも300msデバウンスでライブ反映される
    await guest.waitForTimeout(900);
    let liveText = await owner.evaluate(() => {
        var el = document.querySelector('.node[data-id="collab1"] .node-text');
        return el ? el.textContent : null;
    });
    assert(liveText === 'ゲストが書き換え', '編集確定前にライブ反映される（デバウンス送信）: ' + liveText);
    await guest.keyboard.press('Escape');
    await guest.waitForTimeout(800);
    let finalText = await owner.evaluate(() => {
        var el = document.querySelector('.node[data-id="collab1"] .node-text');
        return el ? el.textContent : null;
    });
    assert(finalText === 'ゲストが書き換え', '編集確定後のテキストがオーナー画面に反映される');

    // ========================================
    // Test 4: 削除の同期
    // ========================================
    console.log('\n=== Test 4: 削除の同期 ===');
    // オーナーが「オーナーが追加」ノードを削除
    const delId = await owner.evaluate(() => {
        var els = document.querySelectorAll('.node');
        for (var i = 0; i < els.length; i++) {
            var t = els[i].querySelector('.node-text');
            if (t && t.textContent === 'オーナーが追加') return els[i].dataset.id;
        }
        return null;
    });
    await owner.click('.node[data-id="' + delId + '"]');
    await owner.waitForTimeout(150);
    await owner.keyboard.press('Escape');
    await owner.waitForTimeout(150);
    await owner.keyboard.press('Delete');
    await owner.waitForTimeout(800);
    const guestStillHasIt = await guest.evaluate((id) => !!document.querySelector('.node[data-id="' + id + '"]'), delId);
    assert(!guestStillHasIt, '削除がゲスト画面に反映される');

    // ========================================
    // Test 5: 移動（親の付け替え）の同期
    // ========================================
    console.log('\n=== Test 5: 移動の同期 ===');
    // ゲスト側: 「ゲストが追加」ノードを collab1 の子へ（Option+Right = 階層を下げる）
    const moveId = await guest.evaluate(() => {
        var els = document.querySelectorAll('.node');
        for (var i = 0; i < els.length; i++) {
            var t = els[i].querySelector('.node-text');
            if (t && t.textContent === 'ゲストが追加') return els[i].dataset.id;
        }
        return null;
    });
    await guest.click('.node[data-id="' + moveId + '"]');
    await guest.waitForTimeout(150);
    await guest.keyboard.press('Escape');
    await guest.waitForTimeout(150);
    await guest.keyboard.press('Alt+ArrowRight'); // 前の兄弟(collab1)の子になる
    await guest.waitForTimeout(800);
    const ownerParent = await owner.evaluate((id) => {
        var d = window.getMindMapData();
        var parent = null;
        (function walk(n, p) {
            if (n.id === id) { parent = p ? p.id : null; return; }
            n.children.forEach(function(c) { walk(c, n); });
        })(d.root, null);
        return parent;
    }, moveId);
    assert(ownerParent === 'collab1', '移動（親の付け替え）がオーナー画面に反映される: parent=' + ownerParent);

    // ========================================
    // Test 6: 編集中ノードの色枠＋名前ラベル（プレゼンス）
    // ========================================
    console.log('\n=== Test 6: 編集中プレゼンス表示 ===');
    await guest.click('.node[data-id="collab1"]'); // ゲストが編集開始
    await guest.waitForTimeout(1200); // presence 反映（400ms tick）待ち
    const outline = await owner.evaluate(() => {
        var el = document.querySelector('.node[data-id="collab1"]');
        var label = el ? el.querySelector('.collab-editing-label') : null;
        return {
            hasOutline: !!(el && el.getAttribute('data-collab-outline')),
            labelText: label ? label.textContent : null
        };
    });
    assert(outline.hasOutline, 'ゲストの編集中ノードにオーナー画面で色枠が付く');
    assert(outline.labelText === 'ゲスト1', '色枠に名前ラベルが表示される: ' + outline.labelText);
    await guest.keyboard.press('Escape');
    await guest.waitForTimeout(1200);
    const outlineGone = await owner.evaluate(() => !document.querySelector('.node[data-collab-outline]'));
    assert(outlineGone, '編集をやめると色枠が消える');

    // ========================================
    // Test 7: Undoは自分の操作だけを巻き戻す
    // ========================================
    console.log('\n=== Test 7: 自分の操作だけUndo ===');
    // オーナーがノード追加 → ゲストもノード追加 → オーナーがUndo
    await owner.click('.node[data-id="collab1"]');
    await owner.waitForTimeout(150);
    await owner.keyboard.press('Escape');
    await owner.waitForTimeout(150);
    await owner.keyboard.press('Enter');
    await owner.waitForTimeout(200);
    await owner.keyboard.type('O追加');
    await owner.keyboard.press('Escape');
    await owner.waitForTimeout(600);
    await guest.click('.node[data-id="collab1"]');
    await guest.waitForTimeout(150);
    await guest.keyboard.press('Escape');
    await guest.waitForTimeout(150);
    await guest.keyboard.press('Enter');
    await guest.waitForTimeout(200);
    await guest.keyboard.type('G追加');
    await guest.keyboard.press('Escape');
    await guest.waitForTimeout(600);

    // 前提確認: 両ノードが両画面に存在する
    const beforeUndo = await owner.evaluate(() => {
        var texts = Array.from(document.querySelectorAll('.node .node-text')).map(e => e.textContent);
        return { hasO: texts.indexOf('O追加') !== -1, hasG: texts.indexOf('G追加') !== -1 };
    });
    assert(beforeUndo.hasO && beforeUndo.hasG, '前提: 両者の追加ノードが揃っている');

    // ノード作成は「追加」＋「テキスト確定」の2操作として記録されるため、Undoは2回で追加前に戻る
    await owner.keyboard.press(CMD + '+z');
    await owner.waitForTimeout(400);
    await owner.keyboard.press(CMD + '+z');
    await owner.waitForTimeout(800);
    const afterUndo = await owner.evaluate(() => {
        var texts = Array.from(document.querySelectorAll('.node .node-text')).map(e => e.textContent);
        return { hasO: texts.indexOf('O追加') !== -1, hasG: texts.indexOf('G追加') !== -1 };
    });
    assert(!afterUndo.hasO, 'Undoで自分（オーナー）の追加ノードが消える');
    assert(afterUndo.hasG, '相手（ゲスト）の追加ノードは巻き戻されず残る');
    const guestAfterUndo = await guest.evaluate(() => {
        var texts = Array.from(document.querySelectorAll('.node .node-text')).map(e => e.textContent);
        return { hasO: texts.indexOf('O追加') !== -1, hasG: texts.indexOf('G追加') !== -1 };
    });
    assert(!guestAfterUndo.hasO && guestAfterUndo.hasG, 'Undo結果がゲスト画面にも反映される');

    // ========================================
    // Test 8: ゲストの編集がDBに保存される（直近編集者が保存する方式）
    // ========================================
    console.log('\n=== Test 8: ゲスト編集の永続化 ===');
    await guest.waitForTimeout(1200); // ゲスト保存デバウンス(800ms)待ち
    const persisted = await guest.evaluate(() => {
        try {
            var d = JSON.parse(localStorage.getItem('mock-collab-map-data'));
            var texts = [];
            (function walk(n) { texts.push(n.text); n.children.forEach(walk); })(d.root);
            return texts;
        } catch (e) { return []; }
    });
    assert(persisted.indexOf('G追加') !== -1, 'ゲストの編集内容がDB（モック）に保存される');

    // ========================================
    // Test 8.5: 色付け・リンク・関連線の同期／ゲストのツールバー制限
    // ========================================
    console.log('\n=== Test 8.5: 色・リンク・関連線の同期とゲストUI ===');
    // ゲストのツールバー: 縦書きモードだけ非表示、他は表示
    const guestToolbar = await guest.evaluate(() => ({
        vertical: (document.getElementById('verticalModeControl') || {}).style.display === 'none',
        fastVisible: !!document.getElementById('fastModeControl') &&
            document.getElementById('fastModeControl').style.display !== 'none',
        colorVisible: !!document.getElementById('grayoutFloatBtn'),
        linkVisible: !!document.getElementById('linkFloatBtn'),
        connectVisible: !!document.getElementById('connectFloatBtn')
    }));
    assert(guestToolbar.vertical, 'ゲスト: 縦書きモードトグルは非表示');
    assert(guestToolbar.fastVisible && guestToolbar.colorVisible && guestToolbar.linkVisible && guestToolbar.connectVisible,
        'ゲスト: 高速モード・色・リンク・接続のUIは使える');

    // 色付けの同期: ゲストが collab1 をグレーアウト → オーナーに反映
    await guest.click('.node[data-id="collab1"]');
    await guest.waitForTimeout(150);
    await guest.keyboard.press('Escape');
    await guest.waitForTimeout(150);
    await guest.click('#grayoutFloatBtn');
    await guest.waitForTimeout(800);
    assert(await guest.$eval('.node[data-id="collab1"]', el => el.classList.contains('grayed-out')),
        'ゲスト画面で色（グレーアウト）が付く');
    assert(await owner.$eval('.node[data-id="collab1"]', el => el.classList.contains('grayed-out')),
        '色付けがオーナー画面に同期される');
    // ゲストのlocalStorageに色データが書き込まれていない（メモリ上のみ）
    const guestColorLs = await guest.evaluate(() => localStorage.getItem('mindmap-node-grayout-2'));
    assert(guestColorLs === null, 'ゲストの色変更はlocalStorageを汚さない');

    // リンクの同期: オーナーが collab1 にリンク設定 → ゲストに反映
    await owner.click('.node[data-id="collab1"]');
    await owner.waitForTimeout(200);
    await owner.keyboard.press('Escape');
    await owner.waitForTimeout(200);
    await owner.click('#linkFloatBtn');
    await owner.waitForTimeout(300);
    await owner.fill('#linkModalUrl', 'https://example.com');
    await owner.waitForTimeout(100);
    await owner.click('#linkModalOk');
    await owner.waitForTimeout(800);
    assert(await guest.$eval('.node[data-id="collab1"]', el => el.classList.contains('has-link')),
        'リンク設定がゲスト画面に同期される');

    // 関連線の同期: ゲストが root → collab1 に関連線を作成 → オーナーに反映
    await guest.click('.node.root');
    await guest.waitForTimeout(150);
    await guest.keyboard.press('Escape');
    await guest.waitForTimeout(150);
    await guest.click('#connectFloatBtn');
    await guest.waitForTimeout(300);
    await guest.click('.node[data-id="collab1"]');
    await guest.waitForTimeout(800);
    const relCounts = await Promise.all([
        guest.evaluate(() => (window.getMindMapData().relations || []).length),
        owner.evaluate(() => (window.getMindMapData().relations || []).length)
    ]);
    assert(relCounts[0] === 1 && relCounts[1] === 1,
        '関連線がゲストで作成されオーナーに同期される: guest=' + relCounts[0] + ' owner=' + relCounts[1]);

    // 全ノード閉じる/開く（«»）がゲストでも動く（ローカルのみ・同期はされない）
    await guest.click('#collapseAllBtn');
    await guest.waitForTimeout(400);
    const guestCollapsed = await guest.evaluate(() => document.querySelectorAll('.node').length);
    const ownerNodesStill = await owner.evaluate(() => document.querySelectorAll('.node').length);
    assert(guestCollapsed < ownerNodesStill, 'ゲストの「すべて閉じる」がローカルで効く（相手には影響しない）: guest=' + guestCollapsed + ' owner=' + ownerNodesStill);
    await guest.click('#expandAllBtn');
    await guest.waitForTimeout(400);
    const guestExpanded = await guest.evaluate(() => document.querySelectorAll('.node').length);
    assert(guestExpanded === ownerNodesStill, 'ゲストの「すべて開く」で元に戻る');
    // 折りたたみ操作でもlocalStorageは汚れない
    const guestCollapseLs = await guest.evaluate(() => localStorage.getItem('mindmap-node-collapse-2'));
    assert(guestCollapseLs === null, 'ゲストの開閉操作はlocalStorageを汚さない');

    // ========================================
    // Test 9: 終了イベントでゲストが閲覧専用に切り替わる
    // ========================================
    console.log('\n=== Test 9: 共同編集の終了 ===');
    await owner.evaluate(() => {
        // オーナー側から終了イベントを送出（トグルUIはステップ3で実装するため直接呼ぶ）
        window._collabTestSendEnd && window._collabTestSendEnd();
    });
    // エンジンにテスト用フックが無い場合は BroadcastChannel で直接終了イベントを送る
    await owner.evaluate(() => {
        var bc = new BroadcastChannel('mock-collab-mockshare-collab');
        bc.postMessage({ kind: 'end' });
        bc.close();
    });
    await guest.waitForTimeout(1000);
    const guestEnded = await guest.evaluate(() => ({
        readonly: !!window._isReadOnly,
        bodyClass: document.body.classList.contains('readonly-mode'),
        collabBannerGone: !document.getElementById('collabGuestBanner') &&
            !document.body.classList.contains('collab-guest-mode')
    }));
    assert(guestEnded.readonly && guestEnded.bodyClass, '終了イベントでゲストが閲覧専用モードに切り替わる');
    assert(guestEnded.collabBannerGone, '終了時に共同編集バナーが消えて閲覧専用バナーに切り替わる');

    // ========================================
    // Test 10: 閲覧専用の共有（allow_collab=false）は従来どおり
    // ========================================
    console.log('\n=== Test 10: 閲覧専用共有の回帰確認 ===');
    const viewer = await ctx.newPage();
    await viewer.goto(CLOUD_URL + '?share=mockshare-valid');
    await viewer.waitForTimeout(1500);
    const viewerState = await viewer.evaluate(() => ({
        readonly: !!window._isReadOnly,
        collabGuest: !!window._collabGuest,
        rootText: (document.querySelector('.node .node-text') || {}).textContent || ''
    }));
    assert(viewerState.readonly && !viewerState.collabGuest, '共同編集OFFの共有は従来どおり閲覧専用');
    assert(viewerState.rootText.includes('共有された中心テーマ'), '閲覧専用の表示内容も従来どおり');

    // ========================================
    // 結果
    // ========================================
    console.log('\n' + '='.repeat(50));
    console.log('collab: ' + pass + ' passed, ' + fail + ' failed');
    console.log('='.repeat(50));
    await browser.close();
    process.exit(fail > 0 ? 1 : 0);
})().catch(err => {
    console.error('Test error:', err);
    process.exit(1);
});
