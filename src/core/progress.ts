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

  if (action.startsWith('executing_')) {
    const tool = action.replace(/^executing_/, '') || 'tool';
    const targetSummary = summarizeToolTarget(tool, target);
    const suffix = targetSummary ? `: ${targetSummary}` : '';
    return `🛠 正在调用 ${tool}${suffix}...（${secs}s）`;
  }

  if (phase === 'assistant' || action === 'thinking') {
    return `🧠 正在思考与规划下一步...（${secs}s）`;
  }

  if (phase === 'result') {
    return `📦 正在整理最终结果...（${secs}s）`;
  }

  if (phase === 'error') {
    return `⚠️ 执行中遇到错误，正在收敛处理...（${secs}s）`;
  }

  return `⏳ 正在处理中...（${secs}s）`;
}
