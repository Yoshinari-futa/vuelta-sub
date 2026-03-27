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
  let passkitHost = process.env.PASSKIT_HOST || 'api.pub2.passkit.io';
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

  // JWT認証トークン生成（PassKit公式形式: uid claim, no kid header）
  const now = Math.floor(Date.now() / 1000);
  const token = jwt.sign(
    { uid: passkitApiKeyId, iat: now, exp: now + 3600 },
    passkitApiKeySecret,
    { algorithm: 'HS256', header: { alg: 'HS256', typ: 'JWT' } }
  );
  const authHeader = token;

  // 会員作成 (5秒タイムアウト — Vercel Hobby 10秒制限対策)
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

    // パスURL構築（PassKitはIDから直接URLを生成）
    // pub2リージョンの場合: https://pub2.pskt.io/{memberId}
    const region = (process.env.PASSKIT_HOST || 'api.pub2.passkit.io').includes('pub1') ? 'pub1' : 'pub2';
    const walletUrl = `https://${region}.pskt.io/${member.id}`;
    console.log(`[PASSKIT] Wallet URL: ${walletUrl}`);

    return walletUrl;
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

// ウェルカムメール送信（walletUrl有無で内容を分岐）
async function sendMembershipEmail(transporter, email, name, walletUrl) {
  const walletButton = walletUrl
    ? `<tr><td align="center" style="padding:28px 0 12px;">
          <a href="${walletUrl}" style="display:inline-block;padding:13px 36px;background:#0a0a0a;color:#ffffff;text-decoration:none;font-weight:600;font-size:13px;letter-spacing:0.06em;border-radius:50px;mso-padding-alt:0;">ADD TO WALLET &rarr;</a>
        </td></tr>
        <tr><td align="center" style="padding:0 0 8px;">
          <span style="font-size:11px;color:#bbb;">タップしてスマホのWalletに保存</span>
        </td></tr>`
    : `<tr><td style="padding:24px 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8f8f8;border-radius:10px;">
            <tr><td style="padding:18px 22px;">
              <span style="font-size:13px;color:#666;line-height:1.7;">会員証の準備ができ次第、別途メールでお送りいたします。来店時にお名前をお伝えいただければ、最初の一杯が無料になります。</span>
            </td></tr>
          </table>
        </td></tr>`;

  const step1Text = walletUrl
    ? '上のボタンから<span style="color:#1a1a1a;font-weight:600;">Walletに会員証を保存</span>'
    : 'メールに届く<span style="color:#1a1a1a;font-weight:600;">リンクからWalletに会員証を保存</span>';

  await transporter.sendMail({
    from: process.env.EMAIL_FROM || 'noreply@vuelta.jp',
    to: email,
    subject: 'VUELTA — Welcome to FIRST-DRINK PASS',
    html: `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Helvetica Neue',sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;">
    <tr><td align="center" style="padding:48px 20px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:440px;background:#ffffff;border-radius:16px;">
        <tr><td style="padding:40px 32px 36px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <!-- Logo -->
            <tr><td align="center" style="padding-bottom:36px;">
              <img src="https://vuelta.jp/images/vuelta-logo.png" alt="VUELTA" height="28" style="height:28px;width:auto;">
            </td></tr>
            <!-- Green accent -->
            <tr><td align="center" style="padding-bottom:24px;">
              <div style="width:36px;height:3px;background:#2d5a3d;border-radius:2px;"></div>
            </td></tr>
            <!-- Greeting -->
            <tr><td align="center" style="padding-bottom:10px;">
              <span style="font-size:20px;font-weight:500;color:#0a0a0a;">${name} 様</span>
            </td></tr>
            <tr><td align="center" style="padding-bottom:28px;">
              <span style="font-size:13px;color:#888;line-height:1.8;">FIRST-DRINK PASS へようこそ。<br>来店ごとに最初の一杯が無料になります。</span>
            </td></tr>
            <!-- Divider -->
            <tr><td style="padding-bottom:24px;"><div style="height:1px;background:#eee;"></div></td></tr>
            <!-- Wallet Button -->
            ${walletButton}
            <!-- Divider -->
            <tr><td style="padding-top:20px;padding-bottom:8px;"><div style="height:1px;background:#eee;"></div></td></tr>
            <!-- How to use -->
            <tr><td style="padding:20px 0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8f8f8;border-radius:10px;">
                <tr><td style="padding:22px;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                    <tr><td style="padding-bottom:14px;">
                      <span style="font-size:10px;font-weight:600;letter-spacing:0.15em;text-transform:uppercase;color:#bbb;">HOW TO USE</span>
                    </td></tr>
                    <tr><td style="padding-bottom:12px;">
                      <table role="presentation" cellpadding="0" cellspacing="0"><tr>
                        <td style="width:28px;vertical-align:top;padding-top:1px;">
                          <div style="width:20px;height:20px;border-radius:50%;background:#0a0a0a;text-align:center;line-height:20px;font-size:10px;font-weight:600;color:#fff;">1</div>
                        </td>
                        <td style="font-size:13px;color:#666;line-height:1.5;">
                          ${step1Text}
                        </td>
                      </tr></table>
                    </td></tr>
                    <tr><td style="padding-bottom:12px;">
                      <table role="presentation" cellpadding="0" cellspacing="0"><tr>
                        <td style="width:28px;vertical-align:top;padding-top:1px;">
                          <div style="width:20px;height:20px;border-radius:50%;background:#0a0a0a;text-align:center;line-height:20px;font-size:10px;font-weight:600;color:#fff;">2</div>
                        </td>
                        <td style="font-size:13px;color:#666;line-height:1.5;">
                          来店時に<span style="color:#1a1a1a;font-weight:600;">QRコード</span>をバーテンダーに提示
                        </td>
                      </tr></table>
                    </td></tr>
                    <tr><td>
                      <table role="presentation" cellpadding="0" cellspacing="0"><tr>
                        <td style="width:28px;vertical-align:top;padding-top:1px;">
                          <div style="width:20px;height:20px;border-radius:50%;background:#0a0a0a;text-align:center;line-height:20px;font-size:10px;font-weight:600;color:#fff;">3</div>
                        </td>
                        <td style="font-size:13px;color:#666;line-height:1.5;">
                          最初の一杯が<span style="color:#1a1a1a;font-weight:600;">無料</span>
                        </td>
                      </tr></table>
                    </td></tr>
                  </table>
                </td></tr>
              </table>
            </td></tr>
            <!-- Footer -->
            <tr><td align="center" style="padding-top:20px;">
              <p style="margin:0 0 4px;font-size:11px;color:#bbb;font-style:italic;">Where welcome back meets nice to meet you.</p>
              <p style="margin:0 0 8px;font-size:11px;color:#ccc;">広島市中区大手町3-3-5 掛江ビル2F</p>
              <p style="margin:0;">
                <a href="https://www.instagram.com/vuelta_bar" style="color:#999;text-decoration:none;font-size:11px;">Instagram</a>
                <span style="color:#ddd;margin:0 6px;">&middot;</span>
                <a href="https://www.vuelta.jp/" style="color:#999;text-decoration:none;font-size:11px;">Website</a>
              </p>
            </td></tr>
          </table>
        </td></tr>
      </table>
    </td></tr>
  </table>
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
      // セッションから直接メール・名前を取得（外部API呼び出し不要）
      const customerEmail = session.customer_email || session.customer_details?.email;
      const customerName = session.customer_details?.name || 'VUELTA Member';
      console.log(`[WEBHOOK] Customer: name=${customerName}, email=${customerEmail}, stripeId=${session.customer}`);

      if (!customerEmail) {
        console.error('[WEBHOOK] ERROR: No email found in session data');
        return res.status(200).json({ received: true, warning: 'No email found' });
      }

      // PassKit会員証生成（失敗しても続行）
      let walletUrl = null;
      try {
        walletUrl = await generatePassKitCard({
          email: customerEmail,
          name: customerName,
          customerId: session.customer || session.id,
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
