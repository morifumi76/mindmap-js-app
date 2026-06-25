// 左サイドバーの公開API（再エクスポート）と window への公開
import { getCurrentCopyText } from '../clipboard.js';
import { parseTabIndentedText } from '../tree-import.js';
import { undo } from '../history.js';
import { selectNode, toggleSelectNode } from '../selection.js';
import { getVisibleNodesInOrder } from '../nodes.js';
import { closeRightSidebar, openRightSidebar } from '../sidebar-right.js';
import {
    collapseAllNodes,
    currentMapId,
    expandAllNodes,
    getNodeCollapseState,
    getNodeGrayoutState,
    getNodeHighlightState,
    isDescendantOfGrayedOut,
    isNodeCollapsed,
    isNodeGrayedOut,
    isNodeHighlighted,
    isNodeOrAncestorGrayedOut,
    mindMapData,
    selectedNodeIds,
    setNodeCollapseState,
    setNodeGrayoutState,
    setNodeHighlightState,
    toggleNodeCollapse,
    toggleNodeGrayout,
    toggleNodeHighlight
} from '../state.js';
import {
    ensureDefaultFolder,
    getCollapseState,
    getDefaultFolderId,
    getMetaList,
    getSortMode,
    setCollapseState,
    setSortMode
} from '../storage.js';
import {
    createFolder,
    createNewMap,
    createPageInFolder,
    createSubFolder,
    deleteFolder,
    startInlineRename,
    switchToMap
} from './crud.js';
import { closeLeftSidebar, openLeftSidebar } from './panel.js';
import { renderMapList } from './render.js';

// サブモジュールの読み込み（実行順は state が先頭）
import './state.js';
import './selection.js';
import './history-clipboard.js';
import './panel.js';
import './render.js';
import './dnd.js';
import './menus.js';
import './crud.js';
import './events.js';

// 外部モジュール向けの公開API
export { initLeftSidebar } from './events.js';
export { renderMapList } from './render.js';

// Expose for testing/integration
window.getCurrentCopyText = getCurrentCopyText;
window.getSelectedNodeIds = function() { return selectedNodeIds; };
window.getMindMapData = function() { return mindMapData; };
window.getCurrentMapId = function() { return currentMapId; };
window.getMetaList = getMetaList;
window.switchToMap = switchToMap;
window.createNewMap = createNewMap;
window.createFolder = createFolder;
window.createSubFolder = createSubFolder;
window.createPageInFolder = createPageInFolder;
window.deleteFolder = deleteFolder;
window.openRightSidebar = openRightSidebar;
window.closeRightSidebar = closeRightSidebar;
window.openLeftSidebar = openLeftSidebar;
window.closeLeftSidebar = closeLeftSidebar;
window.startInlineRename = startInlineRename;
window.getSortMode = getSortMode;
window.setSortMode = setSortMode;
window.getCollapseState = getCollapseState;
window.setCollapseState = setCollapseState;
window.renderMapList = renderMapList;
window.getDefaultFolderId = getDefaultFolderId;
window.ensureDefaultFolder = ensureDefaultFolder;
window.toggleNodeCollapse = toggleNodeCollapse;
window.isNodeCollapsed = isNodeCollapsed;
window.getNodeCollapseState = getNodeCollapseState;
window.setNodeCollapseState = setNodeCollapseState;
window.expandAllNodes = expandAllNodes;
window.collapseAllNodes = collapseAllNodes;
window.getVisibleNodesInOrder = getVisibleNodesInOrder;
window.isNodeGrayedOut = isNodeGrayedOut;
window.getNodeGrayoutState = getNodeGrayoutState;
window.setNodeGrayoutState = setNodeGrayoutState;
window.toggleNodeGrayout = toggleNodeGrayout;
window.isDescendantOfGrayedOut = isDescendantOfGrayedOut;
window.isNodeOrAncestorGrayedOut = isNodeOrAncestorGrayedOut;
window.isNodeHighlighted = isNodeHighlighted;
window.getNodeHighlightState = getNodeHighlightState;
window.setNodeHighlightState = setNodeHighlightState;
window.toggleNodeHighlight = toggleNodeHighlight;
window.parseTabIndentedText = parseTabIndentedText;
window.undo = undo;
window.selectNode = selectNode;
window.toggleSelectNode = toggleSelectNode;
