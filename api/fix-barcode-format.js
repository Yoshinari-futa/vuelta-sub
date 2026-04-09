/**
 * GET /fix-barcode-format
 * PassKit のバーコード形式を PDF417 → QR に変更する
 * 一度だけ実行する設定変更エンドポイント
 */

const jwt = require('jsonwebtoken');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const secret = req.query?.secret;
  const staffPin = process.env.SCAN_PIN || '0000';
  if (secret !== staffPin) return res.status(401).json({ error: 'Invalid PIN' });

  try {
    const apiKeyId = (process.env.PASSKIT_API_KEY || '').trim();
    const apiKeySecret = (process.env.PASSKIT_API_KEY_SECRET || '').trim();
    if (!apiKeyId || !apiKeySecret) throw new Error('PASSKIT credentials missing');

    const now = Math.floor(Date.now() / 1000);
    const token = jwt.sign(
      { uid: apiKeyId, iat: now, exp: now + 3600 },
      apiKeySecret,
      { algorithm: 'HS256', header: { alg: 'HS256', typ: 'JWT' } }
    );

    let host = process.env.PASSKIT_HOST || 'api.pub2.passkit.io';
    if (!host.startsWith('http')) host = 'https://' + host;
    const baseUrl = host.replace(/\/$/, '');
    const programId = process.env.PASSKIT_PROGRAM_ID;
    const tierId = process.env.PASSKIT_TIER_ID || 'black';

    const results = [];

    // 1. プログラム情報取得
    const progRes = await fetch(`${baseUrl}/loyalty/program/${programId}`, {
      headers: { 'Authorization': token },
    });
    const progData = progRes.ok ? await progRes.json() : null;
    results.push({ step: 'GET program', status: progRes.status, hasData: !!progData });

    // 2. テンプレート情報を取得（プログラムから templateId を取得）
    // PassKit の passTemplateId はプログラム or ティアに含まれる
    const tierRes = await fetch(`${baseUrl}/loyalty/tier/${programId}/${tierId}`, {
      headers: { 'Authorization': token },
    });
    const tierData = tierRes.ok ? await tierRes.json() : null;
    results.push({ step: 'GET tier', status: tierRes.status, templateId: tierData?.passTemplateId });

    const templateId = tierData?.passTemplateId;

    if (templateId) {
      // 3. テンプレート取得
      const tmplRes = await fetch(`${baseUrl}/template/${templateId}`, {
        headers: { 'Authorization': token },
      });
      let tmplData = null;
      let tmplText = '';
      if (tmplRes.ok) {
        tmplText = await tmplRes.text();
        try { tmplData = JSON.parse(tmplText); } catch (_) {}
      }
      results.push({
        step: 'GET template',
        status: tmplRes.status,
        currentBarcodeType: tmplData?.barcodeType || tmplData?.defaultBarcode?.format || '(unknown)',
        templateKeys: tmplData ? Object.keys(tmplData).filter(k => k.toLowerCase().includes('barcode')).join(', ') : '(no data)',
      });

      // 4. テンプレートのバーコード形式を変更
      if (tmplData) {
        // PassKit REST API のバーコード形式フィールドを試す
        const updateBody = {
          ...tmplData,
          // PassKit uses different field names depending on API version
          barcodeType: 'QR',           // gRPC-REST 形式
        };

        // defaultBarcode があれば更新
        if (tmplData.defaultBarcode) {
          updateBody.defaultBarcode = {
            ...tmplData.defaultBarcode,
            format: 'PKBarcodeFormatQR',
          };
        }

        const updateRes = await fetch(`${baseUrl}/template`, {
          method: 'PUT',
          headers: { 'Authorization': token, 'Content-Type': 'application/json' },
          body: JSON.stringify(updateBody),
        });
        const updateText = await updateRes.text();
        results.push({ step: 'PUT template (barcode→QR)', status: updateRes.status, body: updateText.substring(0, 300) });
      }
    }

    // 5. プログラムレベルでもバーコード設定を試す
    if (progData) {
      const barcodeFields = Object.keys(progData).filter(k => k.toLowerCase().includes('barcode'));
      results.push({ step: 'program barcode fields', fields: barcodeFields });
    }

    return res.status(200).json({ results });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
