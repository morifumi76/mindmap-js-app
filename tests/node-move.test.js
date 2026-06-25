const { chromium } = require('playwright');
const { BASE_URL } = require('./helpers');

// ノードの場所移動を Option(Alt)+↑/↓ に統一したことの検証
// （旧 Cmd/Ctrl+↑/↓ での移動は廃止、複数選択はまとめて移動・相対順序維持）
(async () => {
    const browser = await chromium.launch();
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(BASE_URL);
    await page.evaluate(() => { localStorage.clear(); });
    await page.reload();
    await page.waitForSelector('.node', { state: 'attached', timeout: 10000 });
    await page.waitForTimeout(800);

    let passed = 0, failed = 0;
    function assert(cond, msg) {
        if (cond) { passed++; console.log('  ✅ ' + msg); }
        else { failed++; console.log('  ❌ FAIL: ' + msg); }
    }
    const isMac = process.platform === 'darwin';
    const SELECT = isMac ? 'Meta' : 'Control';

    // root 直下に A, B, C。B には子 B1 を持たせ「子も一緒に動く」ことを確認
    async function resetTree() {
        await page.evaluate(() => {
            var mapId = window.getCurrentMapId();
            var d = window.getMindMapData();
            d.root.text = '中心テーマ';
            d.root.children = [
                { id: 'a', text: 'A', children: [] },
                { id: 'b', text: 'B', children: [ { id: 'b1', text: 'B1', children: [] } ] },
                { id: 'c', text: 'C', children: [] }
            ];
            localStorage.setItem('mindmap-data-' + mapId, JSON.stringify(d));
        });
        await page.reload();
        await page.waitForSelector('.node', { state: 'attached', timeout: 10000 });
        await page.waitForTimeout(500);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(100);
    }
    // 実際の選択APIで選ぶ（lastSelectedNodeId も正しく設定される）。
    // 先頭で単一選択 → 2つ目以降をトグル追加。最後に選んだものが「主」になる。
    const setSelection = (ids) => page.evaluate((ids) => {
        window.selectNode(ids[0]);
        for (var i = 1; i < ids.length; i++) window.toggleSelectNode(ids[i]);
    }, ids);
    const rootOrder = () => page.evaluate(() => window.getMindMapData().root.children.map(c => c.text));
    const bChildren = () => page.evaluate(() => {
        var b = window.getMindMapData().root.children.find(c => c.id === 'b');
        return b ? b.children.map(c => c.text) : null;
    });

    // ========================================
    // 複数選択を Option+↑ でまとめて上へ（相対順序維持）: A B C → B C A
    // ========================================
    console.log('\n=== Option+Up moves multi-selection as a block ===');
    await resetTree();
    await setSelection(['b', 'c']);
    await page.keyboard.press('Alt+ArrowUp');
    await page.waitForTimeout(200);
    let order = await rootOrder();
    assert(order.join('') === 'BCA', 'A B C with B,C selected + Option+Up → B C A: ' + order.join(' '));
    // 子ノードが一緒に動いている
    assert((await bChildren()).join('') === 'B1', 'B keeps its child B1 after move (subtree moved together)');

    // ========================================
    // 旧 Cmd/Ctrl+↑/↓ では移動しない（Optionに一本化）
    // ========================================
    console.log('\n=== Old Cmd/Ctrl+Arrow no longer moves ===');
    await resetTree();
    await setSelection(['a']);
    await page.keyboard.press(SELECT + '+ArrowDown');
    await page.waitForTimeout(200);
    order = await rootOrder();
    assert(order.join('') === 'ABC', 'Select-modifier+ArrowDown does NOT reorder (still A B C): ' + order.join(' '));

    // ========================================
    // 単一選択でも Option+↓ で移動できる: A B C → B A C
    // ========================================
    console.log('\n=== Option+Down moves single node ===');
    await resetTree();
    await setSelection(['a']);
    await page.keyboard.press('Alt+ArrowDown');
    await page.waitForTimeout(200);
    order = await rootOrder();
    assert(order.join('') === 'BAC', 'A selected + Option+Down → B A C: ' + order.join(' '));

    // ========================================
    // 先頭/末尾では何も起きない（エラーにならない）
    // ========================================
    console.log('\n=== Boundary: no move, no error ===');
    await resetTree();
    await setSelection(['a']);
    await page.keyboard.press('Alt+ArrowUp'); // A は既に先頭
    await page.waitForTimeout(150);
    order = await rootOrder();
    assert(order.join('') === 'ABC', 'Top node Option+Up does nothing: ' + order.join(' '));
    await setSelection(['c']);
    await page.keyboard.press('Alt+ArrowDown'); // C は既に末尾
    await page.waitForTimeout(150);
    order = await rootOrder();
    assert(order.join('') === 'ABC', 'Bottom node Option+Down does nothing: ' + order.join(' '));

    // ========================================
    // Option+→ で階層を1つ下げる（直前の兄弟の子になる）: A B C → A[ B 配下に C ] ... ここでは B,C を使う
    // ========================================
    console.log('\n=== Option+Right demotes (becomes child of previous sibling) ===');
    await resetTree();
    await setSelection(['c']);
    await page.keyboard.press('Alt+ArrowRight'); // C は B の弟 → B の子になる
    await page.waitForTimeout(200);
    order = await rootOrder();
    assert(order.join('') === 'AB', 'After demote, root has A B (C moved under B): ' + order.join(' '));
    let bKids = await bChildren();
    assert(bKids.join('') === 'B1C', 'C became a child of B (B1, C): ' + bKids.join(' '));

    // ========================================
    // Option+← で階層を1つ上げる（親の弟になる）: 上で B の子にした C を元の階層へ
    // ========================================
    console.log('\n=== Option+Left promotes (becomes sibling of parent) ===');
    await setSelection(['c']);
    await page.keyboard.press('Alt+ArrowLeft'); // C は B の子 → B の弟（root直下）へ
    await page.waitForTimeout(200);
    order = await rootOrder();
    assert(order.join('') === 'ABC', 'After promote, C is back at root level (A B C): ' + order.join(' '));
    assert((await bChildren()).join('') === 'B1', 'B no longer has C (only B1): ' + (await bChildren()).join(' '));

    // ========================================
    // 複数選択を Option+→ でまとめて1階層下げる（相対順序維持）
    //   A B C で B,C を選択 → A の子に B,C（A 配下 [B,C]）
    // ========================================
    console.log('\n=== Option+Right demotes multi-selection together ===');
    await resetTree();
    await setSelection(['b', 'c']);
    await page.keyboard.press('Alt+ArrowRight');
    await page.waitForTimeout(200);
    order = await rootOrder();
    assert(order.join('') === 'A', 'After multi-demote, root has only A: ' + order.join(' '));
    let aKids = await page.evaluate(() => {
        var a = window.getMindMapData().root.children.find(c => c.id === 'a');
        return a ? a.children.map(c => c.text) : null;
    });
    assert(aKids.join('') === 'BC', 'B and C both became children of A in order (B, C): ' + aKids.join(' '));

    // ========================================
    // 複数選択を Option+← でまとめて1階層上げる（相対順序維持）
    //   上で A 配下にした B,C を root 直下へ戻す → A B C
    // ========================================
    console.log('\n=== Option+Left promotes multi-selection together ===');
    await setSelection(['b', 'c']);
    await page.keyboard.press('Alt+ArrowLeft');
    await page.waitForTimeout(200);
    order = await rootOrder();
    assert(order.join('') === 'ABC', 'After multi-promote, root is A B C again: ' + order.join(' '));

    // ========================================
    // 選択が「一番上」で上に兄弟がいない場合は、すぐ下の兄弟の子になる（画像1のケース）
    //   並び: B C A（B,C を選択）→ 上に兄弟なし → 下の隣 A の子に B,C
    // ========================================
    console.log('\n=== Option+Right: top selection demotes into the sibling below ===');
    await resetTree();
    // root 直下を B, C, A の順に並べ替えてから B,C を選択（B,C が先頭＝上に兄弟なし）
    await page.evaluate(() => {
        var mapId = window.getCurrentMapId();
        var d = window.getMindMapData();
        d.root.children = [
            { id: 'b', text: 'B', children: [ { id: 'b1', text: 'B1', children: [] } ] },
            { id: 'c', text: 'C', children: [] },
            { id: 'a', text: 'A', children: [ { id: 'a1', text: 'A1', children: [] } ] }
        ];
        localStorage.setItem('mindmap-data-' + mapId, JSON.stringify(d));
    });
    await page.reload();
    await page.waitForSelector('.node', { state: 'attached', timeout: 10000 });
    await page.waitForTimeout(500);
    await page.keyboard.press('Escape');
    await setSelection(['b', 'c']);
    await page.keyboard.press('Alt+ArrowRight');
    await page.waitForTimeout(200);
    order = await rootOrder();
    assert(order.join('') === 'A', 'Top selection demote: root has only A left: ' + order.join(' '));
    aKids = await page.evaluate(() => {
        var a = window.getMindMapData().root.children.find(c => c.id === 'a');
        return a ? a.children.map(c => c.text) : null;
    });
    // A の既存の子 A1 の後ろに B, C が順番どおり入る
    assert(aKids.join(',') === 'A1,B,C', 'B,C appended under the sibling-below A (A1, B, C): ' + aKids.join(' '));

    // ========================================
    // 旧 Cmd/Ctrl+←/→ では親子移動しない（Optionに一本化）
    // ========================================
    console.log('\n=== Old Cmd/Ctrl+Left/Right no longer promotes/demotes ===');
    await resetTree();
    await setSelection(['c']);
    await page.keyboard.press(SELECT + '+ArrowRight');
    await page.waitForTimeout(200);
    order = await rootOrder();
    assert(order.join('') === 'ABC', 'Select-modifier+ArrowRight does NOT demote (still A B C): ' + order.join(' '));

    console.log('\n=== Results ===');
    console.log('Passed: ' + passed + ', Failed: ' + failed);
    await browser.close();
    if (failed > 0) process.exit(1);
})();
