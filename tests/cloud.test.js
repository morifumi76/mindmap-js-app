// クラウド版（認証・同期・共有）のテスト
// 対象: dist/test.html（クラウド版と同一構成で、保存アダプターだけ Supabase モックに差し替えたビルド）
// モックの仕様は tests/mocks/supa-mock.js を参照（test@example.com / test1234 でログイン可能）
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

    // ========================================
    // Test 1: 未ログイン時は認証画面が表示され、マップは描画されない
    // ========================================
    console.log('\n=== Test 1: Logged-out boot shows auth screen ===');
    await page.goto(CLOUD_URL);
    await page.waitForTimeout(1200);

    let overlayVisible = await page.evaluate(() =>
        getComputedStyle(document.getElementById('authOverlay')).display !== 'none');
    assert(overlayVisible, 'Auth overlay is visible before login');

    let nodesBefore = await page.locator('.node').count();
    assert(nodesBefore === 0, 'No mindmap nodes rendered before login');

    // ========================================
    // Test 2: 間違ったパスワードはエラー表示（画面遷移しない）
    // ========================================
    console.log('\n=== Test 2: Failed login shows error ===');
    await page.fill('#loginEmail', 'test@example.com');
    await page.fill('#loginPassword', 'wrong-password');
    await page.click('#loginBtn');
    await page.waitForTimeout(800);

    let errorText = await page.locator('#loginError').textContent();
    assert(errorText.length > 0, 'Login error message shown: ' + errorText);

    let stillOverlay = await page.evaluate(() =>
        getComputedStyle(document.getElementById('authOverlay')).display !== 'none');
    assert(stillOverlay, 'Auth overlay still visible after failed login');

    let btnEnabled = await page.evaluate(() => !document.getElementById('loginBtn').disabled);
    assert(btnEnabled, 'Login button re-enabled after failure');

    // ========================================
    // Test 3: 正しい資格情報でログイン → マップ描画
    // ========================================
    console.log('\n=== Test 3: Successful login renders the app ===');
    await page.fill('#loginPassword', 'test1234');
    await page.click('#loginBtn');
    await page.waitForTimeout(1500);

    let overlayAfter = await page.evaluate(() =>
        getComputedStyle(document.getElementById('authOverlay')).display === 'none');
    assert(overlayAfter, 'Auth overlay hidden after login');

    let nodesAfter = await page.locator('.node').count();
    assert(nodesAfter >= 1, 'Mindmap rendered after login: ' + nodesAfter + ' node(s)');

    let calls = await page.evaluate(() => window._supaMockCalls.map(c => c.fn));
    assert(calls.includes('loadUserData'), 'loadUserData was called on login');

    let saveText = await page.locator('#saveIndicator').textContent();
    assert(saveText === '保存済み', 'Save indicator shows 保存済み: ' + saveText);

    // ========================================
    // Test 4: 編集すると Supabase 同期（saveMap）が走り、保存済みに戻る
    // ========================================
    console.log('\n=== Test 4: Editing triggers debounced sync ===');
    let callCountBefore = await page.evaluate(() =>
        window._supaMockCalls.filter(c => c.fn === 'saveMap').length);

    await page.locator('.node').first().click();
    await page.keyboard.press('Tab');
    await page.waitForTimeout(250);
    await page.keyboard.type('CloudSyncTest');
    await page.keyboard.press('Enter');
    // デバウンス 800ms + 余裕
    await page.waitForTimeout(2000);

    let callCountAfter = await page.evaluate(() =>
        window._supaMockCalls.filter(c => c.fn === 'saveMap').length);
    assert(callCountAfter > callCountBefore,
        'saveMap called after edit (' + callCountBefore + ' -> ' + callCountAfter + ')');

    let saveTextAfter = await page.locator('#saveIndicator').textContent();
    assert(saveTextAfter === '保存済み', 'Save indicator back to 保存済み after sync');

    let synced = await page.evaluate(() => {
        var meta = JSON.parse(localStorage.getItem('mindmap-meta') || '[]');
        return meta.length >= 1;
    });
    assert(synced, 'Local meta exists after cloud login flow');

    // ========================================
    // Test 5: リロードしてもセッション維持（再ログイン不要）
    // ========================================
    console.log('\n=== Test 5: Session persists across reload ===');
    await page.reload();
    await page.waitForTimeout(1500);

    let overlayReload = await page.evaluate(() =>
        getComputedStyle(document.getElementById('authOverlay')).display === 'none');
    assert(overlayReload, 'No login screen after reload (session kept)');

    let nodesReload = await page.locator('.node').count();
    assert(nodesReload >= 1, 'Mindmap rendered directly after reload');

    // ========================================
    // Test 6: ログアウト → セッション破棄
    // ========================================
    console.log('\n=== Test 6: Logout clears session ===');
    page.on('dialog', d => d.accept());
    // 左サイドバーを開いてログアウトボタンを押す（フッターにある）
    await page.evaluate(() => { var b = document.getElementById('logoutBtn'); if (b) b.click(); });
    await page.waitForTimeout(2000);

    let sessionGone = await page.evaluate(() => !localStorage.getItem('mock-supa-session'));
    assert(sessionGone, 'Mock session removed after logout');

    let logoutCalled = await page.evaluate(() =>
        (window._supaMockCalls || []).some(c => c.fn === 'logout'));
    assert(logoutCalled || sessionGone, 'logout was invoked');

    // ========================================
    // Test 7: 共有URL（?share=ID）で閲覧専用モード
    // ========================================
    console.log('\n=== Test 7: Shared map opens in read-only mode ===');
    const sharedPage = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
    await sharedPage.goto(CLOUD_URL + '?share=mockshare-valid');
    await sharedPage.waitForTimeout(1500);

    let sharedState = await sharedPage.evaluate(() => ({
        readonly: !!window._isReadOnly,
        bodyClass: document.body.classList.contains('readonly-mode'),
        sidebarHidden: (document.getElementById('leftSidebar') || {}).style.display === 'none',
        rootText: (document.querySelector('.node .node-text') || {}).textContent || '',
        metaWritten: localStorage.getItem('mindmap-meta') !== null,
    }));
    assert(sharedState.readonly, 'Read-only flag set for shared map');
    assert(sharedState.bodyClass, 'body has readonly-mode class');
    assert(sharedState.sidebarHidden, 'Left sidebar hidden in shared view');
    assert(sharedState.rootText.includes('共有された中心テーマ'), 'Shared map content rendered: ' + sharedState.rootText);
    assert(!sharedState.metaWritten, 'Shared view does not write to localStorage');

    // ========================================
    // Test 8: 存在しない共有IDはエラー表示
    // ========================================
    console.log('\n=== Test 8: Invalid share ID shows error ===');
    const badPage = await (await browser.newContext()).newPage();
    await badPage.goto(CLOUD_URL + '?share=unknown-id');
    await badPage.waitForTimeout(1500);

    let bodyText = await badPage.evaluate(() => document.body.textContent);
    assert(bodyText.includes('このマップは共有されていません'), 'Error message for invalid share ID');

    // ========================================
    // Summary
    // ========================================
    console.log('\n' + '='.repeat(50));
    console.log('Results: ' + pass + ' passed, ' + fail + ' failed');
    console.log('='.repeat(50));

    await browser.close();
    process.exit(fail > 0 ? 1 : 0);
})().catch(err => {
    console.error('Test error:', err);
    process.exit(1);
});
