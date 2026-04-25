/**
 * Apple Wallet に更新 push を発火させるためのトリガーフィールド。
 *
 * PassKit では metaData だけ更新しても iPhone / Apple Wallet 側へ
 * 更新 push が届かない。過去の実験（コミット 35bc7a5）で以下の
 * 組み合わせが push 発火に有効と判明している:
 *   - 会員の `secondaryPoints` を epoch 秒で更新（表示フィールドの値変更）
 *   - `passOverrides.relevantDate` を現在時刻に設定
 *
 * これを PUT 更新に含めることで、Wallet が最新データを取りに来て
 * metaData（例: `universal.info`）や backFields の変更が反映される。
 */

function getWalletPushTrigger() {
  const now = new Date();
  return {
    secondaryPoints: Math.floor(now.getTime() / 1000),
    relevantDate: now.toISOString(),
  };
}

module.exports = { getWalletPushTrigger };
