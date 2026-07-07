import {
    isNodeCollapsed,
    isNodeGrayedOut,
    levelIcons,
    mindMapData,
    selectedNodeIds,
    viewState
} from './state.js';
import { selectNode } from './selection.js';
import { updateView } from './render.js';
import { getTreeTabText } from './clipboard.js';
import { applyImportedTree, parseTabIndentedText } from './tree-import.js';
import { showToast } from './utils.js';

// ========================================
// Right Sidebar: Resize, Tree Rendering, Focus
// ========================================

var SIDEBAR_OPEN_MIN = 200;
var SIDEBAR_DEFAULT = 260;
var SIDEBAR_KEY = 'mindmap_sidebar_width';
var sidebarIsOpen = false;
var sidebarInitialized = false;
var treeEditMode = false; // ツリーをテキスト編集中かどうか

export function initSidebar() {
    if (sidebarInitialized) return;
    sidebarInitialized = true;
    var sidebar = document.getElementById('sidebar');
    var handle = document.getElementById('sidebarResizeHandle');
    var floatToggle = document.getElementById('sidebarFloatToggle');
    var closeBtn = document.getElementById('sidebarCloseBtn');

    // Start collapsed
    sidebar.classList.add('collapsed');
    sidebar.style.width = SIDEBAR_DEFAULT + 'px';
    sidebarIsOpen = false;
    updateSidebarFloatToggle();

    // Floating 🌲 button opens the sidebar
    if (floatToggle) {
        floatToggle.addEventListener('click', function(e) {
            e.stopPropagation();
            openRightSidebar();
        });
    }

    // Close button inside sidebar header
    if (closeBtn) {
        closeBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            closeRightSidebar();
        });
    }

    // Resize handle
    var dragging = false;
    handle.addEventListener('mousedown', function(e) {
        e.preventDefault();
        dragging = true;
        handle.classList.add('dragging');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
    });
    document.addEventListener('mousemove', function(e) {
        if (!dragging) return;
        var w = window.innerWidth - e.clientX;
        if (w < SIDEBAR_OPEN_MIN) {
            w = SIDEBAR_OPEN_MIN;
        } else if (w > window.innerWidth * 0.6) {
            w = Math.floor(window.innerWidth * 0.6);
        }
        sidebar.style.width = w + 'px';
        adjustCanvasForSidebars();
    });
    document.addEventListener('mouseup', function() {
        if (!dragging) return;
        dragging = false;
        handle.classList.remove('dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        var currentW = parseInt(sidebar.style.width, 10) || SIDEBAR_DEFAULT;
        try { localStorage.setItem(SIDEBAR_KEY, currentW); } catch(e) {}
        renderSidebarTree();
    });

    // 編集／取り込み／キャンセルボタン
    var editBtn = document.getElementById('treeEditBtn');
    var importBtn = document.getElementById('treeImportBtn');
    var cancelBtn = document.getElementById('treeCancelBtn');
    if (editBtn) editBtn.addEventListener('click', enterTreeEditMode);
    if (importBtn) importBtn.addEventListener('click', importTreeFromEditor);
    if (cancelBtn) cancelBtn.addEventListener('click', exitTreeEditMode);

    // 編集欄のキー操作（Enter/Tab/Shift+Tab/Option+矢印/Cmd+D）をアウトライナー風に処理
    var editor = document.getElementById('sidebarTreeEditor');
    if (editor) {
        editor.addEventListener('keydown', handleEditorKeydown);
        // 入力時は飾り（行番号・タブガイド・改行マーク・警告）を作り直す
        editor.addEventListener('input', updateEditorDecorations);
        // スクロール時は位置合わせだけ（作り直しは不要で軽い）
        editor.addEventListener('scroll', applyEditorScroll);
    }
}

export function openRightSidebar() {
    var sidebar = document.getElementById('sidebar');
    var savedW = parseInt(localStorage.getItem(SIDEBAR_KEY), 10);
    var w = (savedW && savedW >= SIDEBAR_OPEN_MIN) ? savedW : SIDEBAR_DEFAULT;
    sidebar.style.width = w + 'px';
    sidebar.classList.remove('collapsed');
    sidebarIsOpen = true;
    updateSidebarFloatToggle();
    adjustCanvasForSidebars();
    renderSidebarTree();
}

