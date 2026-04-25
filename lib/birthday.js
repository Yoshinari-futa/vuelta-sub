/**
 * VUELTA 誕生日機能の共通ヘルパー
 *
 * Stripe Checkout の custom_field "birth_month" は自由入力なので、
 * 以下の入力フォーマットを許容する:
 *   - "3/15" / "03/15" （MM/DD・推奨）
 *   - "3月15日" / "3月15"
 *   - "1990/3/15" / "1990-03-15" （年付き）
 *   - "3" / "03" （月のみ → 1日扱い）
 *
 * JST 基準で「今月が誕生月か」を判定する。
 */

function parseBirthMonth(str) {
  if (!str) return null;
  const s = String(str).trim();
  if (!s) return null;

  // "MM/DD" または "M/D"
  let m = s.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (m) {
    return { month: parseInt(m[1], 10), day: parseInt(m[2], 10) };
  }

  // "M月D日" or "M月D"
  m = s.match(/^(\d{1,2})月(\d{1,2})日?$/);
  if (m) {
    return { month: parseInt(m[1], 10), day: parseInt(m[2], 10) };
  }

  // "YYYY-MM-DD" or "YYYY/MM/DD"
  m = s.match(/^\d{4}[-/](\d{1,2})[-/](\d{1,2})$/);
  if (m) {
    return { month: parseInt(m[1], 10), day: parseInt(m[2], 10) };
  }

  // 月のみ "3" or "03"（日は 1 とする）
  m = s.match(/^(\d{1,2})$/);
  if (m) {
    const month = parseInt(m[1], 10);
    if (month >= 1 && month <= 12) {
      return { month, day: 1 };
    }
  }

  return null;
}

/** JST の年月日を取得 */
function getJSTDate(now = new Date()) {
  // JST = UTC + 9 時間
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return {
    year: jst.getUTCFullYear(),
    month: jst.getUTCMonth() + 1,
    day: jst.getUTCDate(),
  };
}

/** birthMonth 文字列が「今月が誕生月」かを判定 */
function isBirthdayMonth(birthMonthStr, now = new Date()) {
  const parsed = parseBirthMonth(birthMonthStr);
  if (!parsed) return false;
  const jst = getJSTDate(now);
  return parsed.month === jst.month;
}

module.exports = {
  parseBirthMonth,
  getJSTDate,
  isBirthdayMonth,
};
