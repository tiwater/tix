import {
  createMindPackage,
  getMindState,
  listMindPackages,
  rollbackMindPackage,
  storeInteractionEvent,
  updateMindState,
} from './db.js';
import type {
  InteractionEvent,
  InteractionIntent,
  MindPackage,
  MindState,
} from './types.js';

function classifyIntent(content: string): InteractionIntent {
  const t = content.toLowerCase();
  const personaHints = [
    '活泼',
    '严肃',
    '简短',
    '详细',
    '少点表情',
    '多点表情',
    'tone',
    'style',
    'personality',
  ];
  if (personaHints.some((h) => t.includes(h))) return 'persona';
  if (t.includes('记住') || t.includes('remember')) return 'memory';
  if (t.includes('并且') || t.includes('同时')) return 'mixed';
  return 'task';
}

function applyPersonaHints(state: MindState, content: string): MindState {
  const nextPersona = { ...state.persona };
  if (content.includes('活泼')) nextPersona.tone = 'playful';
  if (content.includes('专业') || content.includes('严肃'))
    nextPersona.tone = 'professional';
  if (content.includes('简短')) nextPersona.verbosity = 'short';
  if (content.includes('详细')) nextPersona.verbosity = 'detailed';
  if (content.includes('少点表情')) nextPersona.emoji = false;
  if (content.includes('多点表情')) nextPersona.emoji = true;

  return updateMindState({
    persona: nextPersona,
    memory_summary: state.memory_summary,
  });
}

export function recordUserInteraction(
  event: Omit<InteractionEvent, 'id' | 'intent'>,
): {
  intent: InteractionIntent;
  state: MindState;
} {
  const intent = classifyIntent(event.content);
  const fullEvent: InteractionEvent = {
    ...event,
    id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    intent,
  };

  storeInteractionEvent(fullEvent);

  let state = getMindState();
  if (state.lifecycle === 'locked') {
    return { intent, state };
  }

  if (intent === 'persona' || intent === 'mixed') {
    state = applyPersonaHints(state, event.content);
  }

  return { intent, state };
}

export function lockMind(): MindState {
  return updateMindState({ lifecycle: 'locked' });
}

export function unlockMind(): MindState {
  return updateMindState({ lifecycle: 'draft' });
}

export function setMindPersonaPatch(patch: Partial<MindState['persona']>): MindState {
  const state = getMindState();
  if (state.lifecycle === 'locked') return state;
  return updateMindState({
    persona: {
      ...state.persona,
      ...patch,
    },
  });
}

export function diffMindVersions(fromVersion: number, toVersion: number): string {
  const pkgs = listMindPackages(200);
  const from = pkgs.find((p) => p.version === fromVersion);
  const to = pkgs.find((p) => p.version === toVersion);
  if (!from || !to) return 'version not found';

  const changes: string[] = [];
  const keys = new Set([...Object.keys(from.persona || {}), ...Object.keys(to.persona || {})]);
  for (const key of keys) {
    const a = (from.persona as any)?.[key];
    const b = (to.persona as any)?.[key];
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      changes.push(`${key}: ${JSON.stringify(a)} -> ${JSON.stringify(b)}`);
    }
  }

  if (from.memory_summary !== to.memory_summary) {
    changes.push('memory_summary changed');
  }

  return changes.length ? changes.join('\n') : 'no diff';
}

export function mindStatus(): MindState {
  return getMindState();
}

export function createPackage(
  changelog = 'Manual package create',
): MindPackage {
  const state = getMindState();
  const next = updateMindState({ version: state.version + 1 });
  return createMindPackage(changelog || `Package from mind v${next.version}`);
}

export function listPackages(limit = 10): MindPackage[] {
  return listMindPackages(limit);
}

export function rollbackPackage(version: number): MindState | null {
  return rollbackMindPackage(version);
}
