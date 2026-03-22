import fs from 'fs';
import os from 'os';
import path from 'path';
import { beforeEach, describe, expect, it } from 'vitest';

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ticlaw-pairing-'));
process.env.HOME = tmpHome;
process.env.TICLAW_HOME = path.join(tmpHome, '.ticlaw');

const mod = await import('./pairing.js');

describe('pairing store', () => {
  beforeEach(() => {
    fs.rmSync(process.env.TICLAW_HOME!, { recursive: true, force: true });
  });

  it('creates a pending pairing and reuses unexpired code', () => {
    const first = mod.ensurePendingPairing('feishu:app123:userA');
    const second = mod.ensurePendingPairing('feishu:app123:userA');
    expect(second.pair_code).toBe(first.pair_code);
    expect(first.status).toBe('pending');
  });

  it('approves a pairing and persists a binding', () => {
    const pending = mod.ensurePendingPairing('feishu:app123:userB');
    const approved = mod.approvePairing(pending.pair_code, 'admin-user', 'agent-security');
    expect(approved?.status).toBe('approved');
    mod.upsertBinding({
      chatJid: 'feishu:app123:userB',
      agentId: 'agent-security',
      approvedBy: 'admin-user',
      pairCode: pending.pair_code,
    });
    const binding = mod.getBinding('feishu:app123:userB');
    expect(binding?.agent_id).toBe('agent-security');
    expect(binding?.approved_by).toBe('admin-user');
  });

  it('lists pending pairings and supports unbind', () => {
    const pending = mod.ensurePendingPairing('feishu:app123:userC');
    const list = mod.listPendingPairings();
    expect(list.some((item: any) => item.pair_code === pending.pair_code)).toBe(true);

    mod.upsertBinding({
      chatJid: 'feishu:app123:userC',
      agentId: 'agent-c',
      approvedBy: 'admin-user',
    });
    expect(mod.removeBinding('feishu:app123:userC')).toBe(true);
    expect(mod.getBinding('feishu:app123:userC')).toBeUndefined();
  });
});
