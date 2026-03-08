/**
 * OpenClaw-compatible mind files (SOUL, MEMORY, IDENTITY, USER).
 * Evolved through conversation; synced to files when mind state changes.
 */

import fs from 'fs';
import path from 'path';

import { AGENTS_DIR, AGENT_MIND_FILES } from './config.js';
import { getMindState } from './db.js';
import { scheduleSupabasePush } from '../sync/supabase-sync.js';
import type { MindPersona } from './types.js';

/** Convert persona to SOUL.md markdown (OpenClaw-compatible). */
function personaToSoul(persona: MindPersona): string {
  const lines: string[] = [
    '# SOUL',
    '',
    'Personality and behavioral core (evolved through conversation).',
    '',
  ];
  if (persona.tone) lines.push(`- **Tone:** ${persona.tone}`);
  if (persona.verbosity) lines.push(`- **Verbosity:** ${persona.verbosity}`);
  if (typeof persona.emoji === 'boolean')
    lines.push(`- **Emoji:** ${persona.emoji}`);
  const rest = Object.entries(persona).filter(
    ([k]) => !['tone', 'verbosity', 'emoji'].includes(k),
  );
  for (const [k, v] of rest) {
    if (v != null) lines.push(`- **${k}:** ${String(v)}`);
  }
  return lines.join('\n') + '\n';
}

/**
 * Sync mind state (persona, memory_summary) to OpenClaw files.
 * Called after persona or memory evolves through conversation.
 */
export function syncMindStateToFiles(): void {
  const state = getMindState();
  if (!fs.existsSync(AGENTS_DIR)) fs.mkdirSync(AGENTS_DIR, { recursive: true });

  const soul = personaToSoul(state.persona);
  fs.writeFileSync(path.join(AGENTS_DIR, 'SOUL.md'), soul, 'utf-8');

  if (state.memory_summary?.trim()) {
    const memory = `# MEMORY\n\nLong-term facts and preferences (evolved through conversation).\n\n${state.memory_summary.trim()}\n`;
    fs.writeFileSync(path.join(AGENTS_DIR, 'MEMORY.md'), memory, 'utf-8');
  }

  scheduleSupabasePush();
}

/**
 * Load OpenClaw mind context for a group (boot-md order: SOUL, IDENTITY, USER, MEMORY).
 * Returns combined markdown for agent system prompt.
 */
export function loadGroupMindContext(groupFolder?: string): string {
  const baseDir = groupFolder ? path.join(AGENTS_DIR, groupFolder) : AGENTS_DIR;
  if (!fs.existsSync(baseDir)) return '';

  const parts: string[] = [];
  for (const filename of AGENT_MIND_FILES) {
    const p = path.join(baseDir, filename);
    if (fs.existsSync(p)) {
      const content = fs.readFileSync(p, 'utf-8').trim();
      if (content) parts.push(content);
    }
  }

  if (parts.length === 0) {
    // Fallback: synthesize from SQLite if no files yet
    const state = getMindState();
    if (
      Object.keys(state.persona || {}).length > 0 ||
      state.memory_summary?.trim()
    ) {
      parts.push(personaToSoul(state.persona));
      if (state.memory_summary?.trim()) {
        parts.push(`# MEMORY\n\n${state.memory_summary.trim()}\n`);
      }
    }
  }

  return parts.length
    ? `\n## Mind context\n\n${parts.join('\n\n---\n\n')}\n`
    : '';
}
