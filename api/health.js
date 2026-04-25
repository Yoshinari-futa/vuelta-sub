/**
 * GET /health
 * ヘルスチェック + PassKit 疎通テスト
 * ?diag=passkit を付けると PassKit API へ接続テスト
 */
const { getPassKitAuth } = require('../lib/passkit-auth');

module.exports = async function handler(req, res) {
  const base = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'vuelta-membership-backend',
    env: {
      STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY ? 'SET' : 'MISSING',
      STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET ? 'SET' : 'MISSING',
      STRIPE_PRICE_ID: process.env.STRIPE_PRICE_ID ? 'SET' : 'MISSING',
      PASSKIT_HOST: process.env.PASSKIT_HOST ? 'SET' : 'MISSING',
      PASSKIT_API_KEY: process.env.PASSKIT_API_KEY ? 'SET' : 'MISSING',
      PASSKIT_API_KEY_SECRET: process.env.PASSKIT_API_KEY_SECRET ? 'SET' : 'MISSING',
      PASSKIT_TIER_ID: process.env.PASSKIT_TIER_ID || 'MISSING',
      PASSKIT_PROGRAM_ID: process.env.PASSKIT_PROGRAM_ID || 'MISSING',
      EMAIL_FROM: process.env.EMAIL_FROM ? 'SET' : 'MISSING',
      EMAIL_SERVICE: process.env.EMAIL_SERVICE ? 'SET' : 'MISSING',
      EMAIL_USER: process.env.EMAIL_USER ? 'SET' : 'MISSING',
      EMAIL_PASS: process.env.EMAIL_PASS ? 'SET' : 'MISSING',
    },
  };

  // PassKit 疎通テスト
  if (req.query?.diag === 'passkit') {
    try {
      const { token, baseUrl } = getPassKitAuth();
      const programId = (process.env.PASSKIT_PROGRAM_ID || '').trim();

      // 1. プログラム取得テスト
      let programTest = { status: 'skipped' };
      if (programId) {
        const pr = await fetch(`${baseUrl}/members/program/${encodeURIComponent(programId)}`, {
          headers: { Authorization: token },
        });
        const pt = await pr.text();
        programTest = { status: pr.status, body: pt.substring(0, 500) };
      }

      // 2. メンバー一覧テスト
      let listTest = { status: 'skipped' };
      if (programId) {
        const lr = await fetch(`${baseUrl}/members/member/list/${encodeURIComponent(programId)}`, {
          method: 'POST',
          headers: { Authorization: token, 'Content-Type': 'application/json' },
          body: JSON.stringify({ filters: { limit: 50 } }),
        });
        const lt = await lr.text();
        listTest = { status: lr.status, body: lt.substring(0, 20000) };
      }

      // 3. points/set エンドポイント存在確認（空リクエスト）
      let pointsTest = { status: 'skipped' };
      try {
        const ptr = await fetch(`${baseUrl}/members/member/points/set`, {
          method: 'PUT',
          headers: { Authorization: token, 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        const ptt = await ptr.text();
        pointsTest = { status: ptr.status, body: ptt.substring(0, 300) };
      } catch (e) {
        pointsTest = { error: e.message };
      }

      // 4. 特定メンバー取得テスト（?member=xxx）
      let memberTest = { status: 'skipped' };
      const memberId = req.query?.member;
      if (memberId) {
        try {
          const mr = await fetch(`${baseUrl}/members/member/${encodeURIComponent(memberId)}`, {
            headers: { Authorization: token },
          });
          const mt = await mr.text();
          memberTest = { status: mr.status, body: mt.substring(0, 1200) };
        } catch (e) {
          memberTest = { error: e.message };
        }
      }

      base.passkit = {
        baseUrl,
        programId,
        programTest,
        listTest,
        pointsTest,
        memberTest,
      };
    } catch (e) {
      base.passkit = { error: e.message };
    }
  }

  res.json(base);
};
