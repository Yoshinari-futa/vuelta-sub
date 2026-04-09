/**
 * VUELTA PassKit プログラムの tier ID（PassKit ダッシュボードで確認済み）
 * 環境変数 PASSKIT_TIER_ID_* で上書き可能。
 *
 * 注意: これはテンプレートIDではなく、tier の slug。
 * テンプレートID（5XDN..., 6CjM..., 7pvl..., 5OjL...）とは別物。
 */
module.exports = {
  TIER_BASE: 'base',
  TIER_SILVER: 'silver',
  TIER_GOLD: 'gold',
  TIER_BLACK: 'black',
};
