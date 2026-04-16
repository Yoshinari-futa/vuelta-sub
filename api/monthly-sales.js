/**
 * GET /monthly-sales
 * VUELTA 月次売上レポート → Slack 送信
 * Vercel Cron: 毎月1日 22:00 UTC（= 2日 7:00 JST）→ 前月を集計
 * 手動実行: GET /monthly-sales?secret=vuelta2026-member[&year=2026&month=3]
 */

const JST_OFFSET = 9 * 60 * 60 * 1000;
const BOUNDARY_HOUR = 5;
const TARGET_MONTHLY = 3_000_000;
const DASHBOARD_URL = 'https://vuelta-dashboard.vercel.app';

// ────────────────────────────────────────
// 原価マスタ（daily-sales.js と同じ）
// ────────────────────────────────────────
const COST_MASTER = [
  ['Cover Charge', 22], ['チャージ', 22], ['お通し', 22],
  ['Shell We?', 236], ['Shell We', 236], ['OKONOMIYAKI', 153], ['お好み焼き', 153], ['Aki Amber', 330],
  ['ヒロシマレモンサワー', 162], ['トマトサワー', 162], ['ダッサイサケマティーニ', 195],
  ['スタンドアップエメラルド', 187], ['スピークロウ', 250],
  ['トゥエンティーシックスアワーズ', 200], ['スパイシージンバック', 237],
  ['サクラマルガリータ', 240], ['リンゴスター', 300], ['Setouchi Fizz', 81],
  ['Twenty Six Hours', 200], ['Twenty-Six', 200], ['Stand Up Emerald', 187],
  ['Standup Emerald', 187], ['Spicy Gin Buck', 237], ['Sakura Margarita', 240],
  ['Ringo Star', 300], ['Hiroshima Lemon', 162], ['Tomato Sawa', 162],
  ['Dassai Sake Martini', 195], ['Speak Low', 250], ['Tipsy Crane', 258],
  ['Yaoyorozu Mule', 194], ['Yaoyorozu', 194], ['WAPIRITS TUMUGI', 264],
  ['TUMUGI', 264], ['Kaku-Gari-Ta', 450], ['カクガリータ', 450], ['カクガリ', 450],
  ['Electric Buck', 124], ['Smoked Cheese Paloma', 201],
  ['Spring Bloom Margarita', 162], ['VUELTA Archive', 176],
  ['26 hours', 200], ['1886', 265], ['GIFT', 180], ['Gift', 180], ['恩送り', 180], ['SP', 250],
  ['Classic Lager', 300], ['クラシックラガー', 300],
  ['AKABOSHI', 232], ['Akaboshi', 232], ['赤星', 232], ['Red Star', 232],
  ['Heartland', 230], ['Heart Land', 230], ['ハートランド', 230],
  ['Monkey 47', 382], ['モンキー47', 382],
  ['Yamazaki 12y', 643], ['山崎12年', 643],
  ['Yamazaki', 300], ['山崎', 300],
  ['Taketsuru Pure Malt', 300], ['Taketsuru', 300], ['竹鶴', 300],
  ['SAKE-Taketsuru', 83],
  ['Sakurao NC', 231], ['桜尾NC', 231],
  ['Sakurao', 126], ['桜尾', 126],
  ['Togouchi', 231], ['戸河内', 231],
  ['Senfuku', 120], ['千福', 120],
  ['Kaku', 113], ['角', 113],
  ['瀬戸内', 81], ['ビール', 175],
  ['Belle Epoque', 26500], ['ベルエポック', 26500], ['ペリエジュエ', 26500],
  ['Dom Pérignon', 27980], ['ドンペリニヨン', 27980], ['ドンペリ', 27980],
  ['Louis Roederer Cristal', 41250], ['クリスタル', 41250],
  ['二階堂', 130], ['Torikai', 188], ['鳥飼', 188],
  ['安田', 302], ['森伊蔵', 1040], ['獺祭', 910],
  ['Kamotsuru', 229], ['賀茂鶴', 229],
  ['DAIYAME', 89], ['DAIYAMA', 89], ['だいやめ', 89],
  ['ミックスナッツ', 150], ['ドライフルーツ', 195],
  ['生チョコレート', 245], ['生チョコ', 245],
  ['出汁オリーブ', 87], ['Olives', 87], ['Sakai-ya', 79],
  ['Rum Raisin Butter', 56], ['Rum Raisin', 56],
  ['ラムレーズンバター', 56], ['ラムレーズン', 56],
  ['Gansu Tacos', 160], ['ガンスタコス', 160],
  ['Cheesy Melt Carnitas', 209], ['Cheesy Carnitas', 209], ['チーズタコス', 209],
  ['Carnitas Tacos', 164], ['Carnitas', 164], ['カルニタスタコス', 164],
  ['ガンスレバーパテ', 79], ['坂井屋', 79],
  ['Sweet Potato Crisps', 161], ['Hand-Cut Fries', 167], ['Hand-Cut', 167],
  ['チップス', 161], ['生ポテト', 167], ['ポテトフライ', 167],
  ['ハニーマスカルポーネ', 150], ['マスカルポーネ', 150],
  ['Spinach', 76], ['スピナッチ', 76], ['ベンジャミン', 76],
  ['オニオンリング', 180],
  ['スパイシーチキン', 285], ['チキンウィング', 285], ['ナチョス', 285],
].sort((a, b) => b[0].length - a[0].length);

