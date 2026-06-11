'use strict';
// テスト共通の定数
//
// 対象はローカル版ビルド（dist/local.html）。
// クラウド版（dist/index.html）は未ログイン時に認証画面が表示されて
// マインドマップ本体が描画されないため、テスト対象にできない。
// 本体コードは保存アダプター以外すべて両ビルド共通なので、
// ローカル版でのテストでアプリ本体の検証として成立する。
const PORT = process.env.TEST_PORT || 8080;
const BASE_URL = 'http://localhost:' + PORT + '/local.html';

// アプリのショートカット修飾キーは Mac では Cmd、その他では Ctrl
// （src/js/keyboard.js の isMac 判定に対応）
const CMD = process.platform === 'darwin' ? 'Meta' : 'Control';

module.exports = { PORT, BASE_URL, CMD };
