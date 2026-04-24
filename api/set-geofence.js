/**
 * PassKit ジオフェンス設定（全ティア + 全メンバー）
 * GET/POST /set-geofence
 *
 * v2: 全ティアのテンプレート locations を更新し、
 *     さらに全メンバーの passOverrides.locations も一括更新。
 *
 * 任意: ?secret=環境変数 GEOFENCE_SECRET と一致させると実行
 */

const { getPassKitAuth } = require('../lib/passkit-auth');
const { TIER_BASE, TIER_SILVER, TIER_GOLD, TIER_BLACK, TIER_RAINBOW } = require('../lib/passkit-tier-ids');
const { getGeofenceLocation } = require('../lib/geofence');
const { getReferralBackFields } = require('../lib/referral');

const ALL_TIERS = [TIER_BASE, TIER_GOLD, TIER_SILVER, TIER_BLACK, TIER_RAINBOW];

module.exports = async function handler(req, res) {
  const steps = [];

  try {
    // Auth check
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

    const locationEntry = getGeofenceLocation();
    const { latitude: lat, longitude: lng, relevantText } = locationEntry;

    let token, baseUrl;
    try {
      const auth = getPassKitAuth();
      token = auth.token;
      baseUrl = auth.baseUrl;
    } catch (e) {
      return res.status(500).json({ error: 'PassKit auth failed: ' + e.message });
    }

    const headers = { Authorization: token, 'Content-Type': 'application/json' };

    // ── Step 1: 全メンバーを取得して passOverrides.locations を一括更新 ──
    steps.push({ step: 'list_members', programId });

    const listResp = await fetch(`${baseUrl}/members/member/list/${encodeURIComponent(programId)}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ limit: 100 }),
    });
    const listText = await listResp.text();

    if (!listResp.ok) {
      steps.push({ step: 'list_members_failed', status: listResp.status, body: listText.substring(0, 300) });
    } else {
      let members = [];
      try {
        const listData = JSON.parse(listText);
        // PassKit returns { result: member } for single or { result: [...] } for array
        if (Array.isArray(listData)) {
          members = listData;
        } else if (listData.result) {
          members = Array.isArray(listData.result) ? listData.result : [listData.result];
        } else if (listData.id) {
          members = [listData];
        }
      } catch (e) {
        // Sometimes the list endpoint returns newline-delimited JSON
        members = listText.split('\n').filter(Boolean).map(line => {
          try {
            const parsed = JSON.parse(line);
            return parsed.result || parsed;
          } catch { return null; }
        }).filter(Boolean);
      }

      steps.push({ step: 'members_found', count: members.length });

      let updated = 0;
      let failed = 0;

      for (const m of members) {
        if (!m.id) continue;
        const updateBody = {
          id: m.id,
          programId: m.programId || programId,
          passOverrides: {
            locations: [locationEntry],
            backFields: getReferralBackFields(m.externalId || m.id),
          },
        };

        try {
          const r = await fetch(`${baseUrl}/members/member`, {
            method: 'PUT',
            headers,
            body: JSON.stringify(updateBody),
          });
          if (r.ok) {
            updated++;
          } else {
            const errText = await r.text();
            failed++;
            if (updated === 0 && failed === 1) {
              steps.push({ step: 'first_member_update_failed', status: r.status, body: errText.substring(0, 200) });
            }
          }
        } catch (e) {
          failed++;
        }
      }

      steps.push({ step: 'members_updated', updated, failed });
    }

    // ── Step 2: 各ティアのテンプレートにも locations を設定（テンプレAPI が動く場合） ──
    for (const tierId of ALL_TIERS) {
      try {
        const tierUrl = `${baseUrl}/members/tier/${programId}/${tierId}`;
        const tierResp = await fetch(tierUrl, { headers: { Authorization: token } });
        if (!tierResp.ok) {
          steps.push({ step: 'tier_skip', tierId, status: tierResp.status });
          continue;
        }
        const tierData = await tierResp.json();
        const passTemplateId = tierData.passTemplateId;
        if (!passTemplateId) {
          steps.push({ step: 'tier_no_template', tierId });
          continue;
        }

        // Try multiple template API paths
        const templatePaths = [
          `/template/${passTemplateId}`,
          `/passes/template/${passTemplateId}`,
        ];

        let templateData = null;
        let workingPath = null;

        for (const tp of templatePaths) {
          try {
            const r = await fetch(`${baseUrl}${tp}`, { headers: { Authorization: token } });
            if (r.ok) {
              templateData = await r.json();
              workingPath = tp;
              break;
            }
          } catch {}
        }

        if (!templateData) {
          steps.push({ step: 'template_get_failed', tierId, passTemplateId });
          continue;
        }

        // Update template with locations
        const updatePayload = { ...templateData };
        delete updatePayload.metrics;
        delete updatePayload.created;
        delete updatePayload.updated;
        updatePayload.locations = [locationEntry];

        const putResp = await fetch(`${baseUrl}/template`, {
          method: 'PUT',
          headers,
          body: JSON.stringify(updatePayload),
        });
        steps.push({
          step: 'template_updated',
          tierId,
          passTemplateId,
          status: putResp.status,
          ok: putResp.ok,
        });
      } catch (e) {
        steps.push({ step: 'tier_error', tierId, error: e.message });
      }
    }

    const success = steps.some(s => s.step === 'members_updated' && s.updated > 0);
    res.status(success ? 200 : 500).json({
      ok: success,
      endpoint: 'set-geofence-v2',
      timestamp: new Date().toISOString(),
      target: { lat, lng, relevantText },
      steps,
    });

  } catch (err) {
    steps.push({ step: 'error', message: err.message });
    res.status(500).json({ ok: false, endpoint: 'set-geofence-v2', steps });
  }
};
