const { chromium } = require('playwright');
const { BASE_URL, CMD } = require('./helpers');

// 縦表示モード（vertical layout）のテスト
// 仕様: docs/specs/vertical-layout.md（Notion指示書「縦書きモード」2026-07-06）
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

    // テストツリー構築（長文ノード・深い階層・多ノードを含む）
    console.log('\n=== Building test tree ===');
    await page.evaluate(() => {
        var mapId = window.getCurrentMapId();
        var d = window.getMindMapData();
        d.root.text = '中心テーマ';
        d.root.children = [
            { id: 'pa', text: 'ParentA', children: [
                { id: 'ca1', text: 'とても長いテキストを持つ子ノードで幅の計算を検証する', children: [
                    { id: 'ga1', text: 'GrandA1', children: [] },
                    { id: 'ga2', text: 'GrandA2', children: [] }
                ] },
                { id: 'ca2', text: 'ChildA2', children: [] }
            ]},
            { id: 'pb', text: 'ParentB', children: [
                { id: 'cb1', text: 'ChildB1', children: [] },
                { id: 'cb2', text: 'ChildB2', children: [] },
                { id: 'cb3', text: 'ChildB3', children: [] }
            ]},
            { id: 'pc', text: 'ParentC', children: [] }
        ];
        localStorage.setItem('mindmap-data-' + mapId, JSON.stringify(d));
    });
    await page.reload();
    await page.waitForSelector('.node', { state: 'attached', timeout: 10000 });
    await page.waitForTimeout(800);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    // ========================================
    // Test 1: チェックボックスのUI（高速モードの左隣・デフォルトOFF）
    // ========================================
    console.log('\n=== Test 1: 縦書きモードトグルUI（高速モードと同一の見た目） ===');
    const toggle = await page.$('#verticalModeToggle');
    assert(!!toggle, '縦書きモードトグルボタンが存在する');

    const labelText = await page.$eval('#verticalModeControl .fast-mode-label', el => el.textContent.trim());
    assert(labelText === '縦書きモード', 'ラベルが「縦書きモード」: ' + labelText);

    // 高速モードと同じトグルUI（同一のCSSクラスとON/OFFスイッチ構造）
    const sameUi = await page.evaluate(() => {
        var ctrl = document.getElementById('verticalModeControl');
        var btn = document.getElementById('verticalModeToggle');
        return {
            ctrlClass: ctrl ? ctrl.className : '',
            role: btn ? btn.getAttribute('role') : '',
            hasOnOff: !!(btn && btn.querySelector('.fast-mode-toggle-text-on') &&
                btn.querySelector('.fast-mode-toggle-text-off') && btn.querySelector('.fast-mode-toggle-knob'))
        };
    });
    assert(sameUi.ctrlClass === 'fast-mode-control', '高速モードと同じコントロールUI（fast-mode-control）: ' + sameUi.ctrlClass);
    assert(sameUi.role === 'switch', 'トグルは role=switch のスイッチボタン');
    assert(sameUi.hasOnOff, 'ON/OFF表示とツマミを持つ高速モードと同一構造');

    // 高速モードの左隣（同じ親の直前の兄弟要素）に配置されている
    const isLeftOfFastMode = await page.evaluate(() => {
        var fm = document.getElementById('fastModeControl');
        return !!(fm && fm.previousElementSibling && fm.previousElementSibling.id === 'verticalModeControl');
    });
    assert(isLeftOfFastMode, '高速モードボタンの左隣に配置されている');

    const checkedDefault = await page.$eval('#verticalModeToggle', el => el.getAttribute('aria-checked'));
    assert(checkedDefault === 'false', 'デフォルトはOFF（横レイアウト）');

    // 横レイアウト：子はルートの右側
    const hRootPa = await page.evaluate(() => {
        var r = document.querySelector('[data-id="root"]').getBoundingClientRect();
        var p = document.querySelector('[data-id="pa"]').getBoundingClientRect();
        return { rootRight: r.right, paLeft: p.left };
    });
    assert(hRootPa.paLeft >= hRootPa.rootRight, '横モード: 子ノードはルートの右側にある');

    // ========================================
    // Test 2: チェックONで縦レイアウトに即時切替
    // ========================================
    console.log('\n=== Test 2: 縦レイアウトへの切替 ===');
    await page.click('#verticalModeToggle');
    await page.waitForTimeout(400);

    const vGeom = await page.evaluate(() => {
        function rect(id) { return document.querySelector('[data-id="' + id + '"]').getBoundingClientRect(); }
        function cx(r) { return r.left + r.width / 2; }
        var root = rect('root'), pa = rect('pa'), pb = rect('pb'), pc = rect('pc');
        var ca1 = rect('ca1'), ca2 = rect('ca2');
        var cb1 = rect('cb1'), cb3 = rect('cb3');
        return {
            rootBottom: root.bottom, rootCx: cx(root),
            paTop: pa.top, pbTop: pb.top, pcTop: pc.top,
            paRight: pa.right, pbLeft: pb.left, pbRight: pb.right, pcLeft: pc.left,
            paCx: cx(pa), pcCx: cx(pc),
            ca1Top: ca1.top, paBottom: pa.bottom,
            pbCx: cx(pb),
            ca1Cx: cx(ca1), ca2Cx: cx(ca2), cb1Cx: cx(cb1), cb3Cx: cx(cb3),
            ca1Right: ca1.right, ca2Left: ca2.left
        };
    });
    assert(vGeom.paTop >= vGeom.rootBottom, '縦モード: 子（ParentA）はルートの下にある');
    assert(vGeom.pbTop >= vGeom.rootBottom && vGeom.pcTop >= vGeom.rootBottom, '縦モード: 全ての子がルートの下にある');
    assert(vGeom.paRight <= vGeom.pbLeft && vGeom.pbRight <= vGeom.pcLeft, '縦モード: 兄弟が左右に並び重ならない');
    assert(vGeom.ca1Top >= vGeom.paBottom, '縦モード: 孫はさらに1段下にある');
    // 配置ルール（Reingold-Tilford）: 親のX中心 = 左端の子の中心と右端の子の中心の中間点
    assert(Math.abs(vGeom.pbCx - (vGeom.cb1Cx + vGeom.cb3Cx) / 2) < 2,
        '縦モード: 親（ParentB）は左端の子と右端の子の中心の中間点にある');
    // 非対称な枝（ca1=孫持ちの長文ノード、ca2=葉）でも親は子の中心の中間点に来る
    assert(Math.abs(vGeom.paCx - (vGeom.ca1Cx + vGeom.ca2Cx) / 2) < 2,
        '縦モード: 非対称な枝でも親（ParentA）は子の中心の中間点にある');
    // ルートも同じルール（左端の子 pa と右端の子 pc の中間点）
    assert(Math.abs(vGeom.rootCx - (vGeom.paCx + vGeom.pcCx) / 2) < 2,
        '縦モード: ルートも左端の子と右端の子の中心の中間点にある');
    assert(vGeom.paCx < vGeom.pbCx && vGeom.pbCx < vGeom.pcCx, '縦モード: 兄弟の並び順が左→右');
    assert(vGeom.ca1Right <= vGeom.ca2Left, '縦モード: 長文ノードの兄弟も重ならない（幅の再帰計算）');

    // いとこ間（ca2 と cb1）の重なりも確認
    const cousinOverlap = await page.evaluate(() => {
        var a = document.querySelector('[data-id="ca2"]').getBoundingClientRect();
        var b = document.querySelector('[data-id="cb1"]').getBoundingClientRect();
        return a.right > b.left && b.right > a.left && a.bottom > b.top && b.bottom > a.top;
    });
    assert(!cousinOverlap, '縦モード: いとこ同士のノードが重ならない');

    // ========================================
    // Test 3: 接続線（組織図風の直交3セグメント: 縦→水平→縦）
    // ========================================
    console.log('\n=== Test 3: 接続線の直交セグメント ===');
    // 縦表示の全接続線をパースして始点・折れ点・終点を返すヘルパ
    const vLines = await page.evaluate(() => {
        var off = 5000;
        function canvasPos(el) {
            var x = parseFloat(el.style.left), y = parseFloat(el.style.top);
            var w = el.offsetWidth, h = el.offsetHeight;
            // top は上下中央基準（translateY(-50%)）
            return { bottomCx: x + w / 2, bottomY: y + h / 2, topCx: x + w / 2, topY: y - h / 2 };
        }
        var nodes = {};
        ['root', 'pa', 'pb', 'pc', 'cb1', 'cb2', 'cb3'].forEach(function(id) {
            nodes[id] = canvasPos(document.querySelector('[data-id="' + id + '"]'));
        });
        var lines = [];
        document.querySelectorAll('#linesSvg .connection-line').forEach(function(p) {
            var m = p.getAttribute('d').match(
                /^M ([\d.-]+) ([\d.-]+) L ([\d.-]+) ([\d.-]+) L ([\d.-]+) ([\d.-]+) L ([\d.-]+) ([\d.-]+)$/
            );
            if (!m) { lines.push({ bad: p.getAttribute('d') }); return; }
            var n = m.slice(1).map(function(v) { return parseFloat(v) - off; });
            lines.push({ sx: n[0], sy: n[1], x2: n[2], y2: n[3], x3: n[4], y3: n[5], ex: n[6], ey: n[7] });
        });
        return { nodes: nodes, lines: lines };
    });

    const badLines = vLines.lines.filter(l => l.bad);
    assert(badLines.length === 0, '縦表示の全接続線が直交3セグメント形式（M L L L）: ' + (badLines[0] ? badLines[0].bad : 'OK'));

    function findLine(fromPos, toPos) {
        return vLines.lines.find(l => !l.bad &&
            Math.abs(l.sx - fromPos.bottomCx) < 1 && Math.abs(l.sy - fromPos.bottomY) < 1 &&
            Math.abs(l.ex - toPos.topCx) < 1 && Math.abs(l.ey - toPos.topY) < 1);
    }
    function isOrthogonal(l) {
        // 縦（x不変）→ 水平（y不変）→ 縦（x不変）で、水平線は親の下辺と子の上辺の間にある
        return Math.abs(l.sx - l.x2) < 0.01 && Math.abs(l.y2 - l.y3) < 0.01 &&
            Math.abs(l.x3 - l.ex) < 0.01 && l.y2 > l.sy && l.y2 < l.ey;
    }

    const rootToPa = findLine(vLines.nodes.root, vLines.nodes.pa);
    assert(!!rootToPa, '接続線が親の下辺中央→子の上辺中央に描画される');
    assert(rootToPa && isOrthogonal(rootToPa), '線が縦→水平→縦の直角折れ線になっている');

    // 兄弟への水平線が全員同じ高さ（バス）に揃う: ルートの子 pa/pb/pc で確認
    const rootToPb = findLine(vLines.nodes.root, vLines.nodes.pb);
    const rootToPc = findLine(vLines.nodes.root, vLines.nodes.pc);
    assert(!!rootToPb && !!rootToPc, 'ルートから全ての子への線が存在する');
    if (rootToPa && rootToPb && rootToPc) {
        assert(Math.abs(rootToPa.y2 - rootToPb.y2) < 0.01 && Math.abs(rootToPb.y2 - rootToPc.y2) < 0.01,
            '兄弟への水平線が同じ高さに揃う（バス）: ' + [rootToPa.y2, rootToPb.y2, rootToPc.y2].join(', '));
    }
    // 別の親（ParentB → cb1/cb2/cb3）でもバスの高さが揃う
    const pbToCb1 = findLine(vLines.nodes.pb, vLines.nodes.cb1);
    const pbToCb3 = findLine(vLines.nodes.pb, vLines.nodes.cb3);
    assert(!!pbToCb1 && !!pbToCb3 && Math.abs(pbToCb1.y2 - pbToCb3.y2) < 0.01,
        'ParentBの子への水平線も同じ高さに揃う');

    // 横表示に戻すと従来どおりベジェ曲線（C）で描かれる（無変更の確認）→ 確認後に縦へ戻す
    await page.click('#verticalModeToggle');
    await page.waitForTimeout(400);
    const hCurveOk = await page.evaluate(() => {
        var paths = document.querySelectorAll('#linesSvg .connection-line');
        if (paths.length === 0) return false;
        for (var i = 0; i < paths.length; i++) {
            if (!/^M [\d.-]+ [\d.-]+ C /.test(paths[i].getAttribute('d'))) return false;
        }
        return true;
    });
    assert(hCurveOk, '横表示の接続線は従来どおり曲線（C）のまま');
    await page.click('#verticalModeToggle');
    await page.waitForTimeout(400);

    // ========================================
    // Test 4: 折りたたみ●がノード下側に出て、クリックで展開できる
    // ========================================
    console.log('\n=== Test 4: 折りたたみインジケーター ===');
    // 接合部のクリック判定エリアで折りたたむ
    await page.click('[data-id="pa"] .node-junction-hitarea');
    await page.waitForTimeout(400);

    const indicator = await page.$('[data-id="pa"] .node-collapse-indicator');
    assert(!!indicator, '折りたたみ後に●インジケーターが表示される');

    const indPos = await page.evaluate(() => {
        var node = document.querySelector('[data-id="pa"]').getBoundingClientRect();
        var ind = document.querySelector('[data-id="pa"] .node-collapse-indicator').getBoundingClientRect();
        return {
            below: ind.top >= node.bottom - 1,
            centered: Math.abs((ind.left + ind.width / 2) - (node.left + node.width / 2)) < 2,
            size: Math.round(ind.width)
        };
    });
    assert(indPos.below, '●がノードの下側にある');
    assert(indPos.centered, '●がノードの水平中央にある');
    assert(indPos.size === 8, '●の直径が8px: ' + indPos.size);

    const ca1Hidden = await page.evaluate(() => !document.querySelector('[data-id="ca1"]'));
    assert(ca1Hidden, '折りたたみで子孫が非表示になる');

    await page.click('[data-id="pa"] .node-collapse-indicator');
    await page.waitForTimeout(400);
    const ca1Visible = await page.evaluate(() => !!document.querySelector('[data-id="ca1"]'));
    assert(ca1Visible, '●クリックで展開できる');

    // ========================================
    // Test 5: 保存（isVertical がマップデータに入る・リロード後も維持）
    // ========================================
    console.log('\n=== Test 5: マップごとの保存 ===');
    const savedFlag = await page.evaluate(() => {
        var mapId = window.getCurrentMapId();
        var raw = localStorage.getItem('mindmap-data-' + mapId);
        return JSON.parse(raw).isVertical;
    });
    assert(savedFlag === true, 'isVertical: true がマップデータ本体に保存される');

    await page.reload();
    await page.waitForSelector('.node', { state: 'attached', timeout: 10000 });
    await page.waitForTimeout(800);
    const checkedAfterReload = await page.$eval('#verticalModeToggle', el => el.getAttribute('aria-checked'));
    assert(checkedAfterReload === 'true', 'リロード後も縦書きモードが維持される');

    const stillVertical = await page.evaluate(() => {
        var r = document.querySelector('[data-id="root"]').getBoundingClientRect();
        var p = document.querySelector('[data-id="pa"]').getBoundingClientRect();
        return p.top >= r.bottom;
    });
    assert(stillVertical, 'リロード後も縦レイアウトで描画される');

    // ========================================
    // Test 6: コピー出力が縦・横で同一
    // ========================================
    console.log('\n=== Test 6: コピー出力の同一性 ===');
    // コピーボタンは右サイドバー内にあるので先に開く
    const rightSidebarClosed = await page.evaluate(() => {
        var btn = document.getElementById('copyBtn');
        return !btn || btn.getBoundingClientRect().width === 0 || btn.getBoundingClientRect().right > window.innerWidth || btn.getBoundingClientRect().left < 0;
    });
    if (rightSidebarClosed) {
        await page.click('#sidebarFloatToggle');
        await page.waitForTimeout(400);
    }
    // navigator.clipboard.writeText を横取りしてコピー文字列を記録する
    await page.evaluate(() => {
        window._copiedTexts = [];
        navigator.clipboard.writeText = function(t) {
            window._copiedTexts.push(t);
            return Promise.resolve();
        };
    });
    await page.click('#copyBtn');
    await page.waitForTimeout(300);
    // 横に切り替えて再度コピー
    await page.click('#verticalModeToggle');
    await page.waitForTimeout(400);
    await page.click('#copyBtn');
    await page.waitForTimeout(300);
    const copyResult = await page.evaluate(() => window._copiedTexts);
    assert(copyResult.length === 2 && copyResult[0].length > 0, 'コピーが両モードで実行できる');
    assert(copyResult[0] === copyResult[1], 'コピー出力が縦・横で完全に同一');

    // 横に戻した時点でフラグが消え、既存データ形状に戻る
    const flagRemoved = await page.evaluate(() => {
        var mapId = window.getCurrentMapId();
        var raw = localStorage.getItem('mindmap-data-' + mapId);
        return !('isVertical' in JSON.parse(raw));
    });
    assert(flagRemoved, 'OFFに戻すと isVertical フラグがデータから消える（既存形状を維持）');

    // ========================================
    // Test 7: Undo/Redo の対象外
    // ========================================
    console.log('\n=== Test 7: 表示モード切替はUndo履歴に入らない ===');
    // 現在横モード。ノードを追加（履歴に入る操作）→ 縦に切替 → Undo
    await page.click('[data-id="pc"]');
    await page.waitForTimeout(200);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    await page.keyboard.press('Tab'); // 子ノード追加
    await page.waitForTimeout(300);
    await page.keyboard.type('UndoTarget');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    const childCountBefore = await page.evaluate(() => {
        var d = window.getMindMapData();
        var pc = d.root.children.find(c => c.id === 'pc');
        return pc.children.length;
    });
    assert(childCountBefore === 1, 'ノード追加ができている（前提確認）');

    await page.click('#verticalModeToggle'); // 縦へ
    await page.waitForTimeout(400);
    // ノード追加＋テキスト編集確定で履歴が2段積まれるため2回Undoする
    await page.keyboard.press(CMD + '+z');
    await page.waitForTimeout(300);
    await page.keyboard.press(CMD + '+z');
    await page.waitForTimeout(400);

    const afterUndo = await page.evaluate(() => {
        var d = window.getMindMapData();
        var pc = d.root.children.find(c => c.id === 'pc');
        return {
            childCount: pc ? pc.children.length : -1,
            isVertical: d.isVertical === true,
            checked: document.getElementById('verticalModeToggle').getAttribute('aria-checked') === 'true'
        };
    });
    assert(afterUndo.childCount === 0, 'Undoでノード追加だけが取り消される');
    assert(afterUndo.isVertical === true, 'Undo後も縦表示モードは維持される（履歴の対象外）');
    assert(afterUndo.checked === true, 'Undo後もチェックボックスはONのまま');

    // ========================================
    // Test 8: 高速モードとの独立性
    // ========================================
    console.log('\n=== Test 8: 高速モードとの併用 ===');
    await page.click('#fastModeToggle');
    await page.waitForTimeout(200);
    const bothOn = await page.evaluate(() => ({
        fast: localStorage.getItem('mindmap.fastMode') === 'true',
        vertical: window.getMindMapData().isVertical === true,
        cbChecked: document.getElementById('verticalModeToggle').getAttribute('aria-checked') === 'true'
    }));
    assert(bothOn.fast && bothOn.vertical && bothOn.cbChecked, '高速モードONにしても縦表示は維持される（併用可能）');

    await page.click('#verticalModeToggle'); // 縦OFF
    await page.waitForTimeout(300);
    const fastStillOn = await page.evaluate(() => localStorage.getItem('mindmap.fastMode') === 'true');
    assert(fastStillOn, '縦表示OFFにしても高速モードは維持される');
    await page.click('#fastModeToggle'); // 後始末
    await page.waitForTimeout(200);

    // ========================================
    // Test 9: マップごとに独立して保持される
    // ========================================
    console.log('\n=== Test 9: マップ単位の設定 ===');
    // 現在のマップ（A）を縦に
    await page.click('#verticalModeToggle');
    await page.waitForTimeout(400);
    const mapAId = await page.evaluate(() => window.getCurrentMapId());

    // 左サイドバーを開いて（閉じていれば）新規マップ（B）を作成
    const lsCollapsed = await page.$eval('#leftSidebar', el => el.classList.contains('collapsed'));
    if (lsCollapsed) {
        await page.click('#leftSidebarToggle');
        await page.waitForTimeout(300);
    }
    await page.click('#newMapBtn');
    await page.waitForTimeout(600);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    const mapBState = await page.evaluate(() => ({
        id: window.getCurrentMapId(),
        checked: document.getElementById('verticalModeToggle').getAttribute('aria-checked') === 'true'
    }));
    assert(mapBState.id !== mapAId, '新規マップBに切り替わっている（前提確認）');
    assert(mapBState.checked === false, '新規マップBは横レイアウト（チェックOFF）');

    // マップAに戻ると縦のまま
    await page.evaluate((id) => {
        var items = document.querySelectorAll('.map-item.page-item');
        for (var i = 0; i < items.length; i++) {
            if (String(items[i].dataset.mapId) === String(id)) { items[i].click(); return; }
        }
    }, mapAId);
    await page.waitForTimeout(600);
    const mapAState = await page.evaluate(() => ({
        id: window.getCurrentMapId(),
        checked: document.getElementById('verticalModeToggle').getAttribute('aria-checked') === 'true',
        isVertical: window.getMindMapData().isVertical === true
    }));
    assert(String(mapAState.id) === String(mapAId), 'マップAに戻れている（前提確認）');
    assert(mapAState.checked === true && mapAState.isVertical, 'マップAは縦表示のまま維持されている');

    // ========================================
    // Test 10: 矢印キーが見た目の方向と一致する（縦表示時のみ読み替え）
    // ========================================
    console.log('\n=== Test 10: 矢印キーの方向読み替え ===');
    // 現在マップA（縦表示ON）。cb2 を選択して各方向を検証
    function selectedId() {
        return page.evaluate(() => {
            var el = document.querySelector('.node.selected');
            return el ? el.dataset.id : null;
        });
    }
    async function selectNodeById(id) {
        await page.click('[data-id="' + id + '"]');
        await page.waitForTimeout(150);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(150);
    }

    await selectNodeById('cb2');
    await page.keyboard.press('ArrowUp'); // 縦表示: ↑ = 親へ
    await page.waitForTimeout(150);
    assert((await selectedId()) === 'pb', '縦: ↑で親（pb）へ移動する');

    await page.keyboard.press('ArrowDown'); // 縦表示: ↓ = 最初の子へ
    await page.waitForTimeout(150);
    assert((await selectedId()) === 'cb1', '縦: ↓で最初の子（cb1）へ移動する');

    await page.keyboard.press('ArrowRight'); // 縦表示: → = 右隣（次の兄弟）へ
    await page.waitForTimeout(150);
    assert((await selectedId()) === 'cb2', '縦: →で右隣の兄弟（cb2）へ移動する');

    await page.keyboard.press('ArrowLeft'); // 縦表示: ← = 左隣（前の兄弟）へ
    await page.waitForTimeout(150);
    assert((await selectedId()) === 'cb1', '縦: ←で左隣の兄弟（cb1）へ移動する');

    // 見た目との一致確認：→で移動した先が実際に画面上で右にあること
    const visualCheck = await page.evaluate(() => {
        var a = document.querySelector('[data-id="cb1"]').getBoundingClientRect();
        var b = document.querySelector('[data-id="cb2"]').getBoundingClientRect();
        var p = document.querySelector('[data-id="pb"]').getBoundingClientRect();
        return { siblingIsRight: b.left > a.left, parentIsAbove: p.bottom <= a.top };
    });
    assert(visualCheck.siblingIsRight && visualCheck.parentIsAbove, '縦: 読み替え先が画面上の方向と一致している');

    // Shift+矢印の範囲選択も見た目の方向（左右）で動く
    await selectNodeById('cb1');
    await page.keyboard.press('Shift+ArrowRight');
    await page.waitForTimeout(150);
    const rangeSel = await page.evaluate(() => Array.from(window.getSelectedNodeIds()).sort());
    assert(rangeSel.join(',') === 'cb1,cb2', '縦: Shift+→で右隣へ範囲選択が伸びる');

    // Option+矢印の場所移動も見た目の方向で動く（Alt+→ = 右隣と入れ替え）
    await selectNodeById('cb1');
    await page.keyboard.press('Alt+ArrowRight');
    await page.waitForTimeout(300);
    const orderAfterMove = await page.evaluate(() => {
        var d = window.getMindMapData();
        var pb = d.root.children.find(c => c.id === 'pb');
        return pb.children.map(c => c.id).join(',');
    });
    assert(orderAfterMove === 'cb2,cb1,cb3', '縦: Option+→でノードが右隣と入れ替わる');
    await page.keyboard.press('Alt+ArrowLeft'); // 元に戻す
    await page.waitForTimeout(300);

    // 横表示に戻すと従来の意味（↑↓=兄弟、←→=親子）のまま
    await page.click('#verticalModeToggle');
    await page.waitForTimeout(400);
    await selectNodeById('cb2');
    await page.keyboard.press('ArrowUp'); // 横表示: ↑ = 前の兄弟
    await page.waitForTimeout(150);
    assert((await selectedId()) === 'cb1', '横: ↑は従来どおり前の兄弟（cb1）へ移動する');
    await page.keyboard.press('ArrowLeft'); // 横表示: ← = 親
    await page.waitForTimeout(150);
    assert((await selectedId()) === 'pb', '横: ←は従来どおり親（pb）へ移動する');
    // マップAを縦に戻す（後始末）
    await page.click('#verticalModeToggle');
    await page.waitForTimeout(400);

    // ========================================
    // Test 11: テキスト揃え（縦表示=全ノード中央揃え／横表示=全ノード左揃え）
    // ========================================
    console.log('\n=== Test 11: テキスト揃えのモード切替 ===');
    // 現在は縦表示ON
    function getAligns() {
        return page.evaluate(() => ({
            root: getComputedStyle(document.querySelector('.node.root .node-text')).textAlign,
            child: getComputedStyle(document.querySelector('[data-id="pa"] .node-text')).textAlign
        }));
    }
    const alignV = await getAligns();
    assert(alignV.root === 'center' && alignV.child === 'center', '縦表示: 全ノードのテキストが中央揃え: ' + JSON.stringify(alignV));

    await page.click('#verticalModeToggle'); // 横へ
    await page.waitForTimeout(400);
    const alignH = await getAligns();
    const isLeft = v => v === 'start' || v === 'left';
    assert(isLeft(alignH.root) && isLeft(alignH.child), '横表示: 全ノードのテキストが左揃え: ' + JSON.stringify(alignH));

    // ========================================
    // Test 12: 縦書きモードのキー操作（Enter=子ノード追加／Tab=兄弟ノード追加）
    // ========================================
    console.log('\n=== Test 12: 縦書きモードの Enter/Tab ===');
    // 現在は横表示。まず横の従来挙動を確認してから縦書きモードで検証する
    async function nodeInfo(id) {
        return page.evaluate((nid) => {
            var found = null;
            (function walk(n, parent) {
                if (n.id === nid) found = { parentId: parent ? parent.id : null, childCount: n.children.length };
                n.children.forEach(function(c) { walk(c, n); });
            })(window.getMindMapData().root, null);
            return found;
        }, id);
    }
    // 追加操作で入る編集モードを確定し、新ノードのID/親を返す
    async function pressAndGetNewNode(key) {
        const before = await page.evaluate(() => {
            var ids = [];
            (function walk(n) { ids.push(n.id); n.children.forEach(walk); })(window.getMindMapData().root);
            return ids;
        });
        await page.keyboard.press(key);
        await page.waitForTimeout(300);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
        return page.evaluate((beforeIds) => {
            var added = null;
            (function walk(n, parent) {
                if (beforeIds.indexOf(n.id) === -1) added = { id: n.id, parentId: parent ? parent.id : null };
                n.children.forEach(function(c) { walk(c, n); });
            })(window.getMindMapData().root, null);
            return added;
        }, before);
    }

    // 横表示（従来仕様の回帰確認）: Enter=兄弟、Tab=子
    await selectNodeById('pc');
    const hEnter = await pressAndGetNewNode('Enter');
    assert(hEnter && hEnter.parentId === 'root', '横: Enterで兄弟ノードが追加される（親=root）: ' + JSON.stringify(hEnter));
    await selectNodeById('pc');
    const hTab = await pressAndGetNewNode('Tab');
    assert(hTab && hTab.parentId === 'pc', '横: Tabで子ノードが追加される（親=pc）: ' + JSON.stringify(hTab));

    // 縦書きモードON: Enter=子、Tab=兄弟
    await page.click('#verticalModeToggle');
    await page.waitForTimeout(400);
    await selectNodeById('pc');
    const vEnter = await pressAndGetNewNode('Enter');
    assert(vEnter && vEnter.parentId === 'pc', '縦書き: Enterで子ノードが追加される（下に降りる）: ' + JSON.stringify(vEnter));
    await selectNodeById('pc');
    const vTab = await pressAndGetNewNode('Tab');
    assert(vTab && vTab.parentId === 'root', '縦書き: Tabで兄弟ノードが追加される（横に増える）: ' + JSON.stringify(vTab));

    // 編集モード中のTabも縦書きでは兄弟追加（編集確定→兄弟）
    await selectNodeById('pc');
    await page.keyboard.press('F2');
    await page.waitForTimeout(300);
    const vEditTab = await pressAndGetNewNode('Tab');
    assert(vEditTab && vEditTab.parentId === 'root', '縦書き: 編集中のTabでも兄弟ノードが追加される: ' + JSON.stringify(vEditTab));

    // Shift+Tab は従来どおり親へ移動（ノードは増えない）
    await selectNodeById('cb2');
    const beforeShiftTab = await nodeInfo('pb');
    await page.keyboard.press('Shift+Tab');
    await page.waitForTimeout(300);
    const afterShiftTab = await nodeInfo('pb');
    assert((await selectedId()) === 'pb' && beforeShiftTab.childCount === afterShiftTab.childCount,
        '縦書き: Shift+Tabは従来どおり親へ移動（ノード追加なし）');

    // 横に戻すと従来仕様（Enter=兄弟）に戻る
    await page.click('#verticalModeToggle');
    await page.waitForTimeout(400);
    await selectNodeById('pc');
    const hEnter2 = await pressAndGetNewNode('Enter');
    assert(hEnter2 && hEnter2.parentId === 'root', '横に戻すとEnterは兄弟追加に戻る: ' + JSON.stringify(hEnter2));

    // ========================================
    // 結果
    // ========================================
    console.log('\n========================================');
    console.log('vertical-layout: ' + passed + ' passed, ' + failed + ' failed');
    console.log('========================================');
    await browser.close();
    process.exit(failed > 0 ? 1 : 0);
})();