export function closeRightSidebar() {
    var sidebar = document.getElementById('sidebar');
    sidebar.classList.add('collapsed');
    sidebarIsOpen = false;
    updateSidebarFloatToggle();
    adjustCanvasForSidebars();
}

function updateSidebarFloatToggle() {
    var floatToggle = document.getElementById('sidebarFloatToggle');
    if (!floatToggle) return;
    if (sidebarIsOpen) {
        floatToggle.classList.add('hidden');
    } else {
        floatToggle.classList.remove('hidden');
    }
    // Shift the floating buttons left when right sidebar is open
    updateFloatBtnsPosition();
}

function updateFloatBtnsPosition() {
    var btnsContainer = document.getElementById('canvasFloatBtns');
    if (!btnsContainer) return;
    var rightSidebar = document.getElementById('sidebar');
    var leftSidebar = document.getElementById('leftSidebar');
    var rightW = (rightSidebar && !rightSidebar.classList.contains('collapsed')) ? rightSidebar.offsetWidth : 0;
    var leftW = (leftSidebar && !leftSidebar.classList.contains('collapsed')) ? leftSidebar.offsetWidth : 0;
    // 表示中のキャンバス領域の中央にツールバーを置く。
    // 横方向は left だけを指定（right は指定しない）。両端を固定するとツールバーの幅が
    // 挟まれて潰れてしまうため、片側だけにして幅を中身ぶんに保つ（アイコンが縮まない）。
    var centerX = leftW + (window.innerWidth - leftW - rightW) / 2;
    btnsContainer.style.right = 'auto';
    btnsContainer.style.left = centerX + 'px';

    // 星ボタンの位置: 右上固定、サイドバー開時はその幅分左にずれる
    var starBtn = document.getElementById('canvasStarBtn');
    if (starBtn) {
        starBtn.style.right = (12 + rightW) + 'px';
    }
}

export function adjustCanvasForSidebars() {
    var rightSidebar = document.getElementById('sidebar');
    var leftSidebar = document.getElementById('leftSidebar');
    var container = document.getElementById('canvasContainer');
    if (container) {
        // Right sidebar: only counts when open (not collapsed)
        var rightW = (rightSidebar && !rightSidebar.classList.contains('collapsed')) ? rightSidebar.offsetWidth : 0;
        // Left sidebar: only counts when open (not collapsed)
        var leftW = (leftSidebar && !leftSidebar.classList.contains('collapsed')) ? leftSidebar.offsetWidth : 0;
        container.style.right = rightW + 'px';
        container.style.left = leftW + 'px';
    }
    // Also shift floating buttons
    updateFloatBtnsPosition();
}

