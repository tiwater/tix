/**
 * Test 2: CLI-level — Claude Agent SDK query() with MiniMax env injection.
 * The bundled cli.js subprocess will redirect to MiniMax via ANTHROPIC_BASE_URL.
 */
import { query } from '@anthropic-ai/claude-agent-sdk';
import os from 'os';

const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY;
const MINIMAX_BASE_URL = process.env.MINIMAX_BASE_URL ?? 'https://api.minimax.io/anthropic';

if (!MINIMAX_API_KEY) {
  console.error('Missing MINIMAX_API_KEY');
  process.exit(1);
}

console.log(`\n=== CLI (Agent SDK) Level Test ===`);
console.log(`Base URL: ${MINIMAX_BASE_URL}`);
console.log(`Model:    MiniMax-M2.5`);
console.log(`(This spawns the bundled cli.js subprocess...)\n`);

try {
  for await (const msg of query({
    prompt: 'Reply with exactly: "MiniMax CLI ✅". No other text.',
    options: {
      model: 'MiniMax-M2.5',
      cwd: os.tmpdir(),
      env: {
        ...process.env,
        ANTHROPIC_API_KEY: MINIMAX_API_KEY,
        ANTHROPIC_BASE_URL: MINIMAX_BASE_URL,
      },
      allowedTools: [],
      permissionMode: 'acceptEdits',
      maxTurns: 1,
    },
  })) {
    const type = msg.type;
    if (type === 'assistant') {
      const blocks = msg.message?.content ?? [];
      for (const b of blocks) {
        if (b.type === 'text') console.log(`Response: ${b.text}`);
      }
    }
    if (type === 'result') {
      const r = msg;
      if (r.subtype === 'success') {
        console.log(`\n✅ CLI-level test PASSED (subtype: success)`);
      } else {
        console.error(`\n❌ CLI-level test FAILED (subtype: ${r.subtype})`);
        if (r.error) console.error('Error:', r.error);
        process.exit(1);
      }
    }
  }
} catch (err) {
  console.error(`\n❌ CLI-level test FAILED:`, err.message);
  process.exit(1);
}
