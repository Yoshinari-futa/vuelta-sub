/**
 * VUELTA 紹介（リファラル）機能の共通ヘルパー
 *
 * 仕組み:
 *   1. 既存会員の Wallet カード裏に「友達を紹介」リンク → /share/<externalId> を埋める
 *   2. /share ページで「共有リンク」(/r/<externalId>) とその QR を表示
 *   3. 友達がそのリンクを開くと Stripe Payment Link に client_reference_id を付けてリダイレクト
 *   4. 決済完了時の webhook で紹介者 ID を新メンバーの metaData.pendingReferralReward に保存
 *   5. 新メンバーが初めてスキャンされた瞬間、両方の会員に foodCoupons +1
 */

const STRIPE_PAYMENT_LINK = 'https://buy.stripe.com/cNi7sK0NG9yL7k5cMk6Zy02';
const PUBLIC_BASE_URL = 'https://subsc-webhook.vercel.app';

function buildShareUrl(externalId) {
  if (!externalId) return null;
  return `${PUBLIC_BASE_URL}/share/${encodeURIComponent(externalId)}`;
}

function buildReferralRedirectUrl(externalId) {
  if (!externalId) return null;
  return `${PUBLIC_BASE_URL}/r/${encodeURIComponent(externalId)}`;
}

function buildStripeCheckoutUrl(referrerId) {
  if (!referrerId) return STRIPE_PAYMENT_LINK;
  const sep = STRIPE_PAYMENT_LINK.includes('?') ? '&' : '?';
  return `${STRIPE_PAYMENT_LINK}${sep}client_reference_id=${encodeURIComponent(referrerId)}`;
}

/** Wallet カード裏面の backFields 定義（テンプレートに "referral" key を追加したとき用、保険） */
function getReferralBackFields(externalId) {
  const shareUrl = buildShareUrl(externalId);
  if (!shareUrl) return [];
  return [
    {
      key: 'referral',
      label: 'Introduce a friend',
      value: shareUrl,
    },
  ];
}

/**
 * Wallet カード裏のカスタム Back Field（uniqueName: meta.memberInfo, ラベル: Information）
 * に紹介リンクを表示するための metaData。
 *
 * PassKit はユーザー定義フィールドに自動で "meta." 接頭辞を付けるため、
 * Designer で "memberInfo" として作ったフィールドの実 key は "meta.memberInfo"。
 * 会員の metaData 側もこの key と完全一致させる必要がある。
 *
 * 副作用: テンプレートの Change Message は "VUELTA: %@"（remind-inactive と共用）。
 * 値が変わるたびに Apple Wallet が "VUELTA: <URL>" のロック画面通知を送る。
 */
function getReferralMetaData(externalId) {
  const shareUrl = buildShareUrl(externalId);
  if (!shareUrl) return {};
  return {
    'meta.memberInfo': shareUrl,
  };
}

module.exports = {
  STRIPE_PAYMENT_LINK,
  PUBLIC_BASE_URL,
  buildShareUrl,
  buildReferralRedirectUrl,
  buildStripeCheckoutUrl,
  getReferralBackFields,
  getReferralMetaData,
};
