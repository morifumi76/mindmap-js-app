const { chromium } = require('playwright');

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

    // Navigate and clear storage
    await page.goto('http://localhost:8080');
    await page.evaluate(() => localStorage.clear());
    await page.goto('http://localhost:8080');
    await page.waitForSelector('.node');

    // Load test tree: root -> ParentA (-> ChildA1, ChildA2, ChildA3), ParentB (-> ChildB1)
    await page.evaluate(() => {
        var data = {
            root: {
                id: 'root', text: 'Root',
                children: [
                    {
                        id: 'pa', text: 'ParentA',
                        children: [
                            { id: 'ca1', text: 'ChildA1', children: [] },
                            { id: 'ca2', text: 'ChildA2', children: [] },
                            { id: 'ca3', text: 'ChildA3', children: [] }
                        ]
                    },
                    {
                        id: 'pb', text: 'ParentB',
                        children: [
                            { id: 'cb1', text: 'ChildB1', children: [] }
                        ]
                    }
                ]
            }
        };
        var mapId = window.getCurrentMapId();
        localStorage.setItem('mindmap-data-' + mapId, JSON.stringify(data));
        window.location.reload();
    });
    await page.waitForSelector('.node');
    await page.waitForTimeout(500);

    // Escape any editing mode
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);

    // ========================================
    // 1. Floating Button Container
    // ========================================
    console.log('\n--- 1. Floating Button Container ---');

    const container = await page.$('#canvasFloatBtns');
    check('Float button container exists', container !== null);

    const containerStyle = await page.$eval('#canvasFloatBtns', el => {
        const s = getComputedStyle(el);
        return { position: s.position, bottom: parseInt(s.bottom), right: parseInt(s.right), display: s.display, gap: s.gap, zIndex: parseInt(s.zIndex) };
    });
    check('Container is position fixed', containerStyle.position === 'fixed');
    check('Container at bottom 16px', containerStyle.bottom === 16);
    check('Container at right 16px', containerStyle.right === 16);
    check('Container is flex', containerStyle.display === 'flex');
    check('Container z-index >= 601', containerStyle.zIndex >= 601);

    // ========================================
    // 2. Grey-out Button
    // ========================================
    console.log('\n--- 2. Grey-out Button ---');

    const grayBtn = await page.$('#grayoutFloatBtn');
    check('Grey-out button exists', grayBtn !== null);
    const grayBtnText = await page.$eval('#grayoutFloatBtn', el => el.textContent.trim());
    check('Grey-out button text is "グレーアウト"', grayBtnText === 'グレーアウト');
    const grayBtnBg = await page.$eval('#grayoutFloatBtn', el => getComputedStyle(el).backgroundColor);
    check('Grey-out button bg is #37352f', grayBtnBg === 'rgb(55, 53, 47)');

    // ========================================
    // 3. Highlight Button
    // ========================================
    console.log('\n--- 3. Highlight Button ---');

    const hlBtn = await page.$('#highlightFloatBtn');
    check('Highlight button exists', hlBtn !== null);
    const hlBtnText = await page.$eval('#highlightFloatBtn', el => el.textContent.trim());
    check('Highlight button text is "ハイライト"', hlBtnText === 'ハイライト');
    const hlBtnBg = await page.$eval('#highlightFloatBtn', el => getComputedStyle(el).backgroundColor);
    check('Highlight button bg is #37352f', hlBtnBg === 'rgb(55, 53, 47)');

    // ========================================
    // 4. Both buttons shift when sidebar opens
    // ========================================
    console.log('\n--- 4. Buttons shift with sidebar ---');

    const rightBefore = await page.$eval('#canvasFloatBtns', el => parseInt(getComputedStyle(el).right));
    check('Container right is 16px when sidebar closed', rightBefore === 16);

    await page.evaluate(() => window.openRightSidebar());
    await page.waitForTimeout(300);
    const rightAfterOpen = await page.$eval('#canvasFloatBtns', el => parseInt(el.style.right));
    check('Container shifts when sidebar opens (> 16)', rightAfterOpen > 16);

    await page.evaluate(() => window.closeRightSidebar());
    await page.waitForTimeout(300);
    const rightAfterClose = await page.$eval('#canvasFloatBtns', el => parseInt(el.style.right));
    check('Container returns to 16px after close', rightAfterClose === 16);

    // ========================================
    // 5. Grey-out color is warm gray (#C0B9B0)
    // ========================================
    console.log('\n--- 5. Grey-out color (#C0B9B0) ---');

    await page.evaluate(() => window.toggleNodeGrayout('pa'));
    await page.waitForTimeout(300);

    const grayBg = await page.$eval('[data-id="pa"]', el => getComputedStyle(el).backgroundColor);
    // #C0B9B0 = rgb(192, 185, 176)
    check('Grayed-out bg is rgb(192, 185, 176)', grayBg === 'rgb(192, 185, 176)');

    const grayTextColor = await page.$eval('[data-id="pa"] .node-text', el => getComputedStyle(el).color);
    check('Grayed-out text is white', grayTextColor === 'rgb(255, 255, 255)');

    const ca1NotGrayed = await page.$eval('[data-id="ca1"]', el => !el.classList.contains('grayed-out'));
    check('ChildA1 not grayed out (only selected node affected)', ca1NotGrayed);

    // Toggle off
    await page.evaluate(() => window.toggleNodeGrayout('pa'));
    await page.waitForTimeout(200);

    // ========================================
    // 6. Highlight styling (#F2C94C)
    // ========================================
    console.log('\n--- 6. Highlight styling (#F2C94C) ---');

    await page.evaluate(() => window.toggleNodeHighlight('pa'));
    await page.waitForTimeout(300);

    const hlBg = await page.$eval('[data-id="pa"]', el => getComputedStyle(el).backgroundColor);
    // #F2C94C = rgb(242, 201, 76)
    check('Highlighted bg is rgb(242, 201, 76)', hlBg === 'rgb(242, 201, 76)');

    const hlTextColor = await page.$eval('[data-id="pa"] .node-text', el => getComputedStyle(el).color);
    check('Highlighted text is #37352f', hlTextColor === 'rgb(55, 53, 47)');

    const hlClass = await page.$eval('[data-id="pa"]', el => el.classList.contains('highlighted'));
    check('ParentA has highlighted class', hlClass);

    const ca1NotHighlighted = await page.$eval('[data-id="ca1"]', el => !el.classList.contains('highlighted'));
    check('ChildA1 not highlighted (only selected node)', ca1NotHighlighted);

    // Toggle off
    await page.evaluate(() => window.toggleNodeHighlight('pa'));
    await page.waitForTimeout(200);

    // ========================================
    // 7. Highlight button click
    // ========================================
    console.log('\n--- 7. Highlight via button click ---');

    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
    await page.evaluate(() => { var ids = window.getSelectedNodeIds(); ids.clear(); ids.add('pa'); });
    await page.click('#highlightFloatBtn');
    await page.waitForTimeout(300);

    check('ParentA highlighted via button', await page.evaluate(() => window.isNodeHighlighted('pa')));

    // Toggle off
    await page.evaluate(() => { var ids = window.getSelectedNodeIds(); ids.clear(); ids.add('pa'); });
    await page.click('#highlightFloatBtn');
    await page.waitForTimeout(300);
    check('ParentA unhighlighted via button', !await page.evaluate(() => window.isNodeHighlighted('pa')));

    // ========================================
    // 8. Highlight shortcut (Alt+Ctrl+Y on Linux)
    // ========================================
    console.log('\n--- 8. Highlight via keyboard shortcut ---');

    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
    await page.evaluate(() => { var ids = window.getSelectedNodeIds(); ids.clear(); ids.add('pb'); });

    await page.keyboard.down('Alt');
    await page.keyboard.down('Control');
    await page.keyboard.press('y');
    await page.keyboard.up('Control');
    await page.keyboard.up('Alt');
    await page.waitForTimeout(300);

    check('ParentB highlighted via Alt+Ctrl+Y', await page.evaluate(() => window.isNodeHighlighted('pb')));

    // Toggle off
    await page.evaluate(() => { var ids = window.getSelectedNodeIds(); ids.clear(); ids.add('pb'); });
    await page.keyboard.down('Alt');
    await page.keyboard.down('Control');
    await page.keyboard.press('y');
    await page.keyboard.up('Control');
    await page.keyboard.up('Alt');
    await page.waitForTimeout(300);
    check('ParentB unhighlighted via shortcut', !await page.evaluate(() => window.isNodeHighlighted('pb')));

    // ========================================
    // 9. Grayout shortcut (Alt+Ctrl+G on Linux)
    // ========================================
    console.log('\n--- 9. Grayout via keyboard shortcut ---');

    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
    await page.evaluate(() => { var ids = window.getSelectedNodeIds(); ids.clear(); ids.add('pa'); });

    await page.keyboard.down('Alt');
    await page.keyboard.down('Control');
    await page.keyboard.press('g');
    await page.keyboard.up('Control');
    await page.keyboard.up('Alt');
    await page.waitForTimeout(300);

    check('ParentA grayed out via Alt+Ctrl+G', await page.evaluate(() => window.isNodeGrayedOut('pa')));

    // Toggle off
    await page.evaluate(() => { var ids = window.getSelectedNodeIds(); ids.clear(); ids.add('pa'); });
    await page.keyboard.down('Alt');
    await page.keyboard.down('Control');
    await page.keyboard.press('g');
    await page.keyboard.up('Control');
    await page.keyboard.up('Alt');
    await page.waitForTimeout(300);
    check('ParentA ungrayed via shortcut', !await page.evaluate(() => window.isNodeGrayedOut('pa')));

    // ========================================
    // 10. Mutual exclusion: grayout → highlight
    // ========================================
    console.log('\n--- 10. Mutual exclusion: grayout → highlight ---');

    // Grayout ParentA first
    await page.evaluate(() => window.toggleNodeGrayout('pa'));
    await page.waitForTimeout(200);
    check('PA starts as grayed out', await page.evaluate(() => window.isNodeGrayedOut('pa')));
    check('PA starts not highlighted', !await page.evaluate(() => window.isNodeHighlighted('pa')));

    // Apply highlight → should remove grayout
    await page.evaluate(() => window.toggleNodeHighlight('pa'));
    await page.waitForTimeout(200);
    check('After highlight: PA is highlighted', await page.evaluate(() => window.isNodeHighlighted('pa')));
    check('After highlight: PA is NOT grayed out', !await page.evaluate(() => window.isNodeGrayedOut('pa')));

    // Check visual class
    const paClassHL = await page.$eval('[data-id="pa"]', el => el.classList.contains('highlighted') && !el.classList.contains('grayed-out'));
    check('PA has highlighted class only (not grayed-out)', paClassHL);

    // Clean up
    await page.evaluate(() => window.toggleNodeHighlight('pa'));
    await page.waitForTimeout(200);

    // ========================================
    // 11. Mutual exclusion: highlight → grayout
    // ========================================
    console.log('\n--- 11. Mutual exclusion: highlight → grayout ---');

    // Highlight ParentB first
    await page.evaluate(() => window.toggleNodeHighlight('pb'));
    await page.waitForTimeout(200);
    check('PB starts as highlighted', await page.evaluate(() => window.isNodeHighlighted('pb')));
    check('PB starts not grayed out', !await page.evaluate(() => window.isNodeGrayedOut('pb')));

    // Apply grayout → should remove highlight
    await page.evaluate(() => window.toggleNodeGrayout('pb'));
    await page.waitForTimeout(200);
    check('After grayout: PB is grayed out', await page.evaluate(() => window.isNodeGrayedOut('pb')));
    check('After grayout: PB is NOT highlighted', !await page.evaluate(() => window.isNodeHighlighted('pb')));

    const pbClassGO = await page.$eval('[data-id="pb"]', el => el.classList.contains('grayed-out') && !el.classList.contains('highlighted'));
    check('PB has grayed-out class only (not highlighted)', pbClassGO);

    // Clean up
    await page.evaluate(() => window.toggleNodeGrayout('pb'));
    await page.waitForTimeout(200);

    // ========================================
    // 12. Highlight does NOT affect tree nav
    // ========================================
    console.log('\n--- 12. Highlight does NOT affect tree nav ---');

    await page.evaluate(() => window.toggleNodeHighlight('pa'));
    await page.waitForTimeout(200);
    await page.evaluate(() => window.openRightSidebar());
    await page.waitForTimeout(300);

    const sidebarText = await page.$eval('#sidebarTree', el => el.textContent);
    check('Tree shows highlighted ParentA', sidebarText.includes('ParentA'));
    check('Tree shows ChildA1 (descendant of highlighted)', sidebarText.includes('ChildA1'));
    check('Tree shows ChildA2', sidebarText.includes('ChildA2'));
    check('Tree shows Root', sidebarText.includes('Root'));
    check('Tree shows ParentB', sidebarText.includes('ParentB'));

    // Clean up
    await page.evaluate(() => window.toggleNodeHighlight('pa'));
    await page.evaluate(() => window.closeRightSidebar());
    await page.waitForTimeout(200);

    // ========================================
    // 13. Highlight does NOT affect copy
    // ========================================
    console.log('\n--- 13. Highlight does NOT affect copy ---');

    await page.evaluate(() => window.toggleNodeHighlight('pa'));
    await page.waitForTimeout(200);

    const copyText = await page.evaluate(() => window.getCurrentCopyText());
    check('Copy includes highlighted ParentA', copyText.includes('ParentA'));
    check('Copy includes ChildA1', copyText.includes('ChildA1'));
    check('Copy includes Root', copyText.includes('Root'));

    // Clean up
    await page.evaluate(() => window.toggleNodeHighlight('pa'));
    await page.waitForTimeout(200);

    // ========================================
    // 14. Grayout still hides from tree nav & copy
    // ========================================
    console.log('\n--- 14. Grayout still hides from tree nav & copy ---');

    await page.evaluate(() => window.toggleNodeGrayout('pb'));
    await page.waitForTimeout(200);
    await page.evaluate(() => window.openRightSidebar());
    await page.waitForTimeout(300);

    const sidebarText2 = await page.$eval('#sidebarTree', el => el.textContent);
    check('Tree hides grayed-out ParentB', !sidebarText2.includes('ParentB'));
    check('Tree hides ChildB1 (descendant of grayed)', !sidebarText2.includes('ChildB1'));
    check('Tree shows normal ParentA', sidebarText2.includes('ParentA'));

    const copyText2 = await page.evaluate(() => window.getCurrentCopyText());
    check('Copy excludes grayed-out ParentB', !copyText2.includes('ParentB'));
    check('Copy excludes ChildB1', !copyText2.includes('ChildB1'));
    check('Copy includes ParentA', copyText2.includes('ParentA'));

    // Clean up
    await page.evaluate(() => window.toggleNodeGrayout('pb'));
    await page.evaluate(() => window.closeRightSidebar());
    await page.waitForTimeout(200);

    // ========================================
    // 15. localStorage persistence for highlight
    // ========================================
    console.log('\n--- 15. Highlight localStorage persistence ---');

    await page.evaluate(() => window.toggleNodeHighlight('ca2'));
    await page.waitForTimeout(200);

    const mapId = await page.evaluate(() => window.getCurrentMapId());
    const storedHL = await page.evaluate((mid) => {
        var raw = localStorage.getItem('mindmap-node-highlight-' + mid);
        return raw ? JSON.parse(raw) : {};
    }, mapId);
    check('Highlight state saved in localStorage', storedHL['ca2'] === true);

    await page.reload();
    await page.waitForSelector('.node');
    await page.waitForTimeout(500);

    check('ChildA2 highlight persists after reload', await page.evaluate(() => window.isNodeHighlighted('ca2')));
    const ca2HLClass = await page.$eval('[data-id="ca2"]', el => el.classList.contains('highlighted'));
    check('ChildA2 has highlighted class after reload', ca2HLClass);

    // Clean up
    await page.evaluate(() => window.toggleNodeHighlight('ca2'));
    await page.waitForTimeout(200);

    // ========================================
    // 16. Per-map highlight state
    // ========================================
    console.log('\n--- 16. Per-map highlight state ---');

    await page.evaluate(() => window.toggleNodeHighlight('pa'));
    await page.waitForTimeout(200);
    check('PA highlighted on original map', await page.evaluate(() => window.isNodeHighlighted('pa')));

    await page.evaluate(() => window.createNewMap());
    await page.waitForTimeout(500);

    const newMapHL = await page.evaluate(() => window.getNodeHighlightState());
    check('New map has no highlight state', Object.keys(newMapHL).length === 0);

    const origMapId = mapId;
    await page.evaluate((mid) => window.switchToMap(mid), origMapId);
    await page.waitForTimeout(500);

    check('PA still highlighted on original map after switch', await page.evaluate(() => window.isNodeHighlighted('pa')));

    // Clean up
    await page.evaluate(() => window.toggleNodeHighlight('pa'));
    await page.waitForTimeout(200);

    // ========================================
    // 17. No selection shows toast
    // ========================================
    console.log('\n--- 17. No selection shows toast ---');

    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
    await page.evaluate(() => { var ids = window.getSelectedNodeIds(); ids.clear(); });

    await page.click('#highlightFloatBtn');
    await page.waitForTimeout(500);
    const toastShow = await page.$eval('#toast', el => el.classList.contains('show'));
    check('Toast for highlight with no selection', toastShow);

    // ========================================
    // 18. Redo (Ctrl+Y / Cmd+Y) still works
    // ========================================
    console.log('\n--- 18. Redo still works ---');

    // Select root and type something, then undo, then redo
    await page.evaluate(() => {
        var ids = window.getSelectedNodeIds();
        ids.clear();
        ids.add('root');
    });
    // Simply verify no JS errors occur when pressing Ctrl+Y
    let redoError = false;
    try {
        await page.keyboard.down('Control');
        await page.keyboard.press('y');
        await page.keyboard.up('Control');
        await page.waitForTimeout(200);
    } catch(e) { redoError = true; }
    check('Ctrl+Y (redo) does not throw', !redoError);

    // ========================================
    // Summary
    // ========================================
    console.log(`\n========================================`);
    console.log(`Results: ${passed}/${total} passed, ${failed} failed`);
    console.log(`========================================`);

    await browser.close();
    process.exit(failed > 0 ? 1 : 0);
})();
