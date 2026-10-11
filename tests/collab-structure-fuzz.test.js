// 共同編集中の「階層崩れ」ストレステスト
// 報告: 共有（共同編集）中のマップで、第2階層に追加・編集したノードが、リロード後などに
//       第1階層へ上がってしまうことがある。同じマップを複数タブ・複数PCで開いていた。
// 再現を狙い、オーナー2タブ＋ゲスト1人で、ノード追加・文字編集・色付け・折りたたみ・
// リロードを（ときに同時に）ランダムに繰り返し、毎ステップ後に次の不変条件を検証する:
//   1. 全画面のツリー（ID・文字・親子関係）が一致する
//   2. 作成したノードの親が、作成時の親から変わっていない（誰も移動操作をしていないため）
//   3. ノードIDの重複がない
// 対象: dist/test.html（Supabaseモックのサーバー再現モード）。乱数は SEED で再現可能
const { chromium } = require('playwright');
const { CLOUD_URL, CMD } = require('./helpers');

const SEED = parseInt(process.env.FUZZ_SEED || '20261012', 10);
// 通常の npm test では15ラウンド（約2分）。徹底的に回すときは FUZZ_ROUNDS=40 FUZZ_SEED=1〜10 等で実行する
const ROUNDS = parseInt(process.env.FUZZ_ROUNDS || '15', 10);
const SETTLE_MS = 1300;
const ACTION_TIMEOUT_MS = 8000; // クリック等の待ち上限（既定30秒だと失敗時の調査が遅い） // 同期（Broadcast）・オーナー保存デバウンス（800ms）が落ち着くまで

let pass = 0, fail = 0;
function assert(cond, msg) {
    if (cond) { pass++; }
    else { fail++; console.log('  ❌ FAIL: ' + msg); }
}

