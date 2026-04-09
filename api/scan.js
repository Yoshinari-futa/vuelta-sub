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

  let { memberId, secret } = req.body || {};

  // 簡易認証（スタッフ用PIN）
  const staffPin = process.env.SCAN_PIN || '0000';
  if (secret !== staffPin) {
    return res.status(401).json({ error: 'Invalid PIN' });
  }

  if (!memberId) {
    return res.status(400).json({
      error: 'memberId is required',
      rawBody: JSON.stringify(req.body).substring(0, 200),
    });
  }

  // URL形式の場合、IDを抽出（クライアント側でも処理するが、念のため二重チェック）
  let cleanId = memberId.trim();
  const urlMatch = cleanId.match(/pskt\.io\/(?:c\/)?([A-Za-z0-9_-]{10,})/);
  if (urlMatch) cleanId = urlMatch[1];
  // 一般URL末尾のID
  const pathMatch = cleanId.match(/\/([A-Za-z0-9_-]{15,})(?:\?|$)/);
  if (!urlMatch && pathMatch) cleanId = pathMatch[1];

  console.log(`[SCAN] raw="${memberId}" clean="${cleanId}" len=${cleanId.length}`);
  memberId = cleanId;

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

    // 1. メンバー情報を取得（複数の方法で検索）
    const programId = process.env.PASSKIT_PROGRAM_ID;
    let member = null;

    // 1a: memberId として直接取得
    try {
      const getRes = await fetch(`${baseUrl}/members/member/${memberId}`, {
        headers: { 'Authorization': token },
      });
      if (getRes.ok) {
        member = await getRes.json();
        console.log(`[SCAN] Found by memberId: ${memberId}`);
      } else {
        console.log(`[SCAN] memberId lookup failed (${getRes.status})`);
      }
    } catch (e) {
      console.log(`[SCAN] memberId lookup error: ${e.message}`);
    }

    // 1b: externalId として検索
    if (!member) {
      try {
        const extRes = await fetch(`${baseUrl}/members/member/external/${programId}/${memberId}`, {
          headers: { 'Authorization': token },
        });
        if (extRes.ok) {
          member = await extRes.json();
          console.log(`[SCAN] Found by externalId: ${memberId} → id: ${member.id}`);
        } else {
          console.log(`[SCAN] externalId lookup failed (${extRes.status})`);
        }
      } catch (e) {
        console.log(`[SCAN] externalId lookup error: ${e.message}`);
      }
    }

    // 1c: list APIでプログラム全メンバーから検索（直接GETが404になるケースの回避策）
    let allMembers = [];
    if (!member) {
      console.log(`[SCAN] Trying list fallback for: ${memberId}`);
      try {
        const listRes = await fetch(`${baseUrl}/members/member/list/${programId}`, {
          method: 'POST',
          headers: { 'Authorization': token, 'Content-Type': 'application/json' },
          body: JSON.stringify({ limit: 200 }),
        });
        if (listRes.ok) {
          const listText = await listRes.text();
          const lines = listText.trim().split('\n');
          for (const line of lines) {
            try {
              const parsed = JSON.parse(line);
              const m = parsed.result || parsed;
              if (m.id) allMembers.push(m);
              if (m.id === memberId || m.externalId === memberId || m.passMetaData?.altId === memberId) {
                member = m;
                console.log(`[SCAN] Found by list search: ${memberId} → ${m.person?.displayName || m.person?.surname || 'Member'}`);
              }
            } catch (_) {}
          }
          console.log(`[SCAN] List returned ${allMembers.length} members`);
        }
      } catch (e) {
        console.log(`[SCAN] list fallback error: ${e.message}`);
      }
    }

    if (!member) {
      // デバッグ: 全メンバーのIDリストを出力
      const memberIds = allMembers.map(m => ({
        id: m.id,
        extId: m.externalId || '',
        altId: m.passMetaData?.altId || '',
        name: m.person?.displayName || [m.person?.forename, m.person?.surname].filter(Boolean).join(' ') || '?',
      }));
      console.error(`[SCAN] All lookups failed for: "${memberId}" (len=${memberId.length}). Members in program: ${JSON.stringify(memberIds)}`);
      return res.status(404).json({
        error: 'Member not found',
        scannedValue: memberId,
        scannedLength: memberId.length,
        programId,
        existingMembers: memberIds,
      });
    }
    const currentPoints = member.points || 0;
    const newPoints = currentPoints + 1;
    const p = member.person || {};
    const displayName = p.displayName || [p.forename, p.surname].filter(Boolean).join(' ') || 'Member';

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
