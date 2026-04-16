/**
 * GET /weekly-sales
 * VUELTA 週次売上レポート → Slack 送信
 * Vercel Cron: 毎週日曜 22:00 UTC（= 月曜 7:00 JST）
 * 手動実行: GET /weekly-sales?secret=vuelta2026-member
 */

const JST_OFFSET = 9 * 60 * 60 * 1000;
const BOUNDARY_HOUR = 5;
const WEEKDAY_JP = ['月', '火', '水', '木', '金', '土', '日'];
const TARGET_MONTHLY = 3_000_000;
const DASHBOARD_URL = 'https://vuelta-dashboard.vercel.app';

// ────────────────────────────────────────
// 日時ユーティリティ（daily-sales.js と共通ロジック）
// ────────────────────────────────────────

function toJST(date) {
  return new Date(date.getTime() + JST_OFFSET);
}

function toBusinessDate(utcDate) {
  const jst = toJST(utcDate);
  if (jst.getUTCHours() < BOUNDARY_HOUR) {
    const prev = new Date(jst.getTime() - 86400000);
    return new Date(Date.UTC(prev.getUTCFullYear(), prev.getUTCMonth(), prev.getUTCDate()));
  }
  return new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate()));
}

/** [begin_utc, end_utc] for a range startDate〜endDate (JST営業日) */
function dateRangeUTC(startY, startM, startD, endY, endM, endD) {
  const begin = new Date(Date.UTC(startY, startM - 1, startD, BOUNDARY_HOUR - 9, 0, 0));
  const end   = new Date(Date.UTC(endY, endM - 1, endD + 1, BOUNDARY_HOUR - 9 - 1, 59, 59));
  return [begin.toISOString().replace('.000Z', 'Z'), end.toISOString().replace('.000Z', 'Z')];
}

function addDays(dateObj, n) {
  return new Date(dateObj.getTime() + n * 86400000);
}

// ────────────────────────────────────────
// Square API
// ────────────────────────────────────────

async function fetchOrders(token, locationId, beginTime, endTime) {
  const url = 'https://connect.squareup.com/v2/orders/search';
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    'Square-Version': '2024-01-17',
  };
  let orders = [], cursor = null;
  do {
    const body = {
      location_ids: [locationId],
      query: {
        filter: {
          date_time_filter: { created_at: { start_at: beginTime, end_at: endTime } },
          state_filter: { states: ['COMPLETED'] },
        },
        sort: { sort_field: 'CREATED_AT', sort_order: 'ASC' },
      },
      limit: 500,
    };
    if (cursor) body.cursor = cursor;
    const resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!resp.ok) throw new Error(`Square API ${resp.status}: ${await resp.text()}`);
    const data = await resp.json();
    orders = orders.concat(data.orders || []);
    cursor = data.cursor || null;
  } while (cursor);
  return orders;
}

// ────────────────────────────────────────
// 週次集計
// ────────────────────────────────────────

