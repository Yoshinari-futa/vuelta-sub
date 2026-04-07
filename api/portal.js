/**
 * Vercel Serverless Function: Stripe Customer Portal
 * POST /api/portal
 *
 * メールアドレスからStripe顧客を検索し、
 * Stripe Customer Portalセッションを生成してリダイレクト。
 * お客様がセルフで解約・支払い方法変更を行える。
 */

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

module.exports = async function handler(req, res) {
  // GET: cancelページからのリダイレクト（クエリパラメータ）
  // POST: フォーム送信
  const email =
    req.method === 'POST'
      ? (req.body && req.body.email) || ''
      : (req.query && req.query.email) || '';

  if (!email || !email.includes('@')) {
    return res.status(400).json({
      error: 'メールアドレスが必要です',
    });
  }

  try {
    // メールアドレスでStripe顧客を検索
    const customers = await stripe.customers.list({
      email: email.trim().toLowerCase(),
      limit: 1,
    });

    if (customers.data.length === 0) {
      // セキュリティ上、顧客が見つからない場合も曖昧に返す
      return res.redirect(
        302,
        `/cancel?status=not_found`
      );
    }

    const customer = customers.data[0];

    // Stripe Customer Portalセッション作成
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: customer.id,
      return_url: `https://subsc-webhook.vercel.app/cancel?status=done`,
    });

    // ポータルへリダイレクト
    return res.redirect(302, portalSession.url);
  } catch (err) {
    console.error('[PORTAL] Error:', err.message);
    return res.redirect(
      302,
      `/cancel?status=error`
    );
  }
};
