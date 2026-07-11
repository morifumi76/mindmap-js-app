// オーナー画面の共有状態バナーのテスト
// 開いているマップの共有がONの間、画面上部に帯（青=閲覧専用共有 / オレンジ=共同編集）を
// 表示する機能を検証する（対象: dist/test.html + Supabaseモック）
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

    // ---- セットアップ: ログインしてマップを2つ用意（切替テスト用） ----
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
            { id: 1, name: '共有するマップ', type: 'page', folderId: null, order: 0, createdAt: '', updatedAt: '' },
            { id: 2, name: '共有しないマップ', type: 'page', folderId: null, order: 1, createdAt: '', updatedAt: '' }
        ]));
        localStorage.setItem('mindmap-data-1', JSON.stringify(
            { root: { id: 'root', text: '中心1', children: [] } }));
        localStorage.setItem('mindmap-data-2', JSON.stringify(
            { root: { id: 'root', text: '中心2', children: [] } }));
        localStorage.setItem('mindmap-id-counter', '2');
        localStorage.setItem('mindmap-last-active-id', '1');
        localStorage.setItem('mindmap-migrated-v4', '1');
    });
    await page.reload();
    await page.waitForSelector('.node', { state: 'attached', timeout: 10000 });
    await page.waitForTimeout(800);

    // ========================================
    // Test 1: 共有OFFではバナーが出ない
    // ========================================
    console.log('\n=== Test 1: 共有OFF時はバナーなし ===');
    let banner = await page.$('#ownerShareBanner');
    assert(!banner, '共有OFFのマップではバナーが表示されない');
    let bodyMode = await page.$eval('body', el => el.classList.contains('owner-share-mode'));
    assert(!bodyMode, 'body に owner-share-mode クラスが付かない');

    // ========================================
    // Test 2: 共有ON → 青バナー表示＋レイアウト調整
    // ========================================
    console.log('\n=== Test 2: 共有ONで青バナー ===');
    await page.evaluate(() => window.showShareDialog(1));
    await page.waitForTimeout(600);
    await page.click('#shareOverlay .share-toggle-row .share-toggle-slider');
    await page.waitForTimeout(600);

    banner = await page.$('#ownerShareBanner');
    assert(!!banner, '共有ONでバナーが表示される');
    const blueText = await page.$eval('#ownerShareBanner', el => el.textContent);
    assert(blueText.includes('閲覧専用URLで公開'), 'バナー文言が閲覧専用共有を示す: ' + blueText);
    const blueBg = await page.$eval('#ownerShareBanner', el => getComputedStyle(el).backgroundColor);
    assert(blueBg === 'rgb(26, 115, 232)', 'バナーが青 #1a73e8: ' + blueBg);
    bodyMode = await page.$eval('body', el => el.classList.contains('owner-share-mode'));
    assert(bodyMode, 'body に owner-share-mode クラスが付く');
    const canvasTop = await page.$eval('.canvas-container', el => getComputedStyle(el).top);
    assert(canvasTop === '32px', 'キャンバスがバナーの高さぶん下がる: ' + canvasTop);
    const leftSidebarTop = await page.$eval('.left-sidebar', el => getComputedStyle(el).top);
    assert(leftSidebarTop === '32px', '左サイドバーも下がる: ' + leftSidebarTop);

    // ========================================
    // Test 3: 共同編集ON → オレンジバナーに変化
    // ========================================
    console.log('\n=== Test 3: 共同編集ONでオレンジバナー ===');
    await page.click('.share-toggle-slider--collab');
    await page.waitForTimeout(400);
    await page.click('#backupNoBtn'); // お守りバックアップは「いいえ」
    await page.waitForTimeout(800);

    const collabText = await page.$eval('#ownerShareBanner', el => el.textContent);
    assert(collabText.includes('共同編集モード'), 'バナー文言が共同編集を示す: ' + collabText);
    const orangeBg = await page.$eval('#ownerShareBanner', el => getComputedStyle(el).backgroundColor);
    assert(orangeBg === 'rgb(217, 115, 13)', 'バナーがオレンジ #d9730d: ' + orangeBg);

    // ========================================
    // Test 4: 旧仕様の「共同編集中」文字ラベルが存在しない
    // ========================================
    console.log('\n=== Test 4: 旧ラベルの廃止 ===');
    const oldLabel = await page.$('.collab-status-label');
    assert(!oldLabel, 'アバター下の「共同編集中」文字ラベルは表示されない');

    // ========================================
    // Test 5: 共有していないマップに切り替えるとバナーが消える
    // ========================================
    console.log('\n=== Test 5: マップ切替でバナー連動 ===');
    await page.click('#shareCloseBtn');
    await page.waitForTimeout(300);
    await page.evaluate(() => window.switchToMap(2));
    await page.waitForTimeout(800);

    banner = await page.$('#ownerShareBanner');
    assert(!banner, '共有OFFのマップに切替でバナーが消える');
    bodyMode = await page.$eval('body', el => el.classList.contains('owner-share-mode'));
    assert(!bodyMode, 'owner-share-mode クラスも外れる');

    // 共有中のマップに戻すとオレンジバナーが復活する
    await page.evaluate(() => window.switchToMap(1));
    await page.waitForTimeout(800);
    banner = await page.$('#ownerShareBanner');
    assert(!!banner, '共有中のマップに戻るとバナーが再表示される');
    const backBg = await page.$eval('#ownerShareBanner', el => getComputedStyle(el).backgroundColor);
    assert(backBg === 'rgb(217, 115, 13)', '共同編集ONの状態（オレンジ）が維持される: ' + backBg);

    // ========================================
    // Test 6: 共有OFFでバナーが消える
    // ========================================
    console.log('\n=== Test 6: 共有OFFでバナー解除 ===');
    await page.evaluate(() => window.showShareDialog(1));
    await page.waitForTimeout(600);
    await page.click('#shareOverlay .share-toggle-row .share-toggle-slider'); // OFF
    await page.waitForTimeout(800);

    banner = await page.$('#ownerShareBanner');
    assert(!banner, '共有OFFでバナーが消える');
    bodyMode = await page.$eval('body', el => el.classList.contains('owner-share-mode'));
    assert(!bodyMode, 'owner-share-mode クラスも外れる');
    const canvasTopAfter = await page.$eval('.canvas-container', el => getComputedStyle(el).top);
    assert(canvasTopAfter === '0px', 'キャンバスの位置が元に戻る: ' + canvasTopAfter);

    // ========================================
    // Summary
    // ========================================
    console.log('\n==================');
    console.log('Passed: ' + pass + '/' + (pass + fail));
    if (fail > 0) {
        console.log('FAILED: ' + fail);
        process.exit(1);
    }
    console.log('ALL TESTS PASSED ✅');
    await browser.close();
})();
