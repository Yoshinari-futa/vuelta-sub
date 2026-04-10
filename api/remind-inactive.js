/**
 * GET/POST /remind-inactive
 * 14日以上来店がないメンバーにリマインド通知を送る
 *
 * 仕組み：
 *   PassKit Designer 側で 全5ティア（Base/Gold/Silver/Black/Rainbow）の
 *   Information フィールド（フィールドキー: `universal.info`）に
 *   Apple Wallet の Change Message を `VUELTA: %@` でセット済み。
 *
 *   このエンドポイントは該当メンバーの metaData["universal.info"] を
 *   前回と違う文字列に書き換える。
 *   → PassKit が Apple APNs 経由で自動プッシュ
 *   → ロック画面に「VUELTA: We miss you! ...」が表示される。
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
    // Vercel Cron から叩かれた場合は `x-vercel-cron: 1` ヘッダが付くので
    // シークレット無しでも実行を許可する。
    const isVercelCron =
      req.headers &&
      (req.headers['x-vercel-cron'] === '1' || req.headers['X-Vercel-Cron'] === '1');

    const geoSecret = (process.env.GEOFENCE_SECRET || '').trim();
    if (geoSecret && !isVercelCron) {
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

    // テスト用：特定メンバーだけを対象にしたい場合
    //   ?memberId=xxx または ?force=true で他のフィルタを全スキップして強制的に通知
    const targetMemberId = req.query?.memberId || (req.body && req.body.memberId) || null;
    const forceSend = req.query?.force === 'true';

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

      // memberId 指定時はそれ以外を完全スキップ
      if (targetMemberId && m.id !== targetMemberId) {
        continue;
      }

      const meta = m.metaData || {};
      const lastVisit = meta.lastVisit;

      // 有効な日付が取れるまでフォールバックを順に試す。
      // PassKit の member オブジェクトはエンドポイントやバージョンによって
      // フィールド名が異なる（updated / updatedAt / lastUpdated / created 等）ので、
      // よくある候補をまとめて総当たりする。
      const dateCandidates = [
        lastVisit,
        m.updated,
        m.updatedAt,
        m.lastUpdated,
        m.created,
        m.createdAt,
        m.creationDate,
        m.meta && m.meta.created,
        m.meta && m.meta.updated,
      ];
      let lastActiveDate = null;
      for (const c of dateCandidates) {
        if (!c) continue;
        const d = new Date(c);
        if (!isNaN(d.getTime())) {
          lastActiveDate = d;
          break;
        }
      }

      if (!lastActiveDate) {
        if (forceSend || targetMemberId) {
          // テスト時は日付がなくても続行
          lastActiveDate = new Date(0);
        } else {
          noLastVisit++;
          steps.push({
            step: 'no_date_found',
            memberId: m.id,
            keys: Object.keys(m || {}),
          });
          continue;
        }
      }

      // まだアクティブ（force/targetMemberId 指定時はスキップしない）
      if (!forceSend && !targetMemberId && lastActiveDate > cutoffDate) {
        skipped++;
        continue;
      }

      // 既にリマインド済み（force/targetMemberId 指定時はスキップしない）
      if (!forceSend && !targetMemberId && meta.reminderSent) {
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
      //
      // テンプレート側（全5ティア）の Information フィールド
      // （フィールドキー: universal.info）には、あらかじめ PassKit Designer で
      // Apple Wallet の Change Message = "VUELTA: %@" をセット済み。
      //
      // ここでは metaData["universal.info"] を前回値と異なる文字列に
      // 書き換えるだけでよい。
      //
      // ※ changeMessage は前回値との「差分」が条件。同じ文字列を再送信すると
      //   差分とみなされず通知が出ない。タイムスタンプを末尾に付けて
      //   毎回必ずユニーク化する。
      const now = new Date();
      const stamp = now.toLocaleTimeString('ja-JP', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Asia/Tokyo',
      });
      const messageWithStamp = `${REMIND_MESSAGE_EN} (${stamp})`;

      const updateBody = {
        id: m.id,
        programId: m.programId || programId,
        metaData: {
          ...meta,
          // PassKit テンプレートで定義済みの Information フィールド。
          // このキーの値を書き換えることで Change Message "VUELTA: %@" が発火する。
          'universal.info': messageWithStamp,
          reminderSent: now.toISOString(),
          reminderMessage: messageWithStamp,
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
