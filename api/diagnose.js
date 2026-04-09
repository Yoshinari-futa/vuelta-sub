/**
 * GET /diagnose?secret=0000
 * PassKit メンバー作成の診断エンドポイント
 * Webhookと同じロジックで4名分の作成を試み、結果を返す
 */
const jwt = require('jsonwebtoken');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  const secret = req.query?.secret;
  const staffPin = process.env.SCAN_PIN || '0000';
  if (secret !== staffPin) return res.status(401).json({ error: 'Invalid PIN' });

  const results = {};

  try {
    // PassKit認証
    const apiKeyId = (process.env.PASSKIT_API_KEY || '').trim();
    const apiKeySecret = (process.env.PASSKIT_API_KEY_SECRET || '').trim();
    const now = Math.floor(Date.now() / 1000);
    const token = jwt.sign(
      { uid: apiKeyId, iat: now, exp: now + 3600 },
      apiKeySecret,
      { algorithm: 'HS256', header: { alg: 'HS256', typ: 'JWT' } }
    );

    let host = process.env.PASSKIT_HOST || 'api.pub2.passkit.io';
    if (!host.startsWith('http')) host = 'https://' + host;
    const baseUrl = host.replace(/\/$/, '');
    const programId = process.env.PASSKIT_PROGRAM_ID;
    const tierId = process.env.PASSKIT_TIER_ID;

    results.config = { baseUrl, programId, tierId, tierIdType: typeof tierId };

    // 1. 既存メンバーリスト取得
    const listRes = await fetch(`${baseUrl}/members/member/list/${programId}`, {
      method: 'POST',
      headers: { 'Authorization': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ limit: 100 }),
    });
    const listText = await listRes.text();
    const existingMembers = [];
    if (listRes.ok) {
      const lines = listText.trim().split('\n');
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          const m = parsed.result || parsed;
          existingMembers.push({
            id: m.id,
            externalId: m.externalId || '',
            name: m.person?.displayName || [m.person?.forename, m.person?.surname].filter(Boolean).join(' '),
            email: m.person?.emailAddress || '',
            tierId: m.tierId,
            points: m.points,
            status: m.status,
          });
        } catch (_) {}
      }
    }
    results.existingMembers = existingMembers;

    // 2. テスト: ダミーメンバー作成 → すぐ削除（API接続テスト）
    const testBody = {
      programId,
      tierId,
      person: { displayName: 'API TEST', emailAddress: 'test@test.com' },
      externalId: 'diag-test-' + Date.now(),
      points: 0,
    };

    const createRes = await fetch(`${baseUrl}/members/member`, {
      method: 'POST',
      headers: { 'Authorization': token, 'Content-Type': 'application/json' },
      body: JSON.stringify(testBody),
    });
    const createText = await createRes.text();
    results.testCreate = { status: createRes.status, body: createText.substring(0, 500) };

    // テストメンバー削除
    if (createRes.ok) {
      try {
        const testMember = JSON.parse(createText);
        const delRes = await fetch(`${baseUrl}/members/member`, {
          method: 'DELETE',
          headers: { 'Authorization': token, 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: testMember.id }),
        });
        results.testDelete = { status: delRes.status };
      } catch (_) {
        results.testDelete = { error: 'parse/delete failed' };
      }
    }

    // 3. tierId の検証: tier情報取得
    const tierRes = await fetch(`${baseUrl}/loyalty/tier/${programId}/${tierId}`, {
      headers: { 'Authorization': token },
    });
    results.tierCheck = { status: tierRes.status, url: `/loyalty/tier/${programId}/${tierId}` };

    // 別パスも試す
    const tierRes2 = await fetch(`${baseUrl}/tier/${programId}/${tierId}`, {
      headers: { 'Authorization': token },
    });
    results.tierCheck2 = { status: tierRes2.status, url: `/tier/${programId}/${tierId}` };

  } catch (err) {
    results.error = err.message;
  }

  return res.status(200).json(results);
};
