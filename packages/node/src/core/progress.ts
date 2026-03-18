function toSingleLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function truncate(value: string, maxLength = 120): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

function extractScalar(
  input: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' || typeof value === 'boolean')
      return String(value);
  }
  return null;
}

/**
 * Extract a short summary of the tool target for display.
 * E.g. for Bash calls, pulls out the `command` field from JSON.
 */
function summarizeToolTarget(tool: string, target: string): string | null {
  const cleaned = toSingleLine(target);
  if (!cleaned) return null;

  try {
    const parsed = JSON.parse(cleaned);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return truncate(cleaned);
    }

    const payload = parsed as Record<string, unknown>;
    const lowered = tool.toLowerCase();
    const preferredKeys = lowered.includes('bash')
      ? ['command', 'cmd']
      : lowered.includes('read')
        ? ['file_path', 'path', 'file']
        : lowered.includes('edit') || lowered.includes('write')
          ? ['file_path', 'path', 'file']
          : lowered.includes('glob')
            ? ['pattern', 'path']
            : lowered.includes('grep')
              ? ['pattern', 'query', 'path']
              : ['command', 'cmd', 'file_path', 'path', 'url', 'pattern'];

    const picked =
      extractScalar(payload, preferredKeys) ||
      extractScalar(payload, Object.keys(payload));
    if (!picked) return null;
    return truncate(toSingleLine(picked));
  } catch {
    return truncate(cleaned);
  }
}

// ── Structured progress types ──────────────────────────

/**
 * Categories of progress updates.
 * Each channel (web, CLI, Feishu, etc.) decides how to render these.
 */
export type ProgressCategory =
  | 'skill'     // Using a registered skill (web-search, office, etc.)
  | 'tool'      // Running a generic tool (Bash, Read, Write, etc.)
  | 'thinking'  // LLM is reasoning / planning
  | 'formatting'// Building the final response
  | 'error'     // Recovering from an error
  | 'processing'; // Catch-all for unknown phases

export interface ProgressInfo {
  /** What kind of work is happening */
  category: ProgressCategory;
  /** How long this step has been running */
  elapsed_s: number;
  /** For 'skill': the skill name (e.g. "web-search") */
  skill?: string;
  /** For 'skill': the query/arguments passed to the skill */
  args?: string;
  /** For 'tool': the tool name (e.g. "Bash", "Read") */
  tool?: string;
  /** For 'tool': short summary of what it's operating on */
  target?: string;
}

export function progressKeyFromEvent(event: Record<string, unknown>): string {
  const phase = typeof event.phase === 'string' ? event.phase : '';
  const action = typeof event.action === 'string' ? event.action : '';
  return `${phase}|${action}`;
}

/**
 * Parse a raw progress event into a structured ProgressInfo.
 * Returns null for events that should be suppressed (e.g. streaming text).
 */
export function parseProgressEvent(
  event: Record<string, unknown>,
): ProgressInfo | null {
  const phase = typeof event.phase === 'string' ? event.phase : '';
  const action = typeof event.action === 'string' ? event.action : '';
  const target = typeof event.target === 'string' ? event.target : '';
  const elapsed =
    typeof event.elapsed_ms === 'number' && Number.isFinite(event.elapsed_ms)
      ? event.elapsed_ms
      : 0;
  const elapsed_s = Math.max(1, Math.round(elapsed / 1000));

  // Suppress streaming text and done events
  if (phase === 'stream_event' && action === 'speaking') return null;
  if (phase === 'done') return null;

  // Tool execution
  if (action.startsWith('executing_')) {
    const tool = action.replace(/^executing_/, '') || 'tool';
    const targetSummary = summarizeToolTarget(tool, target);

    // Detect skill invocations: Bash calls to skills/<name>/scripts/...
    if (tool.toLowerCase().includes('bash') && targetSummary) {
      const skillMatch = targetSummary.match(
        /skills\/([^/]+)\/scripts\/[^\s"]+\s*(.*)$/,
      );
      if (skillMatch) {
        const skillName = skillMatch[1];
        const args = skillMatch[2]?.replace(/['"]/g, '').trim();
        return {
          category: 'skill',
          elapsed_s,
          skill: skillName,
          args: args || undefined,
        };
      }
    }

    return {
      category: 'tool',
      elapsed_s,
      tool,
      target: targetSummary || undefined,
    };
  }

  if (phase === 'assistant' || action === 'thinking') {
    return { category: 'thinking', elapsed_s };
  }

  if (phase === 'result') {
    return { category: 'formatting', elapsed_s };
  }

  if (phase === 'error') {
    return { category: 'error', elapsed_s };
  }

  return { category: 'processing', elapsed_s };
}

/**
 * Format a ProgressInfo as a plain-text string.
 * Used by channels that need a single text message (Feishu, WhatsApp, CLI).
 */
export function formatProgressText(info: ProgressInfo): string {
  switch (info.category) {
    case 'skill': {
      const argsSuffix = info.args ? ` for "${truncate(info.args, 60)}"` : '';
      return `Using skill "${info.skill}"${argsSuffix}... (${info.elapsed_s}s)`;
    }
    case 'tool': {
      const suffix = info.target ? `: ${info.target}` : '';
      return `Running ${info.tool}${suffix}... (${info.elapsed_s}s)`;
    }
    case 'thinking':
      return `Thinking... (${info.elapsed_s}s)`;
    case 'formatting':
      return `Formatting result... (${info.elapsed_s}s)`;
    case 'error':
      return `Recovering from error... (${info.elapsed_s}s)`;
    default:
      return `Processing... (${info.elapsed_s}s)`;
  }
}

/**
 * Legacy helper: parse event and format as text in one step.
 * Kept for backward compatibility with non-web channels.
 */
export function formatProgressFromEvent(
  event: Record<string, unknown>,
): string | null {
  const info = parseProgressEvent(event);
  if (!info) return null;
  return formatProgressText(info);
}
