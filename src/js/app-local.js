// ローカル版（オフライン配布／Denso 提出用）専用のエントリポイント。
// app.js とほぼ同じ本体を読み込むが、cloud/（Supabase 認証・同期・共有）は読み込まない。
//   → 生成される local.html に、外部通信し得るコード（fetchSharedMap / login / sync 等）が一切入らない。
// クラウド版（app.js）はこのファイルを使わないため、クラウド版の出力には一切影響しない。
//
// 起動について：
//   クラウド版では cloud/boot.js の DOMContentLoaded が起動を担っていたが、
//   ローカル版はそれを含めないため、ここで最小限の起動処理（画面読込後に init を呼ぶ）を行う。
import './state.js';
import './utils.js';
import './storage.js';
import './history.js';
import './nodes.js';
import './selection.js';
import './editing.js';
import './clipboard.js';
import './drag.js';
import './lasso.js';
import './render.js';
import './relations/index.js';
import './keyboard.js';
import './canvas-interaction.js';
import './link-modal.js';
import './init.js';
import './sidebar-right.js';
import './sidebar-left/index.js';
import { init } from './init.js';

// ローカル版の起動：認証も同期もないので、ページ読込後に init() を呼ぶだけ
document.addEventListener('DOMContentLoaded', function() {
    init();
});
