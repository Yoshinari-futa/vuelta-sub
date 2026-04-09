/**
 * POST /scan
 * バーコードスキャン → PassKit 来店回数（points）+1
 * Body: { memberId, secret }
 *
 * v8: シンプル化。メンバー検索 → points PUT → フォールバック
 */

const parseVisitCount = require('../lib/parse-visit-count');
const { getPassKitAuth } = require('../lib/passkit-auth');

const SCAN_API_VERSION = '2026-04-10-v8-simple';

// ── helpers ──

/** スキャン文字列からPassKit member IDを抽出 */
function extractId(raw) {
  if (!raw || typeof raw !== 'string') return '';
  let val = raw.trim();
  // pskt.io URL
  const urlMatch = val.match(/pskt\.io\/(?:c\/)?([A-Za-z0-9_-]{10,})/i);
  if (urlMatch) return urlMatch[1];
  // 一般URL末尾
  const pathMatch = val.match(/\/([A-Za-z0-9_-]{15,})(?:[?#]|$)/);
  if (pathMatch) return pathMatch[1];
  // そのままID
  if (/^[A-Za-z0-9_-]{10,}$/.test(val)) return val;
  return val;
}

/** NDJSON / 配列 / 単一オブジェクトをメンバー配列に統一 */
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

// ── handler ──

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET: PIN検証のみ
  if (req.method === 'GET') {
    const pin = req.query?.secret;
    const staffPin = process.env.SCAN_PIN || '0000';
    if (pin === staffPin) {
      return res.status(200).json({ valid: true, scanApiVersion: SCAN_API_VERSION });
    }
    return res.status(401).json({ valid: false, error: 'Invalid PIN' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (_) { body = {}; }
  }
  let { memberId, secret } = body || {};

  const staffPin = process.env.SCAN_PIN || '0000';
  if (secret !== staffPin) {
    return res.status(401).json({ error: 'Invalid PIN' });
  }
  if (!memberId) {
    return res.status(400).json({ error: 'memberId is required' });
  }

  const cleanId = extractId(memberId);
  console.log(`[SCAN] raw="${memberId}" clean="${cleanId}"`);

  try {
    const { token, baseUrl } = getPassKitAuth();
    const programId = (process.env.PASSKIT_PROGRAM_ID || '').trim();

    // ── Step 1: メンバー検索 ──
    let member = null;

    // 1a: ID直接
    try {
      const r = await fetch(`${baseUrl}/members/member/${cleanId}`, {
        headers: { Authorization: token },
      });
      if (r.ok) {
        member = await r.json();
        console.log(`[SCAN] Found by id: ${member.id}`);
      } else {
        console.log(`[SCAN] id lookup: ${r.status}`);
      }
    } catch (e) {
      console.log(`[SCAN] id lookup err: ${e.message}`);
    }

    // 1b: externalId
    if (!member && programId) {
      try {
        const r = await fetch(`${baseUrl}/members/member/external/${programId}/${cleanId}`, {
          headers: { Authorization: token },
        });
        if (r.ok) {
          member = await r.json();
          console.log(`[SCAN] Found by externalId: ${member.id}`);
        } else {
          console.log(`[SCAN] extId lookup: ${r.status}`);
        }
      } catch (e) {
        console.log(`[SCAN] extId lookup err: ${e.message}`);
      }
    }

    // 1c: リスト検索（fuzzy）
    if (!member && programId) {
      try {
        const r = await fetch(`${baseUrl}/members/member/list/${programId}`, {
          method: 'POST',
          headers: { Authorization: token, 'Content-Type': 'application/json' },
          body: JSON.stringify({ filters: { limit: 500 } }),
        });
        if (r.ok) {
          const members = parseListResponse(await r.text());
          console.log(`[SCAN] list: ${members.length} members`);
          member = members.find(m =>
            m.id === cleanId ||
            m.externalId === cleanId ||
            (cleanId.length >= 8 && (
              (m.id && (m.id.includes(cleanId) || cleanId.includes(m.id))) ||
              (m.externalId && (m.externalId.includes(cleanId) || cleanId.includes(m.externalId)))
            ))
          );
          if (member) console.log(`[SCAN] Found in list: ${member.id}`);
        } else {
          console.log(`[SCAN] list: ${r.status}`);
        }
      } catch (e) {
        console.log(`[SCAN] list err: ${e.message}`);
      }
    }

    if (!member) {
      return res.status(404).json({
        error: 'Member not found',
        scannedValue: cleanId,
        programId: programId || null,
        scanApiVersion: SCAN_API_VERSION,
      });
    }

    // メンバーをフルGETで更新
    try {
      const r = await fetch(`${baseUrl}/members/member/${member.id}`, {
        headers: { Authorization: token },
      });
      if (r.ok) member = await r.json();
    } catch (_) { /* use existing */ }

    const currentPoints = parseVisitCount(member.points);
    const newPoints = currentPoints + 1;
    const p = member.person || {};
    const displayName = p.displayName || [p.forename, p.surname].filter(Boolean).join(' ') || 'Member';

    console.log(`[SCAN] ${displayName}: ${currentPoints} → ${newPoints}`);

    // メンバーの実 programId を優先（env と不一致の場合がある）
    const effectiveProgramId = (member.programId || programId || '').trim();
    if (member.programId && programId && member.programId !== programId) {
      console.warn(`[SCAN] programId mismatch: env=${programId} member=${member.programId}`);
    }

    // ── Step 2: ポイント更新（3段階フォールバック） ──
    const results = {};

    // 2a: PUT /members/member（全フィールド更新）
    const updateBody = {
      id: member.id,
      programId: effectiveProgramId,
      tierId: member.tierId || (process.env.PASSKIT_TIER_ID || 'base'),
      points: newPoints,
    };
    try {
      const r = await fetch(`${baseUrl}/members/member`, {
        method: 'PUT',
        headers: { Authorization: token, 'Content-Type': 'application/json' },
        body: JSON.stringify(updateBody),
      });
      const t = await r.text();
      results.updateMember = { status: r.status, ok: r.ok, body: t.substring(0, 300) };
      console.log(`[SCAN] updateMember: ${r.status} ${t.substring(0, 200)}`);
      if (r.ok) {
        let afterPoints = newPoints;
        try { afterPoints = parseVisitCount(JSON.parse(t).points); } catch (_) {}
        return res.status(200).json({
          success: true,
          member: displayName,
          visits: afterPoints,
          message: `${displayName}さん ${afterPoints}回目の来店！`,
          via: 'updateMember',
          scanApiVersion: SCAN_API_VERSION,
        });
      }
    } catch (e) {
      results.updateMember = { error: e.message };
      console.log(`[SCAN] updateMember err: ${e.message}`);
    }

    // 2b: PUT /members/member/points/set（絶対値）
    const setBody = { id: member.id, programId: effectiveProgramId, points: newPoints };
    try {
      const r = await fetch(`${baseUrl}/members/member/points/set`, {
        method: 'PUT',
        headers: { Authorization: token, 'Content-Type': 'application/json' },
        body: JSON.stringify(setBody),
      });
      const t = await r.text();
      results.pointsSet = { status: r.status, ok: r.ok, body: t.substring(0, 300) };
      console.log(`[SCAN] points/set: ${r.status} ${t.substring(0, 200)}`);
      if (r.ok) {
        let afterPoints = newPoints;
        try { afterPoints = parseVisitCount(JSON.parse(t).points); } catch (_) {}
        return res.status(200).json({
          success: true,
          member: displayName,
          visits: afterPoints,
          message: `${displayName}さん ${afterPoints}回目の来店！`,
          via: 'points/set',
          scanApiVersion: SCAN_API_VERSION,
        });
      }
    } catch (e) {
      results.pointsSet = { error: e.message };
      console.log(`[SCAN] points/set err: ${e.message}`);
    }

    // 2c: PUT /members/member/points/earn（相対値 +1）
    const earnBody = { id: member.id, programId: effectiveProgramId, points: 1 };
    try {
      const r = await fetch(`${baseUrl}/members/member/points/earn`, {
        method: 'PUT',
        headers: { Authorization: token, 'Content-Type': 'application/json' },
        body: JSON.stringify(earnBody),
      });
      const t = await r.text();
      results.pointsEarn = { status: r.status, ok: r.ok, body: t.substring(0, 300) };
      console.log(`[SCAN] points/earn: ${r.status} ${t.substring(0, 200)}`);
      if (r.ok) {
        let afterPoints = newPoints;
        try { afterPoints = parseVisitCount(JSON.parse(t).points); } catch (_) {}
        return res.status(200).json({
          success: true,
          member: displayName,
          visits: afterPoints,
          message: `${displayName}さん ${afterPoints}回目の来店！`,
          via: 'points/earn',
          scanApiVersion: SCAN_API_VERSION,
        });
      }
    } catch (e) {
      results.pointsEarn = { error: e.message };
      console.log(`[SCAN] points/earn err: ${e.message}`);
    }

    // 全失敗
    console.error(`[SCAN] ALL UPDATES FAILED for ${member.id}`);
    return res.status(500).json({
      error: '来店回数を更新できませんでした',
      memberId: member.id,
      memberProgramId: member.programId,
      envProgramId: programId,
      currentPoints,
      targetPoints: newPoints,
      results,
      scanApiVersion: SCAN_API_VERSION,
    });

  } catch (err) {
    console.error(`[SCAN] FATAL: ${err.stack || err.message}`);
    return res.status(500).json({
      error: 'サーバーエラー',
      detail: err.message,
      scanApiVersion: SCAN_API_VERSION,
    });
  }
};
