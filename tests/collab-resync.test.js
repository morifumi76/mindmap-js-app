// 共同編集の「取りこぼし → 古いツリーで上書き → 階層が巻き戻る」事故の再発防止テスト
// 報告（2026-10）: 共同編集中のマップで、第2階層にしたノードがリロード後に第1階層へ戻る。
// 再現した原因と、それぞれの対策を1シナリオずつ検証する:
//   A. タブ複製で参加者IDが重複 → 互いの操作を無視（対策: IDを画面ごとに新規発行）
//   B. スリープ等で受信が止まる → 復帰時に最新状態をもらう（対策: 復帰時の最新状態要求）
//   C. 通知なしで受信が止まったまま → 一致確認でずれを検知して自動修復（安全網）
//   D. 読み込み中（参加前）に行われた操作の取りこぼし → 参加直後に最新状態をもらう
//   E. 2画面が同時にノードを追加 → どちらも残る（ID重複・入力中の再描画で選択が外れる不具合の対策）
// 対象: dist/test.html（Supabaseモックのサーバー再現モード）
const { chromium } = require('playwright');
const { CLOUD_URL, CMD } = require('./helpers');

let pass = 0, fail = 0;
function assert(cond, msg) {
    if (cond) { pass++; console.log('  ✅ ' + msg); }
    else { fail++; console.log('  ❌ FAIL: ' + msg); }
}

async function waitReady(page) {
    await page.waitForSelector('.node', { state: 'attached', timeout: 15000 });
    await page.waitForTimeout(1800); // オーナーの自動参加ウォッチャー（1秒間隔）
}

// ログインして共同編集ONのマップを用意したオーナー画面を返す
async function setupOwner(ctx) {
    const page = await ctx.newPage();
    await page.goto(CLOUD_URL);
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    await page.reload();
    await page.waitForTimeout(800);
    await page.fill('#loginEmail', 'test@example.com');
    await page.fill('#loginPassword', 'test1234');
    await page.click('#loginBtn');
    await page.waitForTimeout(1200);
    await page.evaluate(() => {
        var data = { root: { id: 'root', text: '中心', children: [
            { id: 'p1', text: '親1', children: [] },
            { id: 'p2', text: '親2', children: [] }
        ] } };
        localStorage.setItem('mindmap-meta', JSON.stringify([{ id: 1, name: 'T', type: 'page', folderId: null, order: 0,
            createdAt: '', updatedAt: '', isPublic: true, shareId: 'mockshare-collab', allowCollab: true }]));
        localStorage.setItem('mindmap-data-1', JSON.stringify(data));
        localStorage.setItem('mindmap-last-active-id', '1');
        localStorage.setItem('mindmap-migrated-v4', '1');
        localStorage.setItem('mock-collab-map-data', JSON.stringify(data));
        localStorage.setItem('mock-server-mode', '1');
    });
    await page.reload();
    await waitReady(page);
    return page;
}

const parentOf = (page, text) => page.evaluate(t => {
    var r = null;
    (function w(n, par) { if (n.text === t) r = par ? par.text : null; n.children.forEach(c => w(c, n)); })(window.getMindMapData().root, null);
    return r;
}, text);

// 第1階層に text のノードを作る（親1を選んで Enter で兄弟追加 → 入力 → 確定）
async function createLevel1(page, text) {
    await page.click('.node[data-id="p1"]');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(150);
    await page.keyboard.type(text);
    await page.keyboard.press('Enter');
}

// text のノードを Option+→ で1階層下げる（直前の兄弟＝親1 の子になる）
async function demote(page, text) {
    const id = await page.evaluate(t => {
        var r = null;
        (function w(n) { if (n.text === t) r = n.id; n.children.forEach(w); })(window.getMindMapData().root);
        return r;
    }, text);
    await page.click('.node[data-id="' + id + '"]');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Alt+ArrowRight');
}

async function editP2(page, text) {
    await page.click('.node[data-id="p2"]');
    await page.keyboard.press(CMD + '+a');
    await page.keyboard.type(text);
    await page.keyboard.press('Enter');
}

