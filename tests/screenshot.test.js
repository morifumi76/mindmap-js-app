// スクリーンショット機能（📷ボタン → クリップボードにコピー / ファイルとして保存）のテスト
// 対象: dist/test.html（クラウド版＋Supabaseモック）。ローカル版にはボタンが無いことも確認する
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { BASE_URL, CLOUD_URL } = require('./helpers');

let pass = 0, fail = 0;
function assert(cond, msg) {
    if (cond) { pass++; console.log('  ✅ ' + msg); }
    else { fail++; console.log('  ❌ FAIL: ' + msg); }
}

// PNG のヘッダ（IHDR）から幅・高さを読む
function pngSize(buf) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

// 画像内で指定色（許容誤差つき）に近いピクセル数を数える（ブラウザ内で PNG をデコード）
async function countColors(page, buf, colors) {
    return page.evaluate(async ({ b64, colors }) => {
        var bin = atob(b64);
        var bytes = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        var bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
        var c = document.createElement('canvas');
        c.width = bmp.width; c.height = bmp.height;
        var ctx = c.getContext('2d');
        ctx.drawImage(bmp, 0, 0);
        var data = ctx.getImageData(0, 0, c.width, c.height).data;
        var counts = {};
        Object.keys(colors).forEach(function(k) { counts[k] = 0; });
        for (var p = 0; p < data.length; p += 4) {
            for (var k in colors) {
                var col = colors[k];
                if (Math.abs(data[p] - col[0]) <= 6 && Math.abs(data[p + 1] - col[1]) <= 6 && Math.abs(data[p + 2] - col[2]) <= 6) counts[k]++;
            }
        }
        return counts;
    }, { b64: buf.toString('base64'), colors });
}

// 📷 → ファイルとして保存（ダウンロード方式）で PNG を取得する
async function saveViaDownload(page) {
    await page.click('#screenshotFloatBtn');
    const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 10000 }),
        page.click('#screenshotSaveBtn')
    ]);
    const filePath = await download.path();
    return { name: download.suggestedFilename(), buf: fs.readFileSync(filePath) };
}

