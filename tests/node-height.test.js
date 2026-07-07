const { chromium } = require('playwright');
const { BASE_URL } = require('./helpers');

// ノードの縦サイズ統一のテスト
// line-height 固定により、英数字のみ・日本語・混在のどのテキストでも
// ノードの高さが同じになることを確認する（v2.4.2 の修正）
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

    await page.evaluate(() => {
        var mapId = window.getCurrentMapId();
        var d = window.getMindMapData();
        d.root.text = '中心テーマ';
        d.root.children = [
            { id: 'jp', text: '広報', children: [] },
            { id: 'en', text: 'Copilot', children: [] },
            { id: 'num', text: '12345', children: [] },
            { id: 'mix', text: 'EXPO会場', children: [] },
            { id: 'multi', text: '複数行の\nCopilotノード', children: [] }
        ];
        localStorage.setItem('mindmap-data-' + mapId, JSON.stringify(d));
    });
    await page.reload();
    await page.waitForSelector('.node', { state: 'attached', timeout: 10000 });
    await page.waitForTimeout(800);

    console.log('\n=== ノード高さの統一（英数字と日本語） ===');
    const h = await page.evaluate(() => {
        function height(id) { return document.querySelector('[data-id="' + id + '"]').offsetHeight; }
        return { jp: height('jp'), en: height('en'), num: height('num'), mix: height('mix'), multi: height('multi') };
    });
    assert(h.en === h.jp, '英数字のみのノードが日本語ノードと同じ高さ: en=' + h.en + ' / jp=' + h.jp);
    assert(h.num === h.jp, '数字のみのノードも同じ高さ: num=' + h.num);
    assert(h.mix === h.jp, '英数字＋日本語の混在ノードも同じ高さ: mix=' + h.mix);
    assert(h.multi > h.jp && h.multi < h.jp * 2, '複数行ノードはちょうど1行分だけ高い: multi=' + h.multi);

    // 1行の高さ（行ボックス）自体も一致していること
    const textH = await page.evaluate(() => {
        function th(id) { return document.querySelector('[data-id="' + id + '"] .node-text').offsetHeight; }
        return { jp: th('jp'), en: th('en') };
    });
    assert(textH.en === textH.jp, 'テキストの行ボックス高さが一致: en=' + textH.en + ' / jp=' + textH.jp);

    console.log('\n==================');
    console.log('Passed: ' + passed + '/' + (passed + failed));
    await browser.close();
    process.exit(failed > 0 ? 1 : 0);
})();
