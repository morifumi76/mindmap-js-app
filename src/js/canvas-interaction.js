// ========================================
// Canvas Interaction: Pan, Zoom, Lasso
// ========================================

function initCanvasInteraction() {
    var canvas = document.getElementById('canvas');

    // --- Mousedown ---
    canvas.addEventListener('mousedown', function(e) {
        if (nodeDragState.isDragging) return;

        var isBackground = (e.target === canvas ||
            e.target.id === 'canvasInner' ||
            e.target.tagName === 'svg' ||
            e.target.classList.contains('lines-svg'));

        if (!isBackground) return;

        // Right-click or middle-click: pan
        if (e.button === 2 || e.button === 1) {
            e.preventDefault();
            viewState.isPanning = true;
            viewState.startX = e.clientX - viewState.panX;
            viewState.startY = e.clientY - viewState.panY;
            canvas.classList.add('panning');
            return;
        }

        // Left-click on background: start lasso
        if (e.button === 0) {
            // 接続待機モード中はラッソを開始しない（mouseup側でモード解除する）
            if (typeof isConnectionModeActive === 'function' && isConnectionModeActive()) {
                return;
            }
            finishEditing();
            startLasso(e.clientX, e.clientY);
        }
    });

    // --- Mousemove ---
    canvas.addEventListener('mousemove', function(e) {
        if (nodeDragState.isDragging) return;
        if (viewState.isPanning) {
            viewState.panX = e.clientX - viewState.startX;
            viewState.panY = e.clientY - viewState.startY;
            updateView();
            return;
        }
        if (lassoState.active) {
            updateLasso(e.clientX, e.clientY);
        }
    });

    // --- Mouseup ---
    canvas.addEventListener('mouseup', function(e) {
        if (viewState.isPanning) {
            viewState.isPanning = false;
            canvas.classList.remove('panning');
            return;
        }
        if (lassoState.active) {
            endLasso();
        }
    });

    // --- Click on background: clear selection ---
    canvas.addEventListener('click', function(e) {
        var isBackground = (e.target === canvas ||
            e.target.id === 'canvasInner' ||
            e.target.tagName === 'svg' ||
            e.target.classList.contains('lines-svg'));

        if (!isBackground) return;

        // 接続待機モード中の空白クリック：モード解除（点線は引かない）
        if (typeof isConnectionModeActive === 'function' && isConnectionModeActive()) {
            cancelConnectionMode();
            return;
        }

        // Don't clear if lasso just selected nodes
        if (lassoState.didSelect) {
            lassoState.didSelect = false;
            return;
        }
        finishEditing();
        clearSelection();
    });

    // --- Mouseleave ---
    canvas.addEventListener('mouseleave', function() {
        if (viewState.isPanning) {
            viewState.isPanning = false;
            canvas.classList.remove('panning');
        }
        if (lassoState.active) endLasso();
        if (nodeDragState.isDragging) endNodeDrag();
    });

    // --- Context menu prevention ---
    canvas.addEventListener('contextmenu', function(e) {
        e.preventDefault();
    });

    // --- Wheel: zoom (mouse scroll wheel) / pan (trackpad 2-finger) ---
    canvas.addEventListener('wheel', function(e) {
        e.preventDefault();
        var container = document.getElementById('canvasContainer');
        var rect = container.getBoundingClientRect();
        var mouseX = e.clientX - rect.left;
        var mouseY = e.clientY - rect.top;

        // ctrlKey is set by browser during trackpad pinch gesture
        if (e.ctrlKey) {
            // Pinch zoom
            var zoomDelta = -e.deltaY * 0.01;
            applyZoom(mouseX, mouseY, zoomDelta);
            return;
        }

        // Trackpad 2-finger scroll → pan
        // Mouse scroll wheel → zoom (deltaMode = 1 for line-based, or large deltaY)
        if (e.deltaMode === 0 && (Math.abs(e.deltaX) > 1 || Math.abs(e.deltaY) < 80)) {
            // Likely trackpad: pan
            viewState.panX -= e.deltaX;
            viewState.panY -= e.deltaY;
            updateView();
        } else {
            // Mouse scroll wheel: zoom
            var zoomDelta = e.deltaY > 0 ? -0.1 : 0.1;
            applyZoom(mouseX, mouseY, zoomDelta);
        }
    }, { passive: false });

    // --- Touch events for pinch-zoom ---
    var lastTouchDist = 0;
    var lastTouchCenter = { x: 0, y: 0 };

    canvas.addEventListener('touchstart', function(e) {
        if (e.touches.length === 2) {
            e.preventDefault();
            var t1 = e.touches[0], t2 = e.touches[1];
            lastTouchDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
            lastTouchCenter = { x: (t1.clientX + t2.clientX) / 2, y: (t1.clientY + t2.clientY) / 2 };
        }
    }, { passive: false });

    canvas.addEventListener('touchmove', function(e) {
        if (e.touches.length === 2) {
            e.preventDefault();
            var t1 = e.touches[0], t2 = e.touches[1];
            var dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
            var center = { x: (t1.clientX + t2.clientX) / 2, y: (t1.clientY + t2.clientY) / 2 };
            var scale = dist / lastTouchDist;
            var oldZoom = viewState.zoom;
            var newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, oldZoom * scale));
            var actualScale = newZoom / oldZoom;
            viewState.panX = center.x - actualScale * (center.x - viewState.panX);
            viewState.panY = center.y - actualScale * (center.y - viewState.panY);
            viewState.zoom = newZoom;
            viewState.panX += center.x - lastTouchCenter.x;
            viewState.panY += center.y - lastTouchCenter.y;
            lastTouchDist = dist;
            lastTouchCenter = center;
            updateView();
            updateZoomDisplay();
        }
    }, { passive: false });
}