export function renderSidebarTree() {
    var tree = document.getElementById('sidebarTree');
    if (!tree) return;
    var sidebar = document.getElementById('sidebar');
    if (sidebar && sidebar.classList.contains('collapsed')) {
        tree.innerHTML = '';
        return;
    }
    // 編集モード中はツリー表示を描き替えず、テキスト欄の内容を保持する
    if (treeEditMode) {
        updateEditAreaVisibility();
        return;
    }
    updateEditAreaVisibility();

    var format = document.getElementById('copyFormat').value;
    var border = document.getElementById('copyBorder').value;
    var useBorder = (border === 'border');
    var lines = [];
    generatePreviewLines(mindMapData.root, 0, [], format, useBorder, lines);

    var displayLines = [];
    for (var i = 0; i < lines.length; i++) {
        if (!lines[i].isSep) displayLines.push(lines[i]);
    }

    var html = '<pre class="sidebar-preview">';
    for (i = 0; i < displayLines.length; i++) {
        var line = displayLines[i];
        var isSelected = selectedNodeIds.has(line.nodeId);
        var cls = 'sidebar-preview-line' + (isSelected ? ' active' : '');
        var escaped = line.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        html += '<span class="' + cls + '" data-sid="' + line.nodeId + '">' + escaped + '</span>';
    }
    html += '</pre>';
    tree.innerHTML = html;

    tree.querySelectorAll('.sidebar-preview-line').forEach(function(el) {
        el.addEventListener('click', function() {
            var nid = el.getAttribute('data-sid');
            if (nid) focusNodeFromSidebar(nid);
        });
    });

    var activeEl = tree.querySelector('.sidebar-preview-line.active');
    if (activeEl) {
        activeEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
}

// ========================================
// ツリーのテキスト編集 → 取り込み（インポート）
// ========================================

// 編集エリア（[編集]ボタン）の表示。罫線の有無に関係なく常に表示する
// ただし閲覧専用モード（共有URL）ではマップを編集できないため表示しない
function updateEditAreaVisibility() {
    var area = document.getElementById('sidebarEditArea');
    if (!area) return;
    area.style.display = window._isReadOnly ? 'none' : 'flex';
}

// 編集／取り込み／キャンセルの各ボタンの出し分け
function updateEditButtons() {
    var editBtn = document.getElementById('treeEditBtn');
    var importBtn = document.getElementById('treeImportBtn');
    var cancelBtn = document.getElementById('treeCancelBtn');
    if (editBtn) editBtn.style.display = treeEditMode ? 'none' : '';
    if (importBtn) importBtn.style.display = treeEditMode ? '' : 'none';
    if (cancelBtn) cancelBtn.style.display = treeEditMode ? '' : 'none';
}

// エラーメッセージ表示（reasons が空なら消す）
function showImportError(reasons) {
    var box = document.getElementById('sidebarEditError');
    if (!box) return;
    if (!reasons || reasons.length === 0) {
        box.style.display = 'none';
        box.innerHTML = '';
        return;
    }
    var html = '<strong>取り込めません</strong><ul>';
    for (var i = 0; i < reasons.length; i++) {
        var safe = String(reasons[i]).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        html += '<li>' + safe + '</li>';
    }
    html += '</ul>';
    box.innerHTML = html;
    box.style.display = 'block';
}

// 範囲[from,to]を text に置き換える。execCommandを使うことでブラウザのUndo/Redo履歴を保つ。
function editorReplace(ed, from, to, text) {
    ed.focus();
    ed.setSelectionRange(from, to);
    var ok;
    try { ok = document.execCommand('insertText', false, text); } catch (e) { ok = false; }
    if (!ok) {
        // 古いブラウザ向けフォールバック（Undo履歴は保てないが動作はする）
        ed.setRangeText(text, from, to, 'end');
    }
}

// 選択範囲がまたぐ「行の範囲」（先頭行の行頭〜末尾行の行末）を求める
function currentLineRange(value, selStart, selEnd) {
    var first = value.lastIndexOf('\n', selStart - 1) + 1;
    // 選択末尾がちょうど行頭（直前が改行）の場合、余計な次行を含めない
    var endForBounds = (selEnd > selStart && value.charAt(selEnd - 1) === '\n') ? selEnd - 1 : selEnd;
    var last = value.indexOf('\n', endForBounds);
    if (last === -1) last = value.length;
    return { first: first, last: last };
}

// 編集欄のキー操作をアウトライナー風に処理する
function handleEditorKeydown(e) {
    // 日本語入力（IME）の変換中は何もしない。変換確定のEnterを改行と誤認しないため
    if (e.isComposing || e.keyCode === 229) return;
    var ed = e.target;
    var isMac = /Mac/.test(navigator.platform);
    var cmd = isMac ? e.metaKey : e.ctrlKey;
    var value = ed.value;
    var selStart = ed.selectionStart;
    var selEnd = ed.selectionEnd;

    // Enter：今の行と同じタブ数で改行（同じ階層を維持）
    if (e.key === 'Enter' && !e.shiftKey && !e.altKey && !cmd) {
        e.preventDefault();
        var lr = currentLineRange(value, selStart, selStart);
        var leadTabs = (value.slice(lr.first).match(/^\t*/) || [''])[0];
        editorReplace(ed, selStart, selEnd, '\n' + leadTabs);
        updateEditorDecorations();
        return;
    }

    // Tab / Shift+Tab：行頭インデントの増減（単一行・複数行どちらも）
    if (e.key === 'Tab') {
        e.preventDefault();
        var r = currentLineRange(value, selStart, selEnd);
        var region = value.slice(r.first, r.last);
        var collapsed = (selStart === selEnd);
        var newRegion = region.split('\n').map(function(line) {
            if (e.shiftKey) return line.charAt(0) === '\t' ? line.slice(1) : line;
            return '\t' + line;
        }).join('\n');
        if (newRegion === region) return; // 変化なし（Shift+Tabでタブ無し等）
        editorReplace(ed, r.first, r.last, newRegion);
        if (collapsed) {
            // 先頭行のタブ増減ぶんだけカーソルを動かす（行頭より前へは行かない）
            var newPos = Math.max(r.first, selStart + (e.shiftKey ? -1 : 1));
            ed.setSelectionRange(newPos, newPos);
        } else {
            ed.setSelectionRange(r.first, r.first + newRegion.length);
        }
        updateEditorDecorations();
        return;
    }

    // Option(Alt)+↑ / ↓：行を上下に移動
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault();
        moveEditorLines(ed, e.key === 'ArrowUp' ? -1 : 1);
        updateEditorDecorations();
        return;
    }

    // Cmd/Ctrl+D：現在行（選択行）を同じインデントで真下に複製
    if (cmd && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault();
        var dr = currentLineRange(value, selStart, selEnd);
        var block = value.slice(dr.first, dr.last);
        editorReplace(ed, dr.last, dr.last, '\n' + block);
        updateEditorDecorations();
        return;
    }
}

