/**
 * Vercel Serverless Function: Stripe Webhook Handler
 * POST /api/webhook/stripe
 *
 * Stripe決済完了 → PassKitで会員証生成 → メール送信
 */

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const nodemailer = require('nodemailer');
const jwt = require('jsonwebtoken');
const { TIER_BASE } = require('../passkit-tier-ids');

// config は handler に付与（下部参照）

// rawBodyを取得するヘルパー
function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// Slack Block Kit の mrkdwn 向け（ユーザー入力のエスケープ）
function escapeSlackMrkdwn(s) {
  if (s == null || s === '') return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Checkout Session の custom_fields（誕生日・Instagram 等）を { key, label, value } に正規化
 * @see https://docs.stripe.com/api/checkout/sessions/object
 */
function extractCustomFieldsFromSession(session) {
  const fields = session && session.custom_fields;
  if (!Array.isArray(fields) || fields.length === 0) return [];

  return fields.map((f) => {
    const label =
      (f.label && f.label.type === 'custom' && f.label.custom) ||
      f.key ||
      '項目';
    let value = '';
    if (f.type === 'text' && f.text && f.text.value != null) {
      value = String(f.text.value);
    } else if (f.type === 'numeric' && f.numeric && f.numeric.value != null) {
      value = String(f.numeric.value);
    } else if (f.type === 'dropdown' && f.dropdown && f.dropdown.value) {
      value = String(f.dropdown.value);
    }
    return { key: f.key, label, value };
  });
}

/** Webhook ペイロードに custom_fields が空のとき、Session を再取得して補完 */
async function enrichCheckoutSessionWithCustomFields(session) {
  if (Array.isArray(session.custom_fields) && session.custom_fields.length > 0) {
    return session;
  }
  try {
    const full = await stripe.checkout.sessions.retrieve(session.id);
    return full;
  } catch (e) {
    console.log('[WEBHOOK] sessions.retrieve (custom_fields):', e.message);
    return session;
  }
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

// PassKit認証トークン生成（共通）
function getPassKitAuth() {
  const passkitApiKeyId = (process.env.PASSKIT_API_KEY || '').trim();
  const passkitApiKeySecret = (process.env.PASSKIT_API_KEY_SECRET || '').trim();
  if (!passkitApiKeyId || !passkitApiKeySecret) {
    throw new Error('PASSKIT_API_KEY and PASSKIT_API_KEY_SECRET are required');
  }
  const now = Math.floor(Date.now() / 1000);
  const token = jwt.sign(
    { uid: passkitApiKeyId, iat: now, exp: now + 3600 },
    passkitApiKeySecret,
    { algorithm: 'HS256', header: { alg: 'HS256', typ: 'JWT' } }
  );
  let host = process.env.PASSKIT_HOST || 'api.pub2.passkit.io';
  if (!host.startsWith('http')) host = 'https://' + host;
  return { token, baseUrl: host.replace(/\/$/, '') };
}

// PassKit会員証削除（解約時）
// 3つの方法を順に試行: externalId直接削除 → programId+externalId削除 → 検索してID削除
async function deletePassKitMember(externalId) {
  const { token, baseUrl } = getPassKitAuth();
  const programId = process.env.PASSKIT_PROGRAM_ID;
  console.log(`[PASSKIT] Deleting member: externalId=${externalId}, programId=${programId}`);

  const attempts = [
    // 方法1: externalIdとprogramIdで直接削除
    { name: 'externalId+programId', body: { externalId, programId } },
    // 方法2: externalIdのみで削除
    { name: 'externalId only', body: { externalId } },
  ];

  for (const attempt of attempts) {
    try {
      console.log(`[PASSKIT] Trying delete: ${attempt.name}`);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const resp = await fetch(`${baseUrl}/members/member`, {
        method: 'DELETE',
        headers: { 'Authorization': token, 'Content-Type': 'application/json' },
        body: JSON.stringify(attempt.body),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const text = await resp.text();
      console.log(`[PASSKIT] ${attempt.name}: ${resp.status} - ${text.substring(0, 200)}`);

      if (resp.ok) {
        console.log(`[PASSKIT] Delete SUCCESS via ${attempt.name}`);
        return true;
      }
    } catch (err) {
      console.error(`[PASSKIT] ${attempt.name} error: ${err.message}`);
    }
  }

  // 方法3: GET検索 → ID削除（フォールバック）
  try {
    console.log(`[PASSKIT] Trying fallback: GET lookup then delete`);
    const controller1 = new AbortController();
    const timeout1 = setTimeout(() => controller1.abort(), 5000);

    const getResponse = await fetch(`${baseUrl}/members/member/external/${programId}/${externalId}`, {
      method: 'GET',
      headers: { 'Authorization': token },
      signal: controller1.signal,
    });
    clearTimeout(timeout1);

    if (getResponse.ok) {
      const member = await getResponse.json();
      console.log(`[PASSKIT] Found member: ${member.id}`);

      const controller2 = new AbortController();
      const timeout2 = setTimeout(() => controller2.abort(), 5000);

      const delResp = await fetch(`${baseUrl}/members/member`, {
        method: 'DELETE',
        headers: { 'Authorization': token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: member.id }),
        signal: controller2.signal,
      });
      clearTimeout(timeout2);

      const delText = await delResp.text();
      console.log(`[PASSKIT] Fallback delete: ${delResp.status} - ${delText.substring(0, 200)}`);
      return delResp.ok;
    } else {
      const text = await getResponse.text();
      console.error(`[PASSKIT] Fallback lookup failed: ${getResponse.status} - ${text.substring(0, 200)}`);
    }
  } catch (err) {
    console.error(`[PASSKIT] Fallback error: ${err.message}`);
  }

  console.error(`[PASSKIT] All delete methods failed for externalId=${externalId}`);
  return false;
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
        person: {
          displayName: name,
          emailAddress: email,
          forenames: name.split(' ')[0],
          surname: name.split(' ').slice(1).join(' ') || name,
        },
        externalId: customerId,
        points: 0,
        tierPoints: 0,
        passOverrides: {
          imageIds: {
            strip: '1KtkahvCl3rLRgLmxhxkaM',
          },
        },
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
              <p style="margin:12px 0 0;">
                <a href="https://subsc-webhook.vercel.app/cancel" style="color:#ccc;text-decoration:none;font-size:10px;">サブスクリプションの管理・解約</a>
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

// Slack通知送信（Stripe Checkout の custom_fields を任意で同梱）
async function sendSlackNotification({ name, email, walletUrl, customFields }) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) {
    console.log('[SLACK] Skipped: SLACK_WEBHOOK_URL not set');
    return;
  }

  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const timeStr = `${jst.getMonth() + 1}/${jst.getDate()} ${String(jst.getHours()).padStart(2, '0')}:${String(jst.getMinutes()).padStart(2, '0')}`;

  const walletStatus = walletUrl ? '✅ Wallet発行済' : '⏳ Wallet未発行（証明書未設定）';

  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: '🎉 新規 FIRST-DRINK PASS 会員', emoji: true }
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*氏名*\n${escapeSlackMrkdwn(name)}` },
        { type: 'mrkdwn', text: `*メール*\n${escapeSlackMrkdwn(email)}` },
      ]
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Wallet*\n${walletStatus}` },
        { type: 'mrkdwn', text: `*登録日時*\n${timeStr}` },
      ]
    },
  ];

  if (Array.isArray(customFields) && customFields.length > 0) {
    const lines = customFields
      .map((f) => {
        const v = f.value && String(f.value).trim() !== '' ? f.value : '（未入力）';
        return `• *${escapeSlackMrkdwn(f.label)}:* ${escapeSlackMrkdwn(v)}`;
      })
      .join('\n');
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*チェックアウト時の追加項目*\n${lines}` },
    });
  }

  blocks.push({
    type: 'context',
    elements: [
      { type: 'mrkdwn', text: 'Stripe → FIRST-DRINK PASS サブスクリプション ¥1,980/月' }
    ]
  });

  const payload = { blocks };

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (response.ok) {
      console.log('[SLACK] SUCCESS: notification sent');
    } else {
      const text = await response.text();
      console.error(`[SLACK] FAILED: ${response.status} - ${text}`);
    }
  } catch (err) {
    console.error(`[SLACK] FAILED: ${err.message}`);
  }
}

// メインハンドラー
async function handler(req, res) {
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

  // ===== 新規決済完了 =====
  if (event.type === 'checkout.session.completed') {
    const session = await enrichCheckoutSessionWithCustomFields(event.data.object);
    const customFields = extractCustomFieldsFromSession(session);
    if (customFields.length > 0) {
      console.log(`[WEBHOOK] custom_fields (${customFields.length}):`, JSON.stringify(customFields));
    }

    console.log(`[WEBHOOK] Session: customer=${session.customer}, email=${session.customer_email || session.customer_details?.email || 'none'}`);

    try {
      const customerEmail = session.customer_email || session.customer_details?.email;
      const customerName = session.customer_details?.name || 'VUELTA Member';
      console.log(`[WEBHOOK] Customer: name=${customerName}, email=${customerEmail}, stripeId=${session.customer}`);

      if (!customerEmail) {
        console.error('[WEBHOOK] ERROR: No email found in session data');
        return res.status(200).json({ received: true, warning: 'No email found' });
      }

      // PassKit会員証生成（失敗しても続行 — ただしSlack警告を送る）
      let walletUrl = null;
      try {
        walletUrl = await generatePassKitCard({
          email: customerEmail,
          name: customerName,
          customerId: session.customer || session.id,
          tierId: process.env.PASSKIT_TIER_ID || TIER_BASE,
        });
        console.log(`[PASSKIT] SUCCESS: ${walletUrl}`);
      } catch (err) {
        console.error(`[PASSKIT] FAILED: ${err.message}`);
        // PassKit作成失敗をSlackに警告
        const webhookUrl = process.env.SLACK_WEBHOOK_URL;
        if (webhookUrl) {
          try {
            const failBlocks = [
              { type: 'header', text: { type: 'plain_text', text: '⚠️ PassKit カード作成失敗', emoji: true } },
              { type: 'section', fields: [
                { type: 'mrkdwn', text: `*名前*\n${escapeSlackMrkdwn(customerName)}` },
                { type: 'mrkdwn', text: `*メール*\n${escapeSlackMrkdwn(customerEmail)}` },
              ]},
            ];
            if (customFields.length > 0) {
              const lines = customFields
                .map((f) => {
                  const v = f.value && String(f.value).trim() !== '' ? f.value : '（未入力）';
                  return `• *${escapeSlackMrkdwn(f.label)}:* ${escapeSlackMrkdwn(v)}`;
                })
                .join('\n');
              failBlocks.push({
                type: 'section',
                text: { type: 'mrkdwn', text: `*チェックアウト時の追加項目*\n${lines}` },
              });
            }
            failBlocks.push({
              type: 'section',
              text: { type: 'mrkdwn', text: `*エラー*\n\`${escapeSlackMrkdwn(err.message)}\`\n\n手動で /create-member から再作成してください。` },
            });
            await fetch(webhookUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ blocks: failBlocks }),
            });
          } catch (slackErr) {
            console.error(`[SLACK] Warning notification failed: ${slackErr.message}`);
          }
        }
      }

      // メール送信
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

      // Slack通知
      try {
        await sendSlackNotification({ name: customerName, email: customerEmail, walletUrl, customFields });
      } catch (err) {
        console.error(`[SLACK] FAILED: ${err.message}`);
      }

    } catch (err) {
      console.error(`[WEBHOOK] Processing error: ${err.message}`);
    }
  }

  // ===== サブスク解約 =====
  // 安全策: PassKitメンバーは自動削除しない（Slack通知のみ → 手動判断）
  if (event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object;
    const customerId = subscription.customer;
    console.log(`[WEBHOOK] Subscription cancelled: customer=${customerId}`);

    try {
      // Slack通知（削除は手動で /cleanup-member から行う）
      const webhookUrl = process.env.SLACK_WEBHOOK_URL;
      if (webhookUrl) {
        await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            blocks: [
              { type: 'header', text: { type: 'plain_text', text: '🚪 FIRST-DRINK PASS 解約通知', emoji: true } },
              { type: 'section', fields: [
                { type: 'mrkdwn', text: `*Stripe ID*\n${customerId}` },
              ]},
              { type: 'section', text: { type: 'mrkdwn', text: '⚠️ Walletカードは *自動削除されません*。\n必要に応じて手動で `/cleanup-member` から削除してください。' } },
            ]
          }),
        });
      }
    } catch (err) {
      console.error(`[WEBHOOK] Cancellation processing error: ${err.message}`);
    }
  }

  res.json({ received: true });
}

// Vercelではbodyのパースを無効にする（Stripe署名検証のため）
// module.exports の後に config を付与する（上書き防止）
module.exports = handler;
module.exports.config = {
  api: {
    bodyParser: false,
  },
};
