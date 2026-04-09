/**
 * PassKit ジオフェンス設定
 * GET/POST /set-geofence
 *
 * 店舗座標をプログラムに載せ、近接時にウォレットで関連表示されやすくする。
 * （半径は OS / ウォレット側の仕様。Apple は relevantText は短め推奨）
 *
 * 任意: ?secret=環境変数 GEOFENCE_SECRET と一致させると実行（未設定なら誰でも実行可）
 *
 * 環境変数（任意）:
 *   VUELTA_GEOFENCE_LAT, VUELTA_GEOFENCE_LNG — デフォルトは広島・掛江ビル付近
 *   VUELTA_GEOFENCE_TEXT — ロック画面向け短文（英語推奨・長すぎない）
 */

const jwt = require('jsonwebtoken');

const DEFAULT_LAT = 34.3893066;
const DEFAULT_LNG = 132.4541823;
/** Apple ロック画面は文字数に制限あり。短く */
const DEFAULT_RELEVANT_TEXT = 'Near VUELTA — Welcome!';

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

    const passkitApiKeyId = (process.env.PASSKIT_API_KEY || '').trim();
    const passkitApiKeySecret = (process.env.PASSKIT_API_KEY_SECRET || '').trim();
    const programId = process.env.PASSKIT_PROGRAM_ID;
    let passkitHost = process.env.PASSKIT_HOST || 'api.pub2.passkit.io';
    if (!passkitHost.startsWith('http')) passkitHost = 'https://' + passkitHost;
    passkitHost = passkitHost.replace(/\/$/, '');

    if (!passkitApiKeyId || !passkitApiKeySecret || !programId) {
      return res.status(500).json({ error: 'PASSKIT_API_KEY, PASSKIT_API_KEY_SECRET, PASSKIT_PROGRAM_ID required' });
    }

    const lat = parseFloat(String(process.env.VUELTA_GEOFENCE_LAT || '').trim()) || DEFAULT_LAT;
    const lng = parseFloat(String(process.env.VUELTA_GEOFENCE_LNG || '').trim()) || DEFAULT_LNG;
    const relevantText = (process.env.VUELTA_GEOFENCE_TEXT || DEFAULT_RELEVANT_TEXT).trim();

    const now = Math.floor(Date.now() / 1000);
    const token = jwt.sign(
      { uid: passkitApiKeyId, iat: now, exp: now + 3600 },
      passkitApiKeySecret,
      { algorithm: 'HS256', header: { alg: 'HS256', typ: 'JWT' } }
    );

    const getProgramUrl = `${passkitHost}/members/program/${programId}`;
    steps.push({ step: 'get_program', url: getProgramUrl });

    const getResp = await fetch(getProgramUrl, {
      method: 'GET',
      headers: { Authorization: token, 'Content-Type': 'application/json' },
    });
    const programText = await getResp.text();
    steps.push({ step: 'get_program_response', status: getResp.status, snippet: programText.substring(0, 1500) });

    let programData = null;
    if (getResp.ok) {
      try {
        programData = JSON.parse(programText);
      } catch (e) {
        steps.push({ step: 'get_program_parse_error', message: e.message });
      }
    }

    const locationEntry = {
      latitude: lat,
      longitude: lng,
      relevantText,
      altitude: 0,
    };

    const messages = [
      { header: 'VUELTA', body: relevantText, messageType: 'TEXT' },
    ];

    let updatePayload;
    if (programData) {
      updatePayload = JSON.parse(JSON.stringify(programData));
      delete updatePayload.metrics;
      delete updatePayload.created;
      delete updatePayload.updated;
      updatePayload.locations = [locationEntry];
      updatePayload.messages = messages;
    } else {
      updatePayload = {
        id: programId,
        locations: [locationEntry],
        messages,
      };
    }

    const updateUrl = `${passkitHost}/members/program`;
    steps.push({
      step: 'update_program',
      url: updateUrl,
      coords: { lat, lng },
      relevantText,
    });

    const updateResp = await fetch(updateUrl, {
      method: 'PUT',
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      body: JSON.stringify(updatePayload),
    });
    const updateText = await updateResp.text();
    steps.push({
      step: 'update_response',
      status: updateResp.status,
      ok: updateResp.ok,
      body: updateText.substring(0, 2000),
    });

    if (updateResp.ok) {
      steps.push({
        step: 'SUCCESS',
        message: 'Geofence applied. Existing passes may need refresh / re-save in Wallet.',
      });
    }
  } catch (err) {
    steps.push({ step: 'error', message: err.message, stack: err.stack ? err.stack.substring(0, 400) : '' });
  }

  res.json({
    endpoint: 'set-geofence',
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
      env: 'VUELTA_GEOFENCE_LAT, VUELTA_GEOFENCE_LNG, VUELTA_GEOFENCE_TEXT',
    },
  });
};
