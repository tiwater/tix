import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import { TICLAW_HOME } from './config.js';
import { logger } from './logger.js';

export type BindingKind = 'user' | 'chat';

export interface AgentBindingRecord {
  chat_jid: string;
  agent_id: string;
  kind: BindingKind;
  channel: string;
  pair_code?: string;
  approved_by?: string;
  created_at: string;
  updated_at: string;
}

export interface PendingPairingRecord {
  pair_code: string;
  chat_jid: string;
  requested_agent_id: string;
  kind: BindingKind;
  channel: string;
  status: 'pending' | 'approved' | 'expired';
  created_at: string;
  expires_at: string;
  approved_at?: string;
  approved_by?: string;
  bound_agent_id?: string;
}

const securityDir = path.join(TICLAW_HOME, 'security');
const bindingsPath = path.join(securityDir, 'agent-bindings.json');
const pairingsPath = path.join(securityDir, 'pending-pairings.json');
const PAIR_TTL_MS = 1000 * 60 * 20;

function ensureSecurityDir(): void {
  fs.mkdirSync(securityDir, { recursive: true });
}

function readJsonFile<T>(filePath: string, fallback: T): T {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
  } catch (err) {
    logger.warn({ err, filePath }, 'Failed to read pairing JSON file');
    return fallback;
  }
}

function writeJsonFile(filePath: string, value: unknown): void {
  ensureSecurityDir();
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

function loadBindings(): Record<string, AgentBindingRecord> {
  return readJsonFile<Record<string, AgentBindingRecord>>(bindingsPath, {});
}

function saveBindings(bindings: Record<string, AgentBindingRecord>): void {
  writeJsonFile(bindingsPath, bindings);
}

function loadPendingPairings(): Record<string, PendingPairingRecord> {
  return readJsonFile<Record<string, PendingPairingRecord>>(pairingsPath, {});
}

function savePendingPairings(pairings: Record<string, PendingPairingRecord>): void {
  writeJsonFile(pairingsPath, pairings);
}

function nowIso(): string {
  return new Date().toISOString();
}

function inferChannel(chatJid: string): string {
  return chatJid.split(':')[0] || 'unknown';
}

function inferBindingKind(chatJid: string): BindingKind {
  if (chatJid.startsWith('feishu:') || chatJid.startsWith('fs:')) {
    return 'chat';
  }
  return 'user';
}

function makePairCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  const bytes = crypto.randomBytes(6);
  for (let i = 0; i < 6; i += 1) {
    code += alphabet[bytes[i] % alphabet.length];
  }
  return code;
}

function normalizeRequestedAgentId(chatJid: string): string {
  const parts = chatJid.split(':');
  if ((chatJid.startsWith('feishu:') || chatJid.startsWith('fs:')) && parts.length >= 2) {
    return parts[1] || 'default';
  }
  if (parts.length >= 2) return parts[1] || 'default';
  return 'default';
}

export function getBinding(chatJid: string): AgentBindingRecord | undefined {
  const bindings = loadBindings();
  return bindings[chatJid];
}

export function listBindings(): AgentBindingRecord[] {
  return Object.values(loadBindings()).sort((a, b) =>
    b.updated_at.localeCompare(a.updated_at),
  );
}

export function upsertBinding(input: {
  chatJid: string;
  agentId: string;
  approvedBy?: string;
  pairCode?: string;
}): AgentBindingRecord {
  const bindings = loadBindings();
  const existing = bindings[input.chatJid];
  const ts = nowIso();
  const record: AgentBindingRecord = {
    chat_jid: input.chatJid,
    agent_id: input.agentId,
    kind: inferBindingKind(input.chatJid),
    channel: inferChannel(input.chatJid),
    pair_code: input.pairCode || existing?.pair_code,
    approved_by: input.approvedBy || existing?.approved_by,
    created_at: existing?.created_at || ts,
    updated_at: ts,
  };
  bindings[input.chatJid] = record;
  saveBindings(bindings);
  return record;
}

export function getPendingPairingByCode(code: string): PendingPairingRecord | undefined {
  const pairings = loadPendingPairings();
  const found = pairings[code.trim().toUpperCase()];
  if (!found) return undefined;
  if (found.status === 'pending' && new Date(found.expires_at).getTime() <= Date.now()) {
    found.status = 'expired';
    pairings[found.pair_code] = found;
    savePendingPairings(pairings);
  }
  return pairings[code.trim().toUpperCase()];
}

export function ensurePendingPairing(chatJid: string): PendingPairingRecord {
  const pairings = loadPendingPairings();
  const existing = Object.values(pairings).find(
    (item) => item.chat_jid === chatJid && item.status === 'pending' && new Date(item.expires_at).getTime() > Date.now(),
  );
  if (existing) return existing;

  let code = makePairCode();
  while (pairings[code]) code = makePairCode();

  const createdAt = nowIso();
  const record: PendingPairingRecord = {
    pair_code: code,
    chat_jid: chatJid,
    requested_agent_id: normalizeRequestedAgentId(chatJid),
    kind: inferBindingKind(chatJid),
    channel: inferChannel(chatJid),
    status: 'pending',
    created_at: createdAt,
    expires_at: new Date(Date.now() + PAIR_TTL_MS).toISOString(),
  };
  pairings[code] = record;
  savePendingPairings(pairings);
  return record;
}

export function approvePairing(code: string, approvedBy: string, agentId?: string): PendingPairingRecord | null {
  const pairings = loadPendingPairings();
  const normalized = code.trim().toUpperCase();
  const existing = pairings[normalized];
  if (!existing) return null;
  if (existing.status !== 'pending') return existing;
  if (new Date(existing.expires_at).getTime() <= Date.now()) {
    existing.status = 'expired';
    pairings[normalized] = existing;
    savePendingPairings(pairings);
    return existing;
  }
  existing.status = 'approved';
  existing.approved_at = nowIso();
  existing.approved_by = approvedBy;
  existing.bound_agent_id = agentId || existing.requested_agent_id;
  pairings[normalized] = existing;
  savePendingPairings(pairings);
  return existing;
}
