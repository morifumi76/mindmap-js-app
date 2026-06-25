import { generateId } from './utils.js';
import {
    setMindMapData,
    setNodeCollapseState,
    setNodeGrayoutState,
    setNodeHighlightState
} from './state.js';
import { saveState } from './history.js';
import { render } from './render.js';

// ========================================
// Tree Import: タブ区切りテキスト → マインドマップ
// ========================================
// 罫線なしモードの出力（深さ×タブ文字）と同じフォーマットを入力として受け取り、
// 中央キャンバスのツリーに変換する。リアルタイム反映はせず、[取り込み]時のみ適用する。

// タブ区切りテキストを解析・検証してツリーに変換する（副作用なしの純粋関数）。
// 成功時: { ok: true, tree }（tree は { id, text, children } のルートノード）
// 失敗時: { ok: false, errors: ['N行目: 理由', ...] }
export function parseTabIndentedText(text) {
    var errors = [];
    var rawLines = (text == null ? '' : String(text)).split(/\r?\n/);

    // 空行を除いた「中身のある行」を、深さ・名前・元の行番号付きで集める
    var entries = [];
    for (var i = 0; i < rawLines.length; i++) {
        var line = rawLines[i];
        var lineNo = i + 1;
        if (line.trim() === '') continue; // 空行はスキップ
        var leading = line.match(/^[\t ]*/)[0]; // 行頭の連続するタブ／スペース
        // 半角スペースでのインデントは認めない（タブのみ厳格）
        if (leading.indexOf(' ') !== -1) {
            errors.push(lineNo + '行目: タブではなく半角スペースが使われています');
            continue;
        }
        var depth = leading.length; // タブのみなので長さ＝深さ
        var name = line.slice(leading.length).trim();
        entries.push({ lineNo: lineNo, depth: depth, name: name });
    }

    if (entries.length === 0) {
        errors.push('取り込む内容がありません（空です）');
    }
    // スペースインデントや空はこの時点で確定なので、構造チェックへ進まず返す
    if (errors.length > 0) return { ok: false, errors: errors };

    // 先頭行はインデントできない（最上位はタブ0個）
    if (entries[0].depth !== 0) {
        errors.push(entries[0].lineNo + '行目: 先頭行はインデントできません（最上位はタブ0個）');
    }

    // 最上位（深さ0）が複数あってはいけない（中心テーマは1つ）
    var rootCount = 0;
    for (var j = 0; j < entries.length; j++) {
        if (entries[j].depth === 0) rootCount++;
    }
    if (rootCount > 1) {
        errors.push('最上位（タブ0個）の行が複数あります。中心テーマは1つにしてください');
    }

    // 階層飛びチェック（1段ずつしか深くできない）
    for (var k = 1; k < entries.length; k++) {
        if (entries[k].depth > entries[k - 1].depth + 1) {
            errors.push(entries[k].lineNo + '行目: 階層が飛んでいます（1段ずつ深くしてください）');
        }
    }

    if (errors.length > 0) return { ok: false, errors: errors };

    // ツリー構築（スタックで親をたどる）
    var root = null;
    var stack = []; // stack[depth] = そのレベルの直近ノード
    for (var m = 0; m < entries.length; m++) {
        var e = entries[m];
        // ルートは既存コードと整合させるため id を 'root' に固定。他は新規ID
        var node = { id: (e.depth === 0 ? 'root' : generateId()), text: e.name, children: [] };
        if (e.depth === 0) {
            root = node;
        } else {
            stack[e.depth - 1].children.push(node);
        }
        stack[e.depth] = node;
        stack.length = e.depth + 1; // より深い階層の古い参照を切り捨てる
    }

    return { ok: true, tree: root };
}

// 検証済みツリーを中央キャンバスに反映する（全置き換え）。
// 色・グレーアウト・ハイライト・折りたたみ・関連線などツリー構造外の情報はリセットする。
// 既存の編集操作と同じ「変更 → saveState → render」の順なので Undo で元に戻せる。
export function applyImportedTree(tree) {
    setMindMapData({ root: tree });
    setNodeGrayoutState({});
    setNodeHighlightState({});
    setNodeCollapseState({});
    saveState();
    render();
}
