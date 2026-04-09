/**
 * POST /repair-member-visits
 * 旧バグで壊れた PassKit の points / tier を、正しい来店回数に合わせて上書きする。
 *
 * Body: { secret, memberId, visits }
 *   secret … REPAIR_MEMBER_SECRET（未設定時は SCAN_PIN）
 *   memberId … PassKit メンバー ID
 *   visits … 正しい来店回数（例: 2）
 */

const jwt = require('jsonwebtoken');
const { parseVisitCount, tierIdForVisitCount, tierColorLabel } = require('./visit-tier-helpers');

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
  const targetTierId = tierIdForVisitCount(v);

  const apiKeyId = (process.env.PASSKIT_API_KEY || '').trim();
  const apiKeySecret = (process.env.PASSKIT_API_KEY_SECRET || '').trim();
  const programId = process.env.PASSKIT_PROGRAM_ID;
  let host = process.env.PASSKIT_HOST || 'api.pub2.passkit.io';
  if (!host.startsWith('http')) host = 'https://' + host;
  const baseUrl = host.replace(/\/$/, '');

  if (!apiKeyId || !apiKeySecret || !programId) {
    return res.status(500).json({ error: 'PASSKIT credentials or PROGRAM_ID missing' });
  }

  const now = Math.floor(Date.now() / 1000);
  const token = jwt.sign(
    { uid: apiKeyId, iat: now, exp: now + 3600 },
    apiKeySecret,
    { algorithm: 'HS256', header: { alg: 'HS256', typ: 'JWT' } }
  );

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

    const putRes = await fetch(`${baseUrl}/members/member`, {
      method: 'PUT',
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: member.id,
        programId,
        tierId: targetTierId,
        points: v,
        person: member.person,
        externalId: member.externalId,
      }),
    });
    const putText = await putRes.text();

    if (!putRes.ok) {
      return res.status(500).json({
        error: 'PUT failed',
        before,
        target: { visits: v, tierId: targetTierId, tierColor: tierColorLabel(targetTierId) },
        detail: putText.substring(0, 800),
      });
    }

    return res.status(200).json({
      success: true,
      memberId: member.id,
      before,
      after: {
        points: v,
        tierId: targetTierId,
        tierColor: tierColorLabel(targetTierId),
      },
      message: `来店 ${v} 回・${tierColorLabel(targetTierId).toUpperCase()} に修正しました。ウォレットは再表示が必要な場合があります。`,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
