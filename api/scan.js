/**
 * POST /scan
 * バーコードスキャン → PassKit 来店回数（points）+1 & ティア自動昇格
 * Body: { memberId, secret }
 *
 * v12: Rainbow ティア追加 (100回以上)
 *   Base(白): 0〜3, Gold(金): 4〜15, Silver(銀): 16〜50, Black(黒): 51〜99, Rainbow(虹): 100+
 */

const parseVisitCount = require('../lib/parse-visit-count');
const { getPassKitAuth } = require('../lib/passkit-auth');
const { TIER_BASE, TIER_SILVER, TIER_GOLD, TIER_BLACK, TIER_RAINBOW } = require('../lib/passkit-tier-ids');
const { getGeofenceLocations } = require('../lib/geofence');
const { getReferralBackFields, getReferralMetaData } = require('../lib/referral');
const { getWalletPushTrigger } = require('../lib/wallet-push');
const { isMemberBirthdayMonth, getBirthDateFromMember, getJSTDate } = require('../lib/birthday');

const META_BIRTHDAY_GRANTED_YEAR = 'birthdayCouponGrantedYear';
const {
  META_FOOD_COUPONS,
  META_PENDING_REFERRAL,
  readFoodCoupons,
  readPendingReferral,
  adjustFoodCoupons,
  findMemberByExternalId,
} = require('../lib/coupons');

const SCAN_API_VERSION = '2026-04-24-v14-referral';

// ── ティア判定 ──
// Base(白): 0〜3, Gold(金): 4〜15, Silver(銀): 16〜50, Black(黒): 51〜99, Rainbow(虹): 100+

const TIER_THRESHOLDS = [
  { min: 100, id: TIER_RAINBOW, label: 'Rainbow' },
  { min: 51,  id: TIER_BLACK,   label: 'Black' },
  { min: 16,  id: TIER_SILVER,  label: 'Silver' },
  { min: 4,   id: TIER_GOLD,    label: 'Gold' },
  { min: 0,   id: TIER_BASE,    label: 'Base' },
];

/** 来店回数からティアIDを決定 */
function tierForVisits(visits) {
  for (const t of TIER_THRESHOLDS) {
    if (visits >= t.min) return t;
  }
  return TIER_THRESHOLDS[TIER_THRESHOLDS.length - 1];
}

// ── helpers ──

