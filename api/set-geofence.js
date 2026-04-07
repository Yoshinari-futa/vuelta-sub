/**
 * PassKit Geofence Setup Utility
 * GET /api/set-geofence
 *
 * Sets VUELTA location (lat:34.3966, lng:132.4596) on PassKit program
 * for Google Wallet location-based notifications
 */
const jwt = require('jsonwebtoken');

module.exports = async function handler(req, res) {
  const steps = [];

  try {
    const passkitApiKeyId = (process.env.PASSKIT_API_KEY || '').trim();
    const passkitApiKeySecret = (process.env.PASSKIT_API_KEY_SECRET || '').trim();
    const programId = process.env.PASSKIT_PROGRAM_ID;
    let passkitHost = process.env.PASSKIT_HOST || 'api.pub2.passkit.io';
    if (!passkitHost.startsWith('http')) passkitHost = 'https://' + passkitHost;
    passkitHost = passkitHost.replace(/\/$/, '');

    const now = Math.floor(Date.now() / 1000);
    const token = jwt.sign(
      { uid: passkitApiKeyId, iat: now, exp: now + 3600 },
      passkitApiKeySecret,
      { algorithm: 'HS256', header: { alg: 'HS256', typ: 'JWT' } }
    );

    // Step 1: Get current program
    const getProgramUrl = passkitHost + '/members/program/' + programId;
    steps.push({ step: 'get_program', url: getProgramUrl });

    const getResp = await fetch(getProgramUrl, {
      method: 'GET',
      headers: { 'Authorization': token, 'Content-Type': 'application/json' },
    });
    const programText = await getResp.text();
    steps.push({ step: 'get_program_response', status: getResp.status, body: programText.substring(0, 2000) });

    let programData;
    if (getResp.ok) {
      programData = JSON.parse(programText);
    }

    // Step 2: Update program with locations + 100m geofence
    const locationPayload = {
      id: programId,
      locations: [{
        latitude: 34.3966,
        longitude: 132.4596,
        relevantText: 'VUELTAの近くです — FIRST DRINK PASSを提示で最初の一杯が無料！',
        altitude: 0,
      }],
      messages: [
        { header: 'VUELTA', body: 'Near VUELTA — Show your FIRST DRINK PASS for a free first drink!', messageType: 'TEXT' },
        { header: 'VUELTA', body: 'VUELTAの近くです。FIRST DRINK PASSで最初の一杯が無料！', messageType: 'TEXT' },
      ],
    };

    if (programData) {
      locationPayload.name = programData.name;
      locationPayload.status = programData.status;
    }

    const updateUrl = passkitHost + '/members/program';
    steps.push({ step: 'update_program', url: updateUrl, payload: locationPayload });

    const updateResp = await fetch(updateUrl, {
      method: 'PUT',
      headers: { 'Authorization': token, 'Content-Type': 'application/json' },
      body: JSON.stringify(locationPayload),
    });
    const updateText = await updateResp.text();
    steps.push({ step: 'update_response', status: updateResp.status, ok: updateResp.ok, body: updateText.substring(0, 1000) });

    if (updateResp.ok) {
      steps.push({ step: 'SUCCESS', message: 'Geofence location set for VUELTA' });
    }

  } catch (err) {
    steps.push({ step: 'error', message: err.message, stack: err.stack ? err.stack.substring(0, 300) : '' });
  }

  res.json({
    endpoint: 'set-geofence',
    timestamp: new Date().toISOString(),
    target: { lat: 34.3966, lng: 132.4596, location: 'VUELTA Hiroshima' },
    steps: steps
  });
};
