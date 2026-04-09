/**
 * GET/POST /remind-inactive
 * 14日以上来店がないメンバーにリマインド通知を送る
 *
 * Apple Wallet はパスの内容が変更されるとプッシュ通知を自動送信する。
 * メンバーの metaData.backField を更新 → Wallet が通知 →
 * ロック画面に「パスが更新されました」と表示される。
 *
 * ?secret= で GEOFENCE_SECRET と照合（任意）
 * ?days=14 で日数を変更可能（デフォルト14日）
 * ?dry=true でドライラン（実際の更新なし）
 */

const { getPassKitAuth } = require('../lib/passkit-auth');

const REMIND_MESSAGE_EN = "We miss you! Your next drink is waiting at VUELTA.";
const INACTIVE_DAYS_DEFAULT = 14;

module.exports = async function handler(req, res) {
  const steps = [];

  try {
    // Auth
    const geoSecret = (process.env.GEOFENCE_SECRET || '').trim();
    if (geoSecret) {
      const provided = (req.query || {}).secret || (req.body && req.body.secret) || '';
      if (provided !== geoSecret) {
        return res.status(401).json({ error: 'Invalid or missing secret' });
      }
    }

    const programId = process.env.PASSKIT_PROGRAM_ID;
    if (!programId) {
      return res.status(500).json({ error: 'PASSKIT_PROGRAM_ID required' });
    }

    const daysParam = req.query?.days;
    const inactiveDays = daysParam !== undefined && daysParam !== '' ? parseInt(daysParam) : INACTIVE_DAYS_DEFAULT;
    const dryRun = req.query?.dry === 'true';
    const cutoffDate = new Date(Date.now() - inactiveDays * 24 * 60 * 60 * 1000);

    let token, baseUrl;
    try {
      const auth = getPassKitAuth();
      token = auth.token;
      baseUrl = auth.baseUrl;
    } catch (e) {
      return res.status(500).json({ error: 'PassKit auth failed: ' + e.message });
    }

    const headers = { Authorization: token, 'Content-Type': 'application/json' };

    // ── Step 1: 全メンバー取得 ──
    const listResp = await fetch(`${baseUrl}/members/member/list/${encodeURIComponent(programId)}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ limit: 200 }),
    });

    if (!listResp.ok) {
      const t = await listResp.text();
      return res.status(502).json({ error: 'Failed to list members', status: listResp.status, body: t.substring(0, 300) });
    }

    const listText = await listResp.text();
    let members = [];
    try {
      // PassKit returns newline-delimited JSON for streaming results
      members = listText.split('\n').filter(Boolean).map(line => {
        try {
          const parsed = JSON.parse(line);
          return parsed.result || parsed;
        } catch { return null; }
      }).filter(Boolean);
    } catch {
      try {
        const data = JSON.parse(listText);
        members = Array.isArray(data) ? data : (data.result ? (Array.isArray(data.result) ? data.result : [data.result]) : [data]);
      } catch {
        return res.status(502).json({ error: 'Failed to parse member list' });
      }
    }

    steps.push({ step: 'members_listed', total: members.length });

    // ── Step 2: 非アクティブ判定 & 通知 ──
    let reminded = 0;
    let skipped = 0;
    let noLastVisit = 0;
    let alreadyReminded = 0;
    const remindedMembers = [];

    for (const m of members) {
      if (!m.id) continue;
      const meta = m.metaData || {};
      const lastVisit = meta.lastVisit;

      // lastVisit が未設定 → 初回 set-geofence 以前のメンバー
      // updated フィールドをフォールバックに使う
      let lastActiveDate = null;
      if (lastVisit) {
        lastActiveDate = new Date(lastVisit);
      } else if (m.updated) {
        lastActiveDate = new Date(m.updated);
      }

      if (!lastActiveDate || isNaN(lastActiveDate.getTime())) {
        noLastVisit++;
        continue;
      }

      // まだアクティブ
      if (lastActiveDate > cutoffDate) {
        skipped++;
        continue;
      }

      // 既にリマインド済み（同じ期間内に2回送らない）
      if (meta.reminderSent) {
        const reminderDate = new Date(meta.reminderSent);
        if (!isNaN(reminderDate.getTime()) && reminderDate > cutoffDate) {
          alreadyReminded++;
          continue;
        }
      }

      const displayName = m.person
        ? [m.person.forename, m.person.surname].filter(Boolean).join(' ') || m.id
        : m.id;

      const daysSince = Math.floor((Date.now() - lastActiveDate.getTime()) / (24 * 60 * 60 * 1000));

      if (dryRun) {
        remindedMembers.push({ id: m.id, name: displayName, daysSince, lastVisit: lastActiveDate.toISOString() });
        reminded++;
        continue;
      }

      // パス更新 → Apple Wallet がプッシュ通知を自動送信
      const updateBody = {
        id: m.id,
        programId: m.programId || programId,
        metaData: {
          ...meta,
          reminderSent: new Date().toISOString(),
          reminderMessage: REMIND_MESSAGE_EN,
        },
      };

      try {
        const r = await fetch(`${baseUrl}/members/member`, {
          method: 'PUT',
          headers,
          body: JSON.stringify(updateBody),
        });
        if (r.ok) {
          reminded++;
          remindedMembers.push({ id: m.id, name: displayName, daysSince });
        } else {
          const errText = await r.text();
          steps.push({ step: 'update_failed', memberId: m.id, status: r.status, body: errText.substring(0, 150) });
        }
      } catch (e) {
        steps.push({ step: 'update_error', memberId: m.id, error: e.message });
      }
    }

    steps.push({
      step: 'summary',
      total: members.length,
      reminded,
      skipped,
      noLastVisit,
      alreadyReminded,
    });

    res.status(200).json({
      ok: true,
      endpoint: 'remind-inactive',
      dryRun,
      inactiveDays,
      cutoffDate: cutoffDate.toISOString(),
      message: REMIND_MESSAGE_EN,
      timestamp: new Date().toISOString(),
      reminded,
      remindedMembers,
      steps,
    });

  } catch (err) {
    steps.push({ step: 'error', message: err.message });
    res.status(500).json({ ok: false, endpoint: 'remind-inactive', steps });
  }
};
