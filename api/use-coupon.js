/**
 * POST /use-coupon
 * フード1品無料クーポンを 1 枚消費する。
 * Body: { memberId, secret }   secret = SCAN_PIN（scanner.html から呼ぶ）
 *
 * memberId は scan API の戻り値の data.memberId を使う想定だが、
 * 念のため scan.js と同じく id 直接 → externalId → リスト検索のフォールバックを実装。
 */

const { getPassKitAuth } = require('../lib/passkit-auth');
const { readFoodCoupons, adjustFoodCoupons } = require('../lib/coupons');

function parseListResponse(text) {
  const t = (text || '').trim();
  if (!t) return [];
  try {
    const parsed = JSON.parse(t);
    if (Array.isArray(parsed)) return parsed;
    if (parsed.result) return Array.isArray(parsed.result) ? parsed.result : [parsed.result];
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

async function findMember({ token, baseUrl, programId, memberId }) {
  // 1a: ID 直接 GET
  try {
    const r = await fetch(`${baseUrl}/members/member/${encodeURIComponent(memberId)}`, {
      headers: { Authorization: token },
    });
    if (r.ok) return { member: await r.json(), via: 'directId' };
    console.log(`[USE-COUPON] directId lookup: ${r.status}`);
  } catch (e) {
    console.log(`[USE-COUPON] directId lookup err: ${e.message}`);
  }

  // 1b: externalId
  if (programId) {
    try {
      const r = await fetch(
        `${baseUrl}/members/member/external/${encodeURIComponent(programId)}/${encodeURIComponent(memberId)}`,
        { headers: { Authorization: token } }
      );
      if (r.ok) return { member: await r.json(), via: 'externalId' };
      console.log(`[USE-COUPON] externalId lookup: ${r.status}`);
    } catch (e) {
      console.log(`[USE-COUPON] externalId lookup err: ${e.message}`);
    }
  }

  // 1c: リスト全取得 → id / externalId / altId 一致
  if (programId) {
    try {
      const r = await fetch(`${baseUrl}/members/member/list/${encodeURIComponent(programId)}`, {
        method: 'POST',
        headers: { Authorization: token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ filters: { limit: 500 } }),
      });
      if (r.ok) {
        const members = parseListResponse(await r.text());
        const hit = members.find((m) =>
          m.id === memberId ||
          m.externalId === memberId ||
          (m.passMetaData && m.passMetaData.altId === memberId)
        );
        if (hit) return { member: hit, via: 'listExact' };
        console.log(`[USE-COUPON] list: not found in ${members.length} members`);
      }
    } catch (e) {
      console.log(`[USE-COUPON] list err: ${e.message}`);
    }
  }

  return { member: null, via: 'notFound' };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const { memberId, secret } = body || {};

  const staffPin = process.env.SCAN_PIN || '0000';
  if (secret !== staffPin) {
    return res.status(401).json({ error: 'Invalid PIN' });
  }
  if (!memberId) {
    return res.status(400).json({ error: 'memberId is required' });
  }

  try {
    const { token, baseUrl } = getPassKitAuth();
    const programId = (process.env.PASSKIT_PROGRAM_ID || '').trim();

    const { member, via } = await findMember({ token, baseUrl, programId, memberId });
    if (!member) {
      return res.status(404).json({
        error: 'Member not found',
        memberId,
        programId,
        hint: '直接 ID / externalId / リスト検索すべて 失敗',
      });
    }
    console.log(`[USE-COUPON] member found via ${via}: ${member.id}`);

    const current = readFoodCoupons(member);
    if (current <= 0) {
      return res.status(400).json({ error: 'クーポン残数が 0 枚です', foodCoupons: 0 });
    }

    const result = await adjustFoodCoupons({ token, baseUrl, member, delta: -1 });
    if (!result.ok) {
      return res.status(500).json({ error: 'クーポン消費に失敗しました', detail: result });
    }

    return res.status(200).json({
      success: true,
      memberId: member.id,
      memberName: member.person?.displayName || 'Member',
      foodCoupons: result.after,
      via,
      message: `フード 1 品無料を 1 枚消費しました（残 ${result.after} 枚）`,
    });
  } catch (err) {
    console.error(`[USE-COUPON] FATAL: ${err.message}`);
    return res.status(500).json({ error: err.message });
  }
};
