/**
 * POST /scan
 * バーコードスキャン → PassKit来店カウント+1
 * Body: { memberId, secret }
 */

const jwt = require('jsonwebtoken');

module.exports = async function handler(req, res) {
  // CORS（スキャナーページから呼ぶため）
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET: PIN検証のみ（カメラ起動前のチェック用）
  if (req.method === 'GET') {
    const pin = req.query?.secret;
    const staffPin = process.env.SCAN_PIN || '0000';
    if (pin === staffPin) {
      return res.status(200).json({ valid: true });
    }
    return res.status(401).json({ valid: false, error: 'Invalid PIN' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { memberId, secret } = req.body || {};

  // 簡易認証（スタッフ用PIN）
  const staffPin = process.env.SCAN_PIN || '0000';
  if (secret !== staffPin) {
    return res.status(401).json({ error: 'Invalid PIN' });
  }

  if (!memberId) {
    return res.status(400).json({ error: 'memberId is required' });
  }

  console.log(`[SCAN] id=${memberId} len=${memberId.length}`);

  try {
    // PassKit認証
    const apiKeyId = (process.env.PASSKIT_API_KEY || '').trim();
    const apiKeySecret = (process.env.PASSKIT_API_KEY_SECRET || '').trim();
    if (!apiKeyId || !apiKeySecret) throw new Error('PASSKIT credentials missing');

    const now = Math.floor(Date.now() / 1000);
    const token = jwt.sign(
      { uid: apiKeyId, iat: now, exp: now + 3600 },
      apiKeySecret,
      { algorithm: 'HS256', header: { alg: 'HS256', typ: 'JWT' } }
    );

    let host = process.env.PASSKIT_HOST || 'api.pub2.passkit.io';
    if (!host.startsWith('http')) host = 'https://' + host;
    const baseUrl = host.replace(/\/$/, '');

    // 1. メンバー情報を取得（memberIdで試す → 失敗したらexternalIdとして検索）
    const programId = process.env.PASSKIT_PROGRAM_ID;
    let member = null;

    // 1a: memberId として直接取得
    const getRes = await fetch(`${baseUrl}/members/member/${memberId}`, {
      headers: { 'Authorization': token },
    });

    if (getRes.ok) {
      member = await getRes.json();
      console.log(`[SCAN] Found by memberId: ${memberId}`);
    } else {
      console.log(`[SCAN] memberId lookup failed (${getRes.status}), trying externalId...`);

      // 1b: externalId として検索（バーコードにexternalIdが入っている場合）
      const extRes = await fetch(`${baseUrl}/members/member/external/${programId}/${memberId}`, {
        headers: { 'Authorization': token },
      });

      if (extRes.ok) {
        member = await extRes.json();
        console.log(`[SCAN] Found by externalId: ${memberId} → internal id: ${member.id}`);
      } else {
        const extErrText = await extRes.text();
        console.error(`[SCAN] Both lookups failed for: ${memberId}, extRes: ${extRes.status} ${extErrText.substring(0, 200)}`);

        // 1c: バーコード値の前後をトリムしたり、エンコーディングの問題を確認
        console.error(`[SCAN] Raw barcode value (length=${memberId.length}): "${memberId}"`);

        return res.status(404).json({
          error: 'Member not found',
          scannedValue: memberId,
          scannedLength: memberId.length,
          tried: {
            memberIdUrl: `${baseUrl}/members/member/${memberId}`,
            externalIdUrl: `${baseUrl}/members/member/external/${programId}/${memberId}`,
          },
          programId,
        });
      }
    }
    const currentPoints = member.points || 0;
    const newPoints = currentPoints + 1;
    const displayName = member.person?.displayName || 'Member';

    console.log(`[SCAN] ${displayName}: points ${currentPoints} → ${newPoints}`);

    // 2. ポイント（来店回数）を+1して更新
    const updateRes = await fetch(`${baseUrl}/members/member`, {
      method: 'PUT',
      headers: { 'Authorization': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: member.id,
        programId: programId,
        points: newPoints,
      }),
    });

    const updateText = await updateRes.text();
    console.log(`[SCAN] UPDATE: ${updateRes.status} - ${updateText.substring(0, 200)}`);

    if (!updateRes.ok) {
      return res.status(500).json({ error: 'Failed to update points', detail: updateText.substring(0, 100) });
    }

    return res.status(200).json({
      success: true,
      member: displayName,
      visits: newPoints,
      message: `${displayName}さん ${newPoints}回目の来店！`,
    });

  } catch (err) {
    console.error(`[SCAN] ERROR: ${err.message}`);
    return res.status(500).json({ error: err.message });
  }
};
