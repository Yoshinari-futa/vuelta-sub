/**
 * PassKit ジオフェンス設定
 * GET/POST /set-geofence
 *
 * Apple Wallet の近接表示は **パスに埋め込まれた locations** に依存する。
 * PassKit の gRPC `Program` メッセージには locations フィールドがなく、
 * `PUT /members/program` に locations を載せても GET に反映されない／無視される可能性が高い。
 * 正しい経路は **ティアの passTemplateId に紐づく Pass Template** を `GET/PUT /template` で更新すること。
 *
 * （半径は OS / ウォレット側の仕様。Apple は relevantText は短め推奨）
 *
 * 任意: ?secret=環境変数 GEOFENCE_SECRET と一致させると実行（未設定なら誰でも実行可）
 *
 * 環境変数（任意）:
 *   PASSKIT_TIER_ID — 未設定時はベース tier（passkit-tier-ids.js の TIER_BASE）
 *   VUELTA_GEOFENCE_LAT, VUELTA_GEOFENCE_LNG — デフォルトは広島・掛江ビル付近
 *   VUELTA_GEOFENCE_TEXT — ロック画面向け短文（英語推奨・長すぎない）
 */

const { getPassKitAuth } = require('../lib/passkit-auth');
const { TIER_BASE } = require('../lib/passkit-tier-ids');

const DEFAULT_LAT = 34.3893066;
const DEFAULT_LNG = 132.4541823;
/** 近接時ロック画面・通知向け（環境変数 VUELTA_GEOFENCE_TEXT で上書き可） */
const DEFAULT_RELEVANT_TEXT = "You're close. We're ready. Come in.";

/** テンプレ PUT 用に読み取り専用っぽいフィールドを落とす */
function stripTemplateReadOnly(obj) {
  const o = JSON.parse(JSON.stringify(obj));
  delete o.metrics;
  delete o.created;
  delete o.updated;
  return o;
}

/**
 * 既存テンプレの location 1件目の形に合わせて座標・文言を上書き。
 * PassKit は lat/lon/lockScreenMessage 系と Apple の latitude/longitude/relevantText 系が混在し得る。
 */
function buildLocationEntry(lat, lng, relevantText, existingFirst) {
  const fallback = {
    name: 'VUELTA',
    latitude: lat,
    longitude: lng,
    relevantText,
    altitude: 0,
    lockScreenMessage: relevantText,
  };

  if (!existingFirst || typeof existingFirst !== 'object' || Object.keys(existingFirst).length === 0) {
    return fallback;
  }

  const e = { ...existingFirst };
  if ('latitude' in e) e.latitude = lat;
  if ('longitude' in e) e.longitude = lng;
  if ('lat' in e) e.lat = String(lat);
  if ('lon' in e) e.lon = String(lng);
  if ('relevantText' in e) e.relevantText = relevantText;
  if ('lockScreenMessage' in e) e.lockScreenMessage = relevantText;
  if ('altitude' in e) e.altitude = 0;
  if ('alt' in e) e.alt = '0';

  if ('latitude' in e || 'lat' in e) return e;
  return fallback;
}

