import { runAgent } from './run-agent.js';
import { logger } from './core/logger.js';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { AGENTS_DIR } from './core/config.js';

async function testAgentEvents() {
  const agentId = 'test-agent';
  const sessionId = `test-session-${Date.now()}`;
  const taskId = `test-task-${Date.now()}`;

  // 1. Prepare minimal agent brain
  const agentDir = path.join(AGENTS_DIR, agentId);
  if (!fs.existsSync(agentDir)) {
    fs.mkdirSync(agentDir, { recursive: true });
  }
  fs.writeFileSync(path.join(agentDir, 'SOUL.md'), '# TEST SOUL\nYou are a helpful test agent.');
  fs.writeFileSync(path.join(agentDir, 'IDENTITY.md'), '# TEST IDENTITY\nA simple probe agent.');

  const session = {
    agent_id: agentId,
    session_id: sessionId,
    task_id: taskId,
    status: 'active' as const,
    channel: 'test',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const group = {
    name: 'Test Project',
    folder: agentId,
    agent_id: agentId,
    added_at: new Date().toISOString(),
    requiresTrigger: false,
    isMain: false,
    trigger: '',
  };

  console.log('--- STARTING AGENT EVENT TEST ---');

  try {
    await runAgent({
      group,
      session,
      messages: [
        { 
          role: 'user', 
          content: '请列出当前目录下所有的 .md 文件，然后告诉我其中一个文件的内容概要。' 
        }
      ],
      onEvent: (event) => {
        // Capture and display the precise JSON signals
        console.log(`[EVENT] ${JSON.stringify(event, null, 2)}`);
      },
      onReply: (text) => {
        console.log(`\n[FINAL REPLY]\n${text}\n`);
      },
    });
  } catch (err) {
    console.error('Test failed:', err);
  }
}

testAgentEvents().catch(console.error);