function buildWeeklySummary(orders, startDateUTC, endDateUTC, prevWeekSales) {
  let totalSales = 0, totalOrders = orders.length;
  const byDate = {}, byWeekday = {}, items = {};

  for (const order of orders) {
    const amount = (order.total_money || {}).amount || 0;
    totalSales += amount;

    // 営業日ベースの日付
    const createdAt = new Date(order.created_at || '');
    const bizDate = toBusinessDate(createdAt);
    const dateKey = `${bizDate.getUTCFullYear()}-${String(bizDate.getUTCMonth()+1).padStart(2,'0')}-${String(bizDate.getUTCDate()).padStart(2,'0')}`;
    const wday = bizDate.getUTCDay() === 0 ? 6 : bizDate.getUTCDay() - 1; // 月=0

    if (!byDate[dateKey]) byDate[dateKey] = { count: 0, amount: 0 };
    byDate[dateKey].count++;
    byDate[dateKey].amount += amount;

    if (!byWeekday[wday]) byWeekday[wday] = { count: 0, amount: 0 };
    byWeekday[wday].count++;
    byWeekday[wday].amount += amount;

    for (const li of order.line_items || []) {
      const name = li.name || '不明';
      const variation = li.variation_name || '';
      const disp = (variation && !['Regular', '通常'].includes(variation)) ? `${name}（${variation}）` : name;
      const qty = parseFloat(li.quantity || '0');
      const itemAmount = ((li.gross_sales_money || li.total_money) || {}).amount || 0;
      if (!items[disp]) items[disp] = { qty: 0, amount: 0 };
      items[disp].qty    += qty;
      items[disp].amount += itemAmount;
    }
  }

  const activeDays = Object.keys(byDate).length;
  const avgDaily = activeDays ? Math.round(totalSales / activeDays) : 0;
  const avgSpend = totalOrders ? Math.round(totalSales / totalOrders) : 0;
  const monthlyPace = avgDaily * 30;

  const dateEntries = Object.entries(byDate).sort((a, b) => a[0].localeCompare(b[0]));
  const bestDate  = dateEntries.length ? dateEntries.reduce((a, b) => b[1].amount > a[1].amount ? b : a) : null;
  const worstDate = dateEntries.length ? dateEntries.reduce((a, b) => b[1].amount < a[1].amount ? b : a) : null;
  const bestWday  = Object.entries(byWeekday).length
    ? Object.entries(byWeekday).reduce((a, b) => b[1].amount > a[1].amount ? b : a)
    : null;

  const topItems = Object.entries(items).sort((a, b) => b[1].amount - a[1].amount).slice(0, 5);

  const wowPct = prevWeekSales
    ? Math.round((totalSales - prevWeekSales) / prevWeekSales * 100)
    : null;

  const startLabel = `${startDateUTC.getUTCFullYear()}-${String(startDateUTC.getUTCMonth()+1).padStart(2,'0')}-${String(startDateUTC.getUTCDate()).padStart(2,'0')}`;
  const endLabel   = `${endDateUTC.getUTCFullYear()}-${String(endDateUTC.getUTCMonth()+1).padStart(2,'0')}-${String(endDateUTC.getUTCDate()).padStart(2,'0')}`;

  return {
    totalSales, totalOrders, activeDays, avgDaily, avgSpend,
    monthlyPace, bestDate, worstDate, bestWday,
    topItems, wowPct, prevWeekSales,
    period: `${startLabel} 〜 ${endLabel}`,
  };
}

// ────────────────────────────────────────
// 自然言語サマリー
// ────────────────────────────────────────

function generateSummaryText(s) {
  if (s.activeDays === 0) return '先週は営業日がありませんでした。';
  const pacePct = Math.round(s.monthlyPace / TARGET_MONTHLY * 100);
  const lines = [
    `先週は${s.activeDays}日間営業し、合計 *¥${s.totalSales.toLocaleString('ja-JP')}*（${s.totalOrders}組）の売上でした。`,
  ];
  if (s.avgDaily >= 50000)      lines.push(`1日あたり平均 ¥${s.avgDaily.toLocaleString('ja-JP')} と好調な週でした。`);
  else if (s.avgDaily >= 30000) lines.push(`1日あたり平均 ¥${s.avgDaily.toLocaleString('ja-JP')} と安定した週でした。`);
  else                          lines.push(`1日あたり平均 ¥${s.avgDaily.toLocaleString('ja-JP')} で、もう少し伸ばしたいところです。`);

  if (pacePct >= 100)      lines.push(`このペースが続けば月商 ¥${s.monthlyPace.toLocaleString('ja-JP')}（目標の${pacePct}%）で、目標達成圏内です。`);
  else if (pacePct >= 80)  lines.push(`月商換算 ¥${s.monthlyPace.toLocaleString('ja-JP')}（目標の${pacePct}%）。あと少しで目標に届きます。`);
  else                     lines.push(`月商換算 ¥${s.monthlyPace.toLocaleString('ja-JP')}（目標の${pacePct}%）。集客施策の強化が必要です。`);

  if (s.bestDate) {
    const [ds, dd] = s.bestDate;
    const wday = WEEKDAY_JP[new Date(ds + 'T00:00:00Z').getUTCDay() === 0 ? 6 : new Date(ds + 'T00:00:00Z').getUTCDay() - 1];
    lines.push(`一番売れた日は *${ds}（${wday}）* の ¥${dd.amount.toLocaleString('ja-JP')}（${dd.count}組）でした。`);
  }
  lines.push(`客単価は平均 ¥${s.avgSpend.toLocaleString('ja-JP')} です。`);
  return lines.join('\n');
}

