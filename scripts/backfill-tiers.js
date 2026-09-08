/**
 * 7段ティア化(2026-09-08)の既存会員バックフィル
 *
 * 全会員の points から新閾値でティアを再計算し、
 * tierId と metaData.nextColor(パス表面 NEXT 欄)を PUT で反映する。
 *
 * 使い方(リポジトリルートで):
 *   DRY_RUN=1 node scripts/backfill-tiers.js   # 変更内容の確認のみ
 *   node scripts/backfill-tiers.js             # 実行
 */

const fs = require('fs');
const path = require('path');

// .env を読む(dotenv 非依存)
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}

const { getPassKitAuth } = require('../lib/passkit-auth');
const parseVisitCount = require('../lib/parse-visit-count');
const { tierForVisits, nextColorMessage } = require('../lib/tiers');

const DRY_RUN = process.env.DRY_RUN === '1';

function parseListResponse(text) {
  const t = (text || '').trim();
  if (!t) return [];
  try {
    const parsed = JSON.parse(t);
    if (Array.isArray(parsed)) return parsed;
    if (parsed.members) return parsed.members;
    if (parsed.passes) return parsed.passes;
    if (parsed.results) return parsed.results;
    if (parsed.id) return [parsed];
  } catch (_) { /* NDJSON */ }
  const out = [];
  for (const line of t.split('\n')) {
    try {
      const obj = JSON.parse(line.trim());
      const m = obj.result || obj;
      if (m && m.id) out.push(m);
    } catch (_) { /* skip */ }
  }
  return out;
}

async function main() {
  const { token, baseUrl } = getPassKitAuth();
  const programId = (process.env.PASSKIT_PROGRAM_ID || '').trim();
  if (!programId) throw new Error('PASSKIT_PROGRAM_ID is required');

  const r = await fetch(`${baseUrl}/members/member/list/${programId}`, {
    method: 'POST',
    headers: { Authorization: token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ filters: { limit: 500 } }),
  });
  if (!r.ok) throw new Error(`list failed: ${r.status} ${await r.text()}`);
  const members = parseListResponse(await r.text());
  console.log(`members: ${members.length}${DRY_RUN ? ' (DRY RUN)' : ''}`);

  let changed = 0;
  for (const m of members) {
    const visits = parseVisitCount(m.points);
    const tier = tierForVisits(visits);
    const nextColor = nextColorMessage(visits);
    const name = m.person?.displayName || m.id;
    const tierChanged = (m.tierId || 'base') !== tier.id;
    const nextChanged = (m.metaData?.nextColor || '') !== nextColor;
    console.log(
      `${name}: visits=${visits} tier ${m.tierId || 'base'} -> ${tier.id}${tierChanged ? ' *' : ''} | NEXT "${nextColor}"${nextChanged ? ' *' : ''}`
    );
    if (!tierChanged && !nextChanged) continue;
    changed++;
    if (DRY_RUN) continue;

    const body = {
      id: m.id,
      programId,
      tierId: tier.id,
      points: visits,
      metaData: { ...(m.metaData || {}), nextColor },
    };
    const pr = await fetch(`${baseUrl}/members/member`, {
      method: 'PUT',
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const pt = await pr.text();
    console.log(`  PUT ${pr.status}${pr.ok ? '' : ` ${pt.substring(0, 200)}`}`);
  }
  console.log(`done. ${changed}/${members.length} member(s) ${DRY_RUN ? 'would be ' : ''}updated`);
}

main().catch(e => { console.error(e); process.exit(1); });