// 行（選択範囲がまたぐ行ブロック）を上下の行と入れ替える
function moveEditorLines(ed, dir) {
    var value = ed.value;
    var r = currentLineRange(value, ed.selectionStart, ed.selectionEnd);
    var block = value.slice(r.first, r.last);
    if (dir < 0) {
        if (r.first === 0) return; // 上に行が無い
        var prevStart = value.lastIndexOf('\n', r.first - 2) + 1;
        var prevLine = value.slice(prevStart, r.first - 1); // r.first-1 は直前の改行
        editorReplace(ed, prevStart, r.last, block + '\n' + prevLine);
        ed.setSelectionRange(prevStart, prevStart + block.length);
    } else {
        if (r.last >= value.length) return; // 下に行が無い
        var nextStart = r.last + 1; // r.last は改行位置
        var nextEnd = value.indexOf('\n', nextStart);
        if (nextEnd === -1) nextEnd = value.length;
        var nextLine = value.slice(nextStart, nextEnd);
        editorReplace(ed, r.first, nextEnd, nextLine + '\n' + block);
        var newFirst = r.first + nextLine.length + 1;
        ed.setSelectionRange(newFirst, newFirst + block.length);
    }
}

// HTMLエスケープ（飾り層に本文を流し込むときに使う）
function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// 飾り層・ガター・警告をスクロール位置に合わせる（作り直しはしない軽い処理）
function applyEditorScroll() {
    var ed = document.getElementById('sidebarTreeEditor');
    if (!ed) return;
    var x = ed.scrollLeft;
    var y = ed.scrollTop;
    var gutter = document.getElementById('sidebarEditorGutter');
    var backdrop = document.getElementById('sidebarEditorBackdrop');
    var layer = document.getElementById('sidebarEditorHighlights');
    if (gutter) gutter.style.transform = 'translateY(' + (-y) + 'px)';
    if (backdrop) backdrop.style.transform = 'translate(' + (-x) + 'px,' + (-y) + 'px)';
    if (layer) layer.style.transform = 'translateY(' + (-y) + 'px)';
}

