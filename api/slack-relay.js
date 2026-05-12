/**
 * POST /slack-relay
 *
 * Anthropic クラウドルーティンから slack.com に直接 curl できない制限を回避するための中継。
 * Bearer 認証で受け、サーバ側で SLACK_BOT_TOKEN を使い chat.postMessage に転送する。
 *
 * 用途: VUELTA 顧客動向アラート(クラウドルーティン)→ Vercel 中継 → Slack #10-daily
 *
 * Request:
 *   POST /slack-relay
 *   Authorization: Bearer <SLACK_RELAY_SECRET>
 *   Content-Type: application/json
 *   { "channel": "C09TRGWEQ2H", "text": "...", "mrkdwn": true }
 *
 * Response:
 *   Slack chat.postMessage のレスポンスをそのまま返す。
 *   ok=true → 200, ok=false → 502, 認証失敗 → 401, パラメータ不足 → 400
 */
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const relaySecret = (process.env.SLACK_RELAY_SECRET || '').trim();
  const slackToken = (process.env.SLACK_BOT_TOKEN || '').trim();
  if (!relaySecret || !slackToken) {
    return res.status(500).json({ error: 'Missing env: SLACK_RELAY_SECRET / SLACK_BOT_TOKEN' });
  }

  const auth = req.headers.authorization || '';
  if (auth !== `Bearer ${relaySecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const body = req.body || {};
  const { channel, text, blocks, mrkdwn, thread_ts } = body;
  if (!channel || (!text && !blocks)) {
    return res.status(400).json({ error: 'channel and (text or blocks) required' });
  }

  const payload = { channel };
  if (text) payload.text = text;
  if (blocks) payload.blocks = blocks;
  if (typeof mrkdwn === 'boolean') payload.mrkdwn = mrkdwn;
  if (thread_ts) payload.thread_ts = thread_ts;

  try {
    const r = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Authorization': `Bearer ${slackToken}`,
      },
      body: JSON.stringify(payload),
    });
    const data = await r.json();
    console.log('[SLACK-RELAY]', data.ok ? `OK ts=${data.ts}` : `FAIL error=${data.error}`);
    return res.status(data.ok ? 200 : 502).json(data);
  } catch (err) {
    console.error('[SLACK-RELAY] ERROR:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
