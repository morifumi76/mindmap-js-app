const { chromium } = require('playwright');
const { BASE_URL, CMD } = require('./helpers');

// 装飾（5色・リンク・関連線）の Undo / Redo テスト
// 履歴スナップショットが grayout / highlight しか持っておらず、
// 青・緑・赤文字が Ctrl+Z で戻らなかったバグ（v2.4.4 で修正）の回帰防止
(async () => {
    const browser = await chromium.launch();
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(BASE_URL);
    await page.evaluate(() => { localStorage.clear(); });
    await page.reload();
    await page.waitForSelector('.node', { state: 'attached', timeout: 10000 });
    await page.waitForTimeout(800);

    let passed = 0;
    let failed = 0;
    function assert(condition, msg) {
        if (condition) { passed++; console.log('  ✅ ' + msg); }
        else { failed++; console.log('  ❌ FAIL: ' + msg); }
    }

    // 色ごとに別ノードを使う（色同士は排他のため同一ノードだと相互に消し合う）
    await page.evaluate(() => {
        var mapId = window.getCurrentMapId();
        var d = window.getMindMapData();
        d.root.text = '中心テーマ';
        d.root.children = [
            { id: 'n1', text: 'グレー用', children: [] },
            { id: 'n2', text: '黄用', children: [] },
            { id: 'n3', text: '緑用', children: [] },
            { id: 'n4', text: '青用', children: [] },
            { id: 'n5', text: '赤文字用', children: [] },
            { id: 'n6', text: '関連線元', children: [] },
            { id: 'n7', text: '関連線先', children: [] }
        ];
        localStorage.setItem('mindmap-data-' + mapId, JSON.stringify(d));
    });
    await page.reload();
    await page.waitForSelector('.node', { state: 'attached', timeout: 10000 });
    await page.waitForTimeout(800);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    async function selectNode(id) {
        await page.click('.node[data-id="' + id + '"]');
        await page.waitForTimeout(150);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(150);
    }
    async function hasClass(id, cls) {
        return page.$eval('.node[data-id="' + id + '"]', (el, c) => el.classList.contains(c), cls);
    }
    async function undoOnce() {
        await page.keyboard.press(CMD + '+z');
        await page.waitForTimeout(300);
    }
    async function redoOnce() {
        await page.keyboard.press(CMD + '+y');
        await page.waitForTimeout(300);
    }

    // ========================================
    // Test 1: 5色それぞれの適用 → Undo → Redo
    // ========================================
    const colorCases = [
        { name: 'グレーアウト', node: 'n1', btn: '#grayoutFloatBtn', cls: 'grayed-out' },
        { name: '黄ハイライト', node: 'n2', btn: '#highlightFloatBtn', cls: 'highlighted' },
        { name: '緑ハイライト', node: 'n3', btn: '#greenFloatBtn', cls: 'green-hl' },
        { name: '青ハイライト', node: 'n4', btn: '#cyanFloatBtn', cls: 'cyan-hl' },
        { name: '赤文字', node: 'n5', btn: '#redTextFloatBtn', cls: 'red-text' }
    ];
    for (const c of colorCases) {
        console.log('\n=== ' + c.name + ' の Undo/Redo ===');
        await selectNode(c.node);
        await page.click(c.btn);
        await page.waitForTimeout(300);
        assert(await hasClass(c.node, c.cls), c.name + 'が適用される');

        await undoOnce();
        assert(!(await hasClass(c.node, c.cls)), 'Undo で' + c.name + 'が解除される');

        await redoOnce();
        assert(await hasClass(c.node, c.cls), 'Redo で' + c.name + 'が復活する');
    }

    // ========================================
    // Test 2: 複数色をまたぐ連続 Undo（適用の逆順で1つずつ戻る）
    // ========================================
    console.log('\n=== 連続 Undo（5色すべて） ===');
    // Test 1 の Redo 済み状態から5回 Undo すると全色が消えるはず
    for (let i = 0; i < colorCases.length; i++) await undoOnce();
    let anyColored = false;
    for (const c of colorCases) {
        if (await hasClass(c.node, c.cls)) anyColored = true;
    }
    assert(!anyColored, '5回の Undo で5色すべてが解除される');
    // 5回 Redo で全色復活
    for (let i = 0; i < colorCases.length; i++) await redoOnce();
    let allColored = true;
    for (const c of colorCases) {
        if (!(await hasClass(c.node, c.cls))) allColored = false;
    }
    assert(allColored, '5回の Redo で5色すべてが復活する');

    // ========================================
    // Test 3: 関連線（接続線）の作成 → Undo → Redo
    // ========================================
    console.log('\n=== 関連線の Undo/Redo ===');
    await selectNode('n6');
    await page.click('#connectFloatBtn');
    await page.waitForTimeout(300);
    await page.click('.node[data-id="n7"]');
    await page.waitForTimeout(400);
    let relCount = await page.evaluate(() => (window.getMindMapData().relations || []).length);
    assert(relCount === 1, '関連線が作成される: ' + relCount + '本');

    await undoOnce();
    relCount = await page.evaluate(() => (window.getMindMapData().relations || []).length);
    assert(relCount === 0, 'Undo で関連線が消える: ' + relCount + '本');

    await redoOnce();
    relCount = await page.evaluate(() => (window.getMindMapData().relations || []).length);
    assert(relCount === 1, 'Redo で関連線が復活する: ' + relCount + '本');

    // ========================================
    // Test 4: リンク（hyperlink）の Undo（link.test.js の補完として最小限）
    // ========================================
    console.log('\n=== リンクの Undo ===');
    await selectNode('n6');
    await page.click('#linkFloatBtn');
    await page.waitForTimeout(300);
    await page.fill('#linkModalUrl', 'https://example.com');
    await page.waitForTimeout(100);
    await page.click('#linkModalOk');
    await page.waitForTimeout(400);
    assert(await hasClass('n6', 'has-link'), 'リンクが設定される');
    await undoOnce();
    assert(!(await hasClass('n6', 'has-link')), 'Undo でリンクが消える');

    // ========================================
    // 結果
    // ========================================
    console.log('\n==================');
    console.log('Passed: ' + passed + '/' + (passed + failed));
    await browser.close();
    process.exit(failed > 0 ? 1 : 0);
})();
