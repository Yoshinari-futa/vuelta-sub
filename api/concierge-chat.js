/**
 * POST /api/concierge-chat
 * VUELTA AI Concierge — multilingual Q&A about VUELTA and the surrounding area.
 *
 * Request body:
 *   { messages: [{role: 'user'|'assistant', content: string}, ...] }
 *
 * Response:
 *   { reply: string, usage: {...} }
 *
 * Env:
 *   ANTHROPIC_API_KEY  (required)
 */
const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');

const MODEL = 'claude-opus-4-7';
const MAX_TOKENS = 1024;
const MAX_HISTORY = 20;
const MAX_MSG_CHARS = 2000;

let cachedKnowledge = null;
function loadKnowledge() {
  if (cachedKnowledge !== null) return cachedKnowledge;
  try {
    const p = path.join(process.cwd(), 'knowledge.md');
    cachedKnowledge = fs.readFileSync(p, 'utf8');
  } catch (e) {
    cachedKnowledge = '';
  }
  return cachedKnowledge;
}

function buildSystemPrompt(knowledge) {
  return [
    'You are the VUELTA AI Concierge — a warm, concise, and knowledgeable digital concierge for VUELTA, a bar in Japan.',
    '',
    'GUIDELINES:',
    '- Detect the language the user writes in and always reply in that same language. Handle Japanese, English, Chinese (Simplified/Traditional), Korean, French, Spanish, and other languages naturally.',
    '- Keep answers short and practical (typically 2–5 sentences). Use bullet points only when genuinely helpful.',
    '- Be warm and welcoming, like a great bartender who happens to know the neighborhood.',
    '- Tone: polished, friendly, never pushy. No emojis unless the user uses them first.',
    '',
    'SCOPE:',
    '- Primary: questions about VUELTA — menu, hours, access, membership (FIRST-DRINK PASS), reservations, payment, dress code, etc.',
    '- Secondary: general travel help for visitors in the surrounding neighborhood — nearby sightseeing, transit, taxis, ATMs, basic Japan travel tips.',
    '- If asked about something truly unrelated (politics, unrelated advice, other bars/competitors), gently redirect: offer what you CAN help with.',
    '',
    'ACCURACY RULES (very important):',
    '- Only state facts about VUELTA that are in the KNOWLEDGE section below. If something is marked as a placeholder, or is not listed, say so honestly and suggest the user check the VUELTA website (https://www.vuelta.jp/), Instagram (@vuelta_bar), or ask the staff in person. Never invent prices, hours, addresses, or menu items.',
    '- For neighborhood/travel questions, answer from general knowledge, but flag anything that may have changed (opening hours, closures, fares) and recommend the user double-check on arrival.',
    '',
    'KNOWLEDGE (authoritative facts about VUELTA):',
    '<knowledge>',
    knowledge || '(No knowledge base has been loaded yet. Tell the user you cannot answer specific VUELTA questions right now and to please check the website.)',
    '</knowledge>',
  ].join('\n');
}

function sanitizeMessages(raw) {
  if (!Array.isArray(raw)) return [];
  const cleaned = [];
  for (const m of raw) {
    if (!m || typeof m !== 'object') continue;
    const role = m.role === 'assistant' ? 'assistant' : 'user';
    const content = typeof m.content === 'string' ? m.content : '';
    const trimmed = content.trim();
    if (!trimmed) continue;
    cleaned.push({ role, content: trimmed.slice(0, MAX_MSG_CHARS) });
  }
  const trimmedHistory = cleaned.slice(-MAX_HISTORY);
  while (trimmedHistory.length > 0 && trimmedHistory[0].role !== 'user') {
    trimmedHistory.shift();
  }
  return trimmedHistory;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(500).json({ error: 'Server is missing ANTHROPIC_API_KEY.' });
    return;
  }

  let body = req.body;
  try {
    if (typeof body === 'string') body = JSON.parse(body);
  } catch {
    res.status(400).json({ error: 'Invalid JSON body' });
    return;
  }

  const messages = sanitizeMessages(body && body.messages);
  if (messages.length === 0) {
    res.status(400).json({ error: 'messages is required and must include at least one user message' });
    return;
  }

  try {
    const client = new Anthropic();
    const knowledge = loadKnowledge();

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: [
        {
          type: 'text',
          text: buildSystemPrompt(knowledge),
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages,
    });

    const textBlock = (response.content || []).find((b) => b.type === 'text');
    const reply = textBlock ? textBlock.text : '';

    res.status(200).json({
      reply,
      usage: response.usage,
      stop_reason: response.stop_reason,
    });
  } catch (err) {
    console.error('[concierge-chat] error:', err);
    const status = (err && err.status) || 500;
    res.status(status >= 400 && status < 600 ? status : 500).json({
      error: (err && err.message) || 'Internal error',
    });
  }
};
