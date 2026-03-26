/**
 * LLM Client
 * ----------
 * Priority:
 *   1. ANTHROPIC_API_KEY in .env → direct Anthropic API
 *   2. OPENCLAW_GATEWAY_TOKEN in .env → route via local OpenClaw proxy
 *   3. Mock mode (no key)
 */

// NOTE: read process.env at call-time (not module-init) to avoid ESM hoisting issues
const MODEL = 'claude-haiku-4-5';

export async function callLLM(systemPrompt, userMessage, options = {}) {
  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  const OPENCLAW_TOKEN    = process.env.OPENCLAW_GATEWAY_TOKEN;

  // ── Option 1: Direct Anthropic key ───────────────────────────
  if (ANTHROPIC_API_KEY) {
    return callDirect(systemPrompt, userMessage, ANTHROPIC_API_KEY);
  }

  // ── Option 2: Via OpenClaw gateway proxy ──────────────────────
  if (OPENCLAW_TOKEN) {
    return callViaGateway(systemPrompt, userMessage, OPENCLAW_TOKEN);
  }

  // ── Option 3: Mock ────────────────────────────────────────────
  return mockResponse(options.agentId || 'unknown', userMessage);
}

async function callDirect(systemPrompt, userMessage, apiKey) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key':         apiKey,
      'anthropic-version': '2023-06-01',
      'content-type':      'application/json',
    },
    body: JSON.stringify({
      model:      MODEL,
      max_tokens: 600,
      system:     systemPrompt,
      messages:   [{ role: 'user', content: userMessage }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${err}`);
  }

  const data = await res.json();
  return data.content?.[0]?.text || '';
}

async function callViaGateway(systemPrompt, userMessage, token) {
  const gatewayUrl = process.env.OPENCLAW_GATEWAY_URL || 'http://localhost:18789';
  // OpenClaw exposes an OpenAI-compatible /v1/chat/completions endpoint
  const res = await fetch(`${gatewayUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'content-type':  'application/json',
    },
    body: JSON.stringify({
      model:      'anthropic/claude-haiku-4-5',
      max_tokens: 600,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userMessage },
      ],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenClaw gateway error ${res.status}: ${err}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

function mockResponse(agentId, context) {
  const mocks = {
    nova:  `• **Trend:** AI-powered personal dashboards are becoming the new productivity layer — you're ahead of this curve\n• **Big idea:** Turn the Control Center into a SaaS product — "Clawd OS for founders" — other builders want exactly this\n• **Opportunity:** The trend-tracker is sitting on valuable signal data; aggregate it and sell insights\n• **Future play:** Add a mobile companion app — check your metrics from your phone`,
    rex:   `• **Architecture:** Current JSON file storage will hit limits at ~10k entries — consider SQLite migration (2-3 hours work)\n• **Quick win:** Add a single \`npm run start:all\` command using concurrently package instead of the .bat file\n• **Risk:** No auth on any endpoints — anyone on your network can POST to your APIs\n• **Improvement:** The trend tracker polls even when you're offline — add a connectivity check`,
    sage:  `• **Revenue #1:** Offer the Control Center as a $29/mo hosted service for indie developers\n• **Revenue #2:** Sell "Trend Alert" reports — weekly AI digest of what's trending in AI tools — email newsletter, $9/mo\n• **Revenue #3:** The YouTube transcript tool has clear B2B use cases (content teams) — productize it\n• **Channel:** Post the GarageOS build process on YouTube — the trend tracker shows that content performs well`,
    vex:   `• **Risk:** You're building tools to manage tools — when do you ship something users actually pay for?\n• **Problem:** The trend tracker alerts are noisy — 30 alerts on first run means the thresholds are too low\n• **Assumption:** "5 AI agents debating" sounds impressive but the output quality depends entirely on context quality\n• **Hard question:** Are you building this for yourself or for customers? The answer changes every architectural decision`,
  };
  return mocks[agentId] || '• Mock response — add ANTHROPIC_API_KEY to .env for real AI responses';
}
