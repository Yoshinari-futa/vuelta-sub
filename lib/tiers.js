/**
 * ティア(パス左上ロゴの色)の共通定義
 *
 * 2026-09-08 7段化: ピンク(4-9)と濃緑(40-69)を追加し、銀→金の序列に修正。
 * PassKit 側は全7ティアともインクロゴ+背景色バナー(480x150)に統一済み。
 * テンプレートには NEXT 欄(uniqueName: meta.nextColor)があり、
 * 会員 metaData.nextColor に「あと3回で銀」形式の文言を入れると表示される。
 */

const {
  TIER_BASE,
  TIER_PINK,
  TIER_SILVER,
  TIER_GOLD,
  TIER_GREEN,
  TIER_BLACK,
  TIER_RAINBOW,
} = require('./passkit-tier-ids');

// 白: 0-3, ピンク: 4-9, 銀: 10-19, 金: 20-39, 濃緑: 40-69, 黒: 70-99, 虹: 100+
const TIER_THRESHOLDS = [
  { min: 100, id: TIER_RAINBOW, label: 'Rainbow', jp: '虹' },
  { min: 70,  id: TIER_BLACK,   label: 'Black',   jp: '黒' },
  { min: 40,  id: TIER_GREEN,   label: 'Green',   jp: '濃緑' },
  { min: 20,  id: TIER_GOLD,    label: 'Gold',    jp: '金' },
  { min: 10,  id: TIER_SILVER,  label: 'Silver',  jp: '銀' },
  { min: 4,   id: TIER_PINK,    label: 'Pink',    jp: 'ピンク' },
  { min: 0,   id: TIER_BASE,    label: 'Base',    jp: '白' },
];

/** 来店回数からティアを決定 */
function tierForVisits(visits) {
  for (const t of TIER_THRESHOLDS) {
    if (visits >= t.min) return t;
  }
  return TIER_THRESHOLDS[TIER_THRESHOLDS.length - 1];
}

/** パス表面 NEXT 欄(metaData.nextColor)の文言。最上位到達後は固定文言 */
function nextColorMessage(visits) {
  const next = [...TIER_THRESHOLDS].reverse().find(t => t.min > visits);
  if (!next) return '全色制覇';
  return `あと${next.min - visits}回で${next.jp}`;
}

module.exports = { TIER_THRESHOLDS, tierForVisits, nextColorMessage };
