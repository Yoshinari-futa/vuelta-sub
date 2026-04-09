/**
 * 来店回数 → PassKit tierId / 表示色（scan.js と修復APIで共有）
 */
const {
  TIER_BASE,
  TIER_SILVER,
  TIER_GOLD,
  TIER_BLACK,
} = require('./passkit-tier-ids');

/**
 * PassKit の points（来店回数）を数に正規化する。
 * 文字列のまま +1 すると "1"+1="11" になり、次回 "11"+1="111" と壊れる。
 */
function parseVisitCount(raw) {
  if (raw == null || raw === '') return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(Math.floor(n), 1e6);
}

function getVisitTierIds() {
  return {
    white: (process.env.PASSKIT_TIER_ID_WHITE || TIER_BASE).trim(),
    silver: (process.env.PASSKIT_TIER_ID_SILVER || TIER_SILVER).trim(),
    gold: (process.env.PASSKIT_TIER_ID_GOLD || TIER_GOLD).trim(),
    black: (process.env.PASSKIT_TIER_ID_BLACK || TIER_BLACK).trim(),
  };
}

function getVisitTierThresholds() {
  const defS = 3;
  const defG = 10;
  const defB = 20;
  const parseMin = (key, fallback) => {
    const n = parseInt(String(process.env[key] ?? '').trim(), 10);
    return Number.isFinite(n) && n >= 1 ? n : fallback;
  };
  let minSilver = parseMin('VISITS_MIN_FOR_SILVER', defS);
  let minGold = parseMin('VISITS_MIN_FOR_GOLD', defG);
  let minBlack = parseMin('VISITS_MIN_FOR_BLACK', defB);
  if (!(minSilver < minGold && minGold < minBlack)) {
    console.warn(
      `[VISIT-TIER] VISITS_MIN_FOR_* invalid (${minSilver}, ${minGold}, ${minBlack}); using ${defS}, ${defG}, ${defB}`
    );
    minSilver = defS;
    minGold = defG;
    minBlack = defB;
  }
  return { minSilver, minGold, minBlack };
}

function tierIdForVisitCount(visits) {
  const { white, silver, gold, black } = getVisitTierIds();
  const { minSilver, minGold, minBlack } = getVisitTierThresholds();
  const v = parseVisitCount(visits);
  if (v < minSilver) return white;
  if (v < minGold) return silver;
  if (v < minBlack) return gold;
  return black;
}

function tierColorLabel(tierId) {
  const { white, silver, gold, black } = getVisitTierIds();
  if (tierId === white) return 'white';
  if (tierId === silver) return 'silver';
  if (tierId === gold) return 'gold';
  if (tierId === black) return 'black';
  return 'unknown';
}

module.exports = {
  parseVisitCount,
  getVisitTierIds,
  getVisitTierThresholds,
  tierIdForVisitCount,
  tierColorLabel,
};
