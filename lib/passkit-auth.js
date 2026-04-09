/**
 * PassKit REST 用 JWT と baseUrl（scan / webhook / repair 等で共通）
 * PassKit 公式 GAS 例に合わせ raw JWT を Authorization に載せる。
 */
const jwt = require('jsonwebtoken');

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
    { algorithm: 'HS256' }
  );
  let host = process.env.PASSKIT_HOST || 'api.pub2.passkit.io';
  if (!host.startsWith('http')) host = 'https://' + host;
  const baseUrl = host.replace(/\/$/, '');
  return { token, baseUrl };
}

module.exports = { getPassKitAuth };
