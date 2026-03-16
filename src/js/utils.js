// ========================================
// Utility Functions
// ========================================

function generateId() {
    return 'node_' + (++nodeIdCounter) + '_' + Date.now();
}

function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
}

function showToast(message, duration) {
    duration = duration || 2000;
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toast._tid);
    toast._tid = setTimeout(function() {
        toast.classList.remove('show');
    }, duration);
}

