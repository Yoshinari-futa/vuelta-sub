/**
 * VUELTA クーポン（フード1品無料など）の共通ヘルパー
 *
 * PassKit メンバーの metaData に以下のキーで保存:
 *   - foodCoupons: 数値（残り枚数、0 以上）
 *   - pendingReferralReward: 紹介者の externalId（初スキャン時に消費）
 *
 * クーポンは誕生日特典・ティア昇格祝い・紹介成立などで共通利用する想定。
 */

const META_FOOD_COUPONS = 'foodCoupons';
const META_PENDING_REFERRAL = 'pendingReferralReward';

function readFoodCoupons(member) {
  const v = member?.metaData?.[META_FOOD_COUPONS];
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function readPendingReferral(member) {
  const v = member?.metaData?.[META_PENDING_REFERRAL];
  return v && String(v).trim() ? String(v).trim() : '';
}

/** 指定メンバーの foodCoupons を delta だけ加算（負数で減算）。0 未満にはならない。 */
async function adjustFoodCoupons({ token, baseUrl, member, delta }) {
  if (!member || !member.id) return { ok: false, error: 'member missing' };

  const current = readFoodCoupons(member);
  const next = Math.max(0, current + delta);

  const body = {
    id: member.id,
    programId: member.programId,
    metaData: {
      ...(member.metaData || {}),
      [META_FOOD_COUPONS]: String(next),
    },
  };

  try {
    const r = await fetch(`${baseUrl}/members/member`, {
      method: 'PUT',
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await r.text();
    return { ok: r.ok, status: r.status, body: text.substring(0, 200), before: current, after: next };
  } catch (e) {
    return { ok: false, error: e.message, before: current, after: next };
  }
}

/** PassKit メンバーを externalId で引く（紹介者の検索用）。見つからなければ null。 */
async function findMemberByExternalId({ token, baseUrl, programId, externalId }) {
  if (!programId || !externalId) return null;
  try {
    const r = await fetch(
      `${baseUrl}/members/member/external/${encodeURIComponent(programId)}/${encodeURIComponent(externalId)}`,
      { headers: { Authorization: token } }
    );
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

module.exports = {
  META_FOOD_COUPONS,
  META_PENDING_REFERRAL,
  readFoodCoupons,
  readPendingReferral,
  adjustFoodCoupons,
  findMemberByExternalId,
};
