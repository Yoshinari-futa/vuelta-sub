/**
 * GET /api/test-email
 * メール送信テスト用エンドポイント（デバッグ専用）
 */
const nodemailer = require('nodemailer');

module.exports = async function handler(req, res) {
  const results = { steps: [] };

  // Step 1: 環境変数チェック
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASS;
  const service = process.env.EMAIL_SERVICE || 'gmail';
  const from = process.env.EMAIL_FROM || 'noreply@vuelta.jp';

  results.steps.push({
    step: 'env_check',
    EMAIL_USER: user ? user.substring(0, 8) + '...' : 'MISSING',
    EMAIL_PASS: pass ? 'SET (' + pass.length + ' chars)' : 'MISSING',
    EMAIL_SERVICE: service,
    EMAIL_FROM: from,
  });

  if (!user || !pass) {
    results.error = 'EMAIL_USER or EMAIL_PASS is missing';
    return res.status(500).json(results);
  }

  // Step 2: トランスポーター作成
  let transporter;
  try {
    transporter = nodemailer.createTransport({
      service: service,
      auth: { user, pass },
    });
    results.steps.push({ step: 'transporter_created', status: 'ok' });
  } catch (err) {
    results.steps.push({ step: 'transporter_created', status: 'error', message: err.message });
    return res.status(500).json(results);
  }

  // Step 3: SMTP接続検証
  try {
    await transporter.verify();
    results.steps.push({ step: 'smtp_verify', status: 'ok' });
  } catch (err) {
    results.steps.push({ step: 'smtp_verify', status: 'error', message: err.message });
    results.error = 'SMTP connection failed: ' + err.message;
    return res.status(500).json(results);
  }

  // Step 4: テストメール送信
  const testTo = req.query.to || user;
  try {
    const info = await transporter.sendMail({
      from: from,
      to: testTo,
      subject: 'VUELTA テストメール',
      html: '<h2>VUELTA</h2><p>メール送信テスト成功です。</p><p>' + new Date().toISOString() + '</p>',
    });
    results.steps.push({ step: 'send_email', status: 'ok', messageId: info.messageId, to: testTo });
    results.success = true;
  } catch (err) {
    results.steps.push({ step: 'send_email', status: 'error', message: err.message, to: testTo });
    results.error = 'Email send failed: ' + err.message;
    return res.status(500).json(results);
  }

  res.json(results);
};