// ────────────────────────────────────────
// 日時ユーティリティ
// ────────────────────────────────────────

function toJST(date) {
  return new Date(date.getTime() + JST_OFFSET);
}

function monthRangeUTC(year, month) {
  const begin = new Date(Date.UTC(year, month - 1, 1, BOUNDARY_HOUR - 9, 0, 0));
  const nextY = month === 12 ? year + 1 : year;
  const nextM = month === 12 ? 1 : month + 1;
  const end   = new Date(Date.UTC(nextY, nextM - 1, 1, BOUNDARY_HOUR - 9 - 1, 59, 59));
  return [begin.toISOString().replace('.000Z', 'Z'), end.toISOString().replace('.000Z', 'Z')];
}

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

function prevMonth(year, month, n = 1) {
  let y = year, m = month;
  for (let i = 0; i < n; i++) {
    m--;
    if (m === 0) { m = 12; y--; }
  }
  return [y, m];
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
// 集計
// ────────────────────────────────────────

function toBusinessDateKey(createdAt) {
  const dt = new Date(createdAt);
  const jst = new Date(dt.getTime() + JST_OFFSET);
  if (jst.getUTCHours() < BOUNDARY_HOUR) {
    const prev = new Date(jst.getTime() - 86400000);
    return `${prev.getUTCFullYear()}-${String(prev.getUTCMonth()+1).padStart(2,'0')}-${String(prev.getUTCDate()).padStart(2,'0')}`;
  }
  return `${jst.getUTCFullYear()}-${String(jst.getUTCMonth()+1).padStart(2,'0')}-${String(jst.getUTCDate()).padStart(2,'0')}`;
}

function paymentMethod(tender) {
  const t = tender.type || '';
  if (t === 'CASH') return '現金';
  if (t === 'CARD') {
    const card = (tender.card_details || {}).card || {};
    if (card.card_type === 'DIGITAL_WALLET') {
      const brand = (card.card_brand || '').toUpperCase();
      if (brand.includes('APPLE')) return 'Apple Pay';
      if (brand.includes('GOOGLE')) return 'Google Pay';
      return '電子マネー';
    }
    return card.card_brand ? `カード（${card.card_brand}）` : 'カード';
  }
  return 'その他';
}

function aggregateMonthly(orders, year, month) {
  let totalSales = 0, totalTax = 0, refundMoney = 0, refundCount = 0;
  const paymentMethods = {}, items = {}, byDate = {};

  // 日別を初期化
  const lastDay = daysInMonth(year, month);
  for (let d = 1; d <= lastDay; d++) {
    const key = `${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    byDate[key] = { count: 0, amount: 0 };
  }

  for (const order of orders) {
    const amount = (order.total_money || {}).amount || 0;
    totalSales += amount;
    totalTax   += (order.total_tax_money || {}).amount || 0;

    for (const ref of order.refunds || []) {
      refundMoney += (ref.amount_money || {}).amount || 0;
      refundCount++;
    }

    const dateKey = toBusinessDateKey(order.created_at || '');
    if (byDate[dateKey]) {
      byDate[dateKey].count++;
      byDate[dateKey].amount += amount;
    }

    for (const tender of order.tenders || []) {
      const method = paymentMethod(tender);
      if (!paymentMethods[method]) paymentMethods[method] = { count: 0, amount: 0 };
      paymentMethods[method].count++;
      paymentMethods[method].amount += (tender.amount_money || {}).amount || 0;
    }

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

  const orderCount = orders.length;
  const activeDays = Object.values(byDate).filter(d => d.count > 0).length;
  const avgDailySales = activeDays ? Math.round(totalSales / activeDays) : 0;
  const avgSpend = orderCount ? Math.round(totalSales / orderCount) : 0;

  const activeDateEntries = Object.entries(byDate).filter(([, v]) => v.count > 0);
  const bestDay  = activeDateEntries.length ? activeDateEntries.reduce((a, b) => b[1].amount > a[1].amount ? b : a) : null;
  const worstDay = activeDateEntries.length ? activeDateEntries.reduce((a, b) => b[1].amount < a[1].amount ? b : a) : null;

  // 週別（第1〜5週: 7日ずつ）
  const weeks = {};
  for (let w = 1; w <= 5; w++) {
    const start = (w - 1) * 7 + 1;
    const end   = Math.min(w * 7, lastDay);
    if (start > lastDay) break;
    let weekSales = 0, weekOrders = 0;
    for (let d = start; d <= end; d++) {
      const key = `${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      weekSales  += (byDate[key] || {}).amount || 0;
      weekOrders += (byDate[key] || {}).count  || 0;
    }
    weeks[w] = { label: `${start}日〜${end}日`, totalSales: weekSales, orderCount: weekOrders };
  }

  return {
    totalSales, totalTax, refundMoney, refundCount,
    netSales: totalSales - refundMoney,
    orderCount, activeDays, avgDailySales, avgSpend,
    paymentMethods, items, byDate, bestDay, worstDay, weeks,
  };
}

// ────────────────────────────────────────
// 原価計算
// ────────────────────────────────────────

function calcCost(items) {
  let totalSales = 0, totalCost = 0;
  for (const [name, data] of Object.entries(items)) {
    totalSales += data.amount;
    if (data.qty <= 0) continue;
    const unitPrice = data.amount / data.qty;
    let costPerUnit = Math.round(unitPrice * 0.25);
    for (const [keyword, cost] of COST_MASTER) {
      if (name.toLowerCase().includes(keyword.toLowerCase())) { costPerUnit = cost; break; }
    }
    totalCost += Math.round(costPerUnit * data.qty);
  }
  const costRate = totalSales ? Math.round(totalCost / totalSales * 1000) / 10 : 0;
  return { totalCost, costRate };
}

// ────────────────────────────────────────
// フォーマット
// ────────────────────────────────────────

function fmtYen(v) { return `¥${(v || 0).toLocaleString('ja-JP')}`; }

function fmtPct(current, previous) {
  if (!previous) return null;
  const pct = Math.round((current - previous) / previous * 1000) / 10;
  const arrow = pct > 0 ? '↑' : pct < 0 ? '↓' : '→';
  return `${arrow} ${pct >= 0 ? '+' : ''}${pct}%`;
}
function pctEmoji(c, p) { return !p ? '' : c >= p ? '📈' : '📉'; }

// ────────────────────────────────────────
// Slack メッセージ構築
// ────────────────────────────────────────

function buildSlackMessage(year, month, stats, prevStats, prevYearStats, footerExtra) {
  const label = `${year}年${month}月`;
  const mom = fmtPct(stats.totalSales, prevStats.totalSales);
  const yoy = fmtPct(stats.totalSales, prevYearStats.totalSales);

  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: `🗓️ 月次売上レポート｜${label}` } },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${label}の売上集計レポートです。*\n営業日数: *${stats.activeDays}日* ／ 総取引件数: *${stats.orderCount}件*`,
      },
    },
    { type: 'divider' },
    { type: 'section', text: { type: 'mrkdwn', text: '*📊 月間サマリー*' } },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*月間総売上*\n${fmtYen(stats.totalSales)}` },
        { type: 'mrkdwn', text: `*純売上*\n${fmtYen(stats.netSales)}` },
        { type: 'mrkdwn', text: `*平均日商*\n${fmtYen(stats.avgDailySales)}` },
        { type: 'mrkdwn', text: `*平均客単価*\n${fmtYen(stats.avgSpend)}` },
        { type: 'mrkdwn', text: `*前月比*\n${pctEmoji(stats.totalSales, prevStats.totalSales)} ${mom || '—'}` },
        { type: 'mrkdwn', text: `*前年同月比*\n${pctEmoji(stats.totalSales, prevYearStats.totalSales)} ${yoy || '—'}` },
      ],
    },
  ];

  // 原価率
  if (stats.totalCost != null) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*📊 原価率*\n売上原価: *${fmtYen(stats.totalCost)}*　原価率: *${stats.costRate}%*` },
    });
    blocks.push({ type: 'divider' });
  }

  // 月商目標達成率
  const pct = Math.round(stats.totalSales / TARGET_MONTHLY * 100);
  const barLen = Math.min(10, Math.max(0, Math.floor(pct / 10)));
  const bar = '█'.repeat(barLen) + '░'.repeat(10 - barLen);
  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `*📈 月商目標達成率*　\`${bar}\`　${pct}%\n目標: ${fmtYen(TARGET_MONTHLY)}　実績: ${fmtYen(stats.totalSales)}`,
    },
  });
  blocks.push({ type: 'divider' });

  // 最高・最低日
  blocks.push({ type: 'section', text: { type: 'mrkdwn', text: '*📅 最高日・最低日*' } });
  const dayFields = [];
  if (stats.bestDay) {
    const [ds, dd] = stats.bestDay;
    const d = parseInt(ds.split('-')[2]);
    dayFields.push({ type: 'mrkdwn', text: `*🔝 最高売上日*\n${month}月${d}日　${fmtYen(dd.amount)}（${dd.count}件）` });
  }
  if (stats.worstDay && stats.worstDay[0] !== (stats.bestDay || [null])[0]) {
    const [ds, dd] = stats.worstDay;
    const d = parseInt(ds.split('-')[2]);
    dayFields.push({ type: 'mrkdwn', text: `*📉 最低売上日*\n${month}月${d}日　${fmtYen(dd.amount)}（${dd.count}件）` });
  }
  if (dayFields.length) blocks.push({ type: 'section', fields: dayFields });
  blocks.push({ type: 'divider' });

  // 週別売上
  blocks.push({ type: 'section', text: { type: 'mrkdwn', text: '*📆 週別売上推移*' } });
  const weekMax = Math.max(...Object.values(stats.weeks).map(w => w.totalSales), 1);
  const weekLines = Object.entries(stats.weeks).map(([wn, w]) => {
    const bLen = Math.round(w.totalSales / weekMax * 8);
    const b = '█'.repeat(bLen) + '░'.repeat(8 - bLen);
    return `第${wn}週（${w.label}）　\`${b}\`　${fmtYen(w.totalSales)}　${w.orderCount}件`;
  });
  blocks.push({ type: 'section', text: { type: 'mrkdwn', text: weekLines.join('\n') || '_データなし_' } });
  blocks.push({ type: 'divider' });

  // 決済方法
  blocks.push({ type: 'section', text: { type: 'mrkdwn', text: '*💳 決済方法別*' } });
  const pm = stats.paymentMethods;
  const pmTotal = Object.values(pm).reduce((s, v) => s + v.amount, 0);
  const pmLines = Object.entries(pm)
    .sort((a, b) => b[1].amount - a[1].amount)
    .map(([m, d]) => `• *${m}*　${d.count}件　${fmtYen(d.amount)}　\`${pmTotal ? Math.round(d.amount / pmTotal * 100) : 0}%\``);
  blocks.push({ type: 'section', text: { type: 'mrkdwn', text: pmLines.join('\n') || '_データなし_' } });
  blocks.push({ type: 'divider' });

  // 商品ランキング TOP10
  blocks.push({ type: 'section', text: { type: 'mrkdwn', text: '*🏆 商品ランキング（上位10件）*' } });
  const medals = ['🥇', '🥈', '🥉', '4.', '5.', '6.', '7.', '8.', '9.', '10.'];
  const topItems = Object.entries(stats.items).sort((a, b) => b[1].amount - a[1].amount).slice(0, 10);
  const itemLines = topItems.map(([name, data], i) => {
    const qty = Number.isInteger(data.qty) ? data.qty : data.qty.toFixed(1);
    return `${medals[i]} *${name}*　${qty}点　${fmtYen(data.amount)}`;
  });
  // 6件以上は2ブロックに分割（Slackのフィールド文字制限対策）
  const mid = itemLines.length > 6 ? Math.ceil(itemLines.length / 2) : itemLines.length;
  blocks.push({ type: 'section', text: { type: 'mrkdwn', text: itemLines.slice(0, mid).join('\n') || '_取引なし_' } });
  if (itemLines.length > mid) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: itemLines.slice(mid).join('\n') } });
  }

  // ダッシュボード
  blocks.push({ type: 'divider' });
  blocks.push({
    type: 'section',
    text: { type: 'mrkdwn', text: '曜日別・時間帯別のグラフなど、詳しいデータはダッシュボードで確認できます。' },
    accessory: {
      type: 'button',
      text: { type: 'plain_text', text: 'ダッシュボードを開く', emoji: true },
      url: DASHBOARD_URL,
      style: 'primary',
    },
  });

  // フッター
  blocks.push({ type: 'divider' });
  const ctxElements = [];
  if (footerExtra) ctxElements.push({ type: 'mrkdwn', text: footerExtra });
  ctxElements.push({ type: 'mrkdwn', text: `月次レポート（Vercel Cron）｜${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })} 実行` });
  blocks.push({ type: 'context', elements: ctxElements });

  return { blocks };
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
    // Cron は毎月1日 22:00 UTC（= 2日 7:00 JST）に実行 → "前月" を集計
    const nowJST = new Date(new Date().getTime() + JST_OFFSET);

    let targetYear, targetMonth, footerExtra = null;

    // クエリパラメータで年月を手動指定可能
    if (req.query && req.query.year && req.query.month) {
      targetYear  = parseInt(req.query.year);
      targetMonth = parseInt(req.query.month);
      footerExtra = `📌 *手動実行・指定月* \`${targetYear}年${targetMonth}月\``;
    } else {
      // 前月（JST基準）
      [targetYear, targetMonth] = prevMonth(nowJST.getUTCFullYear(), nowJST.getUTCMonth() + 1, 1);
    }

    const [prevY, prevM]   = prevMonth(targetYear, targetMonth, 1);
    const [lastYY, lastYM] = [targetYear - 1, targetMonth];

    console.log(`[MONTHLY] 対象: ${targetYear}年${targetMonth}月`);

    const [[tB, tE], [pB, pE], [lyB, lyE]] = [
      monthRangeUTC(targetYear, targetMonth),
      monthRangeUTC(prevY, prevM),
      monthRangeUTC(lastYY, lastYM),
    ];

    const [targetOrders, prevOrders, lastYearOrders] = await Promise.all([
      fetchOrders(token, locationId, tB, tE),
      fetchOrders(token, locationId, pB, pE),
      fetchOrders(token, locationId, lyB, lyE),
    ]);

    console.log(`[MONTHLY] 取得: 対象=${targetOrders.length}件, 前月=${prevOrders.length}件, 前年同月=${lastYearOrders.length}件`);

    const stats     = aggregateMonthly(targetOrders, targetYear, targetMonth);
    const prevStats = aggregateMonthly(prevOrders, prevY, prevM);
    const lyStats   = aggregateMonthly(lastYearOrders, lastYY, lastYM);

    // 原価計算
    const { totalCost, costRate } = calcCost(stats.items);
    stats.totalCost = totalCost;
    stats.costRate  = costRate;

    console.log(`[MONTHLY] 月間総売上=${fmtYen(stats.totalSales)}, 原価率=${costRate}%, 取引=${stats.orderCount}件`);

    const message = buildSlackMessage(targetYear, targetMonth, stats, prevStats, lyStats, footerExtra);
    await postSlack(message);

    console.log('[MONTHLY] Slack送信完了');
    return res.json({ success: true, year: targetYear, month: targetMonth, totalSales: stats.totalSales });

  } catch (err) {
    console.error('[MONTHLY] ERROR:', err.message);
    try {
      await postSlack({ channel: 'D09TV05303C', text: `:warning: *月次売上レポート エラー*\n\`\`\`${err.message}\`\`\`` });
    } catch (_) {}
    return res.status(500).json({ error: err.message });
  }
};
