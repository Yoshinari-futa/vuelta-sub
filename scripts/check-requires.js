#!/usr/bin/env node
/**
 * 全 api/**.js を実ロードして MODULE_NOT_FOUND を検知する。
 * Vercel ビルドは require を実行しないため、本番アクセスで初めて
 * 落ちる事故（例: 2026-04-15 stripe webhook 500）を CI で先に潰す。
 *
 * MODULE_NOT_FOUND 以外の例外（環境変数未設定など）は無視する。
 * exit 1 = 必須モジュール未解決あり / exit 0 = OK
 */

const fs = require('fs');
const path = require('path');

const API_DIR = path.resolve(__dirname, '..', 'api');

function walk(dir) {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else if (name.endsWith('.js')) out.push(p);
  }
  return out;
}

const files = walk(API_DIR);
const failures = [];

for (const f of files) {
  try {
    require(f);
  } catch (err) {
    if (err && err.code === 'MODULE_NOT_FOUND') {
      failures.push({ file: path.relative(process.cwd(), f), msg: err.message.split('\n')[0] });
    }
    // 環境変数不足等は無視（require フェーズ後の throw）
  }
}

if (failures.length) {
  console.error('\n❌ MODULE_NOT_FOUND detected:\n');
  for (const f of failures) console.error(`  - ${f.file}\n      ${f.msg}`);
  console.error('\nファイル移動・リネーム時に require パス更新を忘れていませんか？\n');
  process.exit(1);
}

console.log(`✓ ${files.length} files: 全 require 解決OK`);
