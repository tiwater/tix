/**
 * Command Hub - Central registry for Slash Commands in Tix.
 * Handles rapid command execution without LLM latency.
 */
export interface CommandResponse {
    type: 'text' | 'card';
    content: string;
    data?: any;
}
export declare class CommandHub {
    private static commands;
    /** Register core system commands */
    static init(): void;
    static register(name: string, handler: (args: string[]) => Promise<CommandResponse>): void;
    /** New: Expose all registered command names */
    static getCommandNames(): string[];
    /**
     * Main Dispatcher: Checks if text is a slash command
     */
    static tryExecute(text: string): Promise<CommandResponse | null>;
}
//# sourceMappingURL=command-hub.d.ts.map