/** スキャン文字列からPassKit IDを抽出 */
function extractId(raw) {
  if (!raw || typeof raw !== 'string') return '';
  let val = raw.trim();
  const urlMatch = val.match(/pskt\.io\/(?:c\/)?([A-Za-z0-9_-]{10,})/i);
  if (urlMatch) return urlMatch[1];
  const pathMatch = val.match(/\/([A-Za-z0-9_-]{15,})(?:[?#]|$)/);
  if (pathMatch) return pathMatch[1];
  if (/^[A-Za-z0-9_-]{10,}$/.test(val)) return val;
  return val;
}

/** NDJSON / 配列 / 単一オブジェクトをメンバー配列に統一 */
function parseListResponse(text) {
  const t = (text || '').trim();
  if (!t) return [];
  try {
    const parsed = JSON.parse(t);
    if (Array.isArray(parsed)) return parsed;
    if (parsed.members) return parsed.members;
    if (parsed.passes) return parsed.passes;
    if (parsed.results) return parsed.results;
    if (parsed.id) return [parsed];
  } catch (_) { /* NDJSON */ }
  const out = [];
  for (const line of t.split('\n')) {
    try {
      const obj = JSON.parse(line.trim());
      const m = obj.result || obj;
      if (m && m.id) out.push(m);
    } catch (_) { /* skip */ }
  }
  return out;
}

// ── handler ──

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET: PIN検証のみ
  if (req.method === 'GET') {
    const pin = req.query?.secret;
    const staffPin = process.env.SCAN_PIN || '0000';
    if (pin === staffPin) {
      return res.status(200).json({ valid: true, scanApiVersion: SCAN_API_VERSION });
    }
    return res.status(401).json({ valid: false, error: 'Invalid PIN' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (_) { body = {}; }
  }
  let { memberId, secret } = body || {};

  const staffPin = process.env.SCAN_PIN || '0000';
  if (secret !== staffPin) {
    return res.status(401).json({ error: 'Invalid PIN' });
  }
  if (!memberId) {
    return res.status(400).json({ error: 'memberId is required' });
  }

  const cleanId = extractId(memberId);
  console.log(`[SCAN] raw="${memberId}" clean="${cleanId}"`);

  try {
    const { token, baseUrl } = getPassKitAuth();
    const programId = (process.env.PASSKIT_PROGRAM_ID || '').trim();

    // ── Step 1: メンバー検索 ──
    let member = null;
    let foundVia = '';

    // 1a: ID直接
    try {
      const r = await fetch(`${baseUrl}/members/member/${cleanId}`, {
        headers: { Authorization: token },
      });
      if (r.ok) {
        member = await r.json();
        foundVia = 'directId';
        console.log(`[SCAN] Found by id: ${member.id} program=${member.programId} points=${member.points}`);
      } else {
        console.log(`[SCAN] id lookup: ${r.status}`);
      }
    } catch (e) {
      console.log(`[SCAN] id lookup err: ${e.message}`);
    }

    // 1b: externalId
    if (!member && programId) {
      try {
        const r = await fetch(`${baseUrl}/members/member/external/${programId}/${cleanId}`, {
          headers: { Authorization: token },
        });
        if (r.ok) {
          member = await r.json();
          foundVia = 'externalId';
          console.log(`[SCAN] Found by externalId: ${member.id} points=${member.points}`);
        } else {
          console.log(`[SCAN] extId lookup: ${r.status}`);
        }
      } catch (e) {
        console.log(`[SCAN] extId lookup err: ${e.message}`);
      }
    }

    // 1c: リスト検索（id, externalId, altId で一致）
    if (!member && programId) {
      try {
        const r = await fetch(`${baseUrl}/members/member/list/${programId}`, {
          method: 'POST',
          headers: { Authorization: token, 'Content-Type': 'application/json' },
          body: JSON.stringify({ filters: { limit: 500 } }),
        });
        if (r.ok) {
          const members = parseListResponse(await r.text());
          console.log(`[SCAN] list: ${members.length} members`);

          // 完全一致（id, externalId, altId）
          member = members.find(m =>
            m.id === cleanId ||
            m.externalId === cleanId ||
            (m.passMetaData && m.passMetaData.altId === cleanId)
          );
          if (member) {
            foundVia = 'listExact';
          }

          // 部分一致（バーコードが長い文字列にIDを含む場合）
          if (!member && cleanId.length >= 8) {
            for (const m of members) {
              const candidates = [
                m.id,
                m.externalId,
                m.passMetaData?.altId,
              ].filter(Boolean);
              for (const c of candidates) {
                if (cleanId.includes(c) || c.includes(cleanId)) {
                  member = m;
                  foundVia = `listFuzzy(${c})`;
                  break;
                }
              }
              if (member) break;
            }
          }

          if (member) {
            console.log(`[SCAN] Found in list via ${foundVia}: ${member.id} points=${member.points}`);
          } else {
            // デバッグ: 全メンバーのIDを出力
            const ids = members.map(m => ({
              id: m.id,
              extId: m.externalId || '',
              altId: m.passMetaData?.altId || '',
              points: m.points,
            }));
            console.log(`[SCAN] No match in list. Members: ${JSON.stringify(ids)}`);
          }
        } else {
          console.log(`[SCAN] list: ${r.status}`);
        }
      } catch (e) {
        console.log(`[SCAN] list err: ${e.message}`);
      }
    }

    if (!member) {
      return res.status(404).json({
        error: 'Member not found',
        scannedValue: cleanId,
        programId: programId || null,
        scanApiVersion: SCAN_API_VERSION,
      });
    }

    // メンバーをフルGETで最新データに更新
    try {
      const r = await fetch(`${baseUrl}/members/member/${member.id}`, {
        headers: { Authorization: token },
      });
      if (r.ok) {
        const fresh = await r.json();
        console.log(`[SCAN] Refreshed: id=${fresh.id} points=${fresh.points} program=${fresh.programId}`);
        member = fresh;
      }
    } catch (_) { /* use existing */ }

    const currentPoints = parseVisitCount(member.points);
    const newPoints = currentPoints + 1;
    const p = member.person || {};
    const displayName = p.displayName || [p.forename, p.surname].filter(Boolean).join(' ') || 'Member';

    // ── ティア判定 ──
    const newTier = tierForVisits(newPoints);
    const oldTier = tierForVisits(currentPoints);
    const tierChanged = newTier.id !== (member.tierId || TIER_BASE);

    console.log(`[SCAN] ${displayName}: ${currentPoints} → ${newPoints} tier=${newTier.label}${tierChanged ? ` (升格! ${member.tierId}→${newTier.id})` : ''} foundVia=${foundVia}`);

    // メンバーの実 programId を優先
    const effectiveProgramId = (member.programId || programId || '').trim();
    if (member.programId && programId && member.programId !== programId) {
      console.warn(`[SCAN] programId mismatch: env=${programId} member=${member.programId}`);
    }

    // 成功時の共通レスポンス
    const successResponse = (via, extra = {}) => ({
      success: true,
      member: displayName,
      memberId: member.id,
      visits: newPoints,
      previousVisits: currentPoints,
      tier: newTier.label,
      tierId: newTier.id,
      tierChanged,
      foodCoupons: extra.foodCoupons != null ? extra.foodCoupons : readFoodCoupons(member),
      referralGranted: !!extra.referralGranted,
      referrerName: extra.referrerName || null,
      isBirthdayMonth: !!extra.isBirthdayMonth,
      birthdayBonusGranted: !!extra.birthdayBonusGranted,
      message: tierChanged
        ? `${displayName}さん ${newPoints}回目の来店！🎉 ${newTier.label}ランクに昇格！`
        : `${displayName}さん ${newPoints}回目の来店！`,
      via,
      foundVia,
      scanApiVersion: SCAN_API_VERSION,
    });

    // ── Step 2: ポイント更新 + ティア変更（3段階フォールバック） ──
    const results = {};

    // 紹介成立判定（metaData.pendingReferralReward が入った状態で初めて来店スキャン）
    const pendingRefId = readPendingReferral(member);
    let referrerMember = null;
    let grantedFoodCoupons = readFoodCoupons(member);

    // 誕生月判定（来店スキャン時に年 1 回だけフード1品無料を自動付与）
    // person.dateOfBirth（Portal の Personal Info Birthday）→ metaData.birthMonth の順で参照
    const memberBd = getBirthDateFromMember(member);
    const memberBirthMonth = memberBd ? `${memberBd.month}/${memberBd.day}` : '';
    const memberIsBirthdayMonth = isMemberBirthdayMonth(member);
    const currentYearJST = String(getJSTDate().year);
    const lastBirthdayGrantYear = String(member.metaData?.[META_BIRTHDAY_GRANTED_YEAR] || '');
    const birthdayBonusGranted =
      memberIsBirthdayMonth && lastBirthdayGrantYear !== currentYearJST;

    const nextMetaData = {
      ...(member.metaData || {}),
      // Information 欄をリマインド後も最新の状態に戻す（誕生月なら誕生日メッセージに切替）
      ...getReferralMetaData(member.externalId || member.id, { birthMonth: memberBirthMonth }),
      lastVisit: new Date().toISOString(),
      reminderSent: '',  // スキャン時にリマインドフラグをリセット
    };

    if (birthdayBonusGranted) {
      grantedFoodCoupons += 1;
      nextMetaData[META_FOOD_COUPONS] = String(grantedFoodCoupons);
      nextMetaData[META_BIRTHDAY_GRANTED_YEAR] = currentYearJST;
      console.log(`[SCAN] Birthday bonus: ${displayName} +1 food coupon (year=${currentYearJST}, birthMonth=${memberBirthMonth})`);
    }

    if (pendingRefId && pendingRefId !== (member.externalId || member.id)) {
      referrerMember = await findMemberByExternalId({
        token,
        baseUrl,
        programId: effectiveProgramId,
        externalId: pendingRefId,
      });
      if (referrerMember) {
        grantedFoodCoupons += 1;
        nextMetaData[META_FOOD_COUPONS] = String(grantedFoodCoupons);
        nextMetaData[META_PENDING_REFERRAL] = '';
        console.log(`[SCAN] Referral grant: ${displayName} +1 food coupon (referrer=${pendingRefId})`);
      } else {
        console.warn(`[SCAN] Referrer not found: externalId=${pendingRefId}. Clearing pending flag.`);
        nextMetaData[META_PENDING_REFERRAL] = '';
      }
    }

    // 2a: PUT /members/member（ポイント＋ティア＋ジオフェンス＋最終来店日＋紹介報酬を同時更新）
    const push = getWalletPushTrigger();
    const updateBody = {
      id: member.id,
      programId: effectiveProgramId,
      tierId: newTier.id,
      points: newPoints,
      secondaryPoints: push.secondaryPoints,  // Wallet push 発火用
      metaData: nextMetaData,
      passOverrides: {
        locations: getGeofenceLocations(),
        backFields: getReferralBackFields(member.externalId || member.id),
        relevantDate: push.relevantDate,  // Wallet push 発火用
      },
    };
    try {
      const r = await fetch(`${baseUrl}/members/member`, {
        method: 'PUT',
        headers: { Authorization: token, 'Content-Type': 'application/json' },
        body: JSON.stringify(updateBody),
      });
      const t = await r.text();
      results.updateMember = { status: r.status, ok: r.ok, body: t.substring(0, 300) };
      console.log(`[SCAN] updateMember: ${r.status} ${t.substring(0, 200)}`);
      if (r.ok) {
        // 誕生日ボーナス成立時に Slack 通知
        if (birthdayBonusGranted) {
          const slackUrl = process.env.SLACK_WEBHOOK_URL;
          if (slackUrl) {
            try {
              await fetch(slackUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  blocks: [
                    { type: 'header', text: { type: 'plain_text', text: '🎂 誕生日特典 進呈！', emoji: true } },
                    {
                      type: 'section',
                      text: {
                        type: 'mrkdwn',
                        text: `*${displayName}* さん（誕生月: ${memberBirthMonth}）が来店\nフード 1 品無料クーポン +1 枚`,
                      },
                    },
                  ],
                }),
              });
            } catch (slackErr) {
              console.error(`[SCAN] Birthday Slack notify failed: ${slackErr.message}`);
            }
          }
        }
        // 紹介者側にもフードクーポンを +1（成立時のみ）
        let referrerName = null;
        if (referrerMember) {
          const refResult = await adjustFoodCoupons({
            token,
            baseUrl,
            member: referrerMember,
            delta: 1,
          });
          referrerName =
            referrerMember.person?.displayName ||
            [referrerMember.person?.forenames, referrerMember.person?.surname].filter(Boolean).join(' ') ||
            'Member';
          console.log(`[SCAN] Referrer +1 coupon: ${referrerName} -> ${refResult.ok ? 'OK' : 'FAIL'}`);

          // Slack 通知
          const slackUrl = process.env.SLACK_WEBHOOK_URL;
          if (slackUrl) {
            try {
              await fetch(slackUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  blocks: [
                    { type: 'header', text: { type: 'plain_text', text: '🍽️ 紹介成立！', emoji: true } },
                    {
                      type: 'section',
                      text: {
                        type: 'mrkdwn',
                        text: `*${referrerName}* さんの紹介で *${displayName}* さんが初来店\n両者にフード 1 品無料クーポンを付与しました`,
                      },
                    },
                  ],
                }),
              });
            } catch (slackErr) {
              console.error(`[SCAN] Referral Slack notify failed: ${slackErr.message}`);
            }
          }
        }

        return res.status(200).json(
          successResponse('updateMember', {
            foodCoupons: grantedFoodCoupons,
            referralGranted: !!referrerMember,
            referrerName,
            isBirthdayMonth: memberIsBirthdayMonth,
            birthdayBonusGranted,
          })
        );
      }
    } catch (e) {
      results.updateMember = { error: e.message };
      console.log(`[SCAN] updateMember err: ${e.message}`);
    }

    // 2b: PUT /members/member/points/set
    const setBody = { id: member.id, programId: effectiveProgramId, points: newPoints };
    try {
      const r = await fetch(`${baseUrl}/members/member/points/set`, {
        method: 'PUT',
        headers: { Authorization: token, 'Content-Type': 'application/json' },
        body: JSON.stringify(setBody),
      });
      const t = await r.text();
      results.pointsSet = { status: r.status, ok: r.ok, body: t.substring(0, 300) };
      console.log(`[SCAN] points/set: ${r.status} ${t.substring(0, 200)}`);
      if (r.ok) {
        return res.status(200).json(successResponse('points/set'));
      }
    } catch (e) {
      results.pointsSet = { error: e.message };
      console.log(`[SCAN] points/set err: ${e.message}`);
    }

    // 2c: PUT /members/member/points/earn
    const earnBody = { id: member.id, programId: effectiveProgramId, points: 1 };
    try {
      const r = await fetch(`${baseUrl}/members/member/points/earn`, {
        method: 'PUT',
        headers: { Authorization: token, 'Content-Type': 'application/json' },
        body: JSON.stringify(earnBody),
      });
      const t = await r.text();
      results.pointsEarn = { status: r.status, ok: r.ok, body: t.substring(0, 300) };
      console.log(`[SCAN] points/earn: ${r.status} ${t.substring(0, 200)}`);
      if (r.ok) {
        return res.status(200).json(successResponse('points/earn'));
      }
    } catch (e) {
      results.pointsEarn = { error: e.message };
      console.log(`[SCAN] points/earn err: ${e.message}`);
    }

    // 全失敗
    console.error(`[SCAN] ALL UPDATES FAILED for ${member.id}`);
    return res.status(500).json({
      error: '来店回数を更新できませんでした',
      memberId: member.id,
      memberProgramId: member.programId,
      envProgramId: programId,
      currentPoints,
      targetPoints: newPoints,
      foundVia,
      results,
      scanApiVersion: SCAN_API_VERSION,
    });

  } catch (err) {
    console.error(`[SCAN] FATAL: ${err.stack || err.message}`);
    return res.status(500).json({
      error: 'サーバーエラー',
      detail: err.message,
      scanApiVersion: SCAN_API_VERSION,
    });
  }
};
