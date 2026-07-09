// 共同編集モードのUI・運用まわりのテスト — チェックポイント2相当
// 共有ダイアログのトグル・URL再発行・お守りバックアップ・マイマップの色・
// ニックネームの保持を検証する（対象: dist/test.html + Supabaseモック）
const { chromium } = require('playwright');
const { CLOUD_URL } = require('./helpers');

let pass = 0, fail = 0;
function assert(cond, msg) {
    if (cond) { pass++; console.log('  ✅ ' + msg); }
    else { fail++; console.log('  ❌ FAIL: ' + msg); }
}

(async () => {
    const browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await ctx.newPage();

    // ---- セットアップ: ログインしてマップを1つ用意 ----
    await page.goto(CLOUD_URL);
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    await page.reload();
    await page.waitForTimeout(1000);
    await page.fill('#loginEmail', 'test@example.com');
    await page.fill('#loginPassword', 'test1234');
    await page.click('#loginBtn');
    await page.waitForTimeout(1500);
    await page.evaluate(() => {
        localStorage.setItem('mindmap-meta', JSON.stringify([
            { id: 1, name: '企画メモ', type: 'page', folderId: null, order: 0, createdAt: '', updatedAt: '' }
        ]));
        localStorage.setItem('mindmap-data-1', JSON.stringify(
            { root: { id: 'root', text: '中心', children: [] } }));
        localStorage.setItem('mindmap-id-counter', '1');
        localStorage.setItem('mindmap-last-active-id', '1');
        localStorage.setItem('mindmap-migrated-v4', '1');
    });
    await page.reload();
    await page.waitForSelector('.node', { state: 'attached', timeout: 10000 });
    await page.waitForTimeout(800);

    // ========================================
    // Test 1: 共有OFFでは共同編集トグルが表示されない
    // ========================================
    console.log('\n=== Test 1: 共有OFF時のダイアログ ===');
    await page.evaluate(() => window.showShareDialog(1));
    await page.waitForTimeout(600);
    let rowVisible = await page.$eval('#shareCollabRow', el => el.classList.contains('show'));
    assert(!rowVisible, '共有OFFのとき共同編集トグルは非表示');

    // ========================================
    // Test 2: 共有ONで共同編集トグルが出る／ONのたびに新URL
    // ========================================
    console.log('\n=== Test 2: 共有ONとURL再発行 ===');
    await page.click('#shareOverlay .share-toggle-row .share-toggle-slider');
    await page.waitForTimeout(600);
    const url1 = await page.$eval('#shareUrlInput', el => el.value);
    assert(url1.includes('/share/'), '共有ONでURLが発行される: ' + url1);
    rowVisible = await page.$eval('#shareCollabRow', el => el.classList.contains('show'));
    assert(rowVisible, '共有ONで共同編集トグルが表示される');
    const collabChecked = await page.$eval('#collabToggleInput', el => el.checked);
    assert(!collabChecked, '共同編集トグルの初期値はOFF');

    // OFF → ON し直すと新しいURLになる（古いURLは無効）
    await page.click('#shareOverlay .share-toggle-row .share-toggle-slider'); // OFF
    await page.waitForTimeout(600);
    await page.click('#shareOverlay .share-toggle-row .share-toggle-slider'); // ON
    await page.waitForTimeout(600);
    const url2 = await page.$eval('#shareUrlInput', el => el.value);
    assert(url2.includes('/share/') && url2 !== url1, '共有をONにし直すと新しいURLが発行される');

    // ========================================
    // Test 3: 共同編集ON → お守りバックアップ「いいえ」
    // ========================================
    console.log('\n=== Test 3: お守りバックアップ（いいえ） ===');
    await page.click('.share-toggle-slider--collab');
    await page.waitForTimeout(400);
    let backupShown = await page.$eval('#backupConfirmOverlay', el => el.classList.contains('show'));
    assert(backupShown, '共同編集ONでお守りバックアップ確認が表示される');
    const mapCountBefore = await page.evaluate(() =>
        JSON.parse(localStorage.getItem('mindmap-meta')).filter(m => m.type === 'page').length);
    await page.click('#backupNoBtn');
    await page.waitForTimeout(800);
    const mapCountAfterNo = await page.evaluate(() =>
        JSON.parse(localStorage.getItem('mindmap-meta')).filter(m => m.type === 'page').length);
    assert(mapCountAfterNo === mapCountBefore, '「いいえ」ではバックアップ複製が作られない');
    const collabSet = await page.evaluate(() =>
        (window._supaMockCalls || []).some(c => c.fn === 'setCollabEnabled' && c.args[1] === true));
    assert(collabSet, '「いいえ」でも共同編集はONになる（allow_collab=true）');

    // ========================================
    // Test 4: マイマップでオレンジ表示
    // ========================================
    console.log('\n=== Test 4: マイマップの色ルール ===');
    const nameClass = await page.evaluate(() => {
        var el = document.querySelector('.map-item-name');
        return el ? el.className : '';
    });
    assert(nameClass.includes('map-item-name--collab'), '共同編集ONのマップがオレンジ表示: ' + nameClass);
    const orangeColor = await page.evaluate(() => {
        var el = document.querySelector('.map-item-name--collab');
        return el ? getComputedStyle(el).color : '';
    });
    assert(orangeColor === 'rgb(217, 115, 13)', 'オレンジの色コードが #d9730d: ' + orangeColor);

    // ========================================
    // Test 5: ダイアログ再オープンで共同編集ONが復元される
    // ========================================
    console.log('\n=== Test 5: ダイアログの状態復元 ===');
    await page.click('#shareCloseBtn');
    await page.waitForTimeout(300);
    await page.evaluate(() => window.showShareDialog(1));
    await page.waitForTimeout(600);
    const restored = await page.evaluate(() => ({
        share: document.getElementById('shareToggleInput').checked,
        row: document.getElementById('shareCollabRow').classList.contains('show'),
        collab: document.getElementById('collabToggleInput').checked
    }));
    assert(restored.share && restored.row && restored.collab, '再オープン時に共有ON・共同編集ONが復元される');

    // ========================================
    // Test 6: 共同編集OFF → 青（閲覧専用共有）表示に戻る
    // ========================================
    console.log('\n=== Test 6: 共同編集OFF ===');
    await page.click('.share-toggle-slider--collab');
    await page.waitForTimeout(800);
    const classAfterOff = await page.evaluate(() => {
        var el = document.querySelector('.map-item-name');
        return el ? el.className : '';
    });
    assert(!classAfterOff.includes('--collab') && classAfterOff.includes('--shared'),
        '共同編集OFFで青（閲覧専用共有）表示に戻る: ' + classAfterOff);

    // ========================================
    // Test 7: お守りバックアップ「はい」で複製が作られる
    // ========================================
    console.log('\n=== Test 7: お守りバックアップ（はい） ===');
    await page.click('.share-toggle-slider--collab');
    await page.waitForTimeout(400);
    await page.click('#backupYesBtn');
    await page.waitForTimeout(800);
    const backupMeta = await page.evaluate(() => {
        var metas = JSON.parse(localStorage.getItem('mindmap-meta')).filter(m => m.type === 'page');
        return metas.map(m => m.name);
    });
    const dateStr = new Date().getFullYear() + '-' +
        String(new Date().getMonth() + 1).padStart(2, '0') + '-' +
        String(new Date().getDate()).padStart(2, '0');
    const expectedName = '企画メモ_バックアップ_' + dateStr;
    assert(backupMeta.indexOf(expectedName) !== -1,
        '「はい」で複製マップが作られる（' + expectedName + '）: ' + JSON.stringify(backupMeta));
    // バックアップは非公開（オレンジ・青が付かない）
    const backupClass = await page.evaluate((name) => {
        var els = document.querySelectorAll('.map-item-name');
        for (var i = 0; i < els.length; i++) {
            if (els[i].title === name) return els[i].className;
        }
        return null;
    }, expectedName);
    assert(backupClass !== null && !backupClass.includes('--shared') && !backupClass.includes('--collab'),
        'バックアップ複製は非公開（黒表示）で作られる');

    // ========================================
    // Test 8: 共有OFFで共同編集も自動OFF
    // ========================================
    console.log('\n=== Test 8: 共有OFF連動 ===');
    await page.click('#shareOverlay .share-toggle-row .share-toggle-slider'); // 共有OFF（共同編集ON状態のまま）
    await page.waitForTimeout(800);
    const autoOff = await page.evaluate(() => {
        var calls = window._supaMockCalls || [];
        // 直近の setCollabEnabled 呼び出しが false であること
        var last = null;
        for (var i = 0; i < calls.length; i++) {
            if (calls[i].fn === 'setCollabEnabled') last = calls[i];
        }
        return last && last.args[1] === false;
    });
    assert(autoOff, '共有OFFで共同編集も自動的にOFFになる（allow_collab=false）');
    const metaAfter = await page.evaluate(() =>
        JSON.parse(localStorage.getItem('mindmap-meta')).find(m => m.id === 1));
    assert(!metaAfter.isPublic && !metaAfter.allowCollab, 'メタ情報も共有OFF・共同編集OFFに更新される');
    const rowAfter = await page.$eval('#shareCollabRow', el => el.classList.contains('show'));
    assert(!rowAfter, '共同編集トグルが非表示に戻る');

    // ========================================
    // Test 9: ニックネームはリロードで聞き直さない（sessionStorage保持）
    // ========================================
    console.log('\n=== Test 9: ニックネームの保持 ===');
    const guest = await ctx.newPage();
    // 事前に sessionStorage へ名前を保存した状態で共同編集URLを開く
    await guest.goto(CLOUD_URL + '?share=mockshare-collab');
    await guest.waitForSelector('#nicknameOverlay.show', { timeout: 10000 });
    await guest.fill('#nicknameInput', 'もりた');
    await guest.click('#nicknameJoinBtn');
    await guest.waitForSelector('.node', { state: 'attached', timeout: 10000 });
    await guest.waitForTimeout(800);
    const savedName = await guest.evaluate(() => sessionStorage.getItem('collab-nickname'));
    assert(savedName === 'もりた', '入力したニックネームが保存される: ' + savedName);
    // リロード → ダイアログは出ずにそのまま参加
    await guest.reload();
    await guest.waitForSelector('.node', { state: 'attached', timeout: 10000 });
    await guest.waitForTimeout(1000);
    const dialogAfterReload = await guest.$eval('#nicknameOverlay', el => el.classList.contains('show'));
    assert(!dialogAfterReload, 'リロード時はニックネームを聞き直さない');
    const avatarTitle = await guest.evaluate(() => {
        var av = document.querySelector('.collab-avatar');
        return av ? av.title : null;
    });
    assert(avatarTitle === 'もりた', '保存済みニックネームで参加している: ' + avatarTitle);

    // ========================================
    // 結果
    // ========================================
    console.log('\n' + '='.repeat(50));
    console.log('collab-ui: ' + pass + ' passed, ' + fail + ' failed');
    console.log('='.repeat(50));
    await browser.close();
    process.exit(fail > 0 ? 1 : 0);
})().catch(err => {
    console.error('Test error:', err);
    process.exit(1);
});
