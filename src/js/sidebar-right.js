// ========================================
// Right Sidebar: Resize, Tree Rendering, Focus
// ========================================

var SIDEBAR_OPEN_MIN = 200;
var SIDEBAR_DEFAULT = 260;
var SIDEBAR_KEY = 'mindmap_sidebar_width';
var sidebarIsOpen = false;

function initSidebar() {
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
}

function openRightSidebar() {
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

function closeRightSidebar() {
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
    var rightW = (rightSidebar && !rightSidebar.classList.contains('collapsed')) ? rightSidebar.offsetWidth : 0;
    btnsContainer.style.right = (16 + rightW) + 'px';
}

function adjustCanvasForSidebars() {
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

function renderSidebarTree() {
    var tree = document.getElementById('sidebarTree');
    if (!tree) return;
    var sidebar = document.getElementById('sidebar');
    if (sidebar && sidebar.classList.contains('collapsed')) {
        tree.innerHTML = '';
        return;
    }

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
    for (var i = 0; i < displayLines.length; i++) {
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

function generatePreviewLines(node, level, parentContinues, format, useBorder, lines) {
    // If this node is grayed out, skip it and all descendants entirely in tree nav
    if (level > 0 && isNodeGrayedOut(node.id)) return;

    var iconLevel = Math.min(level + 1, 4);
    var icons = levelIcons[format];
    var icon = icons ? (icons[iconLevel] + ' ') : '';

    var lineText = '';
    if (level === 0) {
        lineText = icon + node.text;
    } else {
        var prefix = '';
        for (var i = 0; i < level - 1; i++) {
            if (useBorder) {
                prefix += parentContinues[i] ? '│  ' : '   ';
            } else {
                prefix += '  ';
            }
        }
        var isLast = (parentContinues[level - 1] === false);
        var connector;
        if (useBorder) {
            connector = isLast ? '└─ ' : '├─ ';
        } else {
            connector = '  ';
        }
        lineText = prefix + connector + icon + node.text;
    }
    lineText = lineText.replace(/\n/g, ' ');
    lines.push({ text: lineText, nodeId: node.id });

    // Skip children if node is collapsed OR grayed out (hide grayed-out node and all descendants)
    if (isNodeCollapsed(node.id) || isNodeGrayedOut(node.id)) return;

    // Filter out grayed-out children for sidebar display
    var visibleChildrenForSidebar = [];
    for (var ci = 0; ci < node.children.length; ci++) {
        if (!isNodeGrayedOut(node.children[ci].id)) {
            visibleChildrenForSidebar.push(node.children[ci]);
        }
    }

    for (var i = 0; i < visibleChildrenForSidebar.length; i++) {
        var isLastChild = (i === visibleChildrenForSidebar.length - 1);
        var newContinues = parentContinues.slice();
        newContinues.push(!isLastChild);
        generatePreviewLines(visibleChildrenForSidebar[i], level + 1, newContinues, format, useBorder, lines);
    }

    if (useBorder && level > 0 && visibleChildrenForSidebar.length > 0) {
        var amILast = (parentContinues[level - 1] === false);
        if (!amILast) {
            var sep = '';
            for (var i = 0; i < level - 1; i++) {
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

