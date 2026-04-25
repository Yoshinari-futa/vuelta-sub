/**
 * GET/POST /birthday-push
 *
 * 毎月 1 日に Vercel Cron から呼ばれる。
 * - 全メンバーをリストし、metaData.birthMonth が今月のメンバーを抽出
 * - そのメンバーの memberInfo を「🎂 Happy Birthday Month」メッセージに更新
 * - secondaryPoints と relevantDate を更新して Apple Wallet に push を発火
 * - 誕生月でないメンバーも、念のため最新メッセージで再書き込み（紹介リンクが
 *   先月誕生月だった人も自動で通常メッセージに戻る）
 *
 * Slack に「🎂 N 名にお祝い push を送信」サマリ通知を送る。
 *
 * 認証:
 *   - Vercel Cron は x-vercel-cron ヘッダーを付ける（無条件で許可）
 *   - 手動実行時は ?secret= で GEOFENCE_SECRET を要求（任意）
 */

const { getPassKitAuth } = require('../lib/passkit-auth');
const { getReferralMetaData, getReferralBackFields } = require('../lib/referral');
const { getWalletPushTrigger } = require('../lib/wallet-push');
const { getGeofenceLocation } = require('../lib/geofence');
const { isMemberBirthdayMonth, getBirthDateFromMember, getJSTDate } = require('../lib/birthday');

function parseListResponse(text) {
  const t = (text || '').trim();
  if (!t) return [];
  try {
    const parsed = JSON.parse(t);
    if (Array.isArray(parsed)) return parsed;
    if (parsed.result) return Array.isArray(parsed.result) ? parsed.result : [parsed.result];
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

module.exports = async function handler(req, res) {
  const steps = [];

  // 認証
  const isVercelCron = !!req.headers['x-vercel-cron'];
  const geoSecret = (process.env.GEOFENCE_SECRET || '').trim();
  if (!isVercelCron && geoSecret) {
    const provided = (req.query || {}).secret || (req.body && req.body.secret) || '';
    if (provided !== geoSecret) {
      return res.status(401).json({ error: 'Invalid or missing secret' });
    }
  }

  try {
    const programId = (process.env.PASSKIT_PROGRAM_ID || '').trim();
    if (!programId) return res.status(500).json({ error: 'PASSKIT_PROGRAM_ID required' });

    const { token, baseUrl } = getPassKitAuth();
    const headers = { Authorization: token, 'Content-Type': 'application/json' };
    const jst = getJSTDate();

    steps.push({ step: 'list_members', programId, jstMonth: jst.month });

    const listResp = await fetch(`${baseUrl}/members/member/list/${encodeURIComponent(programId)}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ limit: 500 }),
    });
    const listText = await listResp.text();
    if (!listResp.ok) {
      steps.push({ step: 'list_failed', status: listResp.status, body: listText.substring(0, 300) });
      return res.status(500).json({ ok: false, steps });
    }
    const members = parseListResponse(listText);
    steps.push({ step: 'members_found', count: members.length });

    let birthdayCount = 0;
    let updated = 0;
    let failed = 0;
    const birthdayMembers = [];

    for (const m of members) {
      if (!m.id) continue;
      const bd = getBirthDateFromMember(m);
      const birthMonth = bd ? `${bd.month}/${bd.day}` : '';
      const isBday = isMemberBirthdayMonth(m);
      if (isBday) {
        birthdayCount++;
        const name =
          m.person?.displayName ||
          [m.person?.forename, m.person?.surname].filter(Boolean).join(' ') ||
          m.id;
        birthdayMembers.push({ id: m.id, name, birthMonth });
      }

      // 全員の memberInfo を再計算（誕生月切替・紹介リンクの最新化を兼ねる）
      // 注意: PassKit の PUT は passOverrides 全体を上書きするため、
      // locations / backFields も明示的に再送しないと wipe される。
      const push = getWalletPushTrigger();
      const externalId = m.externalId || m.id;
      const updateBody = {
        id: m.id,
        programId: m.programId || programId,
        secondaryPoints: push.secondaryPoints,
        metaData: {
          ...(m.metaData || {}),
          ...getReferralMetaData(externalId, { birthMonth }),
        },
        passOverrides: {
          locations: [getGeofenceLocation()],
          backFields: getReferralBackFields(externalId),
          relevantDate: push.relevantDate,
        },
      };

      try {
        const r = await fetch(`${baseUrl}/members/member`, {
          method: 'PUT',
          headers,
          body: JSON.stringify(updateBody),
        });
        if (r.ok) updated++;
        else failed++;
      } catch (_) { failed++; }
    }

    steps.push({ step: 'updated', updated, failed, birthdayCount });

    // Slack 通知
    const slackUrl = process.env.SLACK_WEBHOOK_URL;
    if (slackUrl) {
      try {
        const lines = birthdayMembers
          .map((b) => `• ${b.name}（${b.birthMonth}）`)
          .join('\n') || '（今月誕生日の会員はいません）';
        await fetch(slackUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            blocks: [
              { type: 'header', text: { type: 'plain_text', text: `🎂 ${jst.month}月のお誕生日 push を送信`, emoji: true } },
              { type: 'section', text: { type: 'mrkdwn', text: `今月誕生日: *${birthdayCount}* 名 / 全 ${members.length} 名のカードを更新\n\n${lines}` } },
              { type: 'context', elements: [{ type: 'mrkdwn', text: `updated: ${updated} / failed: ${failed}` }] },
            ],
          }),
        });
      } catch (e) {
        console.error(`[BIRTHDAY-PUSH] slack notify failed: ${e.message}`);
      }
    }

    return res.status(200).json({ ok: true, jstMonth: jst.month, birthdayCount, updated, failed, steps });
  } catch (err) {
    console.error(`[BIRTHDAY-PUSH] FATAL: ${err.message}`);
    return res.status(500).json({ ok: false, error: err.message, steps });
  }
};