// 編集欄の飾りを作り直す：左ガターの行番号（1始まり）、裏層のタブガイド＋改行マーク、
// スペース混入の赤マーカー。すべて表示専用で、本文テキスト（コピー/取り込み）には混ざらない。
function updateEditorDecorations() {
    var ed = document.getElementById('sidebarTreeEditor');
    if (!ed) return;
    var gutter = document.getElementById('sidebarEditorGutter');
    var backdrop = document.getElementById('sidebarEditorBackdrop');
    var layer = document.getElementById('sidebarEditorHighlights');
    var cs = getComputedStyle(ed);
    var lh = parseFloat(cs.lineHeight);
    if (!lh || isNaN(lh)) lh = parseFloat(cs.fontSize) * 1.3;
    var padTop = parseFloat(cs.paddingTop) || 0;
    var lines = ed.value.split('\n');
    var last = lines.length - 1;

    // 左ガター：文字のある行だけ行番号（1始まり）を右揃えで表示。記号は付けない
    if (gutter) {
        var g = '';
        for (var i = 0; i < lines.length; i++) {
            if (lines[i].trim() === '') continue; // 文字が無い行は番号を出さない
            var topG = padTop + i * lh;
            g += '<div class="ge-row" style="top:' + topG + 'px;height:' + lh + 'px;">' +
                 '<span class="ge-num">' + (i + 1) + '</span></div>';
        }
        gutter.innerHTML = g;
    }

    // 裏層：本文と同じ配置でタブ（→＋縦ガイド線）と行末の改行マーク（↵）を描く
    if (backdrop) {
        var b = '';
        for (var k = 0; k < lines.length; k++) {
            var line = lines[k];
            var inner = '';
            for (var c = 0; c < line.length; c++) {
                var ch = line.charAt(c);
                if (ch === '\t') {
                    inner += '<span class="be-tab">\t</span>';
                } else {
                    inner += escapeHtml(ch);
                }
            }
            if (k < last) inner += '<span class="be-nl">↵</span>'; // ↵（最終行以外）
            if (inner === '') inner = '​'; // 空行でも行の高さを確保（ゼロ幅スペース）
            b += '<div class="be-line">' + inner + '</div>';
        }
        backdrop.innerHTML = b;
    }

    // 赤マーカー：行頭に半角/全角スペースが混ざった行を警告
    if (layer) {
        var h = '';
        for (var j = 0; j < lines.length; j++) {
            if (/^[ \u3000]/.test(lines[j])) { // 行頭が半角スペース or 全角スペース
                var topH = padTop + j * lh;
                h += '<div class="sidebar-editor-warnline" style="top:' + topH + 'px;height:' + lh + 'px;"></div>';
            }
        }
        layer.innerHTML = h;
    }

    applyEditorScroll();
}

// [編集]：ツリー表示をテキスト欄に切り替える
function enterTreeEditMode() {
    var editor = document.getElementById('sidebarTreeEditor');
    var wrap = document.getElementById('sidebarEditorWrap');
    var tree = document.getElementById('sidebarTree');
    if (!editor || !wrap || !tree) return;
    // 初期値＝今のツリーのタブ区切りテキスト（罫線の有無に関係なく常にタブ区切り）。末尾の余分な改行は削る
    editor.value = getTreeTabText().replace(/\n+$/, '');
    treeEditMode = true;
    tree.style.display = 'none';
    wrap.style.display = 'block';
    showImportError(null);
    updateEditButtons();
    editor.focus();
    updateEditorDecorations();
}

// [キャンセル]：編集をやめてツリー表示に戻す
function exitTreeEditMode() {
    var wrap = document.getElementById('sidebarEditorWrap');
    var tree = document.getElementById('sidebarTree');
    treeEditMode = false;
    if (wrap) wrap.style.display = 'none';
    if (tree) tree.style.display = '';
    showImportError(null);
    updateEditButtons();
    renderSidebarTree();
}

// [取り込み]：テキストを検証し、問題なければキャンバスに反映する
function importTreeFromEditor() {
    var editor = document.getElementById('sidebarTreeEditor');
    if (!editor) return;
    var result = parseTabIndentedText(editor.value);
    if (!result.ok) {
        showImportError(result.errors);
        return;
    }
    showImportError(null);
    var ok = window.confirm('現在のマップを置き換えます。ノードの色・手動の位置・点線の関連線はリセットされます。よろしいですか？');
    if (!ok) return;
    applyImportedTree(result.tree);
    exitTreeEditMode();
    showToast('✅ 取り込みました');
}

