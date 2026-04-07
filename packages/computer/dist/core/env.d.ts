/** A model definition within a provider entry in config.yaml. */
export interface ProviderModelDef {
    /** Model name sent to the LLM API (e.g. "claude-3-5-sonnet-latest"). */
    name: string;
    /** Human-friendly display name (optional). */
    display_name?: string;
    /** Per-model pricing overrides from config.yaml. */
    pricing?: {
        input_usd_per_1m: number;
        output_usd_per_1m: number;
    };
}
/**
 * Expanded model entry — one per (provider, model) pair.
 * Flattened from the config.yaml `providers` array at startup.
 */
export interface ModelEntry {
    /** Composite key: "provider_id:model_name" — uniquely identifies this configuration. */
    id: string;
    /** Provider identifier (e.g. "babelark", "anthropic"). */
    provider_id: string;
    /** Provider API key. */
    api_key: string;
    /** Provider base URL. */
    base_url: string;
    /** Model name sent to the API. */
    model: string;
    /** Human-friendly display name. */
    display_name?: string;
    /** If true, this is the default model. First in list wins if none marked default. */
    default?: boolean;
    /** Per-provider pricing for this model. */
    pricing?: {
        input_usd_per_1m: number;
        output_usd_per_1m: number;
    };
}
declare const TIX_CONFIG_PATH: string;
/**
 * Read config values from ~/.tix/config.yaml.
 * Returns a flat key-value map using env-style keys.
 * Creates a default config template on first run.
 */
export declare function readConfigYaml(keys: string[]): Record<string, string>;
/**
 * Read config values from ~/.tix/config.yaml.
 * Runtime priority is still enforced by callers as: process.env -> config.yaml.
 * This function does NOT mutate process.env.
 */
export declare function readEnvFile(keys: string[]): Record<string, string>;
/** Path to the YAML config file */
export { TIX_CONFIG_PATH };
/**
 * Read the models registry from config.yaml `providers` array.
 *
 * Each provider entry contains API credentials and a list of models.
 * This function expands them into a flat list of `ModelEntry` objects,
 * each with a composite key `"provider_id:model_name"`.
 *
 * Returns entries in list order. Fallback order = list order.
 */
export declare function readModelsConfig(): ModelEntry[];
/**
 * Returns channel names enabled in config.yaml.
 * Config-driven: only channels with a config block and enabled !== false are started.
 * Credentials can come from config or env; the channel factory returns null if missing.
 * If no channels are configured, returns [] and index falls back to all registered.
 */
export declare function getEnabledChannelsFromConfig(): string[];
//# sourceMappingURL=env.d.ts.map