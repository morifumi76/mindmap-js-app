const { chromium } = require('playwright');
const { BASE_URL } = require('./helpers');

// 関連線（緑の点線）の端点を別ノードへつなぎ替える機能のテスト。
// 検証対象: つなぎ替え成功 / 自己ループ・重複・循環の無効判定 / 保存と再描画が壊れていない。
(async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    let passed = 0, failed = 0, total = 0;

    function check(name, condition) {
        total++;
        if (condition) {
            passed++;
            console.log(`  ✅ ${name}`);
        } else {
            failed++;
            console.log(`  ❌ ${name}`);
        }
    }

    await page.goto(BASE_URL);
    await page.evaluate(() => localStorage.clear());
    await page.goto(BASE_URL);
    await page.waitForSelector('.node');

    // ノード root -> a, b, c, d と、関連線 rel1: a→b を仕込む
    await page.evaluate(() => {
        var data = {
            root: {
                id: 'root', text: 'Root',
                children: [
                    { id: 'a', text: 'A', children: [] },
                    { id: 'b', text: 'B', children: [] },
                    { id: 'c', text: 'C', children: [] },
                    { id: 'd', text: 'D', children: [] }
                ]
            },
            relations: [
                { id: 'rel1', fromNodeId: 'a', toNodeId: 'b', controlPoint: null }
            ]
        };
        var mapId = window.getCurrentMapId();
        localStorage.setItem('mindmap-data-' + mapId, JSON.stringify(data));
        window.location.reload();
    });
    await page.waitForSelector('.node');
    await page.waitForTimeout(400);

    // --- 1. 端点ドット・線が描画されている ---
    console.log('\n--- 1. 描画 ---');
    const endpointCount = await page.$$eval('.relation-endpoint', els => els.length);
    check('関連線の端点ドットが2つ描画されている', endpointCount === 2);

    // --- 2. つなぎ替え成功（to側を b → c） ---
    console.log('\n--- 2. つなぎ替え成功 ---');
    const r2 = await page.evaluate(() => window.reconnectRelationEndpoint('rel1', 'to', 'c'));
    check('結果が ok', r2.ok === true);
    const after2 = await page.evaluate(() => {
        var r = window.getMindMapData().relations[0];
        return { from: r.fromNodeId, to: r.toNodeId };
    });
    check('toNodeId が c に変わった', after2.to === 'c');
    check('fromNodeId は a のまま', after2.from === 'a');

    // --- 3. 自己ループは無効（from側を c→ a の相手... a→c の to を a にする＝自己ループ） ---
    console.log('\n--- 3. 自己ループ禁止 ---');
    const r3 = await page.evaluate(() => window.reconnectRelationEndpoint('rel1', 'to', 'a'));
    check('結果が無効', r3.ok === false);
    check('理由が自己ループ', /自分自身/.test(r3.reason));
    const after3 = await page.evaluate(() => window.getMindMapData().relations[0].toNodeId);
    check('toNodeId は c のまま（変更されない）', after3 === 'c');

    // --- 4. 重複接続は無効 ---
    console.log('\n--- 4. 重複接続禁止 ---');
    // 明示セット: rel1 a→b, rel2 a→c。rel1 の to を c にすると a-c が重複
    await page.evaluate(() => {
        window.getMindMapData().relations = [
            { id: 'rel1', fromNodeId: 'a', toNodeId: 'b', controlPoint: null },
            { id: 'rel2', fromNodeId: 'a', toNodeId: 'c', controlPoint: null }
        ];
    });
    const r4 = await page.evaluate(() => window.reconnectRelationEndpoint('rel1', 'to', 'c'));
    check('結果が無効', r4.ok === false);
    check('理由が重複', /すでに接続/.test(r4.reason));

    // --- 5. 循環は無効（関連線だけで判定） ---
    console.log('\n--- 5. 循環禁止 ---');
    // 明示セット: rel1 a→b, rel2 b→c, rel3 c→d。rel3 の to を a にすると c→a で a→b→c→a の循環
    await page.evaluate(() => {
        window.getMindMapData().relations = [
            { id: 'rel1', fromNodeId: 'a', toNodeId: 'b', controlPoint: null },
            { id: 'rel2', fromNodeId: 'b', toNodeId: 'c', controlPoint: null },
            { id: 'rel3', fromNodeId: 'c', toNodeId: 'd', controlPoint: null }
        ];
    });
    const r5 = await page.evaluate(() => window.reconnectRelationEndpoint('rel3', 'to', 'a'));
    check('結果が無効', r5.ok === false);
    check('理由が循環', /循環/.test(r5.reason));

    // --- 6. 直接ルール関数の確認（テスト5の状態 rel1 a→b, rel2 b→c, rel3 c→d を利用） ---
    console.log('\n--- 6. ルール関数 ---');
    const exists = await page.evaluate(() => window.relationExistsBetween('a', 'b', null));
    check('relationExistsBetween(a,b) は true', exists === true);
    const notExists = await page.evaluate(() => window.relationExistsBetween('a', 'd', null));
    check('relationExistsBetween(a,d) は false', notExists === false);
    const cycle = await page.evaluate(() => window.wouldCreateRelationCycle('c', 'a', 'rel3'));
    check('wouldCreateRelationCycle(c,a) は true（a→b→c）', cycle === true);

    // --- 7. 保存・再読み込みでつなぎ替えが残る ---
    console.log('\n--- 7. 永続化 ---');
    await page.reload();
    await page.waitForSelector('.node');
    await page.waitForTimeout(300);
    const persisted = await page.evaluate(() => {
        var rels = window.getMindMapData().relations;
        var r1 = rels.find(r => r.id === 'rel1');
        return r1 ? r1.toNodeId : null;
    });
    check('再読み込み後も rel1.toNodeId は c', persisted === 'c');
    const endpointCount2 = await page.$$eval('.relation-endpoint', els => els.length);
    check('再読み込み後も端点ドットが描画されている', endpointCount2 >= 2);

    console.log(`\nResults: ${passed} passed, ${failed} failed (total ${total})`);
    await browser.close();
    process.exit(failed > 0 ? 1 : 0);
})();
