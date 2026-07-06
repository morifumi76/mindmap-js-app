const { chromium } = require('playwright');
const { BASE_URL } = require('./helpers');

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
    await page.goto(BASE_URL);
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

    // 現行仕様: フレッシュ起動ではフォルダは作られず、トップレベルにページ1件のみ
    // （旧仕様の「未分類」デフォルトフォルダは廃止済み）
    let meta = await page.evaluate(() => {
        try { return JSON.parse(localStorage.getItem('mindmap-meta')); } catch(e) { return null; }
    });
    assert(meta && meta.length >= 1, 'Meta list has at least 1 entry (initial page)');

    // フレッシュ起動時はフォルダなし
    let folders = meta.filter(m => m.type === 'folder');
    assert(folders.length === 0, 'No folders on fresh start (default folder was removed from spec)');

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

    // 現行仕様ではフレッシュ起動時にフォルダが無いため、ツリーUI検証用にフォルダを1つ作成する
    await page.evaluate(() => window.createFolder());
    await page.waitForTimeout(400);

    // Should have folder items with class 'folder-item'
    let folderItems = await page.locator('.map-item.folder-item').count();
    assert(folderItems >= 1, 'Folder items exist in sidebar');

    // Should have page items with class 'page-item'
    let pageItems = await page.locator('.map-item.page-item').count();
    assert(pageItems >= 1, 'Page items exist in sidebar');

    // Active page should have 📌 pin at end (inline inside name)
    let activePagePin = await page.evaluate(() => {
        var active = document.querySelector('.map-item.page-item.active');
        if (!active) return null;
        var pin = active.querySelector('.map-item-pin');
        return pin ? pin.textContent.trim() : null;
    });
    assert(activePagePin === '📌', 'Active page shows pin icon 📌 at end');

    // Non-active pages should NOT have pin
    let nonActivePins = await page.evaluate(() => {
        var items = document.querySelectorAll('.map-item.page-item:not(.active)');
        for (var i = 0; i < items.length; i++) {
            var pin = items[i].querySelector('.map-item-pin');
            if (pin) return false;
        }
        return true;
    });
    assert(nonActivePins, 'Non-active pages have no pin icon');

    // Folders should have expand/collapse toggle
    let folderToggles = await page.locator('.map-item.folder-item .map-item-toggle').count();
    assert(folderToggles >= 1, 'Folder items have expand/collapse toggle');

    // 現行仕様: トップレベルのページはフォルダと同じ 12px（フォルダ内に入ると 28px に下がる）
    let pageIndent = await page.evaluate(() => {
        var pageItem = document.querySelector('.map-item.page-item');
        if (!pageItem) return null;
        return window.getComputedStyle(pageItem).paddingLeft;
    });
    assert(pageIndent === '12px', 'Top-level page items use 12px padding');

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

    await page.goto(BASE_URL + '?id=' + savedCurrentId);
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
    // （現行UIはソートラベルが複数ある：アルファベット順／タイトルに日付。先頭がソート用）
    let sortLabel = await page.locator('.left-sidebar-sort-label').first().textContent();
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

    // リネームモードに入っている場合があるため、サイドバーDOMではなく meta で確認する
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
    // Test 18: 未分類 Folder – 廃止済み（現行仕様では存在しないこと）
    // ========================================
    console.log('\n=== Test 18: 未分類 Folder – Removed from spec ===');

    // 現行仕様: デフォルトフォルダ（未分類）は廃止され、meta に存在しない
    let defaultFolderExists = await page.evaluate(() => {
        var meta = JSON.parse(localStorage.getItem('mindmap-meta'));
        return meta.some(m => m.type === 'folder' && m.isDefault === true);
    });
    assert(!defaultFolderExists, 'No default (未分類) folder in meta (removed from spec)');

    // DOM にも default-folder 要素が無い
    let defaultFolderInDom = await page.evaluate(() => {
        return document.querySelector('.map-item.default-folder') !== null;
    });
    assert(!defaultFolderInDom, 'No default-folder element in sidebar DOM');

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
    // Test 20: Delete Folder（現行仕様: 中のページもまとめて削除される）
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

    // 現行仕様: フォルダ削除時は中のページも削除される（未分類への移動は廃止）
    if (pagesInFolder.length > 0) {
        let childrenDeleted = await page.evaluate((pageIds) => {
            var meta = JSON.parse(localStorage.getItem('mindmap-meta'));
            return pageIds.every(pid => !meta.some(m => m.id === pid));
        }, pagesInFolder);
        assert(childrenDeleted, 'Children deleted together with folder (current spec)');
    } else {
        assert(true, 'No children to delete (skipped)');
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

    // キャンバスの空き領域を実クリックしてサイドバーのナビゲーションモードを解除する。
    // （ノードクリックでも解除される。Test 27 が回帰テスト）
    await page.mouse.click(700, 80);
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

    // 前のテストで残ったリネーム入力等のフォーカスを外す
    // （フォーカスが残っているとキー入力がキャンバスに届かない）
    await page.evaluate(() => { var a = document.activeElement; if (a && a.blur) a.blur(); });
    await page.waitForTimeout(150);

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
    // Test 27: ノードクリックでサイドバーのナビゲーションモードが解除される
    // （回帰テスト: 以前はノード上の mousedown が stopPropagation され解除されなかった）
    // ========================================
    console.log('\n=== Test 27: Node click exits sidebar navigation mode ===');

    // サイドバーのマップ項目を実クリック → ナビゲーションモード ON
    await page.locator('.map-item.page-item').first().click();
    await page.waitForTimeout(300);
    let navModeOn = await page.evaluate(() => window.sidebarNavigationMode);
    assert(navModeOn === true, 'Clicking a sidebar item enters navigation mode');

    // キャンバスのノードを実クリック → ナビゲーションモード OFF になること
    await page.locator('.node').first().click();
    await page.waitForTimeout(300);
    let navModeOff = await page.evaluate(() => window.sidebarNavigationMode);
    assert(navModeOff === false, 'Clicking a canvas node exits navigation mode');

    // ========================================
    // Test 31: マイマップ選択後の矢印キー操作（Finder風）
    // （回帰テスト: 以前は switchToMap がナビゲーションモードを解除してしまい、
    //   別マップをクリックした直後や↑↓移動の1回目以降で矢印キーが効かなくなっていた）
    // ========================================
    console.log('\n=== Test 31: Sidebar arrow-key navigation (Finder-like) ===');

    // 現在のマップと「違う」ページをクリックする（switchToMap が実行されるケースを踏む）
    const otherPageId = await page.evaluate(() => {
        var cur = String(window.getCurrentMapId());
        var items = document.querySelectorAll('#mapList .map-item.page-item');
        for (var i = 0; i < items.length; i++) {
            if (String(items[i].dataset.mapId) !== cur) {
                items[i].click();
                return String(items[i].dataset.mapId);
            }
        }
        return null;
    });
    await page.waitForTimeout(500);
    assert(otherPageId !== null, 'A non-active page exists to click (precondition)');

    let navAfterSwitch = await page.evaluate(() => ({
        mode: window.sidebarNavigationMode,
        mapId: String(window.getCurrentMapId())
    }));
    assert(navAfterSwitch.mapId === otherPageId, 'Clicking another page switches to it');
    assert(navAfterSwitch.mode === true, 'Navigation mode stays ON after switching maps');

    // ↓ で次のアイテムへ、↑ で戻る（選択表示 sidebar-selected が移動する）
    const neighborInfo = await page.evaluate((clickedId) => {
        var items = Array.from(document.querySelectorAll('#mapList .map-item'));
        var idx = items.findIndex(el => String(el.dataset.mapId) === clickedId);
        var next = (idx !== -1 && idx + 1 < items.length) ? items[idx + 1] : null;
        return next ? { id: String(next.dataset.mapId), isPage: next.classList.contains('page-item') } : null;
    }, otherPageId);

    if (neighborInfo) {
        await page.keyboard.press('ArrowDown');
        await page.waitForTimeout(400);
        let afterDown = await page.evaluate(() => {
            var sel = document.querySelector('#mapList .map-item.sidebar-selected');
            return {
                mode: window.sidebarNavigationMode,
                selected: sel ? String(sel.dataset.mapId) : null,
                mapId: String(window.getCurrentMapId())
            };
        });
        assert(afterDown.selected === neighborInfo.id, 'ArrowDown moves sidebar selection to next item');
        assert(afterDown.mode === true, 'Navigation mode stays ON after ArrowDown');
        if (neighborInfo.isPage) {
            assert(afterDown.mapId === neighborInfo.id, 'ArrowDown onto a page switches the map');
        }

        await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(400);
        let afterUp = await page.evaluate(() => {
            var sel = document.querySelector('#mapList .map-item.sidebar-selected');
            return {
                selected: sel ? String(sel.dataset.mapId) : null,
                mode: window.sidebarNavigationMode
            };
        });
        assert(afterUp.selected === otherPageId, 'ArrowUp moves sidebar selection back');
        assert(afterUp.mode === true, 'Navigation mode stays ON after ArrowUp');
    } else {
        assert(true, 'No neighbor item below (skipped ArrowDown/Up check)');
    }

    // フォルダの ←（閉じる）／→（開く）
    const folderId31 = await page.evaluate(() => {
        var f = document.querySelector('#mapList .map-item.folder-item');
        return f ? String(f.dataset.mapId) : null;
    });
    if (folderId31) {
        function getFolderCollapsed(id) {
            return page.evaluate((fid) => {
                try {
                    var cs = JSON.parse(localStorage.getItem('mindmap-collapse-state') || '{}');
                    return cs[fid] === true || cs[String(fid)] === true;
                } catch (e) { return false; }
            }, id);
        }
        function clickFolder(id) {
            return page.evaluate((fid) => {
                var f = document.querySelector('#mapList .map-item.folder-item[data-map-id="' + fid + '"]');
                if (f) f.click();
            }, id);
        }
        // フォルダをクリックして選択（クリックは開閉もトグルする仕様）。展開状態に揃える
        await clickFolder(folderId31);
        await page.waitForTimeout(300);
        if (await getFolderCollapsed(folderId31)) {
            await clickFolder(folderId31);
            await page.waitForTimeout(300);
        }

        await page.keyboard.press('ArrowLeft'); // 展開中に ← → 折りたたむ
        await page.waitForTimeout(300);
        assert((await getFolderCollapsed(folderId31)) === true, 'ArrowLeft collapses the selected folder');

        await page.keyboard.press('ArrowRight'); // 折りたたみ中に → → 展開
        await page.waitForTimeout(300);
        assert((await getFolderCollapsed(folderId31)) === false, 'ArrowRight expands the selected folder');

        // Finder同様、展開済みフォルダで → を押しても移動せずフォルダに留まる
        await page.keyboard.press('ArrowRight');
        await page.waitForTimeout(300);
        let stayInfo = await page.evaluate((fid) => {
            var sel = document.querySelector('#mapList .map-item.sidebar-selected');
            return {
                selected: sel ? String(sel.dataset.mapId) : null,
                collapsed: (function() {
                    try {
                        var cs = JSON.parse(localStorage.getItem('mindmap-collapse-state') || '{}');
                        return cs[fid] === true;
                    } catch (e) { return false; }
                })(fid)
            };
        }, folderId31);
        assert(stayInfo.selected === folderId31 && stayInfo.collapsed === false,
            'ArrowRight on an expanded folder stays on the folder (Finder-like)');
    } else {
        assert(true, 'No folder present (skipped folder open/close check)');
    }

    // キャンバスのノードをクリックすればモード解除→ノード操作に戻る（Test 27 と同じ経路の最終確認）
    await page.locator('.node').first().click();
    await page.waitForTimeout(300);
    let navModeFinal = await page.evaluate(() => window.sidebarNavigationMode);
    assert(navModeFinal === false, 'Clicking a canvas node returns arrow keys to node operations');

    // ========================================
    // Test 32: ★ページ（お気に入り登録ページ）を跨ぐ↑↓移動でお気に入り欄へ飛ばない
    // （回帰テスト: ★ページは一覧に2箇所表示されるため、ID検索がDOM先頭の
    //   お気に入り欄コピーにヒットし、次の移動でお気に入り欄へジャンプしていた）
    // ========================================
    console.log('\n=== Test 32: Starred page does not hijack arrow navigation ===');

    // 「直前がページで、直後にも項目がある」通常欄のページを1つ選んでお気に入り登録する
    const starTarget = await page.evaluate(() => {
        var items = Array.from(document.querySelectorAll('#mapList .map-item'));
        for (var i = 1; i < items.length - 1; i++) {
            var cur = items[i], prev = items[i - 1];
            if (cur.classList.contains('page-item') && cur.dataset.inFav !== 'true' &&
                prev.classList.contains('page-item') && prev.dataset.inFav !== 'true') {
                // お気に入り登録（メタを直接更新して再描画）
                var id = String(cur.dataset.mapId);
                var list = window.getMetaList();
                for (var m = 0; m < list.length; m++) {
                    if (String(list[m].id) === id) { list[m].starred = true; list[m].starOrder = 999; }
                }
                localStorage.setItem('mindmap-meta', JSON.stringify(list));
                window.renderMapList();
                return { id: id, prevId: String(prev.dataset.mapId) };
            }
        }
        return null;
    });
    await page.waitForTimeout(400);

    if (starTarget) {
        // 星付けにより一覧が [お気に入り欄: X ... / 通常欄: ... prev, X, next ...] になったことを確認し、
        // 通常欄の X の次の項目（期待される移動先）を控える
        const expected = await page.evaluate((t) => {
            var items = Array.from(document.querySelectorAll('#mapList .map-item'));
            var copies = items.filter(el => String(el.dataset.mapId) === t.id);
            var privIdx = items.findIndex(el => String(el.dataset.mapId) === t.id && el.dataset.inFav !== 'true');
            return {
                copyCount: copies.length,
                nextId: (privIdx !== -1 && privIdx + 1 < items.length) ? String(items[privIdx + 1].dataset.mapId) : null
            };
        }, starTarget);
        assert(expected.copyCount === 2, 'Starred page appears twice in the list (precondition)');

        // 通常欄で ★ページの1つ上のページをクリック → ↓で★ページに乗る → さらに↓
        await page.evaluate((t) => {
            var items = Array.from(document.querySelectorAll('#mapList .map-item'));
            var el = items.find(it => String(it.dataset.mapId) === t.prevId && it.dataset.inFav !== 'true');
            if (el) el.click();
        }, starTarget);
        await page.waitForTimeout(500);

        await page.keyboard.press('ArrowDown'); // ★ページ（通常欄側）へ
        await page.waitForTimeout(400);
        let onStarred = await page.evaluate(() => {
            var sel = document.querySelector('#mapList .map-item.sidebar-selected');
            return sel ? String(sel.dataset.mapId) : null;
        });
        assert(onStarred === starTarget.id, 'ArrowDown moves onto the starred page');

        if (expected.nextId && expected.nextId !== starTarget.id) {
            await page.keyboard.press('ArrowDown'); // ★ページの次へ（お気に入り欄へ飛ばないこと）
            await page.waitForTimeout(400);
            let afterStarred = await page.evaluate(() => {
                var sel = document.querySelector('#mapList .map-item.sidebar-selected');
                return sel ? String(sel.dataset.mapId) : null;
            });
            assert(afterStarred === expected.nextId,
                'ArrowDown from the starred page continues in the main list (no jump to favorites): ' + afterStarred + ' === ' + expected.nextId);
        } else {
            assert(true, 'No distinct next item below starred page (skipped continuation check)');
        }

        // 後始末: お気に入り解除
        await page.evaluate((t) => {
            var list = window.getMetaList();
            for (var m = 0; m < list.length; m++) {
                if (String(list[m].id) === t.id) { list[m].starred = false; delete list[m].starOrder; }
            }
            localStorage.setItem('mindmap-meta', JSON.stringify(list));
            window.renderMapList();
        }, starTarget);
        await page.waitForTimeout(300);
    } else {
        assert(true, 'No suitable page pair found (skipped starred-page navigation check)');
    }

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
