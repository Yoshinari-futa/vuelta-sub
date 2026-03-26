/**
 * GET /api/health
 * ヘルスチェックエンドポイント
 */
module.exports = async function handler(req, res) {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'vuelta-membership-backend',
  });
};
