/**
 * Categories of progress updates.
 * Each channel (web, CLI, Feishu, etc.) decides how to render these.
 */
export type ProgressCategory = 'skill' | 'tool' | 'thinking' | 'formatting' | 'error' | 'processing';
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
export declare function progressKeyFromEvent(event: Record<string, unknown>): string;
/**
 * Parse a raw progress event into a structured ProgressInfo.
 * Returns null for events that should be suppressed (e.g. streaming text).
 */
export declare function parseProgressEvent(event: Record<string, unknown>): ProgressInfo | null;
/**
 * Format a ProgressInfo as a plain-text string.
 * Used by channels that need a single text message (Feishu, WhatsApp, CLI).
 */
export declare function formatProgressText(info: ProgressInfo): string;
/**
 * Legacy helper: parse event and format as text in one step.
 * Kept for backward compatibility with non-web channels.
 */
export declare function formatProgressFromEvent(event: Record<string, unknown>): string | null;
//# sourceMappingURL=progress.d.ts.map