// ────────────────────────────────────────
// Slack メッセージ構築
// ────────────────────────────────────────

function buildSlackMessage(summary, monthTotalSales) {
  const summaryText = generateSummaryText(summary);

  const topItemsText = summary.topItems.map(([name, data], i) =>
    `  ${i + 1}. ${name}（${Math.round(data.qty)}点 / ¥${data.amount.toLocaleString('ja-JP')}）`
  ).join('\n');

  const wowText = summary.wowPct !== null
    ? `${summary.wowPct >= 0 ? '📈' : '📉'} 前週比 *${summary.wowPct >= 0 ? '+' : ''}${summary.wowPct}%*（先々週: ¥${summary.prevWeekSales.toLocaleString('ja-JP')}）`
    : '前週比 *—*（先々週データなし）';

  let monthProgressText;
  if (monthTotalSales > 0) {
    const pct = Math.round(monthTotalSales / TARGET_MONTHLY * 100);
    const bars = '█'.repeat(Math.min(Math.floor(pct / 10), 10)) + '░'.repeat(Math.max(0, 10 - Math.floor(pct / 10)));
    monthProgressText = `*📅 今月の進捗 vs 月商目標 ¥${TARGET_MONTHLY.toLocaleString('ja-JP')}*\n\`${bars}\` *${pct}%*　今月累計 ¥${monthTotalSales.toLocaleString('ja-JP')}`;
  } else {
    const pct = Math.round(summary.monthlyPace / TARGET_MONTHLY * 100);
    monthProgressText = `*📅 このペースの月商換算 vs 目標 ¥${TARGET_MONTHLY.toLocaleString('ja-JP')}*\n月商換算 ¥${summary.monthlyPace.toLocaleString('ja-JP')}（目標の *${pct}%*）`;
  }

  const bestWdayText = summary.bestWday
    ? `*一番売れた曜日*: ${WEEKDAY_JP[parseInt(summary.bestWday[0])]}曜日（¥${summary.bestWday[1].amount.toLocaleString('ja-JP')}）`
    : '';

  return {
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: '📋 VUELTA 週次振り返り', emoji: true } },
      { type: 'context', elements: [{ type: 'mrkdwn', text: `集計期間：${summary.period}　|　${summary.activeDays}営業日　${summary.totalOrders}組` }] },
      { type: 'divider' },
      { type: 'section', text: { type: 'mrkdwn', text: `*先週のまとめ*\n${summaryText}` } },
      { type: 'divider' },
      { type: 'section', text: { type: 'mrkdwn', text: wowText } },
      { type: 'section', text: { type: 'mrkdwn', text: monthProgressText } },
      { type: 'divider' },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*🏆 先週よく出たメニュー TOP5*（7日間累計）\n${topItemsText || '_データなし_'}${bestWdayText ? '\n\n' + bestWdayText : ''}`,
        },
      },
      { type: 'divider' },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: '曜日別・時間帯別のグラフはダッシュボードで確認できます。' },
        accessory: {
          type: 'button',
          text: { type: 'plain_text', text: 'ダッシュボードを開く', emoji: true },
          url: DASHBOARD_URL,
          style: 'primary',
        },
      },
      {
        type: 'context',
        elements: [{ type: 'mrkdwn', text: `週次自動レポート（Vercel Cron）｜${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })} 実行` }],
      },
    ],
  };
}

// ────────────────────────────────────────
// メインハンドラー
// ────────────────────────────────────────

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const secret = req.query && req.query.secret;
  const isCron = req.headers['x-vercel-cron'] === '1';
  if (!isCron && secret !== 'vuelta2026-member') {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token        = (process.env.SQUARE_ACCESS_TOKEN || '').trim();
  const locationId   = (process.env.SQUARE_LOCATION_ID || '').trim();
  const slackToken   = (process.env.SLACK_BOT_TOKEN || '').trim();
  const slackChannel = (process.env.SLACK_SALES_CHANNEL_ID || '').trim();

  if (!token || !locationId || !slackToken || !slackChannel) {
    return res.status(500).json({ error: 'Missing env: SQUARE_ACCESS_TOKEN / SQUARE_LOCATION_ID / SLACK_BOT_TOKEN / SLACK_SALES_CHANNEL_ID' });
  }

  async function postSlack(payload) {
    const body = { channel: slackChannel, ...payload };
    const r = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${slackToken}` },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    if (!data.ok) throw new Error(`Slack API error: ${data.error}`);
    return data;
  }

  try {
    // Cron は日曜 22:00 UTC（= 月曜 7:00 JST）に実行 → JST "today" は月曜
    // 集計対象: 直近7日（月曜 0:00 JST 〜 日曜 23:59 JST = 先週月〜日）
    const nowJST = toJST(new Date());
    // "today JST" の日付
    const todayJST = new Date(Date.UTC(nowJST.getUTCFullYear(), nowJST.getUTCMonth(), nowJST.getUTCDate()));

    // 先週: 7日前〜昨日
    const weekEndJST   = addDays(todayJST, -1); // 昨日
    const weekStartJST = addDays(todayJST, -7); // 7日前

    // 前週: 14日前〜8日前
    const prevWeekEndJST   = addDays(todayJST, -8);
    const prevWeekStartJST = addDays(todayJST, -14);

    // 今月初日
    const monthStartJST = new Date(Date.UTC(weekEndJST.getUTCFullYear(), weekEndJST.getUTCMonth(), 1));

    const [weekB, weekE]     = dateRangeUTC(weekStartJST.getUTCFullYear(), weekStartJST.getUTCMonth()+1, weekStartJST.getUTCDate(), weekEndJST.getUTCFullYear(), weekEndJST.getUTCMonth()+1, weekEndJST.getUTCDate());
    const [prevWB, prevWE]   = dateRangeUTC(prevWeekStartJST.getUTCFullYear(), prevWeekStartJST.getUTCMonth()+1, prevWeekStartJST.getUTCDate(), prevWeekEndJST.getUTCFullYear(), prevWeekEndJST.getUTCMonth()+1, prevWeekEndJST.getUTCDate());
    const [monthB, monthE]   = dateRangeUTC(monthStartJST.getUTCFullYear(), monthStartJST.getUTCMonth()+1, monthStartJST.getUTCDate(), weekEndJST.getUTCFullYear(), weekEndJST.getUTCMonth()+1, weekEndJST.getUTCDate());

    console.log(`[WEEKLY] 集計: ${weekStartJST.toISOString().slice(0,10)} 〜 ${weekEndJST.toISOString().slice(0,10)}`);

    const [weekOrders, prevWeekOrders, monthOrders] = await Promise.all([
      fetchOrders(token, locationId, weekB, weekE),
      fetchOrders(token, locationId, prevWB, prevWE),
      fetchOrders(token, locationId, monthB, monthE),
    ]);

    console.log(`[WEEKLY] 取得: 当週=${weekOrders.length}件, 前週=${prevWeekOrders.length}件, 今月=${monthOrders.length}件`);

    const prevWeekTotal  = prevWeekOrders.reduce((s, o) => s + ((o.total_money || {}).amount || 0), 0);
    const monthTotal     = monthOrders.reduce((s, o)    => s + ((o.total_money || {}).amount || 0), 0);
    const summary        = buildWeeklySummary(weekOrders, weekStartJST, weekEndJST, prevWeekTotal);

    const message = buildSlackMessage(summary, monthTotal);
    await postSlack(message);

    console.log('[WEEKLY] Slack送信完了');
    return res.json({ success: true, period: summary.period, totalSales: summary.totalSales });

  } catch (err) {
    console.error('[WEEKLY] ERROR:', err.message);
    try {
      await postSlack({ channel: 'D09TV05303C', text: `:warning: *週次売上レポート エラー*\n\`\`\`${err.message}\`\`\`` });
    } catch (_) {}
    return res.status(500).json({ error: err.message });
  }
};
