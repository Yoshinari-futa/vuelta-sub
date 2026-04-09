/**
 * POST /scan
 * バーコードスキャン → PassKit 来店回数（points）+1
 * Body: { memberId, secret }
 *
 * ティア（カード種類）は来店回数で変えない。全員 PASSKIT_TIER_ID または TIER_BASE（passkit-tier-ids）の1種類。
 */

const jwt = require('jsonwebtoken');
const parseVisitCount = require('./parse-visit-count');
const { TIER_BASE } = require('./passkit-tier-ids');

/** 全員共通の PassKit tier（色はこの1種類のみ） */
function getSingleTierId() {
  return (process.env.PASSKIT_TIER_ID || TIER_BASE).trim();
}

/** PassKit list API のレスポンス（NDJSON / 単一JSON / 配列）を配列に統一 */
function parseMemberListResponse(text) {
  const t = (text || '').trim();
  if (!t) return [];
  if (t.startsWith('[')) {
    try {
      const arr = JSON.parse(t);
      return Array.isArray(arr) ? arr : [];
    } catch (_) {
      /* fall through */
    }
  }
  if (t.startsWith('{')) {
    try {
      const obj = JSON.parse(t);
      if (Array.isArray(obj.members)) return obj.members;
      if (Array.isArray(obj.passes)) return obj.passes;
      if (Array.isArray(obj.results)) return obj.results;
      if (obj.result && obj.result.id) return [obj.result];
    } catch (_) {
      /* fall through */
    }
  }
  const out = [];
  for (const line of t.split('\n')) {
    const lineTrim = line.trim();
    if (!lineTrim) continue;
    try {
      const parsed = JSON.parse(lineTrim);
      const m = parsed.result !== undefined ? parsed.result : parsed;
      if (m && m.id) out.push(m);
    } catch (_) {
      /* skip bad line */
    }
  }
  return out;
}

