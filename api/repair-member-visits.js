/**
 * POST /repair-member-visits
 * 旧バグで壊れた PassKit の points を、正しい来店回数に合わせて上書きする。
 * ティアは全員共通（PASSKIT_TIER_ID または TIER_BASE）の1種類に揃える。
 *
 * Body: { secret, memberId, visits }
 *   secret … REPAIR_MEMBER_SECRET（未設定時は SCAN_PIN）
 *   memberId … PassKit メンバー ID
 *   visits … 正しい来店回数（例: 2）
 */

const parseVisitCount = require('../lib/parse-visit-count');
const { getPassKitAuth } = require('../lib/passkit-auth');
const { TIER_BASE } = require('../lib/passkit-tier-ids');

function getSingleTierId() {
  return (process.env.PASSKIT_TIER_ID || TIER_BASE).trim();
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed', hint: 'POST JSON only' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch (_) {
      body = {};
    }
  }
  const { secret, memberId, visits } = body || {};

  const repairSecret = (process.env.REPAIR_MEMBER_SECRET || process.env.SCAN_PIN || '').trim();
  if (!repairSecret) {
    return res.status(500).json({
      error: 'REPAIR_MEMBER_SECRET or SCAN_PIN must be set in environment',
    });
  }
  if (secret !== repairSecret) {
    return res.status(401).json({ error: 'Invalid secret' });
  }

  if (!memberId || typeof memberId !== 'string') {
    return res.status(400).json({ error: 'memberId required (PassKit member id)' });
  }
  if (visits === undefined || visits === null || visits === '') {
    return res.status(400).json({ error: 'visits required (correct total visit count, e.g. 2)' });
  }

  const v = parseVisitCount(visits);
  const targetTierId = getSingleTierId();

  const programId = process.env.PASSKIT_PROGRAM_ID;
  if (!programId) {
    return res.status(500).json({ error: 'PASSKIT_PROGRAM_ID missing' });
  }

  let token;
  let baseUrl;
  try {
    const auth = getPassKitAuth();
    token = auth.token;
    baseUrl = auth.baseUrl;
  } catch (e) {
    return res.status(500).json({ error: e.message || 'PASSKIT credentials missing' });
  }

  try {
    const getRes = await fetch(`${baseUrl}/members/member/${memberId.trim()}`, {
      headers: { Authorization: token },
    });
    const getText = await getRes.text();
    if (!getRes.ok) {
      return res.status(getRes.status).json({
        error: 'Member not found',
        detail: getText.substring(0, 500),
      });
    }

    const member = JSON.parse(getText);
    const before = {
      points: member.points,
      tierId: member.tierId,
    };

    const effectiveProgramId =
      (member.programId && String(member.programId).trim()) || programId;

    // まず REST の setPoints（絶対値）。updateMember より確実なことが多い。
    let putRes = await fetch(`${baseUrl}/members/member/points/set`, {
      method: 'PUT',
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: member.id,
        points: v,
      }),
    });
    let putText = await putRes.text();

    if (!putRes.ok) {
      putRes = await fetch(`${baseUrl}/members/member`, {
        method: 'PUT',
        headers: { Authorization: token, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: member.id,
          programId: effectiveProgramId,
          tierId: targetTierId,
          points: v,
          person: member.person,
          externalId: member.externalId,
        }),
      });
      putText = await putRes.text();
    }

    if (!putRes.ok) {
      return res.status(500).json({
        error: 'PUT failed',
        before,
        target: { visits: v, tierId: targetTierId },
        detail: putText.substring(0, 800),
      });
    }

    // setPoints だけでは tier が変わらないため、必要ならティアを共通の1種類に揃える
    if (member.tierId !== targetTierId) {
      const tierRes = await fetch(`${baseUrl}/members/member`, {
        method: 'PUT',
        headers: { Authorization: token, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: member.id,
          programId: effectiveProgramId,
          tierId: targetTierId,
          points: v,
        }),
      });
      const tierText = await tierRes.text();
      if (!tierRes.ok) {
        return res.status(500).json({
          error: 'Points were set but tier sync failed',
          before,
          target: { visits: v, tierId: targetTierId },
          detail: tierText.substring(0, 800),
        });
      }
    }

    return res.status(200).json({
      success: true,
      memberId: member.id,
      before,
      after: {
        points: v,
        tierId: targetTierId,
      },
      message: `来店 ${v} 回に修正し、ティアを共通の1種類に揃えました。ウォレットは再表示が必要な場合があります。`,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
