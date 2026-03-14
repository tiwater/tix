import { app } from './core/app.js';
import { initDatabase, ensureAgent } from './core/db.js';
import fs from 'fs';
import path from 'path';
import { AGENTS_DIR } from './core/config.js';

async function testFinalEndToEnd() {
  // Fix: Must init database BEFORE anything else
  initDatabase();
  await app.init();

  const agentId = 'final-e2e-agent';
  const chatJid = 'web:final-session-999';

  // 1. Setup Brain
  const agentDir = path.join(AGENTS_DIR, agentId);
  if (!fs.existsSync(agentDir)) fs.mkdirSync(agentDir, { recursive: true });
  fs.writeFileSync(
    path.join(agentDir, 'SOUL.md'),
    '# FINAL SOUL\nYou are a productive TiClaw agent.',
  );
  ensureAgent({ agent_id: agentId, name: 'Final E2E Agent' });

  console.log('--- FINAL E2E TEST: STARTING ---');

  // Listen for Telemetry (The JSON backbone)
  app.on('broadcast', (data: any) => {
    console.log(
      `[TELEMETRY] ${data.event.agent_id} is ${data.event.status}. Activity: ${data.event.activity?.action}`,
    );
  });

  // Listen for text delivery
  app.on('send', (data: any) => {
    console.log(`[OUTBOUND] Message: ${data.text}`);
  });

  // 2. Dispatch a quick self-inspection task
  const msg = {
    id: 'final-msg-1',
    chat_jid: chatJid,
    sender: 'user',
    sender_name: 'Architect',
    content:
      '请告诉我你当前的大脑目录下有哪些文件，并确认 memory/ 目录是否已创建。',
    agent_id: agentId,
    session_id: 'final-session-999',
  };

  await app.dispatcher.dispatch(chatJid, msg);

  console.log('\n--- FINAL E2E TEST: VERIFYING PERSISTENCE ---');
  const memoryFiles = fs
    .readdirSync(path.join(agentDir, 'memory'))
    .filter((f) => f.endsWith('.md'));
  console.log(
    `Found ${memoryFiles.length} journal files in memory/ directory.`,
  );

  console.log('\n--- ALL SYSTEMS GO ---');
  process.exit(0);
}

testFinalEndToEnd().catch((err) => {
  console.error('Final E2E Failed:', err);
  process.exit(1);
});
