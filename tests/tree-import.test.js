const { chromium } = require('playwright');
const { BASE_URL } = require('./helpers');

// 罫線なしモードのツリーをテキスト編集 → 取り込み（インポート）するステップ2の検証
(async () => {
    const browser = await chromium.launch();
    const context = await browser.newContext();
    const page = await context.newPage();
    // confirm ダイアログは常にOKで応答（取り込み実行）
    page.on('dialog', async (d) => { await d.accept(); });
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

    // テスト用ツリーを用意
    console.log('\n=== Building test tree ===');
    await page.evaluate(() => {
        var mapId = window.getCurrentMapId();
        var d = window.getMindMapData();
        d.root.text = '中心テーマ';
        d.root.children = [
            { id: 'pa', text: 'ParentA', children: [
                { id: 'ca1', text: 'ChildA1', children: [] }
            ]}
        ];
        localStorage.setItem('mindmap-data-' + mapId, JSON.stringify(d));
    });
    await page.reload();
    await page.waitForSelector('.node', { state: 'attached', timeout: 10000 });
    await page.waitForTimeout(800);
    await page.keyboard.press('Escape');

    // ========================================
    // 解析・検証ロジック（parseTabIndentedText）
    // ========================================
    console.log('\n=== Parse & validate (unit) ===');

    // 正常系：タブ区切り → ツリー
    const okResult = await page.evaluate(() => {
        return window.parseTabIndentedText('中心テーマ\n\tA\n\t\tA-1\n\tB');
    });
    assert(okResult.ok === true, 'Valid tab text parses OK');
    assert(okResult.tree && okResult.tree.text === '中心テーマ', 'Root text correct');
    assert(okResult.tree.children.length === 2, 'Root has 2 children (A, B)');
    assert(okResult.tree.children[0].children.length === 1
        && okResult.tree.children[0].children[0].text === 'A-1', 'A has child A-1');
    assert(okResult.tree.id === 'root', 'Root keeps id "root"');

    // 空行はスキップされる
    const blankResult = await page.evaluate(() => {
        return window.parseTabIndentedText('中心テーマ\n\n\tA\n\n');
    });
    assert(blankResult.ok === true && blankResult.tree.children.length === 1, 'Blank lines skipped');

    // 半角スペースのインデントはエラー
    const spaceResult = await page.evaluate(() => {
        return window.parseTabIndentedText('中心テーマ\n  A');
    });
    assert(spaceResult.ok === false, 'Space indent is rejected');
    assert(spaceResult.errors.some(e => e.includes('半角スペース')), 'Error mentions 半角スペース');

    // 階層飛びはエラー
    const skipResult = await page.evaluate(() => {
        return window.parseTabIndentedText('中心テーマ\n\t\tいきなり第3階層');
    });
    assert(skipResult.ok === false && skipResult.errors.some(e => e.includes('階層')), 'Level skip is rejected');

    // 先頭行インデントはエラー
    const headResult = await page.evaluate(() => {
        return window.parseTabIndentedText('\t先頭からインデント');
    });
    assert(headResult.ok === false && headResult.errors.some(e => e.includes('先頭')), 'Leading-indent first line rejected');

    // 最上位が複数はエラー
    const multiRootResult = await page.evaluate(() => {
        return window.parseTabIndentedText('ルート1\nルート2');
    });
    assert(multiRootResult.ok === false && multiRootResult.errors.some(e => e.includes('最上位')), 'Multiple roots rejected');

    // 空はエラー
    const emptyResult = await page.evaluate(() => {
        return window.parseTabIndentedText('   \n\n');
    });
    assert(emptyResult.ok === false, 'Empty input rejected');

    // ========================================
    // UI：[編集]ボタンは罫線あり/なしに関係なく常に表示
    // ========================================
    console.log('\n=== Edit button is always visible ===');
    // サイドバーを開く
    await page.evaluate(() => window.openRightSidebar());
    await page.waitForTimeout(300);

    // 罫線あり → 編集エリアは表示される
    await page.evaluate(() => {
        document.getElementById('toggleBorderInput').checked = true;
        document.getElementById('toggleBorderInput').dispatchEvent(new Event('change'));
    });
    await page.waitForTimeout(200);
    let editAreaDisplay = await page.$eval('#sidebarEditArea', el => getComputedStyle(el).display);
    assert(editAreaDisplay !== 'none', 'Border mode: edit area still shown');

    // 罫線あり状態でも[編集]を押すと編集モードに入れ、初期値はタブ区切り（罫線記号は混ざらない）
    await page.click('#treeEditBtn');
    await page.waitForTimeout(200);
    let borderSeed = await page.$eval('#sidebarTreeEditor', el => el.value);
    assert(borderSeed.includes('\tParentA') && !/[├└│─]/.test(borderSeed),
        'Border mode: editor seeded with tab text (no border glyphs): ' + JSON.stringify(borderSeed));
    // 編集を抜けると罫線ありの表示に戻る（ツリーに罫線記号が出る）
    await page.click('#treeCancelBtn');
    await page.waitForTimeout(200);
    let treeText = await page.$eval('#sidebarTree', el => el.textContent);
    assert(/[├└]/.test(treeText), 'After exit, returns to bordered tree view');

    // 罫線なしに切り替え → 編集エリアは引き続き表示
    await page.evaluate(() => {
        document.getElementById('toggleBorderInput').checked = false;
        document.getElementById('toggleBorderInput').dispatchEvent(new Event('change'));
    });
    await page.waitForTimeout(200);
    editAreaDisplay = await page.$eval('#sidebarEditArea', el => getComputedStyle(el).display);
    assert(editAreaDisplay !== 'none', 'No-border mode: edit area shown');
    const editBtnVisible = await page.$eval('#treeEditBtn', el => getComputedStyle(el).display !== 'none');
    assert(editBtnVisible, 'No-border mode: [編集] button visible');

    // ========================================
    // UI：[編集] → テキスト欄に現在のツリーが入る
    // ========================================
    console.log('\n=== Enter edit mode ===');
    await page.click('#treeEditBtn');
    await page.waitForTimeout(200);
    const editorVisible = await page.$eval('#sidebarTreeEditor', el => el.offsetParent !== null);
    assert(editorVisible, 'Editor textarea visible after [編集]');
    const editorValue = await page.$eval('#sidebarTreeEditor', el => el.value);
    assert(editorValue.includes('中心テーマ') && editorValue.includes('\tParentA'), 'Editor seeded with current tree (tab-indented)');
    const importBtnVisible = await page.$eval('#treeImportBtn', el => getComputedStyle(el).display !== 'none');
    assert(importBtnVisible, '[取り込み] button visible in edit mode');

    // ========================================
    // 修正2：編集欄で実際に入力・削除できる（アプリのショートカットに奪われない）
    // ========================================
    console.log('\n=== Editor accepts typing & deletion ===');
    // 編集欄を空にしてフォーカス、キーボードから入力
    await page.evaluate(() => {
        var ed = document.getElementById('sidebarTreeEditor');
        ed.value = '';
        ed.focus();
    });
    await page.keyboard.type('ABC');
    let typed = await page.$eval('#sidebarTreeEditor', el => el.value);
    assert(typed === 'ABC', 'Typing inserts characters into editor: ' + JSON.stringify(typed));
    // Backspace が「ノード削除」ではなく文字削除として効く
    await page.keyboard.press('Backspace');
    typed = await page.$eval('#sidebarTreeEditor', el => el.value);
    assert(typed === 'AB', 'Backspace deletes a character in editor: ' + JSON.stringify(typed));
    // 入力中にキャンバスのノードが削除されていない（Backspaceが奪われていない証拠）
    const canvasIntact = await page.evaluate(() => {
        const all = []; function walk(n){ all.push(n.text); n.children.forEach(walk); }
        walk(window.getMindMapData().root); return all.includes('ParentA');
    });
    assert(canvasIntact, 'Canvas nodes intact while typing in editor');

    // ヘルパー：編集欄に値とカーソル位置をセットする
    const setEditor = (value, pos, posEnd) => page.evaluate(({ value, pos, posEnd }) => {
        var ed = document.getElementById('sidebarTreeEditor');
        ed.value = value;
        ed.focus();
        ed.selectionStart = (pos == null ? value.length : pos);
        ed.selectionEnd = (posEnd == null ? ed.selectionStart : posEnd);
        ed.dispatchEvent(new Event('input'));
    }, { value, pos, posEnd });
    const getEditor = () => page.$eval('#sidebarTreeEditor', el => el.value);

    // Tab：現在行の行頭にタブを追加（カーソル位置に関係なく行頭、フォーカスは外れない）
    console.log('\n=== Tab indents the line head ===');
    const isMac = process.platform === 'darwin';
    await setEditor('親', 1);
    await page.keyboard.press('Tab');
    let tabbed = await getEditor();
    assert(tabbed === '\t親', 'Tab adds a tab at line head: ' + JSON.stringify(tabbed));
    const stillFocused = await page.evaluate(() => document.activeElement && document.activeElement.id === 'sidebarTreeEditor');
    assert(stillFocused, 'Focus stays in editor after Tab');

    // Shift+Tab：行頭のタブを1つ減らす。タブが無ければ変化なし
    console.log('\n=== Shift+Tab outdents ===');
    await setEditor('\t\t子', 3);
    await page.keyboard.press('Shift+Tab');
    let outdented = await getEditor();
    assert(outdented === '\t子', 'Shift+Tab removes one leading tab: ' + JSON.stringify(outdented));
    await setEditor('子', 1);
    await page.keyboard.press('Shift+Tab');
    assert((await getEditor()) === '子', 'Shift+Tab with no tab does nothing');

    // Enter：今の行と同じタブ数で改行（同じ階層を維持）
    console.log('\n=== Enter keeps same depth ===');
    await setEditor('\t\t親', 3);
    await page.keyboard.press('Enter');
    await page.keyboard.type('子');
    let entered = await getEditor();
    assert(entered === '\t\t親\n\t\t子', 'Enter keeps same indentation: ' + JSON.stringify(entered));

    // Undo/Redo：Tab後に取り消し→やり直しが効く（execCommandでの編集なので履歴が残る）
    console.log('\n=== Undo / Redo work in editor ===');
    await setEditor('親', 1);
    await page.keyboard.press('Tab');
    assert((await getEditor()) === '\t親', 'Tab applied before undo');
    await page.keyboard.press(isMac ? 'Meta+z' : 'Control+z');
    assert((await getEditor()) === '親', 'Undo restores text');
    await page.keyboard.press(isMac ? 'Meta+Shift+z' : 'Control+y');
    assert((await getEditor()) === '\t親', 'Redo re-applies text');

    // 複数行をまとめてインデント／アンインデント
    console.log('\n=== Multi-line indent / outdent ===');
    await setEditor('A\nB\nC', 0, 5); // 全行を選択（0〜末尾）
    await page.keyboard.press('Tab');
    assert((await getEditor()) === '\tA\n\tB\n\tC', 'Multi-line Tab indents all lines');
    await page.keyboard.press('Shift+Tab');
    assert((await getEditor()) === 'A\nB\nC', 'Multi-line Shift+Tab outdents all lines');

    // 行の上下移動（Option+↑ / ↓）
    console.log('\n=== Move line up / down ===');
    await setEditor('1行目\n2行目\n3行目', 8); // カーソルは2行目内（"2行目"は index 4-7, 8は3行目頭手前）
    // 2行目にカーソルを置く（"2行目"の途中）
    await setEditor('1行目\n2行目\n3行目', 5);
    await page.keyboard.press(isMac ? 'Alt+ArrowUp' : 'Alt+ArrowUp');
    assert((await getEditor()) === '2行目\n1行目\n3行目', 'Option+Up moves line up: ' + JSON.stringify(await getEditor()));
    await page.keyboard.press('Alt+ArrowDown');
    assert((await getEditor()) === '1行目\n2行目\n3行目', 'Option+Down moves line back down');

    // 行の複製（Cmd+D）
    console.log('\n=== Duplicate line (Cmd+D) ===');
    await setEditor('\t枝', 2);
    await page.keyboard.press(isMac ? 'Meta+d' : 'Control+d');
    assert((await getEditor()) === '\t枝\n\t枝', 'Cmd/Ctrl+D duplicates the line with same indent: ' + JSON.stringify(await getEditor()));

    // スペース混入のリアルタイム警告（行頭スペースの行にマーカー）
    console.log('\n=== Leading-space warning markers ===');
    await setEditor('親\n  スペース子\n\tタブ子', 0);
    const warnCount = await page.$eval('#sidebarEditorHighlights', el => el.children.length);
    assert(warnCount === 1, 'One warning marker for the space-indented line: ' + warnCount);
    await setEditor('親\n\tタブ子', 0);
    const warnCount2 = await page.$eval('#sidebarEditorHighlights', el => el.children.length);
    assert(warnCount2 === 0, 'No warning markers when only tabs are used');

    // IME（日本語変換）中の Enter は改行しない（変換確定を改行と誤認しない）
    console.log('\n=== Enter during IME composition is ignored ===');
    await page.evaluate(() => {
        var ed = document.getElementById('sidebarTreeEditor');
        ed.value = '日本';
        ed.focus();
        ed.selectionStart = ed.selectionEnd = ed.value.length;
        // isComposing:true の Enter keydown を発火（IME変換確定の状況を再現）
        ed.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true }));
    });
    assert((await getEditor()) === '日本', 'IME Enter does not insert a newline: ' + JSON.stringify(await getEditor()));

    // 左ガター：文字のある行だけ「行番号(1始まり)」を表示。番号の横に記号は付けない
    console.log('\n=== Line-number gutter (1-based, no hyphens) ===');
    await setEditor('親\n\t子\n\n\t\t孫', 0);
    const gutterRows = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('#sidebarEditorGutter .ge-row')).map(r => ({
            num: r.querySelector('.ge-num').textContent,
            hasDash: !!r.querySelector('.ge-dash'),
            text: r.textContent
        }));
    });
    // 行: 0='親', 1='\t子', 2=''(空→番号なし), 3='\t\t孫'
    assert(gutterRows.length === 3, 'Gutter shows numbers only for non-empty lines: ' + gutterRows.length);
    assert(gutterRows[0].num === '1', 'First content line is numbered 1 (1-based)');
    assert(gutterRows[1].num === '2', 'Second content line is numbered 2');
    assert(gutterRows[2].num === '4', 'Line after a blank is numbered 4 (blank counted, not shown)');
    assert(gutterRows.every(r => !r.hasDash), 'No hyphen element next to line numbers');
    assert(gutterRows.every(r => !/[-]/.test(r.text)), 'No hyphen characters in gutter');

    // 裏層の飾り：タブガイドと改行マークが本文と別レイヤーに描かれる
    console.log('\n=== Backdrop tab guides & newline marks ===');
    await setEditor('親\n\t子\n\t\t孫', 0);
    const deco = await page.evaluate(() => {
        return {
            tabGuides: document.querySelectorAll('#sidebarEditorBackdrop .be-tab').length,
            nlMarks: document.querySelectorAll('#sidebarEditorBackdrop .be-nl').length,
            lines: document.querySelectorAll('#sidebarEditorBackdrop .be-line').length
        };
    });
    assert(deco.tabGuides === 3, 'Tab guides: one per tab char (1+2=3): ' + deco.tabGuides);
    assert(deco.nlMarks === 2, 'Newline marks: one per line break (3 lines → 2): ' + deco.nlMarks);
    assert(deco.lines === 3, 'Backdrop renders 3 line blocks');

    // 飾りは表示専用：本文（コピー/取り込みに使う値）に装飾が混ざらない
    console.log('\n=== Decorations do not leak into the text value ===');
    const rawValue = await getEditor();
    assert(rawValue === '親\n\t子\n\t\t孫', 'Editor value stays plain tab text (no ↵, no numbers): ' + JSON.stringify(rawValue));
    const copyText = await page.evaluate(() => window.parseTabIndentedText(document.getElementById('sidebarTreeEditor').value));
    assert(copyText.ok === true && copyText.tree.children[0].children[0].text === '孫', 'Plain text still parses correctly for import');

    // ========================================
    // 修正1：[編集]ボタンが設定エリア（区切り線の下）ではなくツリーナビ側にある
    // ========================================
    console.log('\n=== Edit button placement ===');
    const placement = await page.evaluate(() => {
        const editArea = document.getElementById('sidebarEditArea');
        const bottomPanel = document.querySelector('.sidebar-bottom-panel');
        const separator = document.querySelector('.sidebar-bottom-separator');
        return {
            insideBottomPanel: bottomPanel.contains(editArea),
            // 編集エリアの下端が区切り線の上端より上にある（＝ツリーナビ側）
            aboveSeparator: editArea.getBoundingClientRect().bottom <= separator.getBoundingClientRect().top + 1
        };
    });
    assert(placement.insideBottomPanel === false, 'Edit area is NOT inside the settings (bottom) panel');
    assert(placement.aboveSeparator, 'Edit area sits above the separator (tree-nav side)');

    // 後続テストに影響しないよう編集モードを抜けておく
    await page.click('#treeCancelBtn');
    await page.waitForTimeout(150);
    await page.click('#treeEditBtn');
    await page.waitForTimeout(150);

    // ========================================
    // UI：不正入力で取り込めず、エラー表示が出る（反映されない）
    // ========================================
    console.log('\n=== Import rejects invalid input ===');
    await page.evaluate(() => {
        document.getElementById('sidebarTreeEditor').value = '中心テーマ\n  スペースインデント';
    });
    await page.click('#treeImportBtn');
    await page.waitForTimeout(200);
    const errorShown = await page.$eval('#sidebarEditError', el => getComputedStyle(el).display !== 'none' && el.textContent.includes('取り込めません'));
    assert(errorShown, 'Invalid input shows error and does not import');
    // キャンバスは元のまま（ParentAが残っている）
    let nodeTexts = await page.evaluate(() => {
        const all = []; function walk(n){ all.push(n.text); n.children.forEach(walk); }
        walk(window.getMindMapData().root); return all;
    });
    assert(nodeTexts.includes('ParentA'), 'Canvas unchanged after invalid import');

    // ========================================
    // UI：正しい入力で取り込み → キャンバスに反映 → Undoで戻る
    // ========================================
    console.log('\n=== Import applies & Undo restores ===');
    await page.evaluate(() => {
        document.getElementById('sidebarTreeEditor').value = '新ルート\n\t枝1\n\t\t葉1\n\t枝2';
    });
    await page.click('#treeImportBtn');
    await page.waitForTimeout(400);
    nodeTexts = await page.evaluate(() => {
        const all = []; function walk(n){ all.push(n.text); n.children.forEach(walk); }
        walk(window.getMindMapData().root); return all;
    });
    assert(nodeTexts.join(',') === '新ルート,枝1,葉1,枝2', 'Imported tree reflected on canvas: ' + nodeTexts.join(','));
    // 編集モードは終了している
    const editorHidden = await page.$eval('#sidebarTreeEditor', el => el.offsetParent === null);
    assert(editorHidden, 'Edit mode exited after import');

    // Undo で元のツリーに戻る
    await page.evaluate(() => window.undo());
    await page.waitForTimeout(300);
    nodeTexts = await page.evaluate(() => {
        const all = []; function walk(n){ all.push(n.text); n.children.forEach(walk); }
        walk(window.getMindMapData().root); return all;
    });
    assert(nodeTexts.includes('ParentA') && !nodeTexts.includes('新ルート'), 'Undo restores previous tree');

    // ========================================
    // UI：キャンセルで編集をやめられる
    // ========================================
    console.log('\n=== Cancel edit ===');
    await page.click('#treeEditBtn');
    await page.waitForTimeout(150);
    await page.click('#treeCancelBtn');
    await page.waitForTimeout(150);
    const treeVisibleAfterCancel = await page.$eval('#sidebarTree', el => getComputedStyle(el).display !== 'none');
    assert(treeVisibleAfterCancel, 'Tree view restored after cancel');

    console.log('\n=== Results ===');
    console.log('Passed: ' + passed + ', Failed: ' + failed);
    await browser.close();
    if (failed > 0) process.exit(1);
})();
