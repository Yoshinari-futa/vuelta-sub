/**
 * GET /list-members
 * プログラム内の全メンバーを一覧表示（デバッグ用）
 */
const jwt = require('jsonwebtoken');

module.exports = async function handler(req, res) {
  try {
    const apiKey = (process.env.PASSKIT_API_KEY || '').trim();
    const apiSecret = (process.env.PASSKIT_API_KEY_SECRET || '').trim();
    const programId = process.env.PASSKIT_PROGRAM_ID;
    let host = process.env.PASSKIT_HOST || 'api.pub2.passkit.io';
    if (!host.startsWith('http')) host = 'https://' + host;
    host = host.replace(/\/$/, '');

    const now = Math.floor(Date.now() / 1000);
    const token = jwt.sign(
      { uid: apiKey, iat: now, exp: now + 3600 },
      apiSecret,
      { algorithm: 'HS256', header: { alg: 'HS256', typ: 'JWT' } }
    );

    // メンバー一覧を取得（複数のAPIパターンを試す）
    const results = [];

    // パターン1: POST /members/member/list/{programId}
    try {
      const r = await fetch(`${host}/members/member/list/${programId}`, {
        method: 'POST',
        headers: { 'Authorization': token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 50 }),
      });
      const t = await r.text();
      results.push({ pattern: `POST /members/member/list/${programId}`, status: r.status, body: t.substring(0, 3000) });
    } catch (e) {
      results.push({ pattern: 'list/programId', error: e.message });
    }

    // パターン2: GET /members/member/list/{programId}
    try {
      const r = await fetch(`${host}/members/member/list/${programId}`, {
        headers: { 'Authorization': token },
      });
      const t = await r.text();
      results.push({ pattern: `GET /members/member/list/${programId}`, status: r.status, body: t.substring(0, 3000) });
    } catch (e) {
      results.push({ pattern: 'GET list', error: e.message });
    }

    // パターン3: POST /members/member/count/programId (メンバー数)
    try {
      const r = await fetch(`${host}/members/member/count/${programId}`, {
        method: 'POST',
        headers: { 'Authorization': token, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const t = await r.text();
      results.push({ pattern: 'count', status: r.status, body: t.substring(0, 500) });
    } catch (e) {
      results.push({ pattern: 'count', error: e.message });
    }

    // パターン4: スキャンされたID（2ss2itmtKum）を直接検索
    const scannedId = req.query?.id;
    if (scannedId) {
      // 直接ID
      try {
        const r = await fetch(`${host}/members/member/${scannedId}`, {
          headers: { 'Authorization': token },
        });
        const t = await r.text();
        results.push({ pattern: `direct /${scannedId}`, status: r.status, body: t.substring(0, 1000) });
      } catch (e) {
        results.push({ pattern: 'direct', error: e.message });
      }

      // externalId
      try {
        const r = await fetch(`${host}/members/member/external/${programId}/${scannedId}`, {
          headers: { 'Authorization': token },
        });
        const t = await r.text();
        results.push({ pattern: `external/${programId}/${scannedId}`, status: r.status, body: t.substring(0, 1000) });
      } catch (e) {
        results.push({ pattern: 'external', error: e.message });
      }
    }

    res.json({ programId, host, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
