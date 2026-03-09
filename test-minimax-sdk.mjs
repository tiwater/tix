/**
 * Test 1: SDK-level — Direct Anthropic SDK call routed to MiniMax.
 * Uses @anthropic-ai/sdk with baseURL + API key overridden.
 */
import Anthropic from '@anthropic-ai/sdk';

const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY;
const MINIMAX_BASE_URL = process.env.MINIMAX_BASE_URL ?? 'https://api.minimax.io/anthropic';

if (!MINIMAX_API_KEY) {
  console.error('Missing MINIMAX_API_KEY');
  process.exit(1);
}

console.log(`\n=== SDK Level Test ===`);
console.log(`Base URL: ${MINIMAX_BASE_URL}`);
console.log(`Model:    MiniMax-M2.5`);

const client = new Anthropic({
  apiKey: MINIMAX_API_KEY,
  baseURL: MINIMAX_BASE_URL,
});

try {
  const resp = await client.messages.create({
    model: 'MiniMax-M2.5',
    max_tokens: 64,
    messages: [{ role: 'user', content: 'Reply with exactly: "MiniMax SDK ✅"' }],
  });
  const text = resp.content.map(b => b.type === 'text' ? b.text : '').join('');
  console.log(`\nResponse: ${text}`);
  console.log(`Stop reason: ${resp.stop_reason}`);
  console.log(`\n✅ SDK-level test PASSED`);
} catch (err) {
  console.error(`\n❌ SDK-level test FAILED:`, err.message);
  process.exit(1);
}