(async () => {
    const browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(CLOUD_URL).origin });
    const page = await ctx.newPage();

    // ---- セットアップ: ログインして、色・赤文字・関連線入りのマップを用意 ----
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
            { id: 1, name: '週次/計画', type: 'page', folderId: null, order: 0, createdAt: '', updatedAt: '' }
        ]));
        localStorage.setItem('mindmap-data-1', JSON.stringify({
            root: { id: 'root', text: '中心テーマ', children: [
                { id: 'pa', text: 'ParentA', children: [
                    { id: 'ca1', text: 'とても長いテキストを持つ子ノード', children: [] },
                    { id: 'ca2', text: 'ChildA2', children: [] }
                ] },
                { id: 'pb', text: 'ParentB', children: [
                    { id: 'cb1', text: 'ChildB1', children: [] }
                ] }
            ] },
            relations: [{ id: 'rel1', fromNodeId: 'ca2', toNodeId: 'cb1', controlPoint: null }]
        }));
        localStorage.setItem('mindmap-id-counter', '1');
        localStorage.setItem('mindmap-last-active-id', '1');
        localStorage.setItem('mindmap-migrated-v4', '1');
    });
    await page.reload();
    await page.waitForSelector('.node', { state: 'attached', timeout: 10000 });
    await page.waitForTimeout(800);
    // 色付け: ParentA=黄、ChildB1=赤文字。最後に ChildA2 を選択状態のままにする
    await page.click('.node[data-id="pa"]');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Alt+y');
    await page.click('.node[data-id="cb1"]');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Alt+a');
    await page.click('.node[data-id="ca2"]');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // ========================================
    console.log('\n=== Test 1: 📷ボタンの位置 ===');
    const firstChildId = await page.$eval('#canvasFloatBtns', el => el.firstElementChild.id);
    assert(firstChildId === 'screenshotControl', 'ツールバーの一番左にある: ' + firstChildId);

    // ========================================
    console.log('\n=== Test 2: 選択ダイアログ ===');
    await page.click('#screenshotFloatBtn');
    let visible = await page.isVisible('#screenshotModalOverlay');
    assert(visible, '📷を押すとダイアログが開く');
    const labels = await page.$$eval('#screenshotModalOverlay button', els => els.map(e => e.textContent.trim()));
    assert(JSON.stringify(labels) === JSON.stringify(['クリップボードにコピー', 'ファイルとして保存', 'キャンセル']),
        '3つのボタン: ' + labels.join(' / '));
    const nodesBefore = await page.$$eval('.node', els => els.length);
    await page.keyboard.press('Tab');
    await page.keyboard.press('Delete');
    const nodesAfter = await page.$$eval('.node', els => els.length);
    assert(nodesBefore === nodesAfter, 'ダイアログ表示中はマップのショートカットが効かない');
    await page.keyboard.press('Escape');
    visible = await page.isVisible('#screenshotModalOverlay');
    assert(!visible, 'Escで閉じる');
    await page.click('#screenshotFloatBtn');
    await page.click('#screenshotCancelBtn');
    visible = await page.isVisible('#screenshotModalOverlay');
    assert(!visible, 'キャンセルで閉じる');

    // ========================================
    console.log('\n=== Test 3: ファイルとして保存（ダウンロード方式） ===');
    // 「名前を付けて保存」ダイアログは自動テストで操作できないため、非対応ブラウザ用の経路で検証
    await page.evaluate(() => { delete window.showSaveFilePicker; window.showSaveFilePicker = undefined; });
    const shot1 = await saveViaDownload(page);
    assert(/^\d{4}-\d{2}-\d{2}_週次_計画\.png$/.test(shot1.name), 'ファイル名が 日付_マップ名.png（/ は _ に置換）: ' + shot1.name);
    assert(shot1.buf.slice(1, 4).toString() === 'PNG', 'PNG形式で保存される');
    fs.writeFileSync(path.join(__dirname, '..', 'dist', 'screenshot-sample.png'), shot1.buf);

    const size1 = pngSize(shot1.buf);
    // 期待サイズ = ノード群の範囲（等倍）+ 余白40px×2、を2倍
    const expected = await page.evaluate(() => {
        var inner = document.getElementById('canvasInner');
        var o = inner.getBoundingClientRect();
        var z = window.getViewState ? window.getViewState().zoom : 1;
        var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        inner.querySelectorAll('.node').forEach(function(el) {
            var r = el.getBoundingClientRect();
            minX = Math.min(minX, (r.left - o.left) / z); maxX = Math.max(maxX, (r.right - o.left) / z);
            minY = Math.min(minY, (r.top - o.top) / z); maxY = Math.max(maxY, (r.bottom - o.top) / z);
        });
        return { w: (maxX - minX + 80) * 2, h: (maxY - minY + 80) * 2 };
    });
    assert(Math.abs(size1.width - expected.w) <= 4 && Math.abs(size1.height - expected.h) <= 4,
        '全ノードを含む2倍サイズ: ' + size1.width + 'x' + size1.height + '（期待 ' + Math.round(expected.w) + 'x' + Math.round(expected.h) + '）');

    const counts = await countColors(page, shot1.buf, {
        yellow: [0xFB, 0xD9, 0x60],     // 黄ハイライト
        red: [0xC6, 0x28, 0x28],        // 赤文字
        green: [0x22, 0xC5, 0x5E],      // 関連線
        // 選択中だけの見た目（入ってはいけない）。通常の枠線も #4a90d9 なので、
        // 選択時の薄青背景 #e3f2fd と外側の光彩（白地に30%青≒#c9def4）で判定する
        selectBg: [0xE3, 0xF2, 0xFD],
        selectGlow: [0xC9, 0xDE, 0xF4]
    });
    assert(counts.yellow > 500, '黄ハイライトが写っている: ' + counts.yellow + 'px');
    assert(counts.red > 20, '赤文字が写っている: ' + counts.red + 'px');
    assert(counts.green > 10, '関連線が写っている: ' + counts.green + 'px');
    // 選択ノードが写ると1万px超になる。数十px程度は枠線・影のアンチエイリアスで自然に出る中間色
    assert(counts.selectBg < 500 && counts.selectGlow < 500,
        '選択中の青背景・青い光彩は写らない: ' + counts.selectBg + 'px / ' + counts.selectGlow + 'px');
    const stillSelected = await page.$eval('.node[data-id="ca2"]', el => el.classList.contains('selected'));
    assert(stillSelected, '画面上の選択状態はそのまま');

    // ========================================
    console.log('\n=== Test 4: 閉じた枝は閉じたまま写る / ズームに左右されない ===');
    await page.click('.node[data-id="pa"] .node-junction-hitarea');
    await page.waitForTimeout(300);
    await page.click('#zoomInBtn');
    await page.click('#zoomInBtn');
    await page.waitForTimeout(300);
    const shot2 = await saveViaDownload(page);
    const size2 = pngSize(shot2.buf);
    assert(size2.height < size1.height, 'ParentA を閉じると画像の高さが縮む: ' + size1.height + ' → ' + size2.height);
    await page.click('.node[data-id="pa"] .node-junction-hitarea');
    await page.waitForTimeout(300);
    const shot3 = await saveViaDownload(page);
    const size3 = pngSize(shot3.buf);
    assert(Math.abs(size3.width - size1.width) <= 2 && Math.abs(size3.height - size1.height) <= 2,
        'ズームを変えても同じ大きさの画像: ' + size3.width + 'x' + size3.height);

    // ========================================
    console.log('\n=== Test 5: クリップボードにコピー ===');
    await page.click('#screenshotFloatBtn');
    await page.click('#screenshotCopyBtn');
    await page.waitForFunction(() => document.getElementById('toast').textContent.indexOf('コピー') >= 0, null, { timeout: 10000 });
    const toastText = await page.$eval('#toast', el => el.textContent);
    assert(toastText === 'クリップボードにコピーしました', 'コピー完了のトースト: ' + toastText);
    const clipTypes = await page.evaluate(async () => {
        var items = await navigator.clipboard.read();
        return items.length ? items[0].types : [];
    });
    assert(clipTypes.indexOf('image/png') >= 0, 'クリップボードに PNG 画像が入る: ' + clipTypes.join(','));

    // ========================================
    console.log('\n=== Test 6: ローカル版には📷が無い ===');
    const localPage = await ctx.newPage();
    await localPage.goto(BASE_URL);
    await localPage.waitForSelector('.node', { state: 'attached', timeout: 10000 });
    const hasBtn = await localPage.$('#screenshotFloatBtn');
    const hasModal = await localPage.$('#screenshotModalOverlay');
    assert(!hasBtn && !hasModal, 'local.html に📷ボタン・ダイアログが無い');
    const firstLocal = await localPage.$eval('#canvasFloatBtns', el => el.firstElementChild.id);
    assert(firstLocal === 'verticalModeControl', 'ローカル版の一番左は従来どおり縦書きモード: ' + firstLocal);

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