// 再現可能な乱数（mulberry32）
function makeRng(seed) {
    let a = seed >>> 0;
    return function() {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
const rng = makeRng(SEED);
const pick = arr => arr[Math.floor(rng() * arr.length)];

// ページ内のツリーを「id → { parent, text }」と構造文字列に要約する
async function snapshot(page) {
    return page.evaluate(() => {
        var index = {}, dupes = [];
        (function walk(n, parentId) {
            if (index[n.id]) dupes.push(n.id);
            index[n.id] = { parent: parentId, text: n.text };
            for (var i = 0; i < n.children.length; i++) walk(n.children[i], n.id);
        })(window.getMindMapData().root, null);
        var shape = JSON.stringify(window.getMindMapData().root, ['id', 'text', 'children']);
        return { index: index, dupes: dupes, shape: shape };
    });
}

async function waitReady(page) {
    await page.waitForSelector('.node', { state: 'attached', timeout: 15000 });
    await page.waitForTimeout(1800); // オーナーの自動参加ウォッチャー（1秒間隔）
    // ノードが増えても全体が画面に収まるよう 50% まで縮小する（画面外のノードはクリックできないため）
    for (let i = 0; i < 15; i++) {
        const z = parseInt(await page.$eval('#zoomDisplay', el => el.textContent), 10);
        if (z <= 50) break;
        await page.click('#zoomOutBtn');
    }
}

// ノードをクリックして編集状態にし、確定（Enter）して選択だけ残す
async function selectNode(page, id) {
    await page.click('.node[data-id="' + id + '"]');
    await page.keyboard.press('Enter');
}

async function main() {
    const browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 1800, height: 1100 } });
    const ownerA = await ctx.newPage();

    // ---- セットアップ（collab.test.js と同じ手順＋サーバー再現モード） ----
    await ownerA.goto(CLOUD_URL);
    await ownerA.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    await ownerA.reload();
    await ownerA.waitForTimeout(1000);
    await ownerA.fill('#loginEmail', 'test@example.com');
    await ownerA.fill('#loginPassword', 'test1234');
    await ownerA.click('#loginBtn');
    await ownerA.waitForTimeout(1500);
    await ownerA.evaluate(() => {
        var data = { root: { id: 'root', text: '中心', children: [
            { id: 'p1', text: '親1', children: [{ id: 'c1', text: '子1', children: [] }] },
            { id: 'p2', text: '親2', children: [{ id: 'c2', text: '子2', children: [] }] },
            { id: 'p3', text: '親3', children: [] }
        ] } };
        var meta = [{ id: 1, name: '階層テスト', type: 'page', folderId: null, order: 0,
            createdAt: '', updatedAt: '', isPublic: true, shareId: 'mockshare-collab', allowCollab: true }];
        localStorage.setItem('mindmap-meta', JSON.stringify(meta));
        localStorage.setItem('mindmap-data-1', JSON.stringify(data));
        localStorage.setItem('mindmap-id-counter', '1');
        localStorage.setItem('mindmap-last-active-id', '1');
        localStorage.setItem('mindmap-migrated-v4', '1');
        localStorage.setItem('mock-collab-map-data', JSON.stringify(data));
        localStorage.setItem('mock-server-mode', '1');
    });
    await ownerA.reload();
    await waitReady(ownerA);

    const ownerB = await ctx.newPage(); // 同じマップを別タブでも開いている状態
    await ownerB.goto(CLOUD_URL + '?id=1');
    await waitReady(ownerB);

    const guest = await ctx.newPage();
    await guest.goto(CLOUD_URL + '?share=mockshare-collab');
    await guest.waitForSelector('#nicknameOverlay.show', { timeout: 10000 });
    await guest.click('#nicknameJoinBtn');
    await waitReady(guest);

    const pages = { ownerA, ownerB, guest };
    for (const p of [ownerA, ownerB, guest]) p.setDefaultTimeout(ACTION_TIMEOUT_MS);
    const names = Object.keys(pages);
    for (const n of names) {
        pages[n].on('pageerror', err => { fail++; console.log('  ❌ FAIL: ' + n + ' でJSエラー: ' + err.message); });
    }

    // 期待する親（ノード作成時に記録）。シード分も登録
    const expectedParent = { p1: 'root', p2: 'root', p3: 'root', c1: 'p1', c2: 'p2' };
    let counter = 0;
    let needLongSettle = false; // 復帰イベントなしのスリープ後は、一致確認（約8〜12秒）での修復を待つ

    async function settleAndCheck(label) {
        await ownerA.waitForTimeout(needLongSettle ? 14000 : SETTLE_MS);
        needLongSettle = false;
        const snaps = {};
        for (const n of names) snaps[n] = await snapshot(pages[n]);
        const base = snaps.ownerA;
        for (const n of names) {
            assert(snaps[n].dupes.length === 0, label + ': ' + n + ' にID重複 ' + snaps[n].dupes.join(','));
            assert(snaps[n].shape === base.shape, label + ': ' + n + ' のツリーが ownerA と食い違う');
            for (const id in expectedParent) {
                const got = snaps[n].index[id];
                if (!got) { assert(false, label + ': ' + n + ' でノード ' + id + ' が消えた'); continue; }
                assert(got.parent === expectedParent[id],
                    label + ': ' + n + ' でノード「' + got.text + '」の親が変わった ' + expectedParent[id] + ' → ' + got.parent);
            }
        }
        return base;
    }

    // ---- 操作の定義（いずれも移動系の操作は含まない＝親が変わってはいけない） ----
    const actions = {
        // 第1階層ノードを選んで Tab で子（第2階層）を追加し、文字を打って確定
        async addChild(page) {
            const parent = pick(['p1', 'p2', 'p3']);
            const text = 'N' + (++counter);
            await selectNode(page, parent);
            await page.keyboard.press('Tab');
            await page.waitForTimeout(150);
            await page.keyboard.type(text);
            await page.keyboard.press('Enter');
            const id = await page.evaluate(t => {
                var found = null;
                (function walk(n) { if (n.text === t) found = n.id; n.children.forEach(walk); })(window.getMindMapData().root);
                return found;
            }, text);
            if (id) expectedParent[id] = parent;
            else assert(false, 'addChild: 追加したノード ' + text + ' が見つからない');
            return 'addChild(' + parent + '→' + text + ')';
        },
        // 既存の第2階層ノードの文字を編集する
        async editText(page) {
            const snap = await snapshot(page);
            const level2 = Object.keys(snap.index).filter(id => ['p1', 'p2', 'p3'].indexOf(snap.index[id].parent) >= 0);
            if (level2.length === 0) return 'editText(skip)';
            const id = pick(level2);
            await page.click('.node[data-id="' + id + '"]');
            await page.keyboard.press(CMD + '+a');
            await page.keyboard.type('E' + (++counter));
            await page.keyboard.press('Enter');
            return 'editText(' + id + ')';
        },
        // 第2階層ノードの下にさらに子（第3階層）を追加する
        async addGrandChild(page) {
            const snap = await snapshot(page);
            const level2 = Object.keys(snap.index).filter(id => ['p1', 'p2', 'p3'].indexOf(snap.index[id].parent) >= 0);
            if (level2.length === 0) return 'addGrandChild(skip)';
            const parent = pick(level2);
            const text = 'G' + (++counter);
            await selectNode(page, parent);
            await page.keyboard.press('Tab');
            await page.waitForTimeout(150);
            await page.keyboard.type(text);
            await page.keyboard.press('Enter');
            const id = await page.evaluate(t => {
                var found = null;
                (function walk(n) { if (n.text === t) found = n.id; n.children.forEach(walk); })(window.getMindMapData().root);
                return found;
            }, text);
            if (id) expectedParent[id] = parent;
            return 'addGrandChild(' + parent + '→' + text + ')';
        },
        // 色付け（Option+Y）
        async color(page) {
            const snap = await snapshot(page);
            const id = pick(Object.keys(snap.index).filter(x => x !== 'root'));
            await selectNode(page, id);
            await page.keyboard.press('Alt+y');
            return 'color(' + id + ')';
        },
        // 折りたたみ→展開（各自ローカル）
        async collapseToggle(page) {
            const id = pick(['p1', 'p2', 'p3']);
            const has = await page.$('.node[data-id="' + id + '"] .node-junction-hitarea');
            if (!has) return 'collapse(skip)';
            await page.click('.node[data-id="' + id + '"] .node-junction-hitarea');
            await page.waitForTimeout(100);
            await page.click('.node[data-id="' + id + '"] .node-junction-hitarea');
            return 'collapse(' + id + ')';
        },
        // 下げて戻す（Option+→ → Option+←）。最終的な親は変わらないが、移動の同期を通る
        async moveRoundTrip(page) {
            // 上に兄弟がいる第2階層ノードだけが対象（下げる先＝直前の兄弟が必要。いないと下げられず、
            // 続く「上げる」で第1階層まで上がってしまい往復にならない）
            const candidates = await page.evaluate(() => {
                var out = [];
                window.getMindMapData().root.children.forEach(function(p) {
                    for (var i = 1; i < p.children.length; i++) out.push(p.children[i].id);
                });
                return out;
            });
            if (candidates.length === 0) return 'move(skip)';
            const id = pick(candidates);
            await selectNode(page, id);
            await page.keyboard.press('Alt+ArrowRight');
            await page.waitForTimeout(200);
            await page.keyboard.press('Alt+ArrowLeft');
            return 'moveRoundTrip(' + id + ')';
        },
        // スリープ: この画面だけ受信・送信が止まった状態で、別の画面が編集する。
        // 半分は復帰イベントあり（タブ復帰）、半分は復帰イベントなし（一致確認による自動修復を待つ）
        async sleep(page) {
            const others = names.filter(n => pages[n] !== page);
            await page.evaluate(() => { window._mockSleep = true; });
            const desc = await actions.addChild(pages[pick(others)]);
            await page.waitForTimeout(1000);
            const withEvent = rng() < 0.5;
            await page.evaluate(ev => {
                window._mockSleep = false;
                if (ev) document.dispatchEvent(new Event('visibilitychange'));
            }, withEvent);
            needLongSettle = !withEvent;
            return 'sleep(' + (withEvent ? '復帰イベントあり' : '復帰イベントなし') + ', 他画面で ' + desc + ')';
        },
        // リロード（オーナーは手元データ＋サーバー、ゲストはサーバーから読み直す）
        async reload(page) {
            await page.reload();
            if (page === guest) {
                await page.waitForSelector('#nicknameOverlay.show, .node', { timeout: 10000 });
                if (await page.$('#nicknameOverlay.show')) await page.click('#nicknameJoinBtn');
            }
            await waitReady(page);
            return 'reload';
        }
    };
    const weighted = ['addChild', 'addChild', 'addChild', 'editText', 'editText', 'addGrandChild', 'color',
        'collapseToggle', 'reload', 'reload', 'sleep', 'moveRoundTrip'];
    // 単独で行う操作（同時に行うと最終的な親が一意に決まらない／スリープ中の相手を巻き込む）
    const SOLO_ONLY = ['sleep', 'moveRoundTrip'];

    console.log('\n=== 共同編集ストレステスト（seed=' + SEED + ', rounds=' + ROUNDS + '） ===');
    await settleAndCheck('初期状態');
    for (let r = 1; r <= ROUNDS; r++) {
        // 3割は2画面で同時に操作（競合を起こす）
        const concurrent = rng() < 0.3;
        const who = concurrent ? [pick(names), pick(names)].filter((v, i, a) => a.indexOf(v) === i) : [pick(names)];
        let plan = who.map(n => ({ n, a: pick(weighted) }));
        if (plan.length > 1 && plan.some(p => SOLO_ONLY.indexOf(p.a) >= 0)) plan = [plan[0]];
        const results = await Promise.all(plan.map(p => actions[p.a](pages[p.n]).then(d => p.n + ':' + d).catch(async err => {
            // 操作自体が失敗（ノードがクリックできない等）した場合は、その画面の状態を記録して失敗扱い
            const diag = await pages[p.n].evaluate(() => Array.from(document.querySelectorAll('.node')).map(el => {
                var r = el.getBoundingClientRect();
                return el.dataset.id + '@' + Math.round(r.left) + ',' + Math.round(r.top) + (el.className.indexOf('editing') >= 0 ? '(編集中)' : '');
            }).join(' ')).catch(() => '(取得不可)');
            assert(false, 'ラウンド' + r + ' ' + p.n + ':' + p.a + ' の操作が失敗: ' + String(err.message).split('\n')[0] + ' / ノード位置: ' + diag);
            return p.n + ':' + p.a + '(失敗)';
        })));
        const before = fail;
        await settleAndCheck('ラウンド' + r);
        console.log('  ' + (fail === before ? '✅' : '❌') + ' ラウンド' + r + ' ' + results.join(' / '));
        if (fail > before) break; // 最初に壊れたラウンドで止めて原因を追いやすくする
    }

    // ---- 最後に全画面をリロードして、保存された状態でも崩れていないか ----
    if (fail === 0) {
        for (const n of names) await actions.reload(pages[n]);
        await settleAndCheck('全リロード後');
        console.log('  ' + (fail === 0 ? '✅' : '❌') + ' 全画面リロード後も階層が保たれる');
    }

    console.log('\n==================');
    console.log('Passed: ' + pass + '/' + (pass + fail) + '（ノード数 ' + Object.keys(expectedParent).length + '）');
    await browser.close();
    if (fail > 0) {
        console.log('FAILED: ' + fail);
        process.exit(1);
    }
    console.log('ALL TESTS PASSED ✅');
}

main().catch(e => { console.error(e); process.exit(1); });
