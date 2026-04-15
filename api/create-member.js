/**
 * POST /create-member
 * 手動でPassKitメンバー作成 + ウォレットメール送信
 * Body: { name, email, externalId, secret }
 */

const nodemailer = require('nodemailer');
const { getPassKitAuth } = require('../lib/passkit-auth');
const { TIER_BASE } = require('../lib/passkit-tier-ids');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // 簡易認証
  const { name, email, externalId, secret } = req.body || {};
  if (secret !== 'vuelta2026-member') {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!name || !email) {
    return res.status(400).json({ error: 'name and email are required' });
  }

  const extId = externalId || email.replace(/[@.]/g, '-');
  console.log(`[CREATE-MEMBER] name=${name}, email=${email}, extId=${extId}`);

  // --- PassKit メンバー作成 ---
  let walletUrl = null;
  try {
    const { token, baseUrl: passkitBaseUrl } = getPassKitAuth();
    const programId = process.env.PASSKIT_PROGRAM_ID;
    // 新規メンバーは常にBaseティア（白）から始まる。
    // env変数 PASSKIT_TIER_ID は他用途で使われている可能性があるため上書きしない。
    const tierId = TIER_BASE;

    const apiUrl = `${passkitBaseUrl}/members/member`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Authorization': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        programId,
        tierId,
        person: { displayName: name, emailAddress: email, forenames: name.split(' ')[0], surname: name.split(' ').slice(1).join(' ') || name },
        externalId: extId,
        points: 0,
        tierPoints: 0,
        passOverrides: {
          imageIds: {
            strip: '1KtkahvCl3rLRgLmxhxkaM',
          },
          // ジオフェンス（VUELTA 近くでロック画面提案）を最初から注入。
          // 後から /set-geofence を叩く必要を無くすため。
          // 座標・文言は env で上書き可能。
          locations: [
            {
              latitude: parseFloat(process.env.VUELTA_GEOFENCE_LAT || '') || 34.3893066,
              longitude: parseFloat(process.env.VUELTA_GEOFENCE_LNG || '') || 132.4541823,
              relevantText:
                (process.env.VUELTA_GEOFENCE_TEXT || "You're near VUELTA. How about a drink tonight?").trim(),
              altitude: 0,
              radius: 300,
            },
          ],
        },
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const responseText = await response.text();
    console.log(`[PASSKIT] ${response.status}: ${responseText.substring(0, 300)}`);

    if (!response.ok) throw new Error(`PassKit: ${response.status} - ${responseText.substring(0, 200)}`);

    const member = JSON.parse(responseText);
    const region = (process.env.PASSKIT_HOST || '').includes('pub1') ? 'pub1' : 'pub2';
    walletUrl = `https://${region}.pskt.io/${member.id}`;
    console.log(`[PASSKIT] Wallet URL: ${walletUrl}`);
  } catch (err) {
    console.error(`[PASSKIT] FAILED: ${err.message}`);
  }

  // --- メール送信 ---
  let emailSent = false;
  try {
    const transporter = nodemailer.createTransport({
      service: process.env.EMAIL_SERVICE || 'gmail',
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
    });

    const walletButton = walletUrl
      ? `<tr><td align="center" style="padding:28px 0 12px;">
            <a href="${walletUrl}" style="display:inline-block;padding:13px 36px;background:#0a0a0a;color:#ffffff;text-decoration:none;font-weight:600;font-size:13px;letter-spacing:0.06em;border-radius:50px;">ADD TO WALLET &rarr;</a>
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
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Helvetica Neue',sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;">
    <tr><td align="center" style="padding:48px 20px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:440px;background:#ffffff;border-radius:16px;">
        <tr><td style="padding:40px 32px 36px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr><td align="center" style="padding-bottom:36px;">
              <img src="https://vuelta.jp/images/vuelta-logo.png" alt="VUELTA" height="28" style="height:28px;width:auto;">
            </td></tr>
            <tr><td align="center" style="padding-bottom:24px;">
              <div style="width:36px;height:3px;background:#2d5a3d;border-radius:2px;"></div>
            </td></tr>
            <tr><td align="center" style="padding-bottom:10px;">
              <span style="font-size:20px;font-weight:500;color:#0a0a0a;">${name} 様</span>
            </td></tr>
            <tr><td align="center" style="padding-bottom:28px;">
              <span style="font-size:13px;color:#888;line-height:1.8;">FIRST-DRINK PASS へようこそ。<br>来店ごとに最初の一杯が無料になります。</span>
            </td></tr>
            <tr><td style="padding-bottom:24px;"><div style="height:1px;background:#eee;"></div></td></tr>
            ${walletButton}
            <tr><td style="padding-top:20px;padding-bottom:8px;"><div style="height:1px;background:#eee;"></div></td></tr>
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
                        <td style="font-size:13px;color:#666;line-height:1.5;">${step1Text}</td>
                      </tr></table>
                    </td></tr>
                    <tr><td style="padding-bottom:12px;">
                      <table role="presentation" cellpadding="0" cellspacing="0"><tr>
                        <td style="width:28px;vertical-align:top;padding-top:1px;">
                          <div style="width:20px;height:20px;border-radius:50%;background:#0a0a0a;text-align:center;line-height:20px;font-size:10px;font-weight:600;color:#fff;">2</div>
                        </td>
                        <td style="font-size:13px;color:#666;line-height:1.5;">来店時に<span style="color:#1a1a1a;font-weight:600;">QRコード</span>をバーテンダーに提示</td>
                      </tr></table>
                    </td></tr>
                    <tr><td>
                      <table role="presentation" cellpadding="0" cellspacing="0"><tr>
                        <td style="width:28px;vertical-align:top;padding-top:1px;">
                          <div style="width:20px;height:20px;border-radius:50%;background:#0a0a0a;text-align:center;line-height:20px;font-size:10px;font-weight:600;color:#fff;">3</div>
                        </td>
                        <td style="font-size:13px;color:#666;line-height:1.5;">最初の一杯が<span style="color:#1a1a1a;font-weight:600;">無料</span></td>
                      </tr></table>
                    </td></tr>
                  </table>
                </td></tr>
              </table>
            </td></tr>
            <tr><td style="padding:24px 0 8px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8f8f8;border-radius:10px;">
                <tr><td style="padding:18px 22px;">
                  <p style="margin:0 0 8px;font-size:12px;font-weight:600;color:#1a1a1a;">サブスクリプションの解約・管理について</p>
                  <p style="margin:0 0 10px;font-size:12px;color:#666;line-height:1.7;">
                    解約・お支払い方法の変更は、下記ページからご登録メールアドレスを入力するといつでもセルフでお手続きいただけます。<br>
                    解約日までは引き続きサービスをご利用いただけ、次回更新日以降の請求は発生しません。
                  </p>
                  <p style="margin:0;">
                    <a href="https://subsc-webhook.vercel.app/cancel" style="color:#0a0a0a;text-decoration:underline;font-size:12px;font-weight:600;">解約・管理ページへ &rarr;</a>
                  </p>
                </td></tr>
              </table>
            </td></tr>
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
</body></html>`,
    });
    emailSent = true;
    console.log(`[EMAIL] Sent to ${email}`);
  } catch (err) {
    console.error(`[EMAIL] FAILED: ${err.message}`);
  }

  return res.status(200).json({
    success: true,
    name,
    email,
    externalId: extId,
    walletUrl,
    emailSent,
  });
};
