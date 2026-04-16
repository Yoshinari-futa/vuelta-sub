/**
 * GET /customer-receipt-oku
 *
 * 奥大地さん（Square customer）の前日来店レシートを Slack へ毎朝送る。
 * Vercel Cron: 毎日 22:00 UTC（= 翌朝 7:00 JST）に自動実行
 * 手動実行: GET /customer-receipt-oku?secret=vuelta2026-member
 *
 * 2026-04-15 復活：以前 Claude スケジュールタスクで動いていたが揮発して停止
 * → Vercel cron で永続化（Pro 化で関数枠余り十分）
 */

const JST_OFFSET = 9 * 60 * 60 * 1000;
const BOUNDARY_HOUR = 5; // 営業日の切れ目（05:00 JST）
const SLACK_CHANNEL = 'C0APKUWTR2L'; // #04-receipts（旧: #04_receipt_奥_vuelta店内飲食）

// 奥大地さんの Square 顧客ID（重複アカウントを含めて全部対象）
const OKU_CUSTOMER_IDS = [
  'NPZ894G9Y6PVF6R6ZP2SG7GSNW', // given_name: 大地, family_name: 奥（メイン）
  'NAP2TE0MT0VXPVVZV00FFAJGJR', // given_name: Dichi, family_name: Oku（重複）
];

const WEEKDAY_JP = ['月', '火', '水', '木', '金', '土', '日'];

// ────────────────────────────────────────
// 日時ユーティリティ
// ────────────────────────────────────────
function toJST(date) {
  return new Date(date.getTime() + JST_OFFSET);
}

/** 営業日 date(JST) → UTC range [begin, end] */
function dayRangeUTC(year, month, day) {
  const begin = new Date(Date.UTC(year, month - 1, day, BOUNDARY_HOUR - 9, 0, 0));
  const endDate = new Date(Date.UTC(year, month - 1, day + 1, BOUNDARY_HOUR - 9 - 1, 59, 59));
  return [begin.toISOString().replace('.000Z', 'Z'), endDate.toISOString().replace('.000Z', 'Z')];
}

function fmtYen(n) {
  return '¥' + Number(n || 0).toLocaleString('ja-JP');
}

// ────────────────────────────────────────
// Square API
// ────────────────────────────────────────
async function fetchOrdersForCustomers(token, locationId, customerIds, beginTime, endTime) {
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
          customer_filter: { customer_ids: customerIds },
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
// 整形
// ────────────────────────────────────────
function paymentMethodLabel(tender) {
  const t = tender.type || '';
  if (t === 'CASH') return '現金';
  if (t === 'CARD') {
    const card = (tender.card_details || {}).card || {};
    const brand = card.card_brand || 'カード';
    const last4 = card.last_4 || '';
    return last4 ? `${brand}（下4桁 ${last4}）` : brand;
  }
  return 'その他';
}

function formatOrderLines(order) {
  const lines = [];
  for (const li of order.line_items || []) {
    const name = li.name || '不明';
    const variation = li.variation_name && li.variation_name !== 'Regular' ? `（${li.variation_name}）` : '';
    const qty = parseInt(li.quantity || '1', 10);
    const amount = (li.total_money || {}).amount || 0;
    lines.push(`・${name}${variation} ×${qty}　${fmtYen(amount)}`);
  }
  return lines;
}

function buildMessage(dateLabel, orders) {
  if (orders.length === 0) {
    return {
      text: `:receipt: 奥大地さん — 前日レシート（${dateLabel}）\n来店なし`,
    };
  }

  const sections = [];
  let dailyTotal = 0;

  for (const order of orders) {
    const t = toJST(new Date(order.created_at));
    const hh = String(t.getUTCHours()).padStart(2, '0');
    const mm = String(t.getUTCMinutes()).padStart(2, '0');
    const total = (order.total_money || {}).amount || 0;
    const tax = (order.total_tax_money || {}).amount || 0;
    dailyTotal += total;

    const lines = formatOrderLines(order);
    const tenders = (order.tenders || []).map(paymentMethodLabel).join(' / ');

    sections.push([
      `:alarm_clock: ${hh}:${mm} 会計`,
      '──────────────────',
      ...lines,
      '──────────────────',
      `:moneybag: 合計: ${fmtYen(total)}（税込・消費税 ${fmtYen(tax)}）`,
      tenders ? `支払い方法: ${tenders}` : '',
    ].filter(Boolean).join('\n'));
  }

  const text = [
    `:receipt: 奥大地さん — 前日レシート（${dateLabel}）`,
    '━━━━━━━━━━━━━━━━',
    sections.join('\n━━━━━━━━━━━━━━━━\n'),
    '━━━━━━━━━━━━━━━━',
    `:bar_chart: 本日合計: ${fmtYen(dailyTotal)}（全${orders.length}会計）`,
    '',
    `:robot_face: VUELTA Bot｜Square自動取得 · ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`,
  ].join('\n');

  return { text };
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

  const token       = (process.env.SQUARE_ACCESS_TOKEN || '').trim();
  const locationId  = (process.env.SQUARE_LOCATION_ID || '').trim();
  const slackToken  = (process.env.SLACK_BOT_TOKEN || '').trim();

  if (!token || !locationId || !slackToken) {
    return res.status(500).json({ error: 'Missing env: SQUARE_ACCESS_TOKEN / SQUARE_LOCATION_ID / SLACK_BOT_TOKEN' });
  }

  async function postSlack(payload) {
    const r = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${slackToken}` },
      body: JSON.stringify({ channel: SLACK_CHANNEL, ...payload }),
    });
    const data = await r.json();
    if (!data.ok) throw new Error(`Slack API error: ${data.error}`);
    return data;
  }

  try {
    // 「前日」の営業日を算出（07:00 JST 実行 → 前日が対象）
    const nowJST = toJST(new Date());
    const targetJST = new Date(nowJST.getTime() - 24 * 60 * 60 * 1000);
    const y = targetJST.getUTCFullYear();
    const m = targetJST.getUTCMonth() + 1;
    const d = targetJST.getUTCDate();
    const wIdx = targetJST.getUTCDay() === 0 ? 6 : targetJST.getUTCDay() - 1;
    const dateLabel = `${y}/${String(m).padStart(2,'0')}/${String(d).padStart(2,'0')}（${WEEKDAY_JP[wIdx]}）`;

    const [begin, end] = dayRangeUTC(y, m, d);
    console.log(`[OKU-RECEIPT] 対象: ${dateLabel}, range=${begin}〜${end}`);

    const orders = await fetchOrdersForCustomers(token, locationId, OKU_CUSTOMER_IDS, begin, end);
    console.log(`[OKU-RECEIPT] 取得: ${orders.length}件`);

    const message = buildMessage(dateLabel, orders);
    await postSlack(message);

    console.log('[OKU-RECEIPT] Slack送信完了');
    return res.json({ success: true, date: dateLabel, orderCount: orders.length });

  } catch (err) {
    console.error('[OKU-RECEIPT] ERROR:', err.message);
    try {
      await postSlack({ channel: 'D09TV05303C', text: `:warning: *奥大地さん前日レシート取得エラー*\n\`\`\`${err.message}\`\`\`` });
    } catch (_) {}
    return res.status(500).json({ error: err.message });
  }
};
