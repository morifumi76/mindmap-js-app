'use strict';
// ESLint 設定（フラット構成）
//
// 【現状の制約】src/js/ は build.js が全ファイルを文字列連結して
// 1つの IIFE に詰める方式のため、ファイル間の関数・変数参照がすべて
// 「暗黙のグローバル」になっている。このため no-undef / no-unused-vars を
// src/js/ で有効にすると数百件のファイル間参照が誤検出される。
// → フェーズ3（ESモジュール化）完了後に有効化する。
const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
    {
        ignores: ['dist/', 'node_modules/', 'docs/'],
    },

    // アプリ本体（ブラウザで動く連結ビルド対象）
    {
        files: ['src/js/**/*.js'],
        languageOptions: {
            ecmaVersion: 2017,
            sourceType: 'script',
            globals: Object.assign({}, globals.browser),
        },
        rules: Object.assign({}, js.configs.recommended.rules, {
            'no-undef': 'off',       // 連結ビルドの暗黙グローバル参照のため（フェーズ3で有効化）
            'no-unused-vars': 'off', // 同上：別ファイルから使われる関数が誤検出される
            'no-empty': ['error', { allowEmptyCatch: true }], // catch(e) {} はこのコードベースの慣習
            // ↓ レガシーコードに既存の指摘。挙動には影響しないため warn 扱いとし、
            //    フェーズ3（モジュール化）・フェーズ4（分割）で順次解消する
            'no-redeclare': 'warn',
            'no-regex-spaces': 'warn',
            'no-irregular-whitespace': 'warn',
            'no-prototype-builtins': 'warn',
            'no-useless-assignment': 'warn',
        }),
    },

    // クラウド版 保存アダプター：esbuild で ES モジュールとしてバンドルされる唯一のファイル
    {
        files: ['src/js/storage-supabase.js'],
        languageOptions: {
            ecmaVersion: 2020,
            sourceType: 'module',
            globals: Object.assign({}, globals.browser),
        },
        rules: Object.assign({}, js.configs.recommended.rules, {
            'no-undef': 'off',
            'no-unused-vars': 'off',
            'no-empty': ['error', { allowEmptyCatch: true }],
            'no-redeclare': 'warn',
        }),
    },

    // ビルド・開発スクリプト・テスト（Node.js で動く）
    {
        files: ['build.js', 'scripts/**/*.js', 'tests/**/*.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'commonjs',
            // テストは page.evaluate() 内でブラウザコードを書くため browser も併用
            globals: Object.assign({}, globals.node, globals.browser),
        },
        rules: Object.assign({}, js.configs.recommended.rules, {
            'no-empty': ['error', { allowEmptyCatch: true }],
            // 既存テストは catch(e) で受けて使わない書き方が多い（許容する）
            'no-unused-vars': ['error', { caughtErrors: 'none' }],
        }),
    },
];