// グレーアウト非表示トグルの状態を取得（デフォルトON = 非表示）
function isGrayoutHiddenInSidebar() {
    var el = document.getElementById('toggleHideGrayoutInput');
    if (el) return !!el.checked;
    var saved = null;
    try { saved = localStorage.getItem('mindmap_hideGrayout'); } catch(e) {}
    return (saved === null) ? true : (saved === 'true');
}

function generatePreviewLines(node, level, parentContinues, format, useBorder, lines) {
    var hideGrayout = isGrayoutHiddenInSidebar();
    // グレーアウト非表示がONの場合のみ、グレーアウトされたノードとその子孫をスキップ
    if (hideGrayout && level > 0 && isNodeGrayedOut(node.id)) return;

    var iconLevel = Math.min(level + 1, 4);
    var icons = levelIcons[format];
    var icon = icons ? (icons[iconLevel] + ' ') : '';

    var lineText;
    if (level === 0) {
        lineText = icon + node.text;
    } else if (!useBorder) {
        // 罫線なしモード：深さ×タブ文字（\t）でインデント。半角スペースや罫線記号は使わない
        lineText = '\t'.repeat(level) + icon + node.text;
    } else {
        var prefix = '';
        for (var i = 0; i < level - 1; i++) {
            prefix += parentContinues[i] ? '│  ' : '   ';
        }
        var isLast = (parentContinues[level - 1] === false);
        var connector = isLast ? '└─ ' : '├─ ';
        lineText = prefix + connector + icon + node.text;
    }
    lineText = lineText.replace(/\n/g, ' ');
    lines.push({ text: lineText, nodeId: node.id });

    // Skip children if node is collapsed OR (非表示モード時のみ)グレーアウトされている
    if (isNodeCollapsed(node.id)) return;
    if (hideGrayout && isNodeGrayedOut(node.id)) return;

    // グレーアウトされた子を表示するかはトグル状態に依存
    var visibleChildrenForSidebar = [];
    for (var ci = 0; ci < node.children.length; ci++) {
        if (!hideGrayout || !isNodeGrayedOut(node.children[ci].id)) {
            visibleChildrenForSidebar.push(node.children[ci]);
        }
    }

    for (i = 0; i < visibleChildrenForSidebar.length; i++) {
        var isLastChild = (i === visibleChildrenForSidebar.length - 1);
        var newContinues = parentContinues.slice();
        newContinues.push(!isLastChild);
        generatePreviewLines(visibleChildrenForSidebar[i], level + 1, newContinues, format, useBorder, lines);
    }

    if (useBorder && level > 0 && visibleChildrenForSidebar.length > 0) {
        var amILast = (parentContinues[level - 1] === false);
        if (!amILast) {
            var sep = '';
            for (i = 0; i < level - 1; i++) {
                sep += parentContinues[i] ? '│  ' : '   ';
            }
            sep += '│';
            lines.push({ text: sep, nodeId: '', isSep: true });
        }
    }
}

function focusNodeFromSidebar(nodeId) {
    selectNode(nodeId);
    var nodeEl = document.querySelector('[data-id="' + nodeId + '"]');
    if (!nodeEl) return;
    var container = document.getElementById('canvasContainer');
    var sidebar = document.getElementById('sidebar');
    var sidebarW = sidebar ? sidebar.offsetWidth : 0;
    var rect = nodeEl.getBoundingClientRect();
    var cRect = container.getBoundingClientRect();
    var availableW = cRect.width - sidebarW;
    var targetX = cRect.left + availableW / 2;
    var targetY = cRect.top + cRect.height / 2;
    var dx = targetX - (rect.left + rect.width / 2);
    var dy = targetY - (rect.top + rect.height / 2);
    viewState.panX += dx;
    viewState.panY += dy;
    updateView();
    renderSidebarTree();
}

