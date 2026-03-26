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
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    return null;
  }
  return nodemailer.createTransport({
    service: process.env.EMAIL_SERVICE || 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });
}

// PassKit会員証生成
async function generatePassKitCard({ email, name, customerId, tierId }) {
  let passkitHost = process.env.PASSKIT_HOST || 'api.pub1.passkit.io';
  if (!passkitHost.startsWith('http')) {
    passkitHost = 'https://' + passkitHost;
  }
  const passkitBaseUrl = passkitHost.replace(/\/$/, '');

  const passkitApiKeyId = (process.env.PASSKIT_API_KEY || '').trim();
  const passkitApiKeySecret = (process.env.PASSKIT_API_KEY_SECRET || '').trim();

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

  const programId = process.env.PASSKIT_PROGRAM_ID;
  const apiUrl = `${passkitBaseUrl}/members/member`;

  // 会員作成
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
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`PassKit API error: ${response.status} - ${errorText.substring(0, 500)}`);
  }

  const member = await response.json();
  console.log(`PassKit member created: ${member.id}`);

  // パスURL取得
  const passResponse = await fetch(`${passkitBaseUrl}/members/member/${member.id}/pass`, {
    method: 'GET',
    headers: { 'Authorization': authHeader },
  });

  if (!passResponse.ok) {
    const errorText = await passResponse.text();
    throw new Error(`PassKit Pass API error: ${passResponse.status} - ${errorText.substring(0, 500)}`);
  }

  const passData = await passResponse.json();
  const walletUrl = passData.downloadUrl || passData.appleWalletUrl || passData.googleWalletUrl || passData.url || passData.passUrl;

  if (!walletUrl) {
    throw new Error('PassKit did not return a download URL');
  }

  return walletUrl;
}

// メール送信
async function sendMembershipEmail(transporter, email, name, walletUrl) {
  await transporter.sendMail({
    from: process.env.EMAIL_FROM || 'noreply@vuelta.jp',
    to: email,
    subject: 'VUELTA FIRST-DRINK PASS — Welcome',
    html: `
      <!DOCTYPE html>
      <html>
      <head><meta charset="UTF-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0a0a0a; color: #e0e0e0; }
          .container { max-width: 600px; margin: 0 auto; padding: 40px 20px; }
          .logo { text-align: center; font-size: 28px; letter-spacing: 8px; margin-bottom: 40px; color: #fff; }
          .button { display: inline-block; padding: 14px 32px; background: #fff; color: #0a0a0a; text-decoration: none; font-weight: 600; letter-spacing: 2px; margin: 24px 0; }
          .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #333; font-size: 12px; color: #666; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="logo">VUELTA</div>
          <p>${name} 様</p>
          <p>FIRST-DRINK PASS へようこそ。</p>
          <p>下のボタンからスマートフォンの Wallet に会員証を追加してください。<br>来店時に QR を見せるだけで、最初の一杯が無料になります。</p>
          <p style="text-align:center"><a href="${walletUrl}" class="button">ADD TO WALLET</a></p>
          <p style="word-break:break-all;color:#666;font-size:12px">${walletUrl}</p>
          <div class="footer">
            <p>VUELTA — Where welcome back meets nice to meet you.</p>
            <p>広島市中区大手町3-3-5 掛江ビル2F</p>
          </div>
        </div>
      </body>
      </html>
    `,
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

  console.log(`Webhook event: ${event.type} (${event.id})`);

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;

    try {
      if (!session.customer) {
        console.error('No customer ID in session');
        return res.status(400).json({ error: 'No customer ID' });
      }

      const customer = await stripe.customers.retrieve(session.customer);
      const customerEmail = customer.email || session.customer_email || session.customer_details?.email;
      const customerName = customer.name || session.customer_details?.name || 'VUELTA Member';

      if (!customerEmail) {
        console.error('No email found for customer');
        return res.status(400).json({ error: 'No email found' });
      }

      // PassKit会員証生成
      let walletUrl;
      try {
        walletUrl = await generatePassKitCard({
          email: customerEmail,
          name: customerName,
          customerId: session.customer,
          tierId: process.env.PASSKIT_TIER_ID,
        });
        console.log(`PassKit wallet URL: ${walletUrl}`);
      } catch (err) {
        console.error('PassKit error:', err.message);
        walletUrl = null;
      }

      // メール送信
      if (walletUrl) {
        const transporter = getTransporter();
        if (transporter) {
          try {
            await sendMembershipEmail(transporter, customerEmail, customerName, walletUrl);
            console.log(`Email sent to ${customerEmail}`);
          } catch (err) {
            console.error('Email error:', err.message);
          }
        }
      }
    } catch (err) {
      console.error('Processing error:', err.message);
    }
  }

  res.json({ received: true });
};
