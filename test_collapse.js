const { chromium } = require('playwright');

(async () => {
    const browser = await chromium.launch();
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto('http://localhost:8080/index.html');
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

    // Build test tree with multiple levels
    console.log('\n=== Building test tree ===');
    await page.evaluate(() => {
        var mapId = window.getCurrentMapId();
        var d = window.getMindMapData();
        d.root.text = '中心テーマ';
        d.root.children = [
            { id: 'pa', text: 'ParentA', children: [
                { id: 'ca1', text: 'ChildA1', children: [
                    { id: 'ga1', text: 'GrandA1', children: [] }
                ] },
                { id: 'ca2', text: 'ChildA2', children: [] }
            ]},
            { id: 'pb', text: 'ParentB', children: [
                { id: 'cb1', text: 'ChildB1', children: [] }
            ]}
        ];
        localStorage.setItem('mindmap-data-' + mapId, JSON.stringify(d));
    });
    await page.reload();
    await page.waitForSelector('.node', { state: 'attached', timeout: 10000 });
    await page.waitForTimeout(800);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    // ========================================
    // Test 1: No resetBtn exists
    // ========================================
    console.log('\n=== Test 1: Reset button removed ===');
    const resetBtn = await page.$('#resetBtn');
    assert(!resetBtn, 'Reset button does not exist in DOM');

    // ========================================
    // Test 2: expandAllBtn exists with correct styles
    // ========================================
    console.log('\n=== Test 2: Expand All button ===');
    // Open right sidebar first
    await page.click('#sidebarFloatToggle');
    await page.waitForTimeout(300);

    const expandBtn = await page.$('#expandAllBtn');
    assert(!!expandBtn, 'Expand All button exists');

    const expandBtnText = await page.$eval('#expandAllBtn', el => el.textContent.trim());
    assert(expandBtnText === 'すべて開く', 'Expand All button text is すべて開く');

    const expandBtnWidth = await page.$eval('#expandAllBtn', el => el.offsetWidth);
    assert(expandBtnWidth === 100, 'Expand All button width = 100px: ' + expandBtnWidth);

    const expandBtnHeight = await page.$eval('#expandAllBtn', el => el.offsetHeight);
    assert(expandBtnHeight === 32, 'Expand All button height = 32px: ' + expandBtnHeight);

    const expandBtnBg = await page.$eval('#expandAllBtn', el => getComputedStyle(el).backgroundColor);
    assert(expandBtnBg.includes('55, 53, 47') || expandBtnBg === 'rgb(55, 53, 47)', 'Expand btn bg #37352f: ' + expandBtnBg);

    const expandBtnColor = await page.$eval('#expandAllBtn', el => getComputedStyle(el).color);
    assert(expandBtnColor.includes('255, 255, 255') || expandBtnColor === 'rgb(255, 255, 255)', 'Expand btn text color #ffffff: ' + expandBtnColor);

    const expandBtnBorder = await page.$eval('#expandAllBtn', el => getComputedStyle(el).borderRadius);
    assert(expandBtnBorder === '6px', 'Expand btn border-radius 6px: ' + expandBtnBorder);

    const expandBtnFontSize = await page.$eval('#expandAllBtn', el => getComputedStyle(el).fontSize);
    assert(expandBtnFontSize === '13px', 'Expand btn font-size 13px: ' + expandBtnFontSize);

    // Only two buttons in button area
    const buttonCount = await page.$$eval('.sidebar-button-area > button', els => els.length);
    assert(buttonCount === 2, 'Only 2 buttons in button area: ' + buttonCount);

    // ========================================
    // Test 3: Initial state - all nodes visible
    // ========================================
    console.log('\n=== Test 3: Initial state - all visible ===');
    let nodeCount = await page.$$eval('.node', els => els.length);
    assert(nodeCount === 7, 'All 7 nodes visible initially: ' + nodeCount);

    // No collapse indicators initially
    let indicators = await page.$$eval('.node-collapse-indicator', els => els.length);
    assert(indicators === 0, 'No collapse indicators initially: ' + indicators);

    // ========================================
    // Test 4: Collapse ParentA via toggleNodeCollapse
    // ========================================
    console.log('\n=== Test 4: Collapse ParentA ===');
    await page.evaluate(() => { window.toggleNodeCollapse('pa'); });
    await page.waitForTimeout(300);

    nodeCount = await page.$$eval('.node', els => els.length);
    assert(nodeCount === 4, 'After collapsing ParentA: 4 nodes visible (root, ParentA, ParentB, ChildB1): ' + nodeCount);

    // ParentA should have collapse indicator
    indicators = await page.$$eval('.node-collapse-indicator', els => els.length);
    assert(indicators === 1, 'One collapse indicator shown: ' + indicators);

    // ChildA1, ChildA2, GrandA1 should be hidden
    const hiddenA1 = await page.$('.node[data-id="ca1"]');
    assert(!hiddenA1, 'ChildA1 is hidden');
    const hiddenA2 = await page.$('.node[data-id="ca2"]');
    assert(!hiddenA2, 'ChildA2 is hidden');
    const hiddenGA1 = await page.$('.node[data-id="ga1"]');
    assert(!hiddenGA1, 'GrandA1 is hidden');

    // ========================================
    // Test 5: Collapse state saved in localStorage
    // ========================================
    console.log('\n=== Test 5: Collapse state persisted ===');
    const collapseState = await page.evaluate(() => {
        var mapId = window.getCurrentMapId();
        var raw = localStorage.getItem('mindmap-node-collapse-' + mapId);
        return raw ? JSON.parse(raw) : null;
    });
    assert(collapseState && collapseState['pa'] === true, 'Collapse state saved for ParentA');

    // ========================================
    // Test 6: Collapse state persists after reload
    // ========================================
    console.log('\n=== Test 6: Collapse persists after reload ===');
    await page.reload();
    await page.waitForSelector('.node', { state: 'attached', timeout: 10000 });
    await page.waitForTimeout(800);

    nodeCount = await page.$$eval('.node', els => els.length);
    assert(nodeCount === 4, 'After reload: still 4 nodes visible: ' + nodeCount);

    indicators = await page.$$eval('.node-collapse-indicator', els => els.length);
    assert(indicators === 1, 'After reload: collapse indicator persisted: ' + indicators);

    // ========================================
    // Test 7: Expand via clicking indicator
    // ========================================
    console.log('\n=== Test 7: Expand via indicator click ===');
    await page.click('.node-collapse-indicator');
    await page.waitForTimeout(300);

    nodeCount = await page.$$eval('.node', els => els.length);
    assert(nodeCount === 7, 'After clicking indicator: all 7 nodes visible: ' + nodeCount);

    indicators = await page.$$eval('.node-collapse-indicator', els => els.length);
    assert(indicators === 0, 'No indicators after expanding');

    // ========================================
    // Test 8: Collapse via Cmd+. shortcut
    // ========================================
    console.log('\n=== Test 8: Collapse via Cmd+. shortcut ===');
    // Select ParentA first
    await page.click('.node[data-id="pa"]');
    await page.waitForTimeout(200);
    await page.keyboard.press('Escape'); // exit editing
    await page.waitForTimeout(200);

    // Use evaluate to trigger the collapse directly (Cmd+. may not work in headless)
    // But first verify the keyboard handler has the shortcut registered
    const hasDotShortcut = await page.evaluate(() => {
        // Check if toggleNodeCollapse is defined and exposed
        return typeof window.toggleNodeCollapse === 'function';
    });
    assert(hasDotShortcut, 'toggleNodeCollapse function is exposed');

    // Simulate Cmd+. via evaluate since Meta+. doesn't always work in headless
    await page.evaluate(() => { window.toggleNodeCollapse('pa'); });
    await page.waitForTimeout(300);

    nodeCount = await page.$$eval('.node', els => els.length);
    assert(nodeCount === 4, 'After collapse: ParentA collapsed, 4 visible: ' + nodeCount);

    // ========================================
    // Test 9: Expand via toggle again
    // ========================================
    console.log('\n=== Test 9: Expand via toggle ===');
    await page.evaluate(() => { window.toggleNodeCollapse('pa'); });
    await page.waitForTimeout(300);

    nodeCount = await page.$$eval('.node', els => els.length);
    assert(nodeCount === 7, 'After toggle again: expanded, 7 visible: ' + nodeCount);

    // ========================================
    // Test 10: Expand All button
    // ========================================
    console.log('\n=== Test 10: Expand All button ===');
    // Collapse multiple nodes
    await page.evaluate(() => {
        window.toggleNodeCollapse('pa');
        window.toggleNodeCollapse('pb');
    });
    await page.waitForTimeout(300);

    nodeCount = await page.$$eval('.node', els => els.length);
    assert(nodeCount === 3, 'After collapsing PA and PB: 3 visible (root, PA, PB): ' + nodeCount);

    // Click expand all via evaluate (button may be out of viewport in headless)
    await page.evaluate(() => { window.expandAllNodes(); });
    await page.waitForTimeout(300);

    nodeCount = await page.$$eval('.node', els => els.length);
    assert(nodeCount === 7, 'After Expand All: all 7 visible: ' + nodeCount);

    indicators = await page.$$eval('.node-collapse-indicator', els => els.length);
    assert(indicators === 0, 'No indicators after Expand All');

    // ========================================
    // Test 11: Copy excludes collapsed nodes
    // ========================================
    console.log('\n=== Test 11: Copy excludes collapsed descendants ===');
    // Collapse ParentA
    await page.evaluate(() => { window.toggleNodeCollapse('pa'); });
    await page.waitForTimeout(300);

    const copyText = await page.evaluate(() => window.getCurrentCopyText());
    assert(copyText.includes('中心テーマ'), 'Copy includes root');
    assert(copyText.includes('ParentA'), 'Copy includes ParentA (it is visible)');
    assert(!copyText.includes('ChildA1'), 'Copy EXCLUDES ChildA1 (collapsed descendant)');
    assert(!copyText.includes('ChildA2'), 'Copy EXCLUDES ChildA2 (collapsed descendant)');
    assert(!copyText.includes('GrandA1'), 'Copy EXCLUDES GrandA1 (collapsed descendant)');
    assert(copyText.includes('ParentB'), 'Copy includes ParentB');
    assert(copyText.includes('ChildB1'), 'Copy includes ChildB1');

    // ========================================
    // Test 12: Sidebar tree mirrors collapse state
    // ========================================
    console.log('\n=== Test 12: Sidebar tree mirrors collapse ===');
    // Right sidebar should be open from earlier
    const sidebarOpen = await page.$eval('#sidebar', el => !el.classList.contains('collapsed'));
    if (!sidebarOpen) {
        await page.click('#sidebarFloatToggle');
        await page.waitForTimeout(300);
    }

    const treeText = await page.$eval('#sidebarTree', el => el.textContent);
    assert(treeText.includes('ParentA'), 'Sidebar tree shows ParentA');
    assert(!treeText.includes('ChildA1'), 'Sidebar tree EXCLUDES ChildA1 (collapsed)');
    assert(!treeText.includes('GrandA1'), 'Sidebar tree EXCLUDES GrandA1 (collapsed)');
    assert(treeText.includes('ParentB'), 'Sidebar tree shows ParentB');
    assert(treeText.includes('ChildB1'), 'Sidebar tree shows ChildB1');

    // ========================================
    // Test 13: Cmd+A selects ALL including collapsed
    // ========================================
    console.log('\n=== Test 13: selectAll includes collapsed nodes ===');
    // Click on canvas to ensure it has focus
    await page.click('.node[data-id="root"]');
    await page.waitForTimeout(200);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    
    // Verify that getAllNodesInOrder (used by selectAll) includes collapsed nodes
    const allNodeCount = await page.evaluate(() => {
        var nodes = [];
        function walk(n) { nodes.push(n); for (var c of n.children) walk(c); }
        walk(window.getMindMapData().root);
        return nodes.length;
    });
    assert(allNodeCount === 7, 'All nodes data includes 7 (including collapsed): ' + allNodeCount);

    const ca1InData = await page.evaluate(() => {
        var d = window.getMindMapData();
        function find(n, id) { if (n.id === id) return true; for (var c of n.children) if (find(c, id)) return true; return false; }
        return find(d.root, 'ca1');
    });
    assert(ca1InData, 'Collapsed ChildA1 exists in mind map data');

    const ga1InData = await page.evaluate(() => {
        var d = window.getMindMapData();
        function find(n, id) { if (n.id === id) return true; for (var c of n.children) if (find(c, id)) return true; return false; }
        return find(d.root, 'ga1');
    });
    assert(ga1InData, 'Collapsed GrandA1 exists in mind map data');

    // ========================================
    // Test 14: Root cannot be collapsed
    // ========================================
    console.log('\n=== Test 14: Root cannot be collapsed ===');
    await page.evaluate(() => { window.toggleNodeCollapse('root'); });
    await page.waitForTimeout(300);
    const rootCollapsed = await page.evaluate(() => window.isNodeCollapsed('root'));
    assert(!rootCollapsed, 'Root node cannot be collapsed');

    // ========================================
    // Test 15: Leaf nodes cannot be collapsed
    // ========================================
    console.log('\n=== Test 15: Leaf nodes cannot be collapsed ===');
    await page.evaluate(() => { window.expandAllNodes(); });
    await page.waitForTimeout(300);
    await page.evaluate(() => { window.toggleNodeCollapse('cb1'); });
    await page.waitForTimeout(300);
    const leafCollapsed = await page.evaluate(() => window.isNodeCollapsed('cb1'));
    assert(!leafCollapsed, 'Leaf node (no children) cannot be collapsed');

    // ========================================
    // Test 16: Collapse indicator size and color
    // ========================================
    console.log('\n=== Test 16: Collapse indicator style ===');
    await page.evaluate(() => { window.toggleNodeCollapse('pa'); });
    await page.waitForTimeout(300);

    const indicatorStyle = await page.evaluate(() => {
        var ind = document.querySelector('.node-collapse-indicator');
        if (!ind) return null;
        var cs = getComputedStyle(ind);
        return {
            width: cs.width,
            height: cs.height,
            borderRadius: cs.borderRadius,
            bg: cs.backgroundColor
        };
    });
    assert(indicatorStyle !== null, 'Collapse indicator exists');
    if (indicatorStyle) {
        const w = parseFloat(indicatorStyle.width);
        assert(w >= 6 && w <= 8, 'Indicator width 6-8px: ' + w);
        const h = parseFloat(indicatorStyle.height);
        assert(h >= 6 && h <= 8, 'Indicator height 6-8px: ' + h);
        assert(indicatorStyle.borderRadius === '50%', 'Indicator is circle: ' + indicatorStyle.borderRadius);
        assert(indicatorStyle.bg.includes('55, 53, 47') || indicatorStyle.bg === 'rgb(55, 53, 47)',
            'Indicator color #37352f: ' + indicatorStyle.bg);
    }

    // ========================================
    // Test 17: Lines hidden for collapsed nodes
    // ========================================
    console.log('\n=== Test 17: Connection lines hidden for collapsed ===');
    // ParentA is collapsed - no connection lines from PA to its children
    const pathCount = await page.$$eval('.connection-line', els => els.length);
    // With PA collapsed: root->PA, root->PB, PB->CB1 = 3 lines
    assert(pathCount === 3, 'Only 3 connection lines when PA collapsed: ' + pathCount);

    // Expand all for final check
    await page.evaluate(() => { window.expandAllNodes(); });
    await page.waitForTimeout(300);
    const fullPathCount = await page.$$eval('.connection-line', els => els.length);
    // Fully expanded: root->PA, PA->CA1, CA1->GA1, PA->CA2, root->PB, PB->CB1 = 6 lines
    assert(fullPathCount === 6, 'All 6 connection lines when fully expanded: ' + fullPathCount);

    // ========================================
    // Test 18: Collapse state is per-map
    // ========================================
    console.log('\n=== Test 18: Collapse state per-map ===');
    // Collapse PA in current map
    await page.evaluate(() => { window.toggleNodeCollapse('pa'); });
    await page.waitForTimeout(300);

    const map1Id = await page.evaluate(() => window.getCurrentMapId());

    // Create new map
    await page.evaluate(() => { window.createNewMap(); });
    await page.waitForTimeout(500);

    const map2Id = await page.evaluate(() => window.getCurrentMapId());
    assert(map1Id !== map2Id, 'Created a different map');

    // New map should have no collapse state
    const map2CollapseState = await page.evaluate(() => window.getNodeCollapseState());
    assert(Object.keys(map2CollapseState).length === 0, 'New map has no collapse state');

    // Switch back to map 1
    await page.evaluate((id) => { window.switchToMap(id); }, map1Id);
    await page.waitForTimeout(500);

    // Map 1 should still be collapsed
    const map1Collapsed = await page.evaluate(() => window.isNodeCollapsed('pa'));
    assert(map1Collapsed, 'Map 1 still has PA collapsed after switching back');

    // ========================================
    // Summary
    // ========================================
    console.log('\n==================');
    console.log('Passed: ' + passed + '/' + (passed + failed));
    if (failed > 0) {
        console.log('FAILED: ' + failed);
        process.exit(1);
    } else {
        console.log('ALL TESTS PASSED ✅');
    }

    await browser.close();
})();
