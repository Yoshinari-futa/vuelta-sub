/**
 * GET /daily-sales
 * Square 日次売上レポート → Slack 送信
 * Vercel Cron: 毎日 22:00 UTC（= 翌朝 7:00 JST）に自動実行
 * 手動実行: GET /daily-sales?secret=vuelta2026-member
 */

const JST_OFFSET = 9 * 60 * 60 * 1000;
const BOUNDARY_HOUR = 5; // 営業日の切れ目（05:00 JST）

// ────────────────────────────────────────
// 原価マスタ（cost_master.csv をインライン化）
// keyword は長い順に並べること（部分一致で先にヒットさせる）
// ────────────────────────────────────────
const COST_MASTER = [
  // チャージ
  ['Cover Charge', 22], ['チャージ', 22], ['お通し', 22],
  // シグネチャー
  ['Shell We?', 236], ['Shell We', 236], ['OKONOMIYAKI', 153], ['お好み焼き', 153], ['Aki Amber', 330],
  // スタンダードカクテル
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
  // ビール・スピリッツ
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
  // シャンパン
  ['Belle Epoque', 26500], ['ベルエポック', 26500], ['ペリエジュエ', 26500],
  ['Dom Pérignon', 27980], ['ドンペリニヨン', 27980], ['ドンペリ', 27980],
  ['Louis Roederer Cristal', 41250], ['クリスタル', 41250],
  // 焼酎・日本酒
  ['二階堂', 130], ['Torikai', 188], ['鳥飼', 188],
  ['安田', 302], ['森伊蔵', 1040], ['獺祭', 910],
  ['Kamotsuru', 229], ['賀茂鶴', 229],
  ['DAIYAME', 89], ['DAIYAMA', 89], ['だいやめ', 89],
  // フード Small Talk
  ['ミックスナッツ', 150], ['ドライフルーツ', 195],
  ['生チョコレート', 245], ['生チョコ', 245],
  ['出汁オリーブ', 87], ['Olives', 87], ['Sakai-ya', 79],
  ['Rum Raisin Butter', 56], ['Rum Raisin', 56],
  ['ラムレーズンバター', 56], ['ラムレーズン', 56],
  // タコス
  ['Gansu Tacos', 160], ['ガンスタコス', 160],
  ['Cheesy Melt Carnitas', 209], ['Cheesy Carnitas', 209], ['チーズタコス', 209],
  ['Carnitas Tacos', 164], ['Carnitas', 164], ['カルニタスタコス', 164],
  // フード Repertoire
  ['ガンスレバーパテ', 79], ['坂井屋', 79],
  ['Sweet Potato Crisps', 161], ['Hand-Cut Fries', 167], ['Hand-Cut', 167],
  ['チップス', 161], ['生ポテト', 167], ['ポテトフライ', 167],
  ['ハニーマスカルポーネ', 150], ['マスカルポーネ', 150],
  ['Spinach', 76], ['スピナッチ', 76], ['ベンジャミン', 76],
  ['オニオンリング', 180],
  ['スパイシーチキン', 285], ['チキンウィング', 285], ['ナチョス', 285],
].sort((a, b) => b[0].length - a[0].length); // 長いキーワード優先

// ────────────────────────────────────────
// 日時ユーティリティ
// ────────────────────────────────────────

function toJST(date) {
  return new Date(date.getTime() + JST_OFFSET);
}

/** 営業日 date → UTC range の ISO文字列 [begin, end] */
function dayRangeUTC(year, month, day) {
  // begin: その日 05:00 JST = (day) T(05-9)Z → 前日T20:00Z
  const begin = new Date(Date.UTC(year, month - 1, day, BOUNDARY_HOUR - 9, 0, 0));
  // end: 翌日 04:59:59 JST
  const endDate = new Date(Date.UTC(year, month - 1, day + 1, BOUNDARY_HOUR - 9 - 1, 59, 59));
  return [begin.toISOString().replace('.000Z', 'Z'), endDate.toISOString().replace('.000Z', 'Z')];
}

/** date オブジェクトから営業日の年月日を返す */
function toBusinessDate(utcDate) {
  const jst = toJST(utcDate);
  if (jst.getUTCHours() < BOUNDARY_HOUR) {
    // 前営業日
    const prev = new Date(jst.getTime() - 24 * 60 * 60 * 1000);
    return { year: prev.getUTCFullYear(), month: prev.getUTCMonth() + 1, day: prev.getUTCDate() };
  }
  return { year: jst.getUTCFullYear(), month: jst.getUTCMonth() + 1, day: jst.getUTCDate() };
}

