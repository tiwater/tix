import { app } from './core/app.js';
import { logger } from './core/logger.js';
import fs from 'fs';
import path from 'path';
import { AGENTS_DIR } from './core/config.js';
import { ensureAgent } from './core/db.js';

async function testEndToEnd() {
  await app.init();

  const agentId = 'e2e-agent';
  const chatJid = 'web:session-123';

  // 1. Setup Brain
  const agentDir = path.join(AGENTS_DIR, agentId);
  fs.mkdirSync(agentDir, { recursive: true });
  fs.writeFileSync(
    path.join(agentDir, 'SOUL.md'),
    '# E2E SOUL\nYou are an agent that performs long tasks.',
  );
  ensureAgent({ agent_id: agentId, name: 'E2E Agent' });

  console.log('--- E2E TEST: STARTING LONG TASK ---');

  // Listen for state changes (Telemetry)
  app.on('broadcast', (data: any) => {
    console.log(
      `[HUB_TELEMETRY] Status: ${data.event.status}, Action: ${data.event.activity?.action}`,
    );
  });

  // Listen for replies
  app.on('send', (data: any) => {
    console.log(`[REPLY] ${data.text}`);
  });

  // 2. Dispatch a long task
  const msg1 = {
    id: 'msg-1',
    chat_jid: chatJid,
    sender: 'user',
    sender_name: 'User',
    content: '请先 sleep 10 秒，然后告诉我你现在在做什么。',
    timestamp: new Date().toISOString(),
    agent_id: agentId,
    session_id: 'session-123',
  };

  void app.dispatcher.dispatch(chatJid, msg1);

  // 3. Wait 3 seconds then INTERRUPT
  setTimeout(async () => {
    console.log('\n--- E2E TEST: SENDING INTERRUPT ---');
    const msg2 = {
      id: 'msg-2',
      chat_jid: chatJid,
      sender: 'user',
      sender_name: 'User',
      content: 'STOP',
      timestamp: new Date().toISOString(),
      agent_id: agentId,
      session_id: 'session-123',
    };
    await app.dispatcher.dispatch(chatJid, msg2);
  }, 3000);

  // Keep alive for test observation
  setTimeout(() => {
    console.log('\n--- E2E TEST: FINISHED ---');
    process.exit(0);
  }, 10000);
}

testEndToEnd().catch((err) => {
  console.error(err);
  process.exit(1);
});
