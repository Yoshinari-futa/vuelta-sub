/**
 * POST /fix-barcode
 * PassKitテンプレートのバーコード形式をPDF417→QRに変更
 * Body: { secret, action: "check" | "fix" }
 *
 * PassKit BarcodeType enum:
 *   0=DO_NOT_USE, 1=QR, 2=AZTEC, 3=PDF417, 4=CODE128, 5=TEXT, 6=DATA_MATRIX
 */
const { getPassKitAuth } = require('../lib/passkit-auth');
const { TIER_BASE } = require('../lib/passkit-tier-ids');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { secret, action } = req.body || {};
  if (secret !== 'vuelta2026-member') {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  let token;
  let host;
  try {
    const auth = getPassKitAuth();
    token = auth.token;
    host = auth.baseUrl;
  } catch (e) {
    return res.status(500).json({ error: 'PASSKIT credentials missing' });
  }

  const programId = process.env.PASSKIT_PROGRAM_ID;
  // PASSKIT_TIER_ID 環境変数は無視（過去の遺物で値が `black` になっている可能性あり）。
  // バーコード修正のターゲットは常に Base ティア。
  const tierId = TIER_BASE;
  const steps = [];
  const QR_TYPE = 1; // PKBarcodeFormatQR

  try {
    // Step 1: Get tier
    const tierResp = await fetch(`${host}/members/tier/${programId}/${tierId}`, {
      headers: { 'Authorization': token },
    });
    let tierData = null;
    if (tierResp.ok) {
      tierData = JSON.parse(await tierResp.text());
      steps.push({ step: 'get_tier', passTemplateId: tierData.passTemplateId || 'NOT_FOUND' });
    } else {
      steps.push({ step: 'get_tier_FAILED', status: tierResp.status });
    }

    // Step 2: Get program
    const progResp = await fetch(`${host}/members/program/${programId}`, {
      headers: { 'Authorization': token },
    });
    let progData = null;
    if (progResp.ok) {
      progData = JSON.parse(await progResp.text());
      steps.push({ step: 'get_program', passType: progData.passType });
    } else {
      steps.push({ step: 'get_program_FAILED', status: progResp.status });
    }

    // Step 3: Try multiple template API paths
    const passTemplateId = tierData?.passTemplateId;
    let templateData = null;
    if (passTemplateId) {
      const templatePaths = [
        `/template/${passTemplateId}`,
        `/design/template/${passTemplateId}`,
        `/design/${passTemplateId}`,
        `/passes/template/${passTemplateId}`,
      ];
      for (const path of templatePaths) {
        try {
          const resp = await fetch(`${host}${path}`, { headers: { 'Authorization': token } });
          const text = await resp.text();
          if (resp.ok) {
            templateData = JSON.parse(text);
            steps.push({ step: 'get_template_OK', path, fields: Object.keys(templateData).slice(0, 20) });
            break;
          } else {
            steps.push({ step: 'get_template_try', path, status: resp.status });
          }
        } catch (err) {
          steps.push({ step: 'get_template_try', path, error: err.message });
        }
      }
    }

    if (action === 'fix') {
      // Strategy A: Update template (try multiple paths)
      if (passTemplateId) {
        const templateBody = templateData
          ? { ...templateData, barcodeType: QR_TYPE }
          : { id: passTemplateId, barcodeType: QR_TYPE };

        const putPaths = ['/template', '/design/template', '/design'];
        for (const path of putPaths) {
          try {
            const resp = await fetch(`${host}${path}`, {
              method: 'PUT',
              headers: { 'Authorization': token, 'Content-Type': 'application/json' },
              body: JSON.stringify(templateBody),
            });
            const text = await resp.text();
            steps.push({ step: 'update_template', path, status: resp.status, ok: resp.ok, body: text.substring(0, 500) });
            if (resp.ok) break;
          } catch (err) {
            steps.push({ step: 'update_template', path, error: err.message });
          }
        }
      }

      // Strategy B: Update tier
      if (tierData) {
        try {
          const resp = await fetch(`${host}/members/tier`, {
            method: 'PUT',
            headers: { 'Authorization': token, 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...tierData, barcodeType: QR_TYPE }),
          });
          const text = await resp.text();
          steps.push({ step: 'update_tier', status: resp.status, ok: resp.ok, body: text.substring(0, 500) });
        } catch (err) {
          steps.push({ step: 'update_tier_ERROR', message: err.message });
        }
      }

      // Strategy C: Update program
      if (progData) {
        try {
          const resp = await fetch(`${host}/members/program`, {
            method: 'PUT',
            headers: { 'Authorization': token, 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...progData, barcodeType: QR_TYPE }),
          });
          const text = await resp.text();
          steps.push({ step: 'update_program', status: resp.status, ok: resp.ok, body: text.substring(0, 500) });
        } catch (err) {
          steps.push({ step: 'update_program_ERROR', message: err.message });
        }
      }

      // Strategy D: Update each member with passOverrides barcode
      try {
        const listResp = await fetch(`${host}/members/member/list/${programId}`, {
          method: 'POST',
          headers: { 'Authorization': token, 'Content-Type': 'application/json' },
          body: JSON.stringify({ limit: 20 }),
        });
        if (listResp.ok) {
          const members = await listResp.json();
          const arr = members?.passes || members || [];
          steps.push({ step: 'list_members', count: arr.length });

          for (const m of arr) {
            try {
              const resp = await fetch(`${host}/members/member`, {
                method: 'PUT',
                headers: { 'Authorization': token, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  id: m.id,
                  programId,
                  passOverrides: {
                    ...(m.passOverrides || {}),
                    barcodeType: QR_TYPE,
                  },
                }),
              });
              const text = await resp.text();
              const name = m.person?.displayName || m.person?.forenames || m.id;
              steps.push({ step: 'update_member', name, status: resp.status, ok: resp.ok, snippet: text.substring(0, 200) });
            } catch (err) {
              steps.push({ step: 'update_member_ERROR', id: m.id, message: err.message });
            }
          }
        } else {
          steps.push({ step: 'list_members_FAILED', status: listResp.status });
        }
      } catch (err) {
        steps.push({ step: 'list_members_ERROR', message: err.message });
      }
    }

    return res.status(200).json({ action: action || 'check', steps });
  } catch (err) {
    return res.status(500).json({ error: err.message, steps });
  }
};
