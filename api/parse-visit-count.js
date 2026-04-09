/**
 * PassKit の points（来店回数）を数に正規化（scan / repair で共有）
 */
module.exports = function parseVisitCount(raw) {
  if (raw == null || raw === '') return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(Math.floor(n), 1e6);
};
