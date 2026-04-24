/**
 * GET /share/<externalId>
 * 会員向けの紹介共有ページ。
 * - 紹介リンク（コピー可）
 * - QR コード（友達にその場で見せる用、外部 QR サービスで生成）
 *
 * vercel.json の routes で `/share/:id` → `/api/share-page.js?id=:id` にマップ。
 */

const { buildReferralRedirectUrl } = require('../lib/referral');

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = async function handler(req, res) {
  const id = (req.query?.id || '').trim();
  const shareUrl = buildReferralRedirectUrl(id);

  if (!id || !shareUrl) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(400).send('<h1>Invalid link</h1>');
    return;
  }

  const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(shareUrl)}&size=520x520&margin=0&bgcolor=FFFFFF&color=0A0A0A&ecc=M`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'private, max-age=60');
  res.status(200).send(`<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Introduce a friend — VUELTA</title>
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', sans-serif;
    background: #f4f4f4;
    color: #0a0a0a;
    min-height: 100vh;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 48px 20px;
  }
  .card {
    background: #ffffff;
    border-radius: 16px;
    max-width: 440px;
    width: 100%;
    padding: 40px 32px;
  }
  .logo {
    text-align: center;
    font-size: 14px;
    font-weight: 500;
    letter-spacing: 0.6em;
    color: #0a0a0a;
    padding-left: 0.6em;
    margin-bottom: 18px;
  }
  .accent {
    width: 36px;
    height: 3px;
    background: #2d5a3d;
    border-radius: 2px;
    margin: 0 auto 24px;
  }
  h1 {
    font-size: 20px;
    font-weight: 500;
    text-align: center;
    margin: 0 0 10px;
    letter-spacing: 0.02em;
  }
  .lede {
    font-size: 13px;
    color: #888;
    line-height: 1.8;
    text-align: center;
    margin: 0 0 28px;
  }
  .divider {
    height: 1px;
    background: #eee;
    margin: 0 0 24px;
  }
  .qr {
    background: #f8f8f8;
    border-radius: 10px;
    padding: 22px;
    margin-bottom: 20px;
    text-align: center;
  }
  .qr img {
    width: 100%;
    max-width: 260px;
    height: auto;
    display: block;
    margin: 0 auto 14px;
  }
  .qr .label {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: #bbb;
    margin: 0;
  }
  .link-box {
    background: #f8f8f8;
    border-radius: 10px;
    padding: 18px 22px;
    margin-bottom: 20px;
  }
  .link-box .label {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: #bbb;
    margin: 0 0 8px;
  }
  .link-box .url {
    font-size: 12px;
    color: #1a1a1a;
    word-break: break-all;
    margin: 0 0 12px;
    font-family: 'SF Mono', Menlo, Consolas, monospace;
  }
  .copy-btn {
    display: inline-block;
    padding: 10px 28px;
    background: #0a0a0a;
    color: #ffffff;
    border: none;
    border-radius: 50px;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.06em;
    cursor: pointer;
    font-family: inherit;
  }
  .copy-btn:active { transform: scale(0.98); }
  .copy-btn.copied { background: #2d5a3d; }
  .perk {
    background: #f8f8f8;
    border-radius: 10px;
    padding: 18px 22px;
    margin-bottom: 20px;
  }
  .perk .label {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: #bbb;
    margin: 0 0 10px;
  }
  .perk .text {
    font-size: 13px;
    color: #666;
    line-height: 1.7;
    margin: 0;
  }
  .perk .text strong { color: #1a1a1a; font-weight: 600; }
  footer {
    margin-top: 28px;
    text-align: center;
  }
  footer .tagline {
    font-size: 11px;
    color: #bbb;
    font-style: italic;
    margin: 0 0 6px;
  }
  footer .addr {
    font-size: 11px;
    color: #ccc;
    margin: 0 0 8px;
  }
  footer a {
    color: #999;
    text-decoration: none;
    font-size: 11px;
  }
  footer .sep {
    color: #ddd;
    margin: 0 6px;
  }
</style>
</head>
<body>
<div class="card">
  <div class="logo">V U E L T A</div>
  <div class="accent"></div>
  <h1>Introduce a friend</h1>
  <p class="lede">
    大切な人を VUELTA にご招待。<br>
    QR を見せるか、リンクを送ってください。
  </p>

  <div class="divider"></div>

  <div class="qr">
    <img src="${escapeHtml(qrImageUrl)}" alt="Referral QR">
    <p class="label">Show to a friend</p>
  </div>

  <div class="link-box">
    <p class="label">Share the link</p>
    <p class="url" id="url">${escapeHtml(shareUrl)}</p>
    <button class="copy-btn" id="copy">COPY LINK</button>
  </div>

  <div class="perk">
    <p class="label">Your thank-you</p>
    <p class="text">
      ご紹介でお友達がご入会、初来店されると、<br>
      <strong>フード1品無料券</strong>をおふたりにプレゼントします。
    </p>
  </div>

  <footer>
    <p class="tagline">Where welcome back meets nice to meet you.</p>
    <p class="addr">広島市中区大手町3-3-5 掛江ビル2F</p>
    <p>
      <a href="https://www.instagram.com/vuelta_bar" target="_blank" rel="noopener">Instagram</a>
      <span class="sep">·</span>
      <a href="https://www.vuelta.jp/" target="_blank" rel="noopener">Website</a>
    </p>
  </footer>
</div>

<script>
  const btn = document.getElementById('copy');
  const url = document.getElementById('url').textContent.trim();
  btn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(url);
      btn.textContent = 'COPIED ✓';
      btn.classList.add('copied');
      setTimeout(() => {
        btn.textContent = 'COPY LINK';
        btn.classList.remove('copied');
      }, 2000);
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = url;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch {}
      document.body.removeChild(ta);
      btn.textContent = 'COPIED ✓';
      btn.classList.add('copied');
      setTimeout(() => {
        btn.textContent = 'COPY LINK';
        btn.classList.remove('copied');
      }, 2000);
    }
  });
</script>
</body>
</html>`);
};