module.exports = async function handler(req, res) {
  const steps = [];

  try {
    const geoSecret = (process.env.GEOFENCE_SECRET || '').trim();
    if (geoSecret) {
      const q = req.query || {};
      const bodySecret = (req.body && req.body.secret) || '';
      const provided = q.secret || bodySecret || '';
      if (provided !== geoSecret) {
        return res.status(401).json({ error: 'Invalid or missing secret', hint: 'Set ?secret= or POST JSON { secret }' });
      }
    }

    const programId = process.env.PASSKIT_PROGRAM_ID;
    const tierId = (process.env.PASSKIT_TIER_ID || TIER_BASE).trim();

    if (!programId) {
      return res.status(500).json({ error: 'PASSKIT_API_KEY, PASSKIT_API_KEY_SECRET, PASSKIT_PROGRAM_ID required' });
    }

    const lat = parseFloat(String(process.env.VUELTA_GEOFENCE_LAT || '').trim()) || DEFAULT_LAT;
    const lng = parseFloat(String(process.env.VUELTA_GEOFENCE_LNG || '').trim()) || DEFAULT_LNG;
    const relevantText = (process.env.VUELTA_GEOFENCE_TEXT || DEFAULT_RELEVANT_TEXT).trim();

    let token;
    let passkitHost;
    try {
      const auth = getPassKitAuth();
      token = auth.token;
      passkitHost = auth.baseUrl;
    } catch (e) {
      return res.status(500).json({ error: 'PASSKIT_API_KEY, PASSKIT_API_KEY_SECRET, PASSKIT_PROGRAM_ID required' });
    }

    const authHeaders = { Authorization: token, 'Content-Type': 'application/json' };

    // --- 1) Tier → passTemplateId ---
    const tierUrl = `${passkitHost}/members/tier/${programId}/${tierId}`;
    steps.push({ step: 'get_tier', url: tierUrl });

    const tierResp = await fetch(tierUrl, { method: 'GET', headers: { Authorization: token } });
    const tierText = await tierResp.text();
    steps.push({ step: 'get_tier_response', status: tierResp.status, snippet: tierText.substring(0, 800) });

    let passTemplateId = null;
    if (tierResp.ok) {
      try {
        const tierData = JSON.parse(tierText);
        passTemplateId = tierData.passTemplateId || null;
        steps.push({ step: 'tier_parsed', passTemplateId: passTemplateId || 'MISSING' });
      } catch (e) {
        steps.push({ step: 'tier_parse_error', message: e.message });
      }
    }

    if (!passTemplateId) {
      steps.push({
        step: 'ABORT',
        message: 'passTemplateId not found on tier. Set PASSKIT_TIER_ID to a tier that has a template.',
      });
      return res.status(422).json({
        ok: false,
        endpoint: 'set-geofence',
        timestamp: new Date().toISOString(),
        reason: 'no_passTemplateId',
        steps,
        howTo: {
          production: 'https://subsc-webhook.vercel.app/set-geofence',
          env: 'PASSKIT_PROGRAM_ID, PASSKIT_TIER_ID (default base tier), VUELTA_GEOFENCE_LAT/LNG/TEXT',
        },
      });
    }

    // --- 2) Template GET → merge locations → PUT /template ---
    const templateGetUrl = `${passkitHost}/template/${passTemplateId}`;
    steps.push({ step: 'get_template', url: templateGetUrl });

    const tplResp = await fetch(templateGetUrl, { method: 'GET', headers: { Authorization: token } });
    const tplText = await tplResp.text();
    steps.push({ step: 'get_template_response', status: tplResp.status, snippet: tplText.substring(0, 1200) });

    if (!tplResp.ok) {
      steps.push({ step: 'ABORT', message: 'Could not load pass template for geofence update.' });
      return res.status(502).json({
        ok: false,
        endpoint: 'set-geofence',
        timestamp: new Date().toISOString(),
        reason: 'template_get_failed',
        steps,
      });
    }

    let templateData;
    try {
      templateData = JSON.parse(tplText);
    } catch (e) {
      steps.push({ step: 'template_parse_error', message: e.message });
      return res.status(502).json({
        ok: false,
        endpoint: 'set-geofence',
        timestamp: new Date().toISOString(),
        reason: 'template_parse_failed',
        steps,
      });
    }

    const existingLocs = Array.isArray(templateData.locations) ? templateData.locations : [];
    const sample = existingLocs[0] || null;
    const locationEntry = buildLocationEntry(lat, lng, relevantText, sample);

    const updatePayload = stripTemplateReadOnly(templateData);
    updatePayload.locations = [locationEntry];

    const updateUrl = `${passkitHost}/template`;
    steps.push({
      step: 'update_template',
      url: updateUrl,
      passTemplateId,
      coords: { lat, lng },
      relevantText,
      locationKeys: Object.keys(locationEntry),
    });

    const updateResp = await fetch(updateUrl, {
      method: 'PUT',
      headers: authHeaders,
      body: JSON.stringify(updatePayload),
    });
    const updateText = await updateResp.text();
    steps.push({
      step: 'update_template_response',
      status: updateResp.status,
      ok: updateResp.ok,
      body: updateText.substring(0, 2000),
    });

    if (updateResp.ok) {
      steps.push({
        step: 'SUCCESS',
        message:
          'Template locations updated. Existing passes may need refresh / re-save in Wallet for all users to pick up.',
      });
    }

    // --- 3) 検証: GET template again（locations が返るか） ---
    try {
      const verifyResp = await fetch(templateGetUrl, { method: 'GET', headers: { Authorization: token } });
      const verifyText = await verifyResp.text();
      if (verifyResp.ok) {
        const v = JSON.parse(verifyText);
        steps.push({
          step: 'verify_template',
          hasLocations: Array.isArray(v.locations),
          locationsCount: Array.isArray(v.locations) ? v.locations.length : 0,
          firstLocationKeys: v.locations && v.locations[0] ? Object.keys(v.locations[0]) : [],
        });
      } else {
        steps.push({ step: 'verify_template_skipped', status: verifyResp.status });
      }
    } catch (e) {
      steps.push({ step: 'verify_template_error', message: e.message });
    }
  } catch (err) {
    steps.push({ step: 'error', message: err.message, stack: err.stack ? err.stack.substring(0, 400) : '' });
  }

  const lastOk = steps.some((s) => s.step === 'SUCCESS');
  res.status(lastOk ? 200 : 500).json({
    ok: lastOk,
    endpoint: 'set-geofence',
    note: 'Geofence is applied via PUT /template (not /members/program). See steps.',
    timestamp: new Date().toISOString(),
    target: {
      lat: parseFloat(String(process.env.VUELTA_GEOFENCE_LAT || '').trim()) || DEFAULT_LAT,
      lng: parseFloat(String(process.env.VUELTA_GEOFENCE_LNG || '').trim()) || DEFAULT_LNG,
      label: 'VUELTA（広島・大手町 / 掛江ビル付近。環境変数で上書き可）',
    },
    steps,
    howTo: {
      production: 'https://subsc-webhook.vercel.app/set-geofence',
      optionalSecret: 'GEOFENCE_SECRET を Vercel に設定した場合は ?secret=... が必要',
      env: 'PASSKIT_TIER_ID, VUELTA_GEOFENCE_LAT, VUELTA_GEOFENCE_LNG, VUELTA_GEOFENCE_TEXT',
    },
  });
};