(async () => {
    const browser = await chromium.launch();

    // ========================================
    console.log('\n=== A: タブ複製（sessionStorage ごとコピーされたタブ） ===');
    {
        const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
        const A = await setupOwner(ctx);
        await createLevel1(A, 'XXX');
        await A.waitForTimeout(1200);
        // タブ複製の再現: A の sessionStorage を丸ごと B にコピーしてから開く
        const ss = await A.evaluate(() => JSON.stringify(Object.assign({}, sessionStorage)));
        const B = await ctx.newPage();
        await B.addInitScript(s => { var o = JSON.parse(s); for (var k in o) sessionStorage.setItem(k, o[k]); }, ss);
        await B.goto(CLOUD_URL + '?id=1');
        await waitReady(B);
        await demote(A, 'XXX');
        await A.waitForTimeout(1200);
        assert(await parentOf(B, 'XXX') === '親1', '複製タブにも第2階層への移動が届く');
        await editP2(B, '親2改');
        await B.waitForTimeout(1500);
        await A.reload();
        await waitReady(A);
        assert(await parentOf(A, 'XXX') === '親1', '複製タブで編集→元タブをリロードしても第2階層のまま（報告された症状）');
        await ctx.close();
    }

    // ========================================
    console.log('\n=== B: スリープ（受信停止）→ 復帰時に最新状態をもらう ===');
    {
        const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
        const A = await setupOwner(ctx);
        await createLevel1(A, 'YYY');
        await A.waitForTimeout(1200);
        const B = await ctx.newPage();
        await B.goto(CLOUD_URL + '?id=1');
        await waitReady(B);
        await B.evaluate(() => { window._mockSleep = true; });
        await demote(A, 'YYY');
        await A.waitForTimeout(1200);
        assert(await parentOf(B, 'YYY') === '中心', '（前提）スリープ中の画面には移動が届いていない');
        // 復帰: 受信再開＋画面が表示状態に戻ったイベント
        await B.evaluate(() => { window._mockSleep = false; document.dispatchEvent(new Event('visibilitychange')); });
        await B.waitForTimeout(1200);
        assert(await parentOf(B, 'YYY') === '親1', '復帰直後に最新状態を受け取り第2階層になる');
        await editP2(B, '親2改');
        await B.waitForTimeout(1500);
        assert(await parentOf(A, 'YYY') === '親1', '復帰した画面で編集しても、元の画面の階層は崩れない');
        const p2 = await A.evaluate(() => window.getMindMapData().root.children.find(n => n.id === 'p2').text);
        assert(p2 === '親2改', '復帰した画面の編集は元の画面に届く: ' + p2);
        await ctx.close();
    }

    // ========================================
    console.log('\n=== C: 通知なしで受信が止まったまま → 一致確認で自動修復 ===');
    {
        const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
        const A = await setupOwner(ctx);
        await createLevel1(A, 'ZZZ');
        await A.waitForTimeout(1200);
        const B = await ctx.newPage();
        await B.goto(CLOUD_URL + '?id=1');
        await waitReady(B);
        await B.evaluate(() => { window._mockSleep = true; });
        await demote(A, 'ZZZ');
        await A.waitForTimeout(1200);
        await B.evaluate(() => { window._mockSleep = false; }); // 復帰イベントなし
        // 一致確認（4秒ごと・2回連続で不一致）で検知して取り直すのを待つ
        let fixed = false;
        for (let i = 0; i < 16 && !fixed; i++) {
            await B.waitForTimeout(1000);
            fixed = (await parentOf(B, 'ZZZ')) === '親1';
        }
        assert(fixed, 'ずれを自動検知して最新状態に追いつく');
        assert(await parentOf(A, 'ZZZ') === '親1', '最新側（元の画面）は巻き戻されない');
        await ctx.close();
    }

    // ========================================
    console.log('\n=== D: 読み込み中（参加前）に行われた操作の取りこぼし ===');
    {
        const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
        const A = await setupOwner(ctx);
        const B = await ctx.newPage();
        await B.goto(CLOUD_URL + '?id=1');
        await waitReady(B);
        // B をリロードし、読み込み〜参加の間に A が追加と移動を行う
        const reloading = B.reload();
        await createLevel1(A, 'WWW');
        await demote(A, 'WWW');
        await reloading;
        await waitReady(B);
        await B.waitForTimeout(800);
        assert(await parentOf(B, 'WWW') === '親1', 'リロード中に追加・移動されたノードも正しい階層で表示される');
        await editP2(B, '親2改');
        await B.waitForTimeout(1500);
        await A.reload();
        await waitReady(A);
        assert(await parentOf(A, 'WWW') === '親1', 'その後 B が編集・保存しても A の階層は崩れない');
        await ctx.close();
    }

    // ========================================
    console.log('\n=== E: 2画面で同時にノードを追加 ===');
    {
        const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
        const A = await setupOwner(ctx);
        const B = await ctx.newPage();
        await B.goto(CLOUD_URL + '?id=1');
        await waitReady(B);
        const addChild = async (page, parent, text) => {
            await page.click('.node[data-id="' + parent + '"]');
            await page.keyboard.press('Enter');
            await page.keyboard.press('Tab');
            await page.waitForTimeout(150);
            await page.keyboard.type(text);
            await page.keyboard.press('Enter');
        };
        const texts = page => page.evaluate(() => {
            var out = [];
            (function w(n) { out.push(n.text); n.children.forEach(w); })(window.getMindMapData().root);
            return out;
        });
        let ok = 0;
        const TRIES = 8;
        for (let i = 0; i < TRIES; i++) {
            await Promise.all([addChild(A, 'p1', 'A' + i), addChild(B, 'p2', 'B' + i)]);
            await A.waitForTimeout(1300);
            const ta = await texts(A), tb = await texts(B);
            if (ta.includes('A' + i) && ta.includes('B' + i) && tb.includes('A' + i) && tb.includes('B' + i)) ok++;
            else console.log('    第' + (i + 1) + '回 A画面: ' + ta.join(',') + ' / B画面: ' + tb.join(','));
        }
        assert(ok === TRIES, '同時追加しても両方のノードが正しい文字で両画面に残る: ' + ok + '/' + TRIES);
        await ctx.close();
    }

    console.log('\n==================');
    console.log('Passed: ' + pass + '/' + (pass + fail));
    await browser.close();
    if (fail > 0) {
        console.log('FAILED: ' + fail);
        process.exit(1);
    }
    console.log('ALL TESTS PASSED ✅');
})();