/** クライアント extractMemberId と同等（サーバ側でも再抽出） */
function extractIdFromScannedString(raw) {
  if (!raw || typeof raw !== 'string') return '';
  let val = raw.trim();
  const urlMatch = val.match(/pskt\.io\/(?:c\/)?([A-Za-z0-9_-]{10,})/i);
  if (urlMatch) return urlMatch[1];
  const pathMatch = val.match(/\/([A-Za-z0-9_-]{15,})(?:[?#]|$)/);
  if (pathMatch) return pathMatch[1];
  if (/^[A-Za-z0-9_-]{10,}$/.test(val)) return val;
  return val;
}

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

  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch (_) {
      body = {};
    }
  }
  let { memberId, secret } = body || {};

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
  const urlMatch = cleanId.match(/pskt\.io\/(?:c\/)?([A-Za-z0-9_-]{10,})/i);
  if (urlMatch) cleanId = urlMatch[1];
  // 一般URL末尾のID
  const pathMatch = cleanId.match(/\/([A-Za-z0-9_-]{15,})(?:[?#]|$)/);
  if (!urlMatch && pathMatch) cleanId = pathMatch[1];
  cleanId = extractIdFromScannedString(cleanId) || cleanId;

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
    // PassKit 公式: POST body は { "filters": { "limit", "offset", "orderBy", ... } }
    let allMembers = [];
    if (!member) {
      console.log(`[SCAN] Trying list fallback for: ${memberId}`);
      try {
        const listBody = {
          filters: {
            limit: 500,
            offset: 0,
            orderBy: 'created',
            orderAsc: true,
          },
        };
        let listRes = await fetch(`${baseUrl}/members/member/list/${programId}`, {
          method: 'POST',
          headers: { 'Authorization': token, 'Content-Type': 'application/json' },
          body: JSON.stringify(listBody),
        });
        if (!listRes.ok) {
          listRes = await fetch(`${baseUrl}/members/member/list/${programId}`, {
            method: 'POST',
            headers: { 'Authorization': token, 'Content-Type': 'application/json' },
            body: JSON.stringify({ limit: 500 }),
          });
        }
        if (listRes.ok) {
          const listText = await listRes.text();
          allMembers = parseMemberListResponse(listText);
          console.log(`[SCAN] List returned ${allMembers.length} members`);

          const matchOne = (m) =>
            m.id === memberId ||
            m.externalId === memberId ||
            m.passMetaData?.altId === memberId;

          for (const m of allMembers) {
            if (matchOne(m)) {
              member = m;
              console.log(`[SCAN] Found by list search: ${memberId} → ${m.person?.displayName || m.person?.surname || 'Member'}`);
              break;
            }
          }
          // バーコードが長い文字列にIDを含む場合の緩い一致
          if (!member && memberId.length >= 8) {
            for (const m of allMembers) {
              const candidates = [m.id, m.externalId, m.passMetaData?.altId].filter(Boolean);
              for (const c of candidates) {
                if (c && (memberId.includes(c) || c.includes(memberId))) {
                  member = m;
                  console.log(`[SCAN] Found by fuzzy list match: ${memberId} ↔ ${c}`);
                  break;
                }
              }
              if (member) break;
            }
          }
        } else {
          console.log(`[SCAN] list API failed: ${listRes.status}`);
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

    // 一覧フォールバック等で薄いオブジェクトのときがある。更新前に必ず ID でフル GET し直す（2回目 PUT 失敗の予防）
    try {
      const refreshRes = await fetch(`${baseUrl}/members/member/${member.id}`, {
        headers: { Authorization: token },
      });
      if (refreshRes.ok) {
        member = await refreshRes.json();
        console.log(`[SCAN] Refreshed member by id: ${member.id}`);
      } else {
        console.warn(`[SCAN] Refresh GET failed ${refreshRes.status}, using prior member object`);
      }
    } catch (e) {
      console.warn(`[SCAN] Refresh GET error: ${e.message}`);
    }

    const currentPoints = parseVisitCount(member.points);
    const newPoints = currentPoints + 1;
    const p = member.person || {};
    const displayName = p.displayName || [p.forename, p.surname].filter(Boolean).join(' ') || 'Member';

    if (String(member.points) !== String(currentPoints) && member.points != null) {
      console.warn(
        `[SCAN] points normalized: raw=${JSON.stringify(member.points)} → ${currentPoints} (next ${newPoints})`
      );
    }
    console.log(`[SCAN] ${displayName}: points ${currentPoints} → ${newPoints}`);

    const targetTierId = getSingleTierId();
    if (member.tierId !== targetTierId) {
      console.log(`[SCAN] normalize tier → ${targetTierId} (visits=${newPoints})`);
    }

    // 2. 来店回数 +1、ティアは常に共通の1種類
    const updatePayload = {
      id: member.id,
      programId,
      tierId: targetTierId,
      points: newPoints,
      person: member.person,
      externalId: member.externalId,
    };
    if (member.groupingIdentifier) updatePayload.groupingIdentifier = member.groupingIdentifier;
    if (member.tierPoints !== undefined && member.tierPoints !== null) {
      updatePayload.tierPoints = member.tierPoints;
    }
    if (member.secondaryPoints !== undefined && member.secondaryPoints !== null) {
      updatePayload.secondaryPoints = member.secondaryPoints;
    }
    if (member.optOut === true || member.optOut === false) updatePayload.optOut = member.optOut;
    if (member.passOverrides && typeof member.passOverrides === 'object') {
      updatePayload.passOverrides = member.passOverrides;
    }

    const updateRes = await fetch(`${baseUrl}/members/member`, {
      method: 'PUT',
      headers: { 'Authorization': token, 'Content-Type': 'application/json' },
      body: JSON.stringify(updatePayload),
    });

    const updateText = await updateRes.text();
    console.log(`[SCAN] UPDATE: ${updateRes.status} - ${updateText.substring(0, 500)}`);

    if (!updateRes.ok) {
      let detailObj = updateText;
      try {
        detailObj = JSON.parse(updateText);
      } catch (_) {
        /* plain text */
      }
      return res.status(500).json({
        error: 'Failed to update member',
        passkitStatus: updateRes.status,
        detail: typeof detailObj === 'string' ? detailObj.substring(0, 1200) : detailObj,
      });
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
