/**
 * POST /use-coupon
 * フード1品無料クーポンを 1 枚消費する。
 * Body: { memberId, secret }   secret = SCAN_PIN（scanner.html から呼ぶ）
 */

const { getPassKitAuth } = require('../lib/passkit-auth');
const { readFoodCoupons, adjustFoodCoupons } = require('../lib/coupons');

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

    const r = await fetch(`${baseUrl}/members/member/${encodeURIComponent(memberId)}`, {
      headers: { Authorization: token },
    });
    if (!r.ok) {
      const t = await r.text();
      return res.status(404).json({ error: 'Member not found', status: r.status, body: t.substring(0, 300) });
    }
    const member = await r.json();

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
      message: `フード 1 品無料を 1 枚消費しました（残 ${result.after} 枚）`,
    });
  } catch (err) {
    console.error(`[USE-COUPON] FATAL: ${err.message}`);
    return res.status(500).json({ error: err.message });
  }
};
