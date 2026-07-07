const { chromium } = require('playwright');
const { BASE_URL, CMD } = require('./helpers');

// ノード複製（ドラッグ中に Cmd/Ctrl 押下でコピー）のテスト
// 色（グレー/黄/青/緑/赤文字）とリンクなどの装飾が複製先にそっくり引き継がれること、
// あわせてコピー&ペーストでも全色（緑含む）が引き継がれることを確認する
(async () => {
    const browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
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

    // テストツリー: n1 のサブツリーに5色＋リンクを分散して持たせる
    //   n1(グレー・リンク付き) ─ c1(黄) / c2(青) / c3(緑) / c4(赤文字)
    //   n2: 複製のドロップ先
    await page.evaluate(() => {
        var mapId = window.getCurrentMapId();
        var d = window.getMindMapData();
        d.root.text = '中心テーマ';
        d.root.children = [
            { id: 'n1', text: '装飾ノード', children: [
                { id: 'c1', text: '黄ハイライト', children: [] },
                { id: 'c2', text: '青ハイライト', children: [] },
                { id: 'c3', text: '緑ハイライト', children: [] },
                { id: 'c4', text: '赤文字', children: [] }
            ], hyperlink: { url: 'https://example.com' } },
            { id: 'n2', text: 'ドロップ先', children: [] }
        ];
        localStorage.setItem('mindmap-data-' + mapId, JSON.stringify(d));
        localStorage.setItem('mindmap-node-grayout-' + mapId, JSON.stringify({ n1: true }));
        localStorage.setItem('mindmap-node-highlight-' + mapId, JSON.stringify({ c1: true }));
        localStorage.setItem('mindmap-node-cyan-' + mapId, JSON.stringify({ c2: true }));
        localStorage.setItem('mindmap-node-green-' + mapId, JSON.stringify({ c3: true }));
        localStorage.setItem('mindmap-node-redtext-' + mapId, JSON.stringify({ c4: true }));
    });
    await page.reload();
    await page.waitForSelector('.node', { state: 'attached', timeout: 10000 });
    await page.waitForTimeout(800);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    // 前提確認: 複製元に色クラスが付いている
    console.log('\n=== 前提: 複製元の装飾表示 ===');
    assert(await page.$eval('.node[data-id="n1"]', el => el.classList.contains('grayed-out')), '複製元 n1 がグレーアウト表示');
    assert(await page.$eval('.node[data-id="c3"]', el => el.classList.contains('green-hl')), '複製元 c3 が緑ハイライト表示');

    // ========================================
    // Test 1: Cmd+ドラッグ複製で色・リンクが引き継がれる
    // ========================================
    console.log('\n=== Test 1: ドラッグ複製で装飾引き継ぎ ===');
    const srcBox = await page.$eval('.node[data-id="n1"]', el => {
        const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    const dstBox = await page.$eval('.node[data-id="n2"]', el => {
        const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });

    // 修飾キーなしで mousedown → 150ms 以上たってから動かしてドラッグ開始
    // → ドラッグ中に Cmd を押して複製モード → ドロップ先の中央（child 位置）で mouseup
    await page.mouse.move(srcBox.x, srcBox.y);
    await page.mouse.down();
    await page.waitForTimeout(250);
    await page.mouse.move(srcBox.x + 20, srcBox.y + 10, { steps: 3 });
    await page.waitForTimeout(100);
    await page.keyboard.down(CMD);
    await page.mouse.move(dstBox.x, dstBox.y, { steps: 5 });
    await page.waitForTimeout(100);
    await page.mouse.up();
    await page.keyboard.up(CMD);
    await page.waitForTimeout(600);

    // 複製結果: n2 の子に新IDのサブツリーができている
    const dup = await page.evaluate(() => {
        var d = window.getMindMapData();
        var n2 = d.root.children.find(c => c.id === 'n2');
        if (!n2 || n2.children.length !== 1) return null;
        var p = n2.children[0];
        return {
            id: p.id,
            text: p.text,
            hyperlink: p.hyperlink || null,
            childIds: p.children.map(c => c.id),
            childTexts: p.children.map(c => c.text),
            origExists: !!d.root.children.find(c => c.id === 'n1')
        };
    });
    assert(!!dup, '複製ノードが n2 の子として作られる');
    if (dup) {
        assert(dup.origExists, '複製元 n1 は残っている（移動ではない）');
        assert(dup.id !== 'n1', '複製ノードは新IDを持つ: ' + dup.id);
        assert(dup.text === '装飾ノード', 'テキストが引き継がれる');
        assert(dup.hyperlink && dup.hyperlink.url === 'https://example.com', 'リンク（hyperlink）が引き継がれる');
        assert(dup.childTexts.join(',') === '黄ハイライト,青ハイライト,緑ハイライト,赤文字', '子ノード4つも複製される');

        // 表示上の色クラスを確認（localStorage の色状態が新IDへ写っている）
        const sel = (id) => `.node[data-id="${id}"]`;
        assert(await page.$eval(sel(dup.id), el => el.classList.contains('grayed-out')), '複製ノードにグレーアウトが引き継がれる');
        assert(await page.$eval(sel(dup.id), el => el.classList.contains('has-link')), '複製ノードに has-link 表示が付く');
        assert(await page.$eval(sel(dup.childIds[0]), el => el.classList.contains('highlighted')), '複製された子に黄ハイライトが引き継がれる');
        assert(await page.$eval(sel(dup.childIds[1]), el => el.classList.contains('cyan-hl')), '複製された子に青ハイライトが引き継がれる');
        assert(await page.$eval(sel(dup.childIds[2]), el => el.classList.contains('green-hl')), '複製された子に緑ハイライトが引き継がれる');
        assert(await page.$eval(sel(dup.childIds[3]), el => el.classList.contains('red-text')), '複製された子に赤文字が引き継がれる');
    }

    // ========================================
    // Test 2: 修飾キーなしのドラッグは従来どおり移動（複製しない）
    // ========================================
    console.log('\n=== Test 2: 通常ドラッグは移動のまま ===');
    const countBefore = await page.evaluate(() => {
        var c = 0;
        (function walk(n) { c++; n.children.forEach(walk); })(window.getMindMapData().root);
        return c;
    });
    const c4Box = await page.$eval('.node[data-id="c4"]', el => {
        const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    const n2Box = await page.$eval('.node[data-id="n2"]', el => {
        const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    await page.mouse.move(c4Box.x, c4Box.y);
    await page.mouse.down();
    await page.waitForTimeout(250);
    await page.mouse.move(c4Box.x + 20, c4Box.y + 10, { steps: 3 });
    await page.mouse.move(n2Box.x, n2Box.y, { steps: 5 });
    await page.waitForTimeout(100);
    await page.mouse.up();
    await page.waitForTimeout(600);
    const afterMove = await page.evaluate(() => {
        var d = window.getMindMapData();
        var c = 0;
        (function walk(n) { c++; n.children.forEach(walk); })(d.root);
        var n2 = d.root.children.find(x => x.id === 'n2');
        return { count: c, movedIn: n2.children.some(x => x.id === 'c4') };
    });
    assert(afterMove.count === countBefore, '通常ドラッグでノード数は増えない（移動）');
    assert(afterMove.movedIn, 'c4 が n2 配下へ移動している');
    assert(await page.$eval('.node[data-id="c4"]', el => el.classList.contains('red-text')), '移動でも赤文字は維持される');

    // ========================================
    // Test 3: コピー&ペーストで全色（緑含む）が引き継がれる
    // ========================================
    console.log('\n=== Test 3: コピペで全色引き継ぎ ===');
    // ドラッグ直後の1クリックは didDrag 抑制で無視される仕様のため、1回クリックして消費しておく
    await page.click('.node[data-id="n1"]', { modifiers: [CMD === 'Meta' ? 'Meta' : 'Control'] });
    await page.waitForTimeout(200);
    // n1 を選択（クリックは編集モードに入るが、リンク付きなので Cmd+クリック→Esc）
    await page.click('.node[data-id="n1"]', { modifiers: [CMD === 'Meta' ? 'Meta' : 'Control'] });
    await page.waitForTimeout(200);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    await page.keyboard.press(CMD + '+c');
    await page.waitForTimeout(300);
    // root を選択してペースト
    await page.click('.node.root');
    await page.waitForTimeout(200);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    await page.keyboard.press(CMD + '+v');
    await page.waitForTimeout(600);

    const pasted = await page.evaluate(() => {
        var d = window.getMindMapData();
        var last = d.root.children[d.root.children.length - 1];
        return { id: last.id, text: last.text, childIds: last.children.map(c => c.id), hyperlink: last.hyperlink || null };
    });
    assert(pasted.text === '装飾ノード' && pasted.id !== 'n1', 'ペーストで新IDの複製ができる');
    if (pasted.text === '装飾ノード') {
        const sel = (id) => `.node[data-id="${id}"]`;
        assert(pasted.hyperlink && pasted.hyperlink.url === 'https://example.com', 'ペーストでリンクが引き継がれる');
        assert(await page.$eval(sel(pasted.id), el => el.classList.contains('grayed-out')), 'ペーストでグレーアウトが引き継がれる');
        assert(await page.$eval(sel(pasted.childIds[0]), el => el.classList.contains('highlighted')), 'ペーストで黄ハイライトが引き継がれる');
        assert(await page.$eval(sel(pasted.childIds[1]), el => el.classList.contains('cyan-hl')), 'ペーストで青ハイライトが引き継がれる');
        assert(await page.$eval(sel(pasted.childIds[2]), el => el.classList.contains('green-hl')), 'ペーストで緑ハイライトが引き継がれる（従来は消えていた）');
    }

    // ========================================
    // 結果
    // ========================================
    console.log('\n==================');
    console.log('Passed: ' + passed + '/' + (passed + failed));
    await browser.close();
    process.exit(failed > 0 ? 1 : 0);
})();
