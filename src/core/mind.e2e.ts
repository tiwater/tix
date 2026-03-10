/**
 * Mind System E2E Test
 *
 * Verifies end-to-end mind pipeline behavior with the current architecture:
 * interactions are persisted, intent classification is fixed to `task`,
 * and MindState remains unchanged unless explicitly updated via /mind controls.
 *
 * Usage: npx tsx src/core/mind.e2e.ts
 *
 * Uses the real production database (~/ticlaw/store/messages.db), so wrap it with
 * initDatabase() first. A fresh in-memory DB is NOT used here.
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
  log('\n--- Test 1: interaction is persisted and intent is task ---');
  const beforePersona = JSON.stringify(getMindState().persona);

  const r1 = await recordUserInteraction({
    chat_jid: 'e2e-mind-test',
    role: 'user',
    content: '你活泼一点，回答简短',
    timestamp: new Date().toISOString(),
    is_admin: true,
  });

  log('Intent result', { intent: r1.intent, persona: r1.state.persona });

  assert(r1.intent === 'task', `Expected task intent, got: ${r1.intent}`);
  assert(
    JSON.stringify(getMindState().persona) === beforePersona,
    'Persona should not change via recordUserInteraction in current architecture',
  );
  log('✅  Test 1 passed');

  // ---- Test 2: ordinary message still task ---------------------------------
  log('\n--- Test 2: ordinary message remains task ---');
  const r2 = await recordUserInteraction({
    chat_jid: 'e2e-mind-test',
    role: 'user',
    content: 'What is the weather like today?',
    timestamp: new Date().toISOString(),
  });

  log('Intent result', { intent: r2.intent, persona: r2.state.persona });

  assert(r2.intent === 'task', `Expected task intent, got: ${r2.intent}`);
  log('✅  Test 2 passed');

  // ---- Test 3: /mind persona patch path -----------------------------------
  log('\n--- Test 3: explicit persona patch updates MindState ---');
  const { setMindPersonaPatch } = await import('./mind.js');
  const patched = setMindPersonaPatch({ tone: 'professional', emoji: true });
  assert(
    patched.persona.tone === 'professional' && patched.persona.emoji === true,
    'Expected persona patch to update tone/emoji',
  );
  log('✅  Test 3 passed');

  log('\n=== All Mind E2E tests passed ===');
  log('Final MindState', mindStatus());
  process.exit(0);
}

run().catch((err) => {
  console.error('Fatal E2E error:', err);
  process.exit(1);
});
