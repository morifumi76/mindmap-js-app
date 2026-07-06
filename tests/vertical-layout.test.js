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
    console.log('\n=== Test 1: 縦表示チェックボックスUI ===');
    const cb = await page.$('#verticalModeCheckbox');
    assert(!!cb, '縦表示チェックボックスが存在する');

    const labelText = await page.$eval('.vertical-mode-label', el => el.textContent.trim());
    assert(labelText === '縦表示', 'ラベルが「縦表示」: ' + labelText);

    const labelStyle = await page.$eval('.vertical-mode-label', el => {
        var s = getComputedStyle(el);
        return { fontSize: s.fontSize, color: s.color };
    });
    assert(labelStyle.fontSize === '13px', 'ラベルが13px: ' + labelStyle.fontSize);
    assert(labelStyle.color === 'rgb(55, 53, 47)', 'ラベル色が#37352f: ' + labelStyle.color);

    // 高速モードの左隣（同じ親の直前の兄弟要素）に配置されている
    const isLeftOfFastMode = await page.evaluate(() => {
        var fm = document.getElementById('fastModeControl');
        return !!(fm && fm.previousElementSibling && fm.previousElementSibling.id === 'verticalModeControl');
    });
    assert(isLeftOfFastMode, '高速モードボタンの左隣に配置されている');

    // 高速モードと同じ「テキスト→ボタン」の並び：チェックボックスはラベルの右側
    const cbRightOfLabel = await page.evaluate(() => {
        var label = document.querySelector('.vertical-mode-label').getBoundingClientRect();
        var box = document.getElementById('verticalModeCheckbox').getBoundingClientRect();
        return box.left >= label.right;
    });
    assert(cbRightOfLabel, 'チェックボックスがラベル「縦表示」の右側にある');

    const checkedDefault = await page.$eval('#verticalModeCheckbox', el => el.checked);
    assert(checkedDefault === false, 'デフォルトはOFF（横レイアウト）');

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
    await page.click('#verticalModeCheckbox');
    await page.waitForTimeout(400);

    const vGeom = await page.evaluate(() => {
        function rect(id) { return document.querySelector('[data-id="' + id + '"]').getBoundingClientRect(); }
        var root = rect('root'), pa = rect('pa'), pb = rect('pb'), pc = rect('pc');
        var ca1 = rect('ca1'), ca2 = rect('ca2');
        var cb1 = rect('cb1'), cb3 = rect('cb3');
        return {
            rootBottom: root.bottom, rootCx: root.left + root.width / 2,
            paTop: pa.top, pbTop: pb.top, pcTop: pc.top,
            paRight: pa.right, pbLeft: pb.left, pbRight: pb.right, pcLeft: pc.left,
            paCx: pa.left + pa.width / 2, pcCx: pc.left + pc.width / 2,
            ca1Top: ca1.top, paBottom: pa.bottom,
            pbCx: pb.left + pb.width / 2,
            pbChildrenCenterX: (cb1.left + cb3.right) / 2,
            ca1Right: ca1.right, ca2Left: ca2.left
        };
    });
    assert(vGeom.paTop >= vGeom.rootBottom, '縦モード: 子（ParentA）はルートの下にある');
    assert(vGeom.pbTop >= vGeom.rootBottom && vGeom.pcTop >= vGeom.rootBottom, '縦モード: 全ての子がルートの下にある');
    assert(vGeom.paRight <= vGeom.pbLeft && vGeom.pbRight <= vGeom.pcLeft, '縦モード: 兄弟が左右に並び重ならない');
    assert(vGeom.ca1Top >= vGeom.paBottom, '縦モード: 孫はさらに1段下にある');
    // 親は「子ノード群（部分木）」の水平中央の真上に置かれる。子が全員葉のParentBで厳密に検証する
    assert(Math.abs(vGeom.pbCx - vGeom.pbChildrenCenterX) < 2, '縦モード: 親は子ノード群の水平中央の真上にある');
    assert(vGeom.paCx < vGeom.pbCx && vGeom.pbCx < vGeom.pcCx, '縦モード: ルートは子の部分木の並びの中央上にある（並び順が左→右）');
    assert(vGeom.ca1Right <= vGeom.ca2Left, '縦モード: 長文ノードの兄弟も重ならない（幅の再帰計算）');

    // いとこ間（ca2 と cb1）の重なりも確認
    const cousinOverlap = await page.evaluate(() => {
        var a = document.querySelector('[data-id="ca2"]').getBoundingClientRect();
        var b = document.querySelector('[data-id="cb1"]').getBoundingClientRect();
        return a.right > b.left && b.right > a.left && a.bottom > b.top && b.bottom > a.top;
    });
    assert(!cousinOverlap, '縦モード: いとこ同士のノードが重ならない');

    // ========================================
    // Test 3: 接続線（親の下辺中央→子の上辺中央）
    // ========================================
    console.log('\n=== Test 3: 接続線の始点・終点 ===');
    const lineOk = await page.evaluate(() => {
        var off = 5000;
        var root = document.querySelector('[data-id="root"]');
        var pa = document.querySelector('[data-id="pa"]');
        // ノードのstyle座標（キャンバス座標系）から辺の中央を計算
        function canvasPos(el) {
            var x = parseFloat(el.style.left), y = parseFloat(el.style.top);
            var w = el.offsetWidth, h = el.offsetHeight;
            // top は上下中央基準（translateY(-50%)）
            return { bottomCx: x + w / 2, bottomY: y + h / 2, topCx: x + w / 2, topY: y - h / 2 };
        }
        var rp = canvasPos(root), pp = canvasPos(pa);
        var paths = document.querySelectorAll('#linesSvg .connection-line');
        // ルート→ParentA の線（始点がルート下辺中央、終点がParentA上辺中央）を探す
        for (var i = 0; i < paths.length; i++) {
            var d = paths[i].getAttribute('d');
            var m = d.match(/M ([\d.-]+) ([\d.-]+) C .*, ([\d.-]+) ([\d.-]+)$/);
            if (!m) continue;
            var sx = parseFloat(m[1]) - off, sy = parseFloat(m[2]) - off;
            var ex = parseFloat(m[3]) - off, ey = parseFloat(m[4]) - off;
            if (Math.abs(sx - rp.bottomCx) < 1 && Math.abs(sy - rp.bottomY) < 1 &&
                Math.abs(ex - pp.topCx) < 1 && Math.abs(ey - pp.topY) < 1) {
                return true;
            }
        }
        return false;
    });
    assert(lineOk, '接続線が親の下辺中央→子の上辺中央に描画される');

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
    const checkedAfterReload = await page.$eval('#verticalModeCheckbox', el => el.checked);
    assert(checkedAfterReload === true, 'リロード後も縦表示が維持される');

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
    await page.click('#verticalModeCheckbox');
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

    await page.click('#verticalModeCheckbox'); // 縦へ
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
            checked: document.getElementById('verticalModeCheckbox').checked
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
        cbChecked: document.getElementById('verticalModeCheckbox').checked
    }));
    assert(bothOn.fast && bothOn.vertical && bothOn.cbChecked, '高速モードONにしても縦表示は維持される（併用可能）');

    await page.click('#verticalModeCheckbox'); // 縦OFF
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
    await page.click('#verticalModeCheckbox');
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
        checked: document.getElementById('verticalModeCheckbox').checked
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
        checked: document.getElementById('verticalModeCheckbox').checked,
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
    await page.click('#verticalModeCheckbox');
    await page.waitForTimeout(400);
    await selectNodeById('cb2');
    await page.keyboard.press('ArrowUp'); // 横表示: ↑ = 前の兄弟
    await page.waitForTimeout(150);
    assert((await selectedId()) === 'cb1', '横: ↑は従来どおり前の兄弟（cb1）へ移動する');
    await page.keyboard.press('ArrowLeft'); // 横表示: ← = 親
    await page.waitForTimeout(150);
    assert((await selectedId()) === 'pb', '横: ←は従来どおり親（pb）へ移動する');
    // マップAを縦に戻す（後始末）
    await page.click('#verticalModeCheckbox');
    await page.waitForTimeout(400);

    // ========================================
    // Test 11: ルートノード（0階層）のみテキスト中央揃え
    // ========================================
    console.log('\n=== Test 11: ルートノードの中央揃え ===');
    const align = await page.evaluate(() => ({
        root: getComputedStyle(document.querySelector('.node.root .node-text')).textAlign,
        child: getComputedStyle(document.querySelector('[data-id="pa"] .node-text')).textAlign
    }));
    assert(align.root === 'center', 'ルートのテキストが中央揃え: ' + align.root);
    assert(align.child === 'start' || align.child === 'left', '子孫ノードは従来どおり左揃え: ' + align.child);

    // ========================================
    // 結果
    // ========================================
    console.log('\n========================================');
    console.log('vertical-layout: ' + passed + ' passed, ' + failed + ' failed');
    console.log('========================================');
    await browser.close();
    process.exit(failed > 0 ? 1 : 0);
})();