/** 今月初日〜targetDate の UTC range */
function monthRangeUTC(year, month, endDay) {
  const begin = new Date(Date.UTC(year, month - 1, 1, BOUNDARY_HOUR - 9, 0, 0));
  const end = new Date(Date.UTC(year, month - 1, endDay + 1, BOUNDARY_HOUR - 9 - 1, 59, 59));
  return [begin.toISOString().replace('.000Z', 'Z'), end.toISOString().replace('.000Z', 'Z')];
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
  let orders = [];
  let cursor = null;

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

function timeSlot(createdAt) {
  const dt = new Date(createdAt);
  const h = toJST(dt).getUTCHours();
  if (h < 6) return '深夜（0〜6時）';
  if (h < 12) return '朝（6〜12時）';
  if (h < 18) return '昼（12〜18時）';
  return '夜（18〜24時）';
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

function aggregate(orders) {
  let totalSales = 0, totalTax = 0, refundMoney = 0, refundCount = 0;
  const timeSlots = {};
  const paymentMethods = {};
  const items = {};

  for (const order of orders) {
    totalSales += (order.total_money || {}).amount || 0;
    totalTax   += (order.total_tax_money || {}).amount || 0;

    for (const ref of order.refunds || []) {
      refundMoney += (ref.amount_money || {}).amount || 0;
      refundCount++;
    }

    const slot = timeSlot(order.created_at || '');
    if (!timeSlots[slot]) timeSlots[slot] = { count: 0, amount: 0 };
    timeSlots[slot].count++;
    timeSlots[slot].amount += (order.total_money || {}).amount || 0;

    for (const tender of order.tenders || []) {
      const method = paymentMethod(tender);
      if (!paymentMethods[method]) paymentMethods[method] = { count: 0, amount: 0 };
      paymentMethods[method].count++;
      paymentMethods[method].amount += (tender.amount_money || {}).amount || 0;
    }

    for (const li of order.line_items || []) {
      const name = li.name || '不明';
      const variation = li.variation_name || '';
      const disp = (variation && !['Regular', '通常'].includes(variation))
        ? `${name}（${variation}）` : name;
      const qty = parseFloat(li.quantity || '0');
      const amount = ((li.gross_sales_money || li.total_money) || {}).amount || 0;
      if (!items[disp]) items[disp] = { qty: 0, amount: 0 };
      items[disp].qty    += qty;
      items[disp].amount += amount;
    }
  }

  const orderCount = orders.length;
  return {
    orderCount, totalSales, totalTax, refundCount, refundMoney,
    netSales: totalSales - refundMoney,
    avgSpend: orderCount ? Math.round(totalSales / orderCount) : 0,
    timeSlots, paymentMethods, items,
  };
}

// ────────────────────────────────────────
// 原価計算
// ────────────────────────────────────────

function matchCost(name, amount, qty) {
  const unitPrice = qty ? amount / qty : 0;
  for (const [keyword, cost] of COST_MASTER) {
    if (name.toLowerCase().includes(keyword.toLowerCase())) {
      return [cost, true];
    }
  }
  return [Math.round(unitPrice * 0.25), false];
}

function calcCost(items) {
  let totalSales = 0, totalCost = 0, matched = 0, unmatched = 0;
  const unmatchedRows = [];

  for (const [name, data] of Object.entries(items)) {
    totalSales += data.amount;
    if (data.qty <= 0) continue;
    const [costPerUnit, ok] = matchCost(name, data.amount, data.qty);
    if (ok) matched++; else { unmatched++; unmatchedRows.push([name, data.qty, data.amount]); }
    totalCost += Math.round(costPerUnit * data.qty);
  }

  unmatchedRows.sort((a, b) => b[2] - a[2]);
  const costRate = totalSales ? Math.round(totalCost / totalSales * 1000) / 10 : 0;
  return { totalCost, costRate, matched, unmatched, unmatchedRows: unmatchedRows.slice(0, 5) };
}

// ────────────────────────────────────────
// フォーマット
// ────────────────────────────────────────

function fmtYen(v) { return `¥${v.toLocaleString('ja-JP')}`; }

function fmtPct(current, previous) {
  if (!previous) return null;
  const pct = Math.round((current - previous) / previous * 1000) / 10;
  const arrow = pct > 0 ? '↑' : pct < 0 ? '↓' : '→';
  const sign  = pct >= 0 ? '+' : '';
  return `${arrow} ${sign}${pct}%`;
}

function pctEmoji(current, previous) {
  if (!previous) return '';
  return current >= previous ? '📈' : '📉';
}

const TIME_SLOT_ORDER = ['深夜（0〜6時）', '朝（6〜12時）', '昼（12〜18時）', '夜（18〜24時）'];
const WEEKDAY_JP = ['月', '火', '水', '木', '金', '土', '日'];

// ────────────────────────────────────────
// Slack メッセージ構築
// ────────────────────────────────────────

function buildMessage(dateLabel, today, prevDay, prevWeek, monthTotal, costData) {
  const dod = fmtPct(today.totalSales, prevDay.totalSales);
  const wow = fmtPct(today.totalSales, prevWeek.totalSales);

  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: `📊 日次売上レポート｜${dateLabel}` } },
    { type: 'divider' },
    { type: 'section', text: { type: 'mrkdwn', text: '*💰 サマリー*' } },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*総売上*\n${fmtYen(today.totalSales)}` },
        { type: 'mrkdwn', text: `*取引件数*\n${today.orderCount}件` },
        { type: 'mrkdwn', text: `*純売上*\n${fmtYen(today.netSales)}` },
        { type: 'mrkdwn', text: `*平均客単価*\n${fmtYen(today.avgSpend)}` },
        { type: 'mrkdwn', text: `*前日比*\n${pctEmoji(today.totalSales, prevDay.totalSales)} ${dod || '—'}` },
        { type: 'mrkdwn', text: `*前週同曜日比*\n${pctEmoji(today.totalSales, prevWeek.totalSales)} ${wow || '—'}` },
      ],
    },
  ];

  // 原価率
  if (costData) {
    let umLines = '';
    if (costData.unmatchedRows.length > 0) {
      umLines = '\n\n*未マッチ（要キーワード追加）*\n' +
        costData.unmatchedRows.map(([n, q, a]) =>
          `・\`${n}\` ×${Number.isInteger(q) ? q : q.toFixed(1)} ${fmtYen(a)}`
        ).join('\n');
    }
    blocks.push({ type: 'divider' });
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*📊 原価率*\n売上原価: *${fmtYen(costData.totalCost)}*　原価率: *${costData.costRate}%*\nマスタ一致 *${costData.matched}* 種／推定 *${costData.unmatched}* 種\n_(未登録は売上単価の25%で推定)_${umLines}`,
      },
    });
  }

  // 今月累計
  if (monthTotal && monthTotal.orderCount > 0) {
    blocks.push({ type: 'divider' });
    let monthText = `*📅 今月累計*（月初〜対象日）\n売上: *${fmtYen(monthTotal.totalSales)}*　取引: *${monthTotal.orderCount}件*`;
    if (monthTotal.costRate != null) {
      monthText += `\n原価: *${fmtYen(monthTotal.totalCost)}*　原価率: *${monthTotal.costRate}%*`;
    }
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: monthText } });
  }

  // 時間帯別
  blocks.push({ type: 'divider' });
  blocks.push({ type: 'section', text: { type: 'mrkdwn', text: '*⏰ 時間帯別売上*' } });
  const slotLines = TIME_SLOT_ORDER
    .filter(slot => today.timeSlots[slot] && today.timeSlots[slot].count > 0)
    .map(slot => {
      const d = today.timeSlots[slot];
      const bar = '█'.repeat(Math.min(d.count, 10));
      return `\`${slot.padEnd(12)}\` ${bar}  ${d.count}件  ${fmtYen(d.amount)}`;
    });
  blocks.push({
    type: 'section',
    text: { type: 'mrkdwn', text: slotLines.length ? slotLines.join('\n') : '_データなし_' },
  });

  // 決済方法
  blocks.push({ type: 'divider' });
  blocks.push({ type: 'section', text: { type: 'mrkdwn', text: '*💳 決済方法別*' } });
  const pm = today.paymentMethods;
  const pmTotal = Object.values(pm).reduce((s, v) => s + v.amount, 0);
  const pmLines = Object.entries(pm)
    .sort((a, b) => b[1].amount - a[1].amount)
    .map(([method, data]) => {
      const pct = pmTotal ? Math.round(data.amount / pmTotal * 100) : 0;
      return `• *${method}*　${data.count}件　${fmtYen(data.amount)}　\`${pct}%\``;
    });
  blocks.push({
    type: 'section',
    text: { type: 'mrkdwn', text: pmLines.length ? pmLines.join('\n') : '_データなし_' },
  });

  // 商品ランキング
  blocks.push({ type: 'divider' });
  blocks.push({ type: 'section', text: { type: 'mrkdwn', text: '*🏆 商品ランキング（上位5件）*' } });
  const medals = ['🥇', '🥈', '🥉', '4.', '5.'];
  const topItems = Object.entries(today.items)
    .sort((a, b) => b[1].amount - a[1].amount)
    .slice(0, 5)
    .map(([name, data], i) => {
      const qty = Number.isInteger(data.qty) ? data.qty : data.qty.toFixed(1);
      return `${medals[i]} *${name}*　${qty}点　${fmtYen(data.amount)}`;
    });
  blocks.push({
    type: 'section',
    text: { type: 'mrkdwn', text: topItems.length ? topItems.join('\n') : '_取引なし_' },
  });

  blocks.push({ type: 'divider' });
  blocks.push({
    type: 'context',
    elements: [{ type: 'mrkdwn', text: `自動レポート（Vercel Cron）｜${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })} 実行` }],
  });

  return { blocks };
}

