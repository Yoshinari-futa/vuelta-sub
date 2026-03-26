/**
 * GET /api/health
 * ヘルスチェックエンドポイント
 */
module.exports = async function handler(req, res) {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'vuelta-membership-backend',
    env: {
      STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY ? 'SET' : 'MISSING',
      STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET ? 'SET' : 'MISSING',
      STRIPE_PRICE_ID: process.env.STRIPE_PRICE_ID ? 'SET' : 'MISSING',
      PASSKIT_HOST: process.env.PASSKIT_HOST ? 'SET' : 'MISSING',
      PASSKIT_API_KEY: process.env.PASSKIT_API_KEY ? 'SET' : 'MISSING',
      PASSKIT_API_KEY_SECRET: process.env.PASSKIT_API_KEY_SECRET ? 'SET' : 'MISSING',
      PASSKIT_TIER_ID: process.env.PASSKIT_TIER_ID ? 'SET' : 'MISSING',
      PASSKIT_PROGRAM_ID: process.env.PASSKIT_PROGRAM_ID ? 'SET' : 'MISSING',
      EMAIL_FROM: process.env.EMAIL_FROM ? 'SET' : 'MISSING',
      EMAIL_SERVICE: process.env.EMAIL_SERVICE ? 'SET' : 'MISSING',
      EMAIL_USER: process.env.EMAIL_USER ? 'SET' : 'MISSING',
      EMAIL_PASS: process.env.EMAIL_PASS ? 'SET' : 'MISSING',
    },
  });
};
