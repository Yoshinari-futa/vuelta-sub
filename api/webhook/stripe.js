/**
 * Vercel Serverless Function: Stripe Webhook Handler
 * POST /api/webhook/stripe
 *
 * Stripe決済完了 → PassKitで会員証生成 → メール送信
 */

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const nodemailer = require('nodemailer');
const jwt = require('jsonwebtoken');

// Vercelではbodyのパースを無効にする（Stripe署名検証のため）
module.exports.config = {
  api: {
    bodyParser: false,
  },
};

// rawBodyを取得するヘルパー
function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// メール送信設定
function getTransporter() {
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASS;
  console.log(`[EMAIL] Config: user=${user ? user.substring(0, 5) + '...' : 'MISSING'}, pass=${pass ? 'SET' : 'MISSING'}`);
  if (!user || !pass) {
    return null;
  }
  return nodemailer.createTransport({
    service: process.env.EMAIL_SERVICE || 'gmail',
    auth: { user, pass },
  });
}

// PassKit会員証生成（タイムアウト付き）
async function generatePassKitCard({ email, name, customerId, tierId }) {
  let passkitHost = process.env.PASSKIT_HOST || 'api.pub1.passkit.io';
  if (!passkitHost.startsWith('http')) {
    passkitHost = 'https://' + passkitHost;
  }
  const passkitBaseUrl = passkitHost.replace(/\/$/, '');
  const programId = process.env.PASSKIT_PROGRAM_ID;

  const passkitApiKeyId = (process.env.PASSKIT_API_KEY || '').trim();
  const passkitApiKeySecret = (process.env.PASSKIT_API_KEY_SECRET || '').trim();

  console.log(`[PASSKIT] host=${passkitBaseUrl}, programId=${programId}, tierId=${tierId}`);
  console.log(`[PASSKIT] apiKeyId=${passkitApiKeyId ? passkitApiKeyId.substring(0, 8) + '...' : 'MISSING'}`);

  if (!passkitApiKeyId || !passkitApiKeySecret) {
    throw new Error('PASSKIT_API_KEY and PASSKIT_API_KEY_SECRET are required');
  }

  // JWT認証トークン生成
  const now = Math.floor(Date.now() / 1000);
  const token = jwt.sign(
    { iss: passkitApiKeyId, sub: passkitApiKeyId, iat: now, exp: now + 3600 },
    passkitApiKeySecret,
    { algorithm: 'HS256', header: { alg: 'HS256', typ: 'JWT', kid: passkitApiKeyId } }
  );
  const authHeader = `Bearer ${token}`;

  // 会員作成 (5秒タイムアウト)
  const apiUrl = `${passkitBaseUrl}/members/member`;
  console.log(`[PASSKIT] Creating member: ${apiUrl}`);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        programId,
        tierId,
        person: { displayName: name, externalId: customerId },
        externalId: customerId,
        points: 0,
        tierPoints: 0,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const responseText = await response.text();
    console.log(`[PASSKIT] Response: ${response.status} - ${responseText.substring(0, 300)}`);

    if (!response.ok) {
      throw new Error(`PassKit API error: ${response.status} - ${responseText.substring(0, 300)}`);
    }

    const member = JSON.parse(responseText);
    console.log(`[PASSKIT] Member created: ${member.id}`);

    // パスURL取得
    const passUrl = `${passkitBaseUrl}/members/member/${member.id}/pass`;
    console.log(`[PASSKIT] Getting pass URL: ${passUrl}`);

    const passResponse = await fetch(passUrl, {
      method: 'GET',
      headers: { 'Authorization': authHeader },
    });

    const passText = await passResponse.text();
    console.log(`[PASSKIT] Pass response: ${passResponse.status} - ${passText.substring(0, 300)}`);

    if (!passResponse.ok) {
      throw new Error(`PassKit Pass API error: ${passResponse.status} - ${passText.substring(0, 300)}`);
    }

    const passData = JSON.parse(passText);
    const walletUrl = passData.downloadUrl || passData.appleWalletUrl || passData.googleWalletUrl || passData.url || passData.passUrl;

    if (!walletUrl) {
      console.log(`[PASSKIT] Full pass response keys: ${Object.keys(passData).join(', ')}`);
      throw new Error('PassKit did not return a download URL');
    }

    return walletUrl;
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

// ウェルカムメール送信（walletUrl有無で内容を分岐）
async function sendMembershipEmail(transporter, email, name, walletUrl) {
  const walletSection = walletUrl
    ? `<p>下のボタンからスマートフォンの Wallet に会員証を追加してください。<br>来店時に QR を見せるだけで、最初の一杯が無料になります。</p>
       <p style="text-align:center"><a href="${walletUrl}" style="display:inline-block;padding:14px 32px;background:#fff;color:#0a0a0a;text-decoration:none;font-weight:600;letter-spacing:2px;margin:24px 0;">ADD TO WALLET</a></p>
       <p style="word-break:break-all;color:#666;font-size:12px">${walletUrl}</p>`
    : `<p>会員証の準備ができ次第、別途メールでお送りいたします。<br>来店時にお名前をお伝えいただければ、最初の一杯が無料になります。</p>`;

  await transporter.sendMail({
    from: process.env.EMAIL_FROM || 'noreply@vuelta.jp',
    to: email,
    subject: 'VUELTA FIRST-DRINK PASS — Welcome',
    html: `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0a0a0a;color:#e0e0e0;margin:0;padding:0;">
  <div style="max-width:600px;margin:0 auto;padding:40px 20px;">
    <div style="text-align:center;font-size:28px;letter-spacing:8px;margin-bottom:40px;color:#fff;">VUELTA</div>
    <p>${name} 様</p>
    <p>FIRST-DRINK PASS へようこそ。</p>
    ${walletSection}
    <div style="margin-top:40px;padding-top:20px;border-top:1px solid #333;font-size:12px;color:#666;">
      <p>VUELTA — Where welcome back meets nice to meet you.</p>
      <p>広島市中区大手町3-3-5 掛江ビル2F</p>
    </div>
  </div>
</body>
</html>`,
  });
}

// メインハンドラー
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const rawBody = await getRawBody(req);
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  console.log(`[WEBHOOK] Event received: ${event.type} (${event.id})`);

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    console.log(`[WEBHOOK] Session: customer=${session.customer}, email=${session.customer_email || session.customer_details?.email || 'none'}`);

    try {
      if (!session.customer) {
        console.error('[WEBHOOK] ERROR: No customer ID in session');
        return res.status(400).json({ error: 'No customer ID' });
      }

      // 顧客情報取得
      console.log(`[STRIPE] Retrieving customer: ${session.customer}`);
      const customer = await stripe.customers.retrieve(session.customer);
      const customerEmail = customer.email || session.customer_email || session.customer_details?.email;
      const customerName = customer.name || session.customer_details?.name || 'VUELTA Member';
      console.log(`[STRIPE] Customer: name=${customerName}, email=${customerEmail}`);

      if (!customerEmail) {
        console.error('[WEBHOOK] ERROR: No email found for customer');
        return res.status(400).json({ error: 'No email found' });
      }

      // PassKit会員証生成（失敗しても続行）
      let walletUrl = null;
      try {
        walletUrl = await generatePassKitCard({
          email: customerEmail,
          name: customerName,
          customerId: session.customer,
          tierId: process.env.PASSKIT_TIER_ID,
        });
        console.log(`[PASSKIT] SUCCESS: ${walletUrl}`);
      } catch (err) {
        console.error(`[PASSKIT] FAILED: ${err.message}`);
        // PassKit失敗してもメールは送る
      }

      // メール送信（PassKit成功・失敗に関わらず必ず送信）
      console.log(`[EMAIL] Sending to ${customerEmail}...`);
      const transporter = getTransporter();
      if (transporter) {
        try {
          await sendMembershipEmail(transporter, customerEmail, customerName, walletUrl);
          console.log(`[EMAIL] SUCCESS: sent to ${customerEmail}`);
        } catch (err) {
          console.error(`[EMAIL] FAILED: ${err.message}`);
        }
      } else {
        console.error('[EMAIL] FAILED: No transporter (missing EMAIL_USER or EMAIL_PASS)');
      }

    } catch (err) {
      console.error(`[WEBHOOK] Processing error: ${err.message}`);
    }
  }

  res.json({ received: true });
};