var ZOOM_MIN = 0.1;
var ZOOM_MAX = 2.0;
var ZOOM_STEP = 0.05;

function applyZoom(mouseX, mouseY, zoomDelta) {
    var oldZoom = viewState.zoom;
    var newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, oldZoom + zoomDelta));
    var scale = newZoom / oldZoom;
    viewState.panX = mouseX - scale * (mouseX - viewState.panX);
    viewState.panY = mouseY - scale * (mouseY - viewState.panY);
    viewState.zoom = newZoom;
    updateView();
    updateZoomDisplay();
}

function zoomToCenter(newZoom) {
    var container = document.getElementById('canvasContainer');
    var rect = container.getBoundingClientRect();
    var cx = rect.width / 2;
    var cy = rect.height / 2;
    var oldZoom = viewState.zoom;
    newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, newZoom));
    var scale = newZoom / oldZoom;
    viewState.panX = cx - scale * (cx - viewState.panX);
    viewState.panY = cy - scale * (cy - viewState.panY);
    viewState.zoom = newZoom;
    updateView();
    updateZoomDisplay();
}

function updateZoomDisplay() {
    var display = document.getElementById('zoomDisplay');
    var outBtn = document.getElementById('zoomOutBtn');
    var inBtn = document.getElementById('zoomInBtn');
    if (!display) return;
    display.textContent = Math.round(viewState.zoom * 100) + '%';
    if (outBtn) outBtn.disabled = viewState.zoom <= ZOOM_MIN;
    if (inBtn) inBtn.disabled = viewState.zoom >= ZOOM_MAX;
}

var zoomControlInitialized = false;
function initZoomControl() {
    if (zoomControlInitialized) { updateZoomDisplay(); return; }
    zoomControlInitialized = true;
    var outBtn = document.getElementById('zoomOutBtn');
    var inBtn = document.getElementById('zoomInBtn');
    if (outBtn) {
        outBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            var newZoom = Math.round((viewState.zoom - ZOOM_STEP) * 100) / 100;
            zoomToCenter(newZoom);
        });
    }
    if (inBtn) {
        inBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            var newZoom = Math.round((viewState.zoom + ZOOM_STEP) * 100) / 100;
            zoomToCenter(newZoom);
        });
    }
    updateZoomDisplay();
}

// ========================================
// Toggle Button Sync
// ========================================

function syncToggleButtons() {
    var formatEl = document.getElementById('copyFormat');
    var borderEl = document.getElementById('copyBorder');
    var hiyokoInput = document.getElementById('toggleHiyokoInput');
    var borderInput = document.getElementById('toggleBorderInput');
    var hideGrayoutInput = document.getElementById('toggleHideGrayoutInput');
    if (hiyokoInput) {
        hiyokoInput.checked = (formatEl.value === 'hiyoko');
    }
    if (borderInput) {
        borderInput.checked = (borderEl.value === 'border');
    }
    if (hideGrayoutInput) {
        var saved = null;
        try { saved = localStorage.getItem('mindmap_hideGrayout'); } catch(e) {}
        hideGrayoutInput.checked = (saved === null) ? true : (saved === 'true');
    }
}

