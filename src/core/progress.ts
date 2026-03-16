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

export function progressKeyFromEvent(event: Record<string, unknown>): string {
  const phase = typeof event.phase === 'string' ? event.phase : '';
  const action = typeof event.action === 'string' ? event.action : '';
  return `${phase}|${action}`;
}

export function formatProgressText(
  event: Record<string, unknown>,
): string | null {
  const phase = typeof event.phase === 'string' ? event.phase : '';
  const action = typeof event.action === 'string' ? event.action : '';
  const target = typeof event.target === 'string' ? event.target : '';
  const elapsed =
    typeof event.elapsed_ms === 'number' && Number.isFinite(event.elapsed_ms)
      ? event.elapsed_ms
      : 0;
  const secs = Math.max(1, Math.round(elapsed / 1000));

  if (phase === 'stream_event' && action === 'speaking') return null;
  if (phase === 'done') return null;

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
        const argsSuffix = args ? ` for "${truncate(args, 60)}"` : '';
        return `Using skill "${skillName}"${argsSuffix}... (${secs}s)`;
      }
    }

    const suffix = targetSummary ? `: ${targetSummary}` : '';
    return `Running ${tool}${suffix}... (${secs}s)`;
  }

  if (phase === 'assistant' || action === 'thinking') {
    return `Thinking and planning next steps... (${secs}s)`;
  }

  if (phase === 'result') {
    return `Formatting final result... (${secs}s)`;
  }

  if (phase === 'error') {
    return `Encountered an error, recovering... (${secs}s)`;
  }

  return `Processing... (${secs}s)`;
}
