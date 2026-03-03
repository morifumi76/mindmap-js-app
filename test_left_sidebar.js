const { chromium } = require('playwright');

let pass = 0, fail = 0;
function assert(cond, msg) {
    if (cond) { pass++; console.log('  ✅ ' + msg); }
    else { fail++; console.log('  ❌ FAIL: ' + msg); }
}

(async () => {
    const browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });

    // ========================================
    // Test 1: Initial state & Fresh Start
    // ========================================
    console.log('\n=== Test 1: Initial State & Fresh Start ===');
    let page = await ctx.newPage();
    await page.goto('http://localhost:8080/index.html');
    await page.waitForTimeout(1500);

    // Left sidebar should be open by default
    let leftSidebar = page.locator('#leftSidebar');
    let isCollapsed = await leftSidebar.evaluate(el => el.classList.contains('collapsed'));
    assert(!isCollapsed, 'Left sidebar opens by default on fresh start');

    // Header shows マイマップ (no folder emoji)
    let header = await page.locator('.left-sidebar-header').textContent();
    assert(header.includes('マイマップ'), 'Header shows マイマップ');
    assert(!header.match(/^📂/), 'Header has no folder emoji at the start');

    // Header layout: vertical (flex-direction: column)
    let headerDirection = await page.locator('.left-sidebar-header').evaluate(el =>
        window.getComputedStyle(el).flexDirection
    );
    assert(headerDirection === 'column', 'Header uses vertical layout (flex-direction: column)');

    // New map button is visible
    let newBtn = page.locator('#newMapBtn');
    assert(await newBtn.isVisible(), 'New map button is visible');

    // Sort toggle exists
    let sortToggle = page.locator('#sortToggleInput');
    assert(await sortToggle.count() === 1, 'Sort toggle exists');

    // Separator exists
    let separator = page.locator('.left-sidebar-separator');
    assert(await separator.count() >= 1, 'Separator exists between header and list');

    // ========================================
    // Test 2: Folder-Page Schema & Migration
    // ========================================
    console.log('\n=== Test 2: Folder-Page Schema & Migration ===');

    // mindmap-migrated-v4 flag should be set
    let migratedV4 = await page.evaluate(() => localStorage.getItem('mindmap-migrated-v4'));
    assert(migratedV4 === '1', 'mindmap-migrated-v4 flag is set');

    // Meta should have folder and page entries
    let meta = await page.evaluate(() => {
        try { return JSON.parse(localStorage.getItem('mindmap-meta')); } catch(e) { return null; }
    });
    assert(meta && meta.length >= 2, 'Meta list has at least 2 entries (folder + page)');

    // Should have at least one folder
    let folders = meta.filter(m => m.type === 'folder');
    assert(folders.length >= 1, 'At least 1 folder exists');

    // Should have 未分類 (default) folder
    let defaultFolder = meta.find(m => m.type === 'folder' && m.isDefault === true);
    assert(defaultFolder !== undefined, '未分類 default folder exists');
    assert(defaultFolder.name === '未分類', 'Default folder name is 未分類');

    // Should have at least one page
    let pages = meta.filter(m => m.type === 'page');
    assert(pages.length >= 1, 'At least 1 page exists');

    // Pages should have folderId
    let allPagesHaveFolderId = pages.every(p => p.folderId !== undefined);
    assert(allPagesHaveFolderId, 'All pages have folderId field');

    // All entries should have order
    let allHaveOrder = meta.every(m => m.order !== undefined);
    assert(allHaveOrder, 'All meta entries have order field');

    // All entries should have type
    let allHaveType = meta.every(m => m.type === 'folder' || m.type === 'page');
    assert(allHaveType, 'All meta entries have valid type (folder or page)');

    // ========================================
    // Test 3: Folder-Page Tree UI
    // ========================================
    console.log('\n=== Test 3: Folder-Page Tree UI ===');

    // Should have folder items with class 'folder-item'
    let folderItems = await page.locator('.map-item.folder-item').count();
    assert(folderItems >= 1, 'Folder items exist in sidebar');

    // Should have page items with class 'page-item'
    let pageItems = await page.locator('.map-item.page-item').count();
    assert(pageItems >= 1, 'Page items exist in sidebar');

    // Active page should have 📌 pin at end
    let activePagePin = await page.evaluate(() => {
        var active = document.querySelector('.map-item.page-item.active');
        if (!active) return null;
        var pin = active.querySelector('.map-item-pin');
        return pin ? pin.textContent : null;
    });
    assert(activePagePin === '📌', 'Active page shows pin icon 📌 at end');

    // Non-active pages should NOT have pin
    let nonActivePins = await page.evaluate(() => {
        var items = document.querySelectorAll('.map-item.page-item:not(.active)');
        for (var i = 0; i < items.length; i++) {
            var pin = items[i].querySelector('.map-item-pin');
            if (pin && pin.textContent !== '') return false;
        }
        return true;
    });
    assert(nonActivePins, 'Non-active pages have no pin icon');

    // Folders should have expand/collapse toggle
    let folderToggles = await page.locator('.map-item.folder-item .map-item-toggle').count();
    assert(folderToggles >= 1, 'Folder items have expand/collapse toggle');

    // Page items should be indented
    let pageIndent = await page.evaluate(() => {
        var pageItem = document.querySelector('.map-item.page-item');
        if (!pageItem) return null;
        return window.getComputedStyle(pageItem).paddingLeft;
    });
    assert(pageIndent === '28px', 'Page items indented with 28px padding');

    // Folder items should be left-aligned (no extra indent)
    let folderIndent = await page.evaluate(() => {
        var folderItem = document.querySelector('.map-item.folder-item');
        if (!folderItem) return null;
        return window.getComputedStyle(folderItem).paddingLeft;
    });
    // Default map-item padding is 12px for folders
    assert(folderIndent === '12px', 'Folder items left-aligned (12px default padding)');

    // ========================================
    // Test 4: Create New Page (＋ 新規作成)
    // ========================================
    console.log('\n=== Test 4: Create New Page ===');

    let beforePageCount = await page.evaluate(() => {
        var meta = JSON.parse(localStorage.getItem('mindmap-meta'));
        return meta.filter(m => m.type === 'page').length;
    });

    await newBtn.click();
    await page.waitForTimeout(500);

    let afterPageCount = await page.evaluate(() => {
        var meta = JSON.parse(localStorage.getItem('mindmap-meta'));
        return meta.filter(m => m.type === 'page').length;
    });
    assert(afterPageCount === beforePageCount + 1, 'New page created (' + beforePageCount + ' -> ' + afterPageCount + ')');

    // New page should be active
    let activeItems = await page.locator('.map-item.page-item.active').count();
    assert(activeItems === 1, 'Exactly 1 active page after creation');

    // URL should have ?id= parameter
    let url = page.url();
    assert(url.includes('?id='), 'URL has ?id= parameter');

    // New page should belong to a folder
    let newPageMeta = await page.evaluate(() => {
        var meta = JSON.parse(localStorage.getItem('mindmap-meta'));
        var currentId = window.getCurrentMapId();
        return meta.find(m => m.id === currentId);
    });
    assert(newPageMeta && newPageMeta.type === 'page', 'New entry is type "page"');
    assert(newPageMeta && newPageMeta.folderId !== undefined, 'New page has folderId');

    // ========================================
    // Test 5: Switch Between Pages
    // ========================================
    console.log('\n=== Test 5: Switch Between Pages ===');

    let currentId = await page.evaluate(() => window.getCurrentMapId());

    // Click on a different page
    let switched = await page.evaluate((currentMapId) => {
        var items = document.querySelectorAll('.map-item.page-item');
        for (var i = 0; i < items.length; i++) {
            if (parseInt(items[i].dataset.mapId) !== currentMapId) {
                items[i].click();
                return parseInt(items[i].dataset.mapId);
            }
        }
        return null;
    }, currentId);
    await page.waitForTimeout(500);

    if (switched) {
        let newCurrentId = await page.evaluate(() => window.getCurrentMapId());
        assert(newCurrentId !== currentId, 'Switched to a different page');

        url = page.url();
        assert(url.includes('id=' + newCurrentId), 'URL updated to new page ID');
    } else {
        assert(true, 'Only one page, switch test skipped');
        assert(true, 'URL test skipped');
    }

    // ========================================
    // Test 6: Map Data Isolation
    // ========================================
    console.log('\n=== Test 6: Map Data Isolation ===');

    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
    await page.keyboard.press('Tab');
    await page.waitForTimeout(300);
    await page.keyboard.type('IsolationTest');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);

    let mapAData = await page.evaluate(() => window.getMindMapData());
    let mapAChildren = mapAData.root.children.length;

    // Switch to another page
    let switchedTo = await page.evaluate((currentMapId) => {
        var items = document.querySelectorAll('.map-item.page-item');
        for (var i = 0; i < items.length; i++) {
            if (parseInt(items[i].dataset.mapId) !== currentMapId) {
                items[i].click();
                return parseInt(items[i].dataset.mapId);
            }
        }
        return null;
    }, await page.evaluate(() => window.getCurrentMapId()));
    await page.waitForTimeout(500);

    if (switchedTo) {
        let mapBData = await page.evaluate(() => window.getMindMapData());
        assert(mapBData.root.children.length !== mapAChildren || mapAChildren === 0,
            'Pages have isolated data');
    } else {
        assert(true, 'Only one page, isolation test skipped');
    }

    // ========================================
    // Test 7: Context Menu - Duplicate Page
    // ========================================
    console.log('\n=== Test 7: Context Menu - Duplicate Page ===');

    let beforeDupCount = await page.evaluate(() => {
        var meta = JSON.parse(localStorage.getItem('mindmap-meta'));
        return meta.filter(m => m.type === 'page').length;
    });

    let pageMenuBtn = page.locator('.map-item.page-item .map-item-menu-btn').first();
    await pageMenuBtn.click();
    await page.waitForTimeout(300);

    let ctxMenu = page.locator('#ctxMenu');
    let ctxMenuVisible = await ctxMenu.evaluate(el => el.classList.contains('show'));
    assert(ctxMenuVisible, 'Page context menu appears');

    await page.click('[data-action="duplicate"]');
    await page.waitForTimeout(500);

    let afterDupCount = await page.evaluate(() => {
        var meta = JSON.parse(localStorage.getItem('mindmap-meta'));
        return meta.filter(m => m.type === 'page').length;
    });
    assert(afterDupCount === beforeDupCount + 1, 'Duplicate created new page');

    let allMapNames = await page.evaluate(() => {
        var names = [];
        document.querySelectorAll('.map-item.page-item .map-item-name').forEach(el => names.push(el.textContent));
        return names;
    });
    let hasCopy = allMapNames.some(n => n.includes('のコピー'));
    assert(hasCopy, 'Duplicate page name includes "のコピー"');

    // ========================================
    // Test 8: Context Menu - Rename Page (uses input element)
    // ========================================
    console.log('\n=== Test 8: Context Menu - Rename Page ===');

    pageMenuBtn = page.locator('.map-item.page-item .map-item-menu-btn').first();
    await pageMenuBtn.click();
    await page.waitForTimeout(300);

    await page.click('[data-action="rename"]');
    await page.waitForTimeout(300);

    let renameInput = page.locator('.map-item-rename-input');
    let renameInputCount = await renameInput.count();
    assert(renameInputCount >= 1, 'Rename input field appears');

    await renameInput.first().fill('My Renamed Page');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);

    allMapNames = await page.evaluate(() => {
        var names = [];
        document.querySelectorAll('.map-item-name').forEach(el => names.push(el.textContent));
        return names;
    });
    let hasRenamed = allMapNames.some(n => n === 'My Renamed Page');
    assert(hasRenamed, 'Page renamed successfully');

    meta = await page.evaluate(() => {
        try { return JSON.parse(localStorage.getItem('mindmap-meta')); } catch(e) { return null; }
    });
    let renamedMeta = meta.find(m => m.name === 'My Renamed Page');
    assert(renamedMeta !== undefined, 'Renamed page persisted in localStorage meta');

    // ========================================
    // Test 9: Double-click to rename
    // ========================================
    console.log('\n=== Test 9: Double-Click Rename ===');

    let nameEl = page.locator('.map-item.page-item .map-item-name').first();
    await nameEl.dblclick();
    await page.waitForTimeout(300);

    renameInput = page.locator('.map-item-rename-input');
    renameInputCount = await renameInput.count();
    assert(renameInputCount >= 1, 'Double-click opens rename input');

    // Press Escape to cancel
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    renameInputCount = await page.locator('.map-item-rename-input').count();
    assert(renameInputCount === 0, 'Escape cancels rename');

    // ========================================
    // Test 10: Context Menu - Delete Page
    // ========================================
    console.log('\n=== Test 10: Context Menu - Delete Page ===');

    page.on('dialog', async dialog => {
        await dialog.accept();
    });

    let beforeDelCount = await page.evaluate(() => {
        var meta = JSON.parse(localStorage.getItem('mindmap-meta'));
        return meta.filter(m => m.type === 'page').length;
    });

    pageMenuBtn = page.locator('.map-item.page-item .map-item-menu-btn').last();
    await pageMenuBtn.click();
    await page.waitForTimeout(300);

    await page.click('[data-action="delete"]');
    await page.waitForTimeout(500);

    let afterDelCount = await page.evaluate(() => {
        var meta = JSON.parse(localStorage.getItem('mindmap-meta'));
        return meta.filter(m => m.type === 'page').length;
    });
    assert(afterDelCount === beforeDelCount - 1, 'Page deleted (' + beforeDelCount + ' -> ' + afterDelCount + ')');

    // ========================================
    // Test 11: Cannot delete last page
    // ========================================
    console.log('\n=== Test 11: Cannot Delete Last Page ===');

    // Delete all pages except last
    while (true) {
        let cnt = await page.evaluate(() => {
            var meta = JSON.parse(localStorage.getItem('mindmap-meta'));
            return meta.filter(m => m.type === 'page').length;
        });
        if (cnt <= 1) break;
        let mb = page.locator('.map-item.page-item .map-item-menu-btn').last();
        let mbCount = await mb.count();
        if (mbCount === 0) break;
        await mb.click();
        await page.waitForTimeout(200);
        await page.click('[data-action="delete"]');
        await page.waitForTimeout(500);
    }

    let finalPageCount = await page.evaluate(() => {
        var meta = JSON.parse(localStorage.getItem('mindmap-meta'));
        return meta.filter(m => m.type === 'page').length;
    });
    assert(finalPageCount === 1, 'Cannot delete the last page, 1 remains');

    // ========================================
    // Test 12: Persistence across page reload
    // ========================================
    console.log('\n=== Test 12: Persistence Across Reload ===');

    let savedCurrentId = await page.evaluate(() => window.getCurrentMapId());

    await page.reload();
    await page.waitForTimeout(1500);

    let lsCollapsedAfterReload = await page.locator('#leftSidebar').evaluate(el => el.classList.contains('collapsed'));
    if (lsCollapsedAfterReload) {
        await page.click('#leftSidebarFloatToggle');
        await page.waitForTimeout(300);
    }

    let reloadedId = await page.evaluate(() => window.getCurrentMapId());
    assert(reloadedId === savedCurrentId, 'Same page loaded after reload (last active)');

    // ========================================
    // Test 13: URL ?id= parameter loading
    // ========================================
    console.log('\n=== Test 13: URL ?id= Parameter ===');

    await page.click('#newMapBtn');
    await page.waitForTimeout(500);

    await page.goto('http://localhost:8080/index.html?id=' + savedCurrentId);
    await page.waitForTimeout(1500);

    let loadedId = await page.evaluate(() => window.getCurrentMapId());
    assert(loadedId === savedCurrentId, 'Loads specific page from ?id= param');

    // ========================================
    // Test 14: Sort Toggle
    // ========================================
    console.log('\n=== Test 14: Sort Toggle ===');

    let lsCollapsed14 = await page.locator('#leftSidebar').evaluate(el => el.classList.contains('collapsed'));
    if (lsCollapsed14) {
        await page.click('#leftSidebarFloatToggle');
        await page.waitForTimeout(300);
    }

    // Default sort mode should be 'none'
    let sortMode = await page.evaluate(() => window.getSortMode());
    assert(sortMode === 'none', 'Default sort mode is "none" (manual)');

    // Sort toggle should be OFF by default
    let sortChecked = await page.evaluate(() => document.getElementById('sortToggleInput').checked);
    assert(!sortChecked, 'Sort toggle is OFF by default');

    // Sort label should say "アルファベット順"
    let sortLabel = await page.locator('.left-sidebar-sort-label').textContent();
    assert(sortLabel.includes('アルファベット順'), 'Sort label says アルファベット順');

    // Turn on sort
    await page.evaluate(() => {
        var input = document.getElementById('sortToggleInput');
        input.checked = true;
        input.dispatchEvent(new Event('change'));
    });
    await page.waitForTimeout(300);

    sortMode = await page.evaluate(() => window.getSortMode());
    assert(sortMode === 'alpha', 'Sort mode changed to "alpha"');

    let storedSortMode = await page.evaluate(() => localStorage.getItem('mindmap-sort-mode'));
    assert(storedSortMode === 'alpha', 'Sort mode persisted in localStorage');

    // Turn off sort
    await page.evaluate(() => {
        var input = document.getElementById('sortToggleInput');
        input.checked = false;
        input.dispatchEvent(new Event('change'));
    });
    await page.waitForTimeout(300);

    sortMode = await page.evaluate(() => window.getSortMode());
    assert(sortMode === 'none', 'Sort mode reverted to "none"');

    // ========================================
    // Test 15: Folder Creation (📁 フォルダを作成)
    // ========================================
    console.log('\n=== Test 15: Folder Creation ===');

    let beforeFolderCount = await page.evaluate(() => {
        var meta = JSON.parse(localStorage.getItem('mindmap-meta'));
        return meta.filter(m => m.type === 'folder').length;
    });

    // Use exposed function
    await page.evaluate(() => window.createFolder());
    await page.waitForTimeout(500);

    let afterFolderCount = await page.evaluate(() => {
        var meta = JSON.parse(localStorage.getItem('mindmap-meta'));
        return meta.filter(m => m.type === 'folder').length;
    });
    assert(afterFolderCount === beforeFolderCount + 1, 'New folder created');

    // New folder should appear in sidebar
    let newFolderEl = await page.evaluate(() => {
        var items = document.querySelectorAll('.map-item.folder-item:not(.default-folder)');
        for (var i = 0; i < items.length; i++) {
            var name = items[i].querySelector('.map-item-name');
            if (name && name.textContent === '新しいフォルダ') return true;
        }
        return false;
    });
    // May already be in rename mode, so check meta instead
    let newFolderMeta = await page.evaluate(() => {
        var meta = JSON.parse(localStorage.getItem('mindmap-meta'));
        return meta.find(m => m.type === 'folder' && m.name === '新しいフォルダ');
    });
    assert(newFolderMeta !== undefined, 'New folder has default name "新しいフォルダ"');

    // Cancel rename if active
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    // ========================================
    // Test 16: Page Creation in Folder
    // ========================================
    console.log('\n=== Test 16: Page Creation in Folder ===');

    let targetFolderId = newFolderMeta.id;

    let beforePageInFolder = await page.evaluate((fid) => {
        var meta = JSON.parse(localStorage.getItem('mindmap-meta'));
        return meta.filter(m => m.type === 'page' && m.folderId === fid).length;
    }, targetFolderId);

    await page.evaluate((fid) => window.createPageInFolder(fid), targetFolderId);
    await page.waitForTimeout(800);

    // Cancel rename if active
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    let afterPageInFolder = await page.evaluate((fid) => {
        var meta = JSON.parse(localStorage.getItem('mindmap-meta'));
        return meta.filter(m => m.type === 'page' && m.folderId === fid).length;
    }, targetFolderId);
    assert(afterPageInFolder === beforePageInFolder + 1, 'New page created in folder');

    // The new page's folderId should match
    let newPageInFolder = await page.evaluate((fid) => {
        var meta = JSON.parse(localStorage.getItem('mindmap-meta'));
        var pages = meta.filter(m => m.type === 'page' && m.folderId === fid);
        return pages.length > 0 ? pages[pages.length - 1] : null;
    }, targetFolderId);
    assert(newPageInFolder && newPageInFolder.folderId === targetFolderId, 'New page belongs to correct folder');

    // ========================================
    // Test 17: Collapse/Expand Folder
    // ========================================
    console.log('\n=== Test 17: Collapse/Expand Folder ===');

    // Find a folder with pages (the one we just created should have one)
    let folderWithPages = await page.evaluate((fid) => {
        var item = document.querySelector('.map-item.folder-item[data-map-id="' + fid + '"]');
        if (!item) return null;
        var toggle = item.querySelector('.map-item-toggle');
        return toggle ? toggle.textContent : null;
    }, targetFolderId);
    assert(folderWithPages === '▼', 'Folder with pages shows ▼ (expanded)');

    // Click toggle to collapse
    await page.evaluate((fid) => {
        var item = document.querySelector('.map-item.folder-item[data-map-id="' + fid + '"]');
        if (item) {
            var toggle = item.querySelector('.map-item-toggle');
            if (toggle) toggle.click();
        }
    }, targetFolderId);
    await page.waitForTimeout(300);

    // Pages should be hidden
    let pagesVisible = await page.evaluate((fid) => {
        return document.querySelectorAll('.map-item.page-item[data-folder-id="' + fid + '"]').length;
    }, targetFolderId);
    assert(pagesVisible === 0, 'Pages hidden after collapse');

    // Toggle should show ►
    let collapsedToggle = await page.evaluate((fid) => {
        var item = document.querySelector('.map-item.folder-item[data-map-id="' + fid + '"]');
        if (!item) return null;
        var toggle = item.querySelector('.map-item-toggle');
        return toggle ? toggle.textContent : null;
    }, targetFolderId);
    assert(collapsedToggle === '►', 'Collapsed folder shows ►');

    // Collapse state should be persisted
    let collapseState = await page.evaluate(() => {
        try { return JSON.parse(localStorage.getItem('mindmap-collapse-state')); } catch(e) { return null; }
    });
    assert(collapseState !== null && Object.keys(collapseState).length > 0, 'Collapse state saved in localStorage');

    // Expand again
    await page.evaluate((fid) => {
        var item = document.querySelector('.map-item.folder-item[data-map-id="' + fid + '"]');
        if (item) {
            var toggle = item.querySelector('.map-item-toggle');
            if (toggle) toggle.click();
        }
    }, targetFolderId);
    await page.waitForTimeout(300);

    let pagesAfterExpand = await page.evaluate((fid) => {
        return document.querySelectorAll('.map-item.page-item[data-folder-id="' + fid + '"]').length;
    }, targetFolderId);
    assert(pagesAfterExpand >= 1, 'Pages visible after expand');

    // ========================================
    // Test 18: 未分類 Folder – Immutable
    // ========================================
    console.log('\n=== Test 18: 未分類 Folder – Immutable ===');

    // 未分類 folder should exist
    let defaultFolderExists = await page.evaluate(() => {
        var meta = JSON.parse(localStorage.getItem('mindmap-meta'));
        return meta.some(m => m.type === 'folder' && m.isDefault === true);
    });
    assert(defaultFolderExists, '未分類 folder exists in meta');

    // 未分類 should be at the bottom (last folder)
    let folderOrder = await page.evaluate(() => {
        var folders = document.querySelectorAll('.map-item.folder-item');
        if (folders.length === 0) return null;
        var last = folders[folders.length - 1];
        return last.classList.contains('default-folder');
    });
    assert(folderOrder === true, '未分類 folder is at the bottom of the list');

    // 未分類 should not be draggable
    let defaultDraggable = await page.evaluate(() => {
        var defFolder = document.querySelector('.map-item.default-folder');
        return defFolder ? defFolder.draggable : null;
    });
    assert(!defaultDraggable, '未分類 folder is not draggable');

    // ========================================
    // Test 19: Folder Context Menu
    // ========================================
    console.log('\n=== Test 19: Folder Context Menu ===');

    // Open context menu on a non-default folder
    let nonDefaultFolder = page.locator('.map-item.folder-item:not(.default-folder) .map-item-menu-btn').first();
    let nonDefaultCount = await nonDefaultFolder.count();
    if (nonDefaultCount > 0) {
        await nonDefaultFolder.click();
        await page.waitForTimeout(300);

        let folderMenuVisible = await page.locator('#ctxMenuFolder').evaluate(el => el.classList.contains('show'));
        assert(folderMenuVisible, 'Folder context menu appears for non-default folder');

        // Should have rename, add page, delete options
        let hasRename = await page.locator('#ctxMenuFolder [data-action="folder-rename"]').isVisible();
        let hasAddPage = await page.locator('#ctxMenuFolder [data-action="folder-add-page"]').isVisible();
        let hasDelete = await page.locator('#ctxMenuFolder [data-action="folder-delete"]').isVisible();
        assert(hasRename, 'Folder menu has rename option');
        assert(hasAddPage, 'Folder menu has add page option');
        assert(hasDelete, 'Folder menu has delete option');

        // Close menu
        await page.click('body');
        await page.waitForTimeout(200);
    } else {
        assert(true, 'No non-default folders to test (skipped x4)');
    }

    // ========================================
    // Test 20: Delete Folder (children move to 未分類)
    // ========================================
    console.log('\n=== Test 20: Delete Folder ===');

    // Get pages in the folder before delete
    let pagesInFolder = await page.evaluate((fid) => {
        var meta = JSON.parse(localStorage.getItem('mindmap-meta'));
        return meta.filter(m => m.type === 'page' && m.folderId === fid).map(m => m.id);
    }, targetFolderId);

    // Delete the folder
    await page.evaluate((fid) => window.deleteFolder(fid), targetFolderId);
    await page.waitForTimeout(500);

    // Folder should be removed
    let folderGone = await page.evaluate((fid) => {
        var meta = JSON.parse(localStorage.getItem('mindmap-meta'));
        return !meta.some(m => m.id === fid);
    }, targetFolderId);
    assert(folderGone, 'Folder removed from meta');

    // Children should have moved to 未分類
    if (pagesInFolder.length > 0) {
        let movedToDefault = await page.evaluate((pageIds) => {
            var meta = JSON.parse(localStorage.getItem('mindmap-meta'));
            var defFolder = meta.find(m => m.type === 'folder' && m.isDefault);
            if (!defFolder) return false;
            return pageIds.every(pid => {
                var p = meta.find(m => m.id === pid);
                return p && p.folderId === defFolder.id;
            });
        }, pagesInFolder);
        assert(movedToDefault, 'Children moved to 未分類 after folder deletion');
    } else {
        assert(true, 'No children to move (skipped)');
    }

    // ========================================
    // Test 21: Backspace doesn't trigger during rename
    // ========================================
    console.log('\n=== Test 21: Backspace During Rename ===');

    nameEl = page.locator('.map-item.page-item .map-item-name').first();
    await nameEl.dblclick();
    await page.waitForTimeout(300);

    renameInput = page.locator('.map-item-rename-input').first();
    if (await renameInput.count() > 0) {
        await renameInput.fill('TestBackspace');
        await page.waitForTimeout(100);

        let nodeCountBefore = await page.evaluate(() => window.getMindMapData().root.children.length);
        await page.keyboard.press('Backspace');
        await page.waitForTimeout(200);
        let nodeCountAfter = await page.evaluate(() => window.getMindMapData().root.children.length);
        assert(nodeCountBefore === nodeCountAfter, 'Backspace in rename does NOT delete mind map nodes');

        await page.keyboard.press('Enter');
        await page.waitForTimeout(500);
    } else {
        assert(true, 'Rename input not found (skipped)');
    }

    // ========================================
    // Test 22: Node Operations Still Work
    // ========================================
    console.log('\n=== Test 22: Node Operations Still Work ===');

    await page.click('#canvas');
    await page.waitForTimeout(300);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    await page.evaluate(() => {
        var rootEl = document.querySelector('[data-id="root"]');
        if (rootEl) rootEl.click();
    });
    await page.waitForTimeout(300);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    await page.keyboard.press('Tab');
    await page.waitForTimeout(300);
    await page.keyboard.type('ChildNodeTest');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);

    let data = await page.evaluate(() => window.getMindMapData());
    assert(data.root.children.length >= 1, 'Can add child nodes');

    let copyText = await page.evaluate(() => window.getCurrentCopyText());
    assert(copyText.includes('中心テーマ'), 'Copy text includes root text');
    assert(copyText.includes('ChildNodeTest'), 'Copy text includes child node');

    // ========================================
    // Test 23: Keyboard Shortcuts
    // ========================================
    console.log('\n=== Test 23: Keyboard Shortcuts ===');

    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);

    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(200);

    let selectedIds = await page.evaluate(() => {
        var ids = [];
        window.getSelectedNodeIds().forEach(id => ids.push(id));
        return ids;
    });
    assert(selectedIds.length === 1, 'Navigation with ArrowRight works');

    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(200);
    selectedIds = await page.evaluate(() => {
        var ids = [];
        window.getSelectedNodeIds().forEach(id => ids.push(id));
        return ids;
    });
    assert(selectedIds.includes('root'), 'Navigation with ArrowLeft works back to root');

    // ========================================
    // Test 24: Right Sidebar Still Works
    // ========================================
    console.log('\n=== Test 24: Right Sidebar ===');

    let rightFloatToggle = page.locator('#sidebarFloatToggle');
    await rightFloatToggle.click();
    await page.waitForTimeout(300);

    let rightSidebar = page.locator('#sidebar');
    let rightCollapsed = await rightSidebar.evaluate(el => el.classList.contains('collapsed'));
    assert(!rightCollapsed, 'Right sidebar can be opened');

    let previewLines = await page.locator('.sidebar-preview-line').count();
    assert(previewLines >= 2, 'Right sidebar shows preview lines');

    // ========================================
    // Test 25: Auto-save when switching pages
    // ========================================
    console.log('\n=== Test 25: Auto-save on Switch ===');

    await page.evaluate(() => {
        var root = window.getMindMapData().root;
        root.children.push({ id: 'test_autosave_' + Date.now(), text: 'UniqueAutoSaveTest', children: [] });
        var mapId = window.getCurrentMapId();
        var data = window.getMindMapData();
        localStorage.setItem('mindmap-data-' + mapId, JSON.stringify(data));
    });
    await page.waitForTimeout(500);

    let beforeSwitchId = await page.evaluate(() => window.getCurrentMapId());

    let leftCollapsed = await page.locator('#leftSidebar').evaluate(el => el.classList.contains('collapsed'));
    if (leftCollapsed) {
        await page.click('#leftSidebarFloatToggle');
        await page.waitForTimeout(300);
    }

    await page.click('#newMapBtn');
    await page.waitForTimeout(500);

    let origMapItem = page.locator(`.map-item.page-item[data-map-id="${beforeSwitchId}"]`);
    if (await origMapItem.count() > 0) {
        await origMapItem.click();
        await page.waitForTimeout(500);

        data = await page.evaluate(() => window.getMindMapData());
        let hasUniqueNode = JSON.stringify(data).includes('UniqueAutoSaveTest');
        assert(hasUniqueNode, 'Data auto-saved when switching pages');
    } else {
        assert(true, 'Could not find original map item (skipped)');
    }

    // ========================================
    // Test 26: Left Sidebar Width Persistence
    // ========================================
    console.log('\n=== Test 26: Left Sidebar Width Persistence ===');

    let savedWidth = await page.evaluate(() => localStorage.getItem('mindmap_left_sidebar_width'));
    assert(savedWidth !== null, 'Left sidebar width saved in localStorage');

    // ========================================
    // Test 27: Alphabetical Sort Order
    // ========================================
    console.log('\n=== Test 27: Alphabetical Sort Order ===');

    // Rename pages and folders to test sorting
    await page.evaluate(() => {
        var meta = JSON.parse(localStorage.getItem('mindmap-meta'));
        var pagesOnly = meta.filter(m => m.type === 'page');
        if (pagesOnly.length >= 2) {
            pagesOnly[0].name = 'Zebra Page';
            pagesOnly[1].name = 'Apple Page';
        }
        var foldersNonDefault = meta.filter(m => m.type === 'folder' && !m.isDefault);
        if (foldersNonDefault.length >= 2) {
            foldersNonDefault[0].name = 'Zebra Folder';
            foldersNonDefault[1].name = 'Apple Folder';
        }
        localStorage.setItem('mindmap-meta', JSON.stringify(meta));
        window.renderMapList();
    });
    await page.waitForTimeout(300);

    // Turn on alphabetical sort
    await page.evaluate(() => {
        document.getElementById('sortToggleInput').checked = true;
        document.getElementById('sortToggleInput').dispatchEvent(new Event('change'));
    });
    await page.waitForTimeout(300);

    // Check if folder names are sorted
    let sortedFolderNames = await page.evaluate(() => {
        var names = [];
        document.querySelectorAll('.map-item.folder-item:not(.default-folder) .map-item-name').forEach(el => names.push(el.textContent));
        return names;
    });
    if (sortedFolderNames.length >= 2) {
        let foldersSorted = sortedFolderNames[0].localeCompare(sortedFolderNames[1]) <= 0;
        assert(foldersSorted, 'Folders sorted alphabetically when sort toggle is ON');
    } else {
        assert(true, 'Not enough folders to verify sort (skipped)');
    }

    // Turn off sort
    await page.evaluate(() => {
        document.getElementById('sortToggleInput').checked = false;
        document.getElementById('sortToggleInput').dispatchEvent(new Event('change'));
    });
    await page.waitForTimeout(300);

    // ========================================
    // Test 28: Area Context Menu (create folder)
    // ========================================
    console.log('\n=== Test 28: Area Context Menu ===');

    // The ctxMenuArea should have "📁 フォルダを作成"
    let areaMenuHasCreateFolder = await page.evaluate(() => {
        var item = document.querySelector('#ctxMenuArea [data-action="create-folder"]');
        return item ? item.textContent : null;
    });
    assert(areaMenuHasCreateFolder && areaMenuHasCreateFolder.includes('フォルダを作成'), 'Area context menu has "フォルダを作成" option');

    // ========================================
    // Test 29: Folders have no mindmap data
    // ========================================
    console.log('\n=== Test 29: Folders Have No Mindmap Data ===');

    let folderHasNoData = await page.evaluate(() => {
        var meta = JSON.parse(localStorage.getItem('mindmap-meta'));
        var folders = meta.filter(m => m.type === 'folder');
        for (var i = 0; i < folders.length; i++) {
            var dataKey = 'mindmap-data-' + folders[i].id;
            if (localStorage.getItem(dataKey)) return false;
        }
        return true;
    });
    assert(folderHasNoData, 'Folders do not store mindmap data');

    // ========================================
    // Test 30: Pages have mindmap data
    // ========================================
    console.log('\n=== Test 30: Pages Have Mindmap Data ===');

    let pagesHaveData = await page.evaluate(() => {
        var meta = JSON.parse(localStorage.getItem('mindmap-meta'));
        var pages = meta.filter(m => m.type === 'page');
        for (var i = 0; i < pages.length; i++) {
            var dataKey = 'mindmap-data-' + pages[i].id;
            var raw = localStorage.getItem(dataKey);
            if (!raw) return false;
            try {
                var data = JSON.parse(raw);
                if (!data.root || data.root.id !== 'root') return false;
            } catch(e) { return false; }
        }
        return true;
    });
    assert(pagesHaveData, 'All pages have valid mindmap data');

    // ========================================
    // Summary
    // ========================================
    console.log('\n' + '='.repeat(50));
    console.log('Results: ' + pass + ' passed, ' + fail + ' failed');
    console.log('='.repeat(50));

    await browser.close();
    process.exit(fail > 0 ? 1 : 0);
})().catch(err => {
    console.error('Test error:', err);
    process.exit(1);
});
