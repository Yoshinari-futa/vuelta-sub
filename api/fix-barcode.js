/**
 * POST /fix-barcode
 * PassKitテンプレートのバーコード形式をPDF417→QRに変更
 * Body: { secret, action: "check" | "fix" }
 *
 * PassKit BarcodeType enum:
 *   0=DO_NOT_USE, 1=QR, 2=AZTEC, 3=PDF417, 4=CODE128, 5=TEXT, 6=DATA_MATRIX
 */
const jwt = require('jsonwebtoken');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { secret, action } = req.body || {};
  if (secret !== 'vuelta2026-member') {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const apiKeyId = (process.env.PASSKIT_API_KEY || '').trim();
  const apiKeySecret = (process.env.PASSKIT_API_KEY_SECRET || '').trim();
  if (!apiKeyId || !apiKeySecret) {
    return res.status(500).json({ error: 'PASSKIT credentials missing' });
  }

  const now = Math.floor(Date.now() / 1000);
  const token = jwt.sign(
    { uid: apiKeyId, iat: now, exp: now + 3600 },
    apiKeySecret,
    { algorithm: 'HS256', header: { alg: 'HS256', typ: 'JWT' } }
  );

  let host = process.env.PASSKIT_HOST || 'api.pub2.passkit.io';
  if (!host.startsWith('http')) host = 'https://' + host;
  host = host.replace(/\/$/, '');

  const programId = process.env.PASSKIT_PROGRAM_ID;
  const tierId = process.env.PASSKIT_TIER_ID || 'black';
  const steps = [];

  try {
    // Step 1: Get tier to find passTemplateId
    const tierResp = await fetch(`${host}/members/tier/${programId}/${tierId}`, {
      headers: { 'Authorization': token },
    });
    const tierText = await tierResp.text();
    let tierData = null;
    if (tierResp.ok) {
      tierData = JSON.parse(tierText);
      steps.push({
        step: 'get_tier',
        passTemplateId: tierData.passTemplateId || 'NOT_FOUND',
        tierFields: Object.keys(tierData),
      });
    } else {
      steps.push({ step: 'get_tier_FAILED', status: tierResp.status, body: tierText.substring(0, 500) });
    }

    // Step 2: Get program data
    const progResp = await fetch(`${host}/members/program/${programId}`, {
      headers: { 'Authorization': token },
    });
    let progData = null;
    if (progResp.ok) {
      progData = JSON.parse(await progResp.text());
      steps.push({
        step: 'get_program',
        fields: Object.keys(progData),
        passType: progData.passType,
        barcodeSettings: progData.barcode || progData.barcodes || progData.barcodeType || 'not_in_program',
      });
    } else {
      steps.push({ step: 'get_program_FAILED', status: progResp.status });
    }

    // Step 3: Get template if available
    const passTemplateId = tierData?.passTemplateId;
    let templateData = null;
    if (passTemplateId) {
      const tplResp = await fetch(`${host}/template/${passTemplateId}`, {
        headers: { 'Authorization': token },
      });
      if (tplResp.ok) {
        templateData = JSON.parse(await tplResp.text());
        steps.push({
          step: 'get_template',
          fields: Object.keys(templateData),
          barcodeType: templateData.barcodeType,
          barcode: templateData.barcode,
          barcodes: templateData.barcodes,
          defaultBarcode: templateData.defaultBarcode,
          transitType: templateData.transitType,
        });
      } else {
        const tplText = await tplResp.text();
        steps.push({ step: 'get_template_FAILED', status: tplResp.status, body: tplText.substring(0, 500) });
      }
    }

    // Step 4: If action is "fix", update barcode to QR (type 1)
    if (action === 'fix') {
      const QR_TYPE = 1;

      // 4a: Update template if found
      if (templateData && passTemplateId) {
        try {
          const updatedTemplate = { ...templateData, barcodeType: QR_TYPE };
          // Also try other possible field names
          if (templateData.barcode !== undefined) updatedTemplate.barcode = { ...templateData.barcode, format: QR_TYPE };
          if (templateData.defaultBarcode !== undefined) updatedTemplate.defaultBarcode = QR_TYPE;

          const putResp = await fetch(`${host}/template`, {
            method: 'PUT',
            headers: { 'Authorization': token, 'Content-Type': 'application/json' },
            body: JSON.stringify(updatedTemplate),
          });
          const putText = await putResp.text();
          steps.push({ step: 'update_template', status: putResp.status, ok: putResp.ok, body: putText.substring(0, 800) });
        } catch (err) {
          steps.push({ step: 'update_template_ERROR', message: err.message });
        }
      }

      // 4b: Update tier with barcodeType
      if (tierData) {
        try {
          const updatedTier = { ...tierData, barcodeType: QR_TYPE };
          const putResp = await fetch(`${host}/members/tier`, {
            method: 'PUT',
            headers: { 'Authorization': token, 'Content-Type': 'application/json' },
            body: JSON.stringify(updatedTier),
          });
          const putText = await putResp.text();
          steps.push({ step: 'update_tier', status: putResp.status, ok: putResp.ok, body: putText.substring(0, 800) });
        } catch (err) {
          steps.push({ step: 'update_tier_ERROR', message: err.message });
        }
      }

      // 4c: Update program with barcodeType
      if (progData) {
        try {
          const updatedProg = { ...progData, barcodeType: QR_TYPE };
          const putResp = await fetch(`${host}/members/program`, {
            method: 'PUT',
            headers: { 'Authorization': token, 'Content-Type': 'application/json' },
            body: JSON.stringify(updatedProg),
          });
          const putText = await putResp.text();
          steps.push({ step: 'update_program', status: putResp.status, ok: putResp.ok, body: putText.substring(0, 800) });
        } catch (err) {
          steps.push({ step: 'update_program_ERROR', message: err.message });
        }
      }
    }

    return res.status(200).json({ action: action || 'check', steps });
  } catch (err) {
    return res.status(500).json({ error: err.message, steps });
  }
};
