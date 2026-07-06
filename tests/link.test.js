const { chromium } = require('playwright');
const { BASE_URL, CMD } = require('./helpers');

// リンク機能（link-modal.js）のテスト
// - モーダルのテキスト欄は node.text を直接編集する（表示テキストの二重管理はしない）
// - Enter確定時にキーイベントが keyboard.js に漏れて兄弟ノードが追加されない
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

    const nodeSel = (id) => `.node[data-id="${id}"]`;

    // テストツリー構築（n3 は旧形式データ: hyperlink.displayText 持ち）
    async function buildTree() {
        await page.evaluate(() => {
            var mapId = window.getCurrentMapId();
            var d = window.getMindMapData();
            d.root.text = '中心テーマ';
            d.root.children = [
                { id: 'n1', text: 'リンク対象', children: [] },
                { id: 'n2', text: '通常ノード', children: [] },
                { id: 'n3', text: '旧データノード', children: [],
                  hyperlink: { url: 'https://old.example.com', displayText: '古い表示テキスト' } }
            ];
            localStorage.setItem('mindmap-data-' + mapId, JSON.stringify(d));
        });
        await page.reload();
        await page.waitForSelector('.node', { state: 'attached', timeout: 10000 });
        await page.waitForTimeout(800);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(200);
    }
    await buildTree();

    // n を選択状態にする（編集モードに入れてEscで抜ける。選択は残る）
    // リンクなし: 通常クリックで編集モード。リンクあり: 通常クリックはURLを開くので Cmd+クリック
    async function selectNode(id) {
        const hasLink = await page.$eval(nodeSel(id), el => el.classList.contains('has-link'));
        if (hasLink) {
            await page.click(nodeSel(id), { modifiers: [CMD === 'Meta' ? 'Meta' : 'Control'] });
        } else {
            await page.click(nodeSel(id));
        }
        await page.waitForTimeout(200);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(200);
    }

    async function getNode(id) {
        return page.evaluate((nid) => {
            var found = null;
            (function walk(n) {
                if (n.id === nid) found = n;
                n.children.forEach(walk);
            })(window.getMindMapData().root);
            return found ? { text: found.text, hyperlink: found.hyperlink || null } : null;
        }, id);
    }

    async function countNodes() {
        return page.evaluate(() => {
            var c = 0;
            (function walk(n) { c++; n.children.forEach(walk); })(window.getMindMapData().root);
            return c;
        });
    }

    // ========================================
    // Test 1: リンク設定（テキスト変更あり）がマップに反映される
    // ========================================
    console.log('\n=== Test 1: リンク設定とテキスト反映 ===');
    await selectNode('n1');
    await page.click('#linkFloatBtn');
    await page.waitForTimeout(300);
    assert(await page.$eval('#linkModalOverlay', el => el.style.display === 'flex'), 'リンクモーダルが開く');
    assert(await page.$eval('#linkModalText', el => el.value) === 'リンク対象', 'テキスト欄にノードテキストがプリフィルされる');

    await page.fill('#linkModalText', '新しい表示テキスト');
    await page.fill('#linkModalUrl', 'https://example.com');
    await page.waitForTimeout(100);
    await page.click('#linkModalOk');
    await page.waitForTimeout(400);

    let n1 = await getNode('n1');
    assert(n1.hyperlink && n1.hyperlink.url === 'https://example.com', 'hyperlink.url が保存される');
    assert(n1.text === '新しい表示テキスト', 'node.text がモーダルのテキスト欄の値に更新される');
    assert(n1.hyperlink && !('displayText' in n1.hyperlink), 'displayText の二重管理はしない（hyperlink は url のみ）');
    let mapText = await page.$eval(nodeSel('n1') + ' .node-text', el => el.textContent);
    assert(mapText === '新しい表示テキスト', 'マップ上のノードにテキストが反映される: ' + mapText);
    assert(await page.$eval(nodeSel('n1'), el => el.classList.contains('has-link')), 'has-link クラスが付く');

    // ========================================
    // Test 2: 既存リンクのテキスト再編集もマップに反映される
    // ========================================
    console.log('\n=== Test 2: 既存リンクのテキスト再編集 ===');
    await page.click('#linkFloatBtn');
    await page.waitForTimeout(300);
    assert(await page.$eval('#linkModalText', el => el.value) === '新しい表示テキスト', '再オープン時も node.text がプリフィルされる');
    await page.fill('#linkModalText', '編集後テキスト');
    await page.click('#linkModalOk');
    await page.waitForTimeout(400);
    mapText = await page.$eval(nodeSel('n1') + ' .node-text', el => el.textContent);
    assert(mapText === '編集後テキスト', '再編集がマップに反映される: ' + mapText);

    // ========================================
    // Test 3: リロード後も表示とリンクが保持される
    // ========================================
    console.log('\n=== Test 3: リロード後の永続化 ===');
    await page.reload();
    await page.waitForSelector('.node', { state: 'attached', timeout: 10000 });
    await page.waitForTimeout(800);
    mapText = await page.$eval(nodeSel('n1') + ' .node-text', el => el.textContent);
    assert(mapText === '編集後テキスト', 'リロード後もテキストが保持される');
    assert(await page.$eval(nodeSel('n1'), el => el.classList.contains('has-link')), 'リロード後も has-link クラスが付く');

    // ========================================
    // Test 4: Enter確定でノードが勝手に追加されない（イベント漏れ）
    // ========================================
    console.log('\n=== Test 4: Enter確定のイベント漏れ防止 ===');
    const countBefore = await countNodes();
    await selectNode('n2');
    await page.click('#linkFloatBtn');
    await page.waitForTimeout(300);
    await page.fill('#linkModalUrl', 'https://enter-test.com');
    await page.waitForTimeout(100);
    await page.$eval('#linkModalUrl', el => { el.selectionStart = el.selectionEnd = el.value.length; });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);

    const n2 = await getNode('n2');
    assert(n2.hyperlink && n2.hyperlink.url === 'https://enter-test.com', 'URL欄のEnterでリンクが確定する');
    const countAfter = await countNodes();
    assert(countAfter === countBefore, 'Enter確定で兄弟ノードが追加されない (' + countBefore + '→' + countAfter + ')');
    assert(!(await page.$('.node.editing')), 'Enter確定後に編集モードのノードが残らない');

    // テキスト欄からのEnter（URL入力済み）でも同様
    await page.click('#linkFloatBtn');
    await page.waitForTimeout(300);
    await page.$eval('#linkModalText', el => { el.focus(); el.selectionStart = el.selectionEnd = el.value.length; });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    assert((await countNodes()) === countBefore, 'テキスト欄のEnter確定でもノードが追加されない');

    // ========================================
    // Test 5: Enter確定後の Undo が1回でリンク設定前に戻る
    // ========================================
    console.log('\n=== Test 5: Undo/Redo ===');
    // Test 4 で2回確定（URL欄Enter＋テキスト欄Enter）しているため、
    // 2回目の確定（データ変更なしでも saveState される）ぶんも含めて Undo 2回で設定前に戻る
    await page.keyboard.press(CMD + '+z');
    await page.waitForTimeout(400);
    await page.keyboard.press(CMD + '+z');
    await page.waitForTimeout(400);
    const n2AfterUndo = await getNode('n2');
    assert(!n2AfterUndo.hyperlink, 'Undo でリンク設定前に戻る');
    await page.keyboard.press(CMD + '+y');
    await page.waitForTimeout(400);
    const n2AfterRedo = await getNode('n2');
    assert(n2AfterRedo.hyperlink && n2AfterRedo.hyperlink.url === 'https://enter-test.com', 'Redo でリンクが復活する');

    // ========================================
    // Test 6: 旧形式データ（displayText持ち）の互換性
    // ========================================
    console.log('\n=== Test 6: 旧データ互換（displayText持ち）===');
    mapText = await page.$eval(nodeSel('n3') + ' .node-text', el => el.textContent);
    assert(mapText === '旧データノード', '旧データはこれまで通り node.text が表示される');
    await selectNode('n3');
    await page.click('#linkFloatBtn');
    await page.waitForTimeout(300);
    assert(await page.$eval('#linkModalText', el => el.value) === '旧データノード', '旧データでもテキスト欄は node.text をプリフィルする');
    await page.click('#linkModalOk');
    await page.waitForTimeout(400);
    const n3 = await getNode('n3');
    assert(n3.hyperlink && !('displayText' in n3.hyperlink), '再保存で旧 displayText が取り除かれる');
    assert(n3.hyperlink.url === 'https://old.example.com', '再保存でURLは維持される');

    // ========================================
    // Test 7: 直接編集（Cmd+クリック）とモーダルの整合性
    // ========================================
    console.log('\n=== Test 7: 直接編集との整合性 ===');
    await page.click(nodeSel('n1'), { modifiers: [CMD === 'Meta' ? 'Meta' : 'Control'] });
    await page.waitForTimeout(300);
    assert(await page.$eval(nodeSel('n1'), el => el.classList.contains('editing')), 'Cmd+クリックで編集モードに入る');
    await page.keyboard.press(CMD + '+a');
    await page.keyboard.type('直接編集した名前');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    n1 = await getNode('n1');
    assert(n1.text === '直接編集した名前' && !!n1.hyperlink, '直接編集でテキスト変更・リンクは残る');
    await page.click('#linkFloatBtn');
    await page.waitForTimeout(300);
    assert(await page.$eval('#linkModalText', el => el.value) === '直接編集した名前', '直接編集後のモーダルにも最新テキストが出る');
    await page.click('#linkModalCancel');
    await page.waitForTimeout(200);

    // ========================================
    // Test 8: クリックで新タブ／Cmd+クリックでは開かない
    // ========================================
    console.log('\n=== Test 8: リンククリック動作 ===');
    const [popup] = await Promise.all([
        context.waitForEvent('page', { timeout: 5000 }).catch(() => null),
        page.click(nodeSel('n1'))
    ]);
    assert(!!popup, '通常クリックで新タブが開く');
    if (popup) {
        assert(popup.url().startsWith('https://example.com'), '新タブのURLが設定値: ' + popup.url());
        await popup.close();
    }

    // ========================================
    // Test 9: URLバリデーション
    // ========================================
    console.log('\n=== Test 9: URLバリデーション ===');
    await selectNode('n1');
    await page.click('#linkFloatBtn');
    await page.waitForTimeout(300);
    await page.fill('#linkModalUrl', 'ただの文字列');
    await page.waitForTimeout(100);
    assert(await page.$eval('#linkModalOk', el => el.disabled), '無効URLでOKが非活性');
    await page.fill('#linkModalUrl', 'example.com/path');
    await page.waitForTimeout(100);
    assert(!(await page.$eval('#linkModalOk', el => el.disabled)), 'スキームなしURLは https:// 補完で有効');
    await page.click('#linkModalCancel');
    await page.waitForTimeout(200);

    // ========================================
    // Test 10: コピー&ペーストでリンク引き継ぎ
    // ========================================
    console.log('\n=== Test 10: コピー&ペースト ===');
    await selectNode('n1');
    await page.keyboard.press(CMD + '+c');
    await page.waitForTimeout(300);
    await selectNode('n2');
    await page.keyboard.press(CMD + '+v');
    await page.waitForTimeout(400);
    const pasted = await page.evaluate(() => {
        var n = null;
        (function walk(x) {
            if (x.id === 'n2') n = x;
            x.children.forEach(walk);
        })(window.getMindMapData().root);
        return n && n.children[0] ? { text: n.children[0].text, hyperlink: n.children[0].hyperlink || null } : null;
    });
    assert(pasted && pasted.hyperlink && pasted.hyperlink.url === 'https://example.com', 'ペーストしたノードにリンクが引き継がれる');

    // ========================================
    // Test 11: リンク削除
    // ========================================
    console.log('\n=== Test 11: リンク削除 ===');
    await selectNode('n1');
    await page.click('#linkFloatBtn');
    await page.waitForTimeout(300);
    assert(await page.$eval('#linkModalDelete', el => el.style.display !== 'none'), 'リンク設定済みで削除ボタンが表示される');
    await page.click('#linkModalDelete');
    await page.waitForTimeout(400);
    n1 = await getNode('n1');
    assert(!n1.hyperlink, 'リンクが削除される');
    assert(!(await page.$eval(nodeSel('n1'), el => el.classList.contains('has-link'))), 'has-link クラスが外れる');
    assert(n1.text === '直接編集した名前', 'リンク削除でテキストは変わらない');

    // ========================================
    // 結果
    // ========================================
    console.log('\n==================');
    console.log('Passed: ' + passed + '/' + (passed + failed));
    await browser.close();
    process.exit(failed > 0 ? 1 : 0);
})();