// ────────────────────────────────────────
// メインハンドラー
// ────────────────────────────────────────

module.exports = async function handler(req, res) {
  // Cron（GET）または手動実行（secret付き）のみ許可
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const secret = req.query && req.query.secret;
  const isCron = req.headers['x-vercel-cron'] === '1';
  if (!isCron && secret !== 'vuelta2026-member') {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token       = (process.env.SQUARE_ACCESS_TOKEN || '').trim();
  const locationId  = (process.env.SQUARE_LOCATION_ID || '').trim();
  const slackToken  = (process.env.SLACK_BOT_TOKEN || '').trim();
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
    // 対象日：「今日」の JST 日付から「前営業日」を算出
    const nowJST = toJST(new Date());
    // Cron は 22:00 UTC（翌朝7:00 JST）に実行 → JST では既に「今日」なので前日が営業日
    const targetJST = new Date(nowJST.getTime() - 24 * 60 * 60 * 1000);
    const y = targetJST.getUTCFullYear();
    const m = targetJST.getUTCMonth() + 1;
    const d = targetJST.getUTCDate();
    const wday = WEEKDAY_JP[targetJST.getUTCDay() === 0 ? 6 : targetJST.getUTCDay() - 1];
    const dateLabel = `${y}年${String(m).padStart(2,'0')}月${String(d).padStart(2,'0')}日（${wday}）`;

    // 前日・前週同曜日
    const prevDayJST = new Date(targetJST.getTime() - 24 * 60 * 60 * 1000);
    const prevWeekJST = new Date(targetJST.getTime() - 7 * 24 * 60 * 60 * 1000);

    // 各期間の日付
    function dateOf(dt) {
      return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
    }
    const pd = dateOf(prevDayJST), pw = dateOf(prevWeekJST);

    console.log(`[DAILY-SALES] 対象日: ${dateLabel}`);

    const [todayB, todayE]     = dayRangeUTC(y, m, d);
    const [prevDB, prevDE]     = dayRangeUTC(pd.y, pd.m, pd.d);
    const [prevWB, prevWE]     = dayRangeUTC(pw.y, pw.m, pw.d);
    const [monthB, monthE]     = monthRangeUTC(y, m, d);

    const [todayOrders, prevDayOrders, prevWeekOrders, monthOrders] = await Promise.all([
      fetchOrders(token, locationId, todayB, todayE),
      fetchOrders(token, locationId, prevDB, prevDE),
      fetchOrders(token, locationId, prevWB, prevWE),
      fetchOrders(token, locationId, monthB, monthE),
    ]);

    console.log(`[DAILY-SALES] 取得: 当日=${todayOrders.length}件, 前日=${prevDayOrders.length}件, 前週=${prevWeekOrders.length}件, 今月=${monthOrders.length}件`);

    const todayStats    = aggregate(todayOrders);
    const prevDayStats  = aggregate(prevDayOrders);
    const prevWeekStats = aggregate(prevWeekOrders);
    const monthStats    = aggregate(monthOrders);

    // 原価計算
    const costData  = calcCost(todayStats.items);
    const monthCost = calcCost(monthStats.items);
    monthStats.totalCost = monthCost.totalCost;
    monthStats.costRate  = monthCost.costRate;

    console.log(`[DAILY-SALES] 売上=${fmtYen(todayStats.totalSales)}, 原価率=${costData.costRate}%, 今月累計=${fmtYen(monthStats.totalSales)}`);

    const message = buildMessage(dateLabel, todayStats, prevDayStats, prevWeekStats, monthStats, costData);

    await postSlack(message);

    console.log('[DAILY-SALES] Slack送信完了');
    return res.json({ success: true, date: dateLabel, totalSales: todayStats.totalSales, orderCount: todayStats.orderCount });

  } catch (err) {
    console.error('[DAILY-SALES] ERROR:', err.message);
    try {
      await postSlack({ channel: 'D09TV05303C', text: `:warning: *日次売上レポート エラー*\n\`\`\`${err.message}\`\`\`` });
    } catch (_) {}
    return res.status(500).json({ error: err.message });
  }
};
