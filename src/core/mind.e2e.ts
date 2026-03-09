/**
 * Mind System E2E Test
 *
 * Verifies that chatting actually builds the mind — i.e., that natural-language
 * persona instructions are sent to the LLM intent parser and land in MindState.
 *
 * Usage: npx tsx src/core/mind.e2e.ts
 *
 * Requires OPENROUTER_API_KEY (or HTTPS_PROXY if behind a proxy).
 * Uses the real production database (~/ticlaw/store/messages.db), so wrap it with
 * initDatabase() first. A fresh in-memory DB is NOT used here — we call the live
 * LLM API to exercise the full pipeline.
 */
import { initDatabase, getMindState } from './db.js';
import { recordUserInteraction, mindStatus, unlockMind } from './mind.js';

// ---- helpers ---------------------------------------------------------------

function assert(condition: boolean, msg: string): void {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${msg}`);
  }
}

function log(section: string, detail?: unknown): void {
  const ts = new Date().toISOString();
  if (detail !== undefined) {
    console.log(`[${ts}] ${section}:`, JSON.stringify(detail, null, 2));
  } else {
    console.log(`[${ts}] ${section}`);
  }
}

// ---- main ------------------------------------------------------------------

async function run(): Promise<void> {
  // Use the real on-disk DB so we can observe the persisted outcome
  initDatabase();

  // Ensure mind is unlocked before test
  const initial = getMindState();
  if (initial.lifecycle === 'locked') {
    log('⚠️  Mind was locked — unlocking for E2E test');
    unlockMind();
  }

  log('=== Mind E2E: chatting drives persona evolution ===');
  log('Initial MindState', mindStatus());

  // ---- Test 1: persona instruction changes tone + verbosity ----------------
  log('\n--- Test 1: persona instruction ("活泼一点，回答简短") ---');
  const r1 = await recordUserInteraction({
    chat_jid: 'e2e-mind-test',
    role: 'user',
    content: '你活泼一点，回答简短',
    timestamp: new Date().toISOString(),
    is_admin: true,
  });

  log('Intent result', { intent: r1.intent, persona: r1.state.persona });

  assert(
    r1.intent === 'persona' || r1.intent === 'mixed',
    `Expected persona/mixed intent, got: ${r1.intent}`,
  );
  assert(
    r1.state.persona.tone === 'playful',
    `Expected tone=playful, got: ${r1.state.persona.tone}`,
  );
  assert(
    r1.state.persona.verbosity === 'short',
    `Expected verbosity=short, got: ${r1.state.persona.verbosity}`,
  );
  log('✅  Test 1 passed');

  // ---- Test 2: ordinary task message does not mutate persona ---------------
  log('\n--- Test 2: ordinary task message does not change persona ---');
  const beforePersona = JSON.stringify(getMindState().persona);

  const r2 = await recordUserInteraction({
    chat_jid: 'e2e-mind-test',
    role: 'user',
    content: 'What is the weather like today?',
    timestamp: new Date().toISOString(),
  });

  log('Intent result', { intent: r2.intent, persona: r2.state.persona });

  assert(
    r2.intent === 'task' || r2.intent === 'unknown',
    `Expected task/unknown intent for a question, got: ${r2.intent}`,
  );
  assert(
    JSON.stringify(getMindState().persona) === beforePersona,
    'Persona should not change for a task message',
  );
  log('✅  Test 2 passed');

  // ---- Test 3: emoji toggle -----------------------------------------------
  log('\n--- Test 3: emoji toggle ("多用表情") ---');
  const r3 = await recordUserInteraction({
    chat_jid: 'e2e-mind-test',
    role: 'user',
    content: '多用表情符号，让你的回答更生动',
    timestamp: new Date().toISOString(),
    is_admin: true,
  });

  log('Intent result', { intent: r3.intent, persona: r3.state.persona });

  assert(
    r3.intent === 'persona' || r3.intent === 'mixed',
    `Expected persona/mixed intent for emoji toggle, got: ${r3.intent}`,
  );
  assert(
    r3.state.persona.emoji === true,
    `Expected emoji=true, got: ${r3.state.persona.emoji}`,
  );
  log('✅  Test 3 passed');

  // ---- Test 4: professional tone -------------------------------------------
  log('\n--- Test 4: professional tone ("请保持专业") ---');
  const r4 = await recordUserInteraction({
    chat_jid: 'e2e-mind-test',
    role: 'user',
    content: '请保持专业的口吻，不用表情，详细回答',
    timestamp: new Date().toISOString(),
    is_admin: true,
  });

  log('Intent result', { intent: r4.intent, persona: r4.state.persona });

  assert(
    r4.intent === 'persona' || r4.intent === 'mixed',
    `Expected persona/mixed intent, got: ${r4.intent}`,
  );
  assert(
    r4.state.persona.tone === 'professional',
    `Expected tone=professional, got: ${r4.state.persona.tone}`,
  );
  log('✅  Test 4 passed');

  log('\n=== All Mind E2E tests passed ===');
  log('Final MindState', mindStatus());
  process.exit(0);
}

run().catch((err) => {
  console.error('Fatal E2E error:', err);
  process.exit(1);
});
