/**
 * GET /test-passkit
 * PassKit API接続診断 — tier一覧取得 + メンバー作成テスト
 * ?program=XXXX で別のプログラムIDを試せる
 */
const jwt = require('jsonwebtoken');

module.exports = async function handler(req, res) {
  const steps = [];

  try {
    const passkitApiKeyId = (process.env.PASSKIT_API_KEY || '').trim();
    const passkitApiKeySecret = (process.env.PASSKIT_API_KEY_SECRET || '').trim();
    const programId = req.query?.program || process.env.PASSKIT_PROGRAM_ID;
    const tierId = process.env.PASSKIT_TIER_ID;
    let passkitHost = process.env.PASSKIT_HOST || 'api.pub2.passkit.io';
    if (!passkitHost.startsWith('http')) passkitHost = 'https://' + passkitHost;
    passkitHost = passkitHost.replace(/\/$/, '');

    steps.push({
      step: 'config',
      host: passkitHost,
      programId: programId || 'MISSING',
      tierId: tierId || 'MISSING',
      apiKeyId: passkitApiKeyId ? passkitApiKeyId.substring(0, 8) + '...' : 'MISSING',
      apiKeySecret: passkitApiKeySecret ? 'SET (' + passkitApiKeySecret.length + ' chars)' : 'MISSING',
    });

    // JWT生成
    const now = Math.floor(Date.now() / 1000);
    const token = jwt.sign(
      { uid: passkitApiKeyId, iat: now, exp: now + 3600 },
      passkitApiKeySecret,
      { algorithm: 'HS256', header: { alg: 'HS256', typ: 'JWT' } }
    );
    steps.push({ step: 'jwt', token: token.substring(0, 30) + '...' });

    // === ステップ1: プログラム情報を取得（ティア一覧を含む） ===
    try {
      const progRes = await fetch(`${passkitHost}/members/program/${programId}`, {
        method: 'GET',
        headers: { 'Authorization': token },
      });
      const progText = await progRes.text();
      steps.push({
        step: 'program_info',
        status: progRes.status,
        body: progText.substring(0, 2000),
      });
    } catch (err) {
      steps.push({ step: 'program_info_error', message: err.message });
    }

    // === ステップ2: ティア一覧を取得 ===
    try {
      const tierRes = await fetch(`${passkitHost}/members/program/${programId}/tiers`, {
        method: 'GET',
        headers: { 'Authorization': token },
      });
      const tierText = await tierRes.text();
      steps.push({
        step: 'tiers_list',
        status: tierRes.status,
        body: tierText.substring(0, 2000),
      });
    } catch (err) {
      steps.push({ step: 'tiers_list_error', message: err.message });
    }

    // === ステップ3: 別のエンドポイントでティア取得を試みる ===
    try {
      const tierRes2 = await fetch(`${passkitHost}/members/tier/program/${programId}`, {
        method: 'GET',
        headers: { 'Authorization': token },
      });
      const tierText2 = await tierRes2.text();
      steps.push({
        step: 'tiers_alt',
        status: tierRes2.status,
        body: tierText2.substring(0, 2000),
      });
    } catch (err) {
      steps.push({ step: 'tiers_alt_error', message: err.message });
    }

    // === ステップ4: tierId ありでメンバー作成を試みる（本番と同じ形式） ===
    const testExternalId = 'diag_test_' + Date.now();
    try {
      const bodyWithTier = {
        programId,
        tierId,
        person: {
          displayName: 'Diagnostic Test',
          emailAddress: 'test@example.com',
          forenames: 'Diagnostic',
          surname: 'Test',
        },
        externalId: testExternalId,
        points: 0,
        tierPoints: 0,
      };
      steps.push({ step: 'create_request', body: bodyWithTier });

      const createRes = await fetch(`${passkitHost}/members/member`, {
        method: 'POST',
        headers: { 'Authorization': token, 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyWithTier),
      });
      const createText = await createRes.text();
      steps.push({
        step: 'create_member_with_tier',
        status: createRes.status,
        ok: createRes.ok,
        body: createText.substring(0, 1000),
      });

      // 成功した場合、Wallet URLを生成して削除
      if (createRes.ok) {
        const member = JSON.parse(createText);
        const region = (process.env.PASSKIT_HOST || '').includes('pub1') ? 'pub1' : 'pub2';
        const walletUrl = `https://${region}.pskt.io/${member.id}`;
        steps.push({ step: 'SUCCESS', memberId: member.id, walletUrl });

        // テストメンバーを削除（memberIdで削除）
        try {
          const delRes = await fetch(`${passkitHost}/members/member/${member.id}`, {
            method: 'DELETE',
            headers: { 'Authorization': token },
          });
          const delText = await delRes.text();
          steps.push({ step: 'cleanup', deleted: delRes.ok, status: delRes.status, body: delText.substring(0, 200) });
        } catch (e) {
          steps.push({ step: 'cleanup', deleted: false, error: e.message });
        }
      }
    } catch (err) {
      steps.push({ step: 'create_member_error', message: err.message });
    }

  } catch (err) {
    steps.push({ step: 'error', message: err.message, stack: err.stack ? err.stack.substring(0, 300) : '' });
  }

  res.json({ endpoint: 'test-passkit', timestamp: new Date().toISOString(), steps });
};
