/**
 * GET /test-passkit
 * PassKit API接続診断 — stripe.js と同じ方法でメンバー作成を試行
 */
const jwt = require('jsonwebtoken');

module.exports = async function handler(req, res) {
  const steps = [];

  try {
    const passkitApiKeyId = (process.env.PASSKIT_API_KEY || '').trim();
    const passkitApiKeySecret = (process.env.PASSKIT_API_KEY_SECRET || '').trim();
    const programId = process.env.PASSKIT_PROGRAM_ID;
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

    // stripe.js の generatePassKitCard() と同じボディで作成テスト
    const testExternalId = 'diag_test_' + Date.now();
    const body = {
      programId,
      tierId,
      person: { displayName: 'Diagnostic Test', externalId: testExternalId },
      externalId: testExternalId,
      points: 0,
      tierPoints: 0,
    };
    steps.push({ step: 'request_body', body });

    const apiUrl = `${passkitHost}/members/member`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Authorization': token, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const responseText = await response.text();
    steps.push({
      step: 'passkit_response',
      status: response.status,
      ok: response.ok,
      body: responseText.substring(0, 1000),
    });

    if (response.ok) {
      const member = JSON.parse(responseText);
      const region = (process.env.PASSKIT_HOST || '').includes('pub1') ? 'pub1' : 'pub2';
      const walletUrl = `https://${region}.pskt.io/${member.id}`;
      steps.push({ step: 'SUCCESS', memberId: member.id, walletUrl });

      // テストメンバーを削除
      try {
        const delRes = await fetch(`${passkitHost}/members/member/external/${programId}/${testExternalId}`, {
          method: 'DELETE',
          headers: { 'Authorization': token },
        });
        steps.push({ step: 'cleanup', deleted: delRes.ok });
      } catch (_) {
        steps.push({ step: 'cleanup', deleted: false });
      }
    }

  } catch (err) {
    steps.push({ step: 'error', message: err.message, stack: err.stack ? err.stack.substring(0, 300) : '' });
  }

  res.json({ endpoint: 'test-passkit', timestamp: new Date().toISOString(), steps });
};
