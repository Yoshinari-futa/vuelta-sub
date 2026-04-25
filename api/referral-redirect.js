/**
 * GET /r/<externalId>
 * 紹介リンク。Stripe Payment Link に client_reference_id を付けてリダイレクトする。
 *
 * vercel.json の routes で `/r/:id` → `/api/referral-redirect.js?id=:id` にマップ。
 */

const { buildStripeCheckoutUrl } = require('../lib/referral');

module.exports = async function handler(req, res) {
  const id = (req.query?.id || '').trim();
  const target = buildStripeCheckoutUrl(id);
  console.log(`[REFERRAL] redirect id=${id || '(none)'} -> ${target}`);
  res.setHeader('Cache-Control', 'no-store');
  res.writeHead(302, { Location: target });
  res.end();
};
