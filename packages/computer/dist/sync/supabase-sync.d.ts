/**
 * Supabase sync layer for Tix (Phase 1: sync mode).
 * Local-first: all reads/writes stay local; Supabase is updated in the background.
 * Connectivity and latency to Supabase do not affect normal operation.
 */
/** Returns true if Supabase sync is configured AND explicitly enabled via SUPABASE_SYNC_ENABLED. */
export declare function isSupabaseConfigured(): boolean;
/** Schedule a debounced push to Supabase. Safe to call frequently. */
export declare function scheduleSupabasePush(): void;
/** Start periodic push (e.g. every 5 min) to catch group file changes. Call once at startup. */
export declare function startPeriodicSupabasePush(): void;
/** Push local state to Supabase. Runs in background; never throws to caller. */
export declare function pushToSupabase(): Promise<void>;
/** Pull from Supabase into local SQLite and files. Best-effort: if Supabase is unreachable, agent continues from last local copy. */
export declare function pullFromSupabase(): Promise<void>;
//# sourceMappingURL=supabase-sync.d.ts.map