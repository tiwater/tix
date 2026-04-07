/**
 * Injected Context for Built-in Tools.
 * Guaranteed by the framework, cannot be spoofed by the Agent.
 */
export interface ToolContext {
    agent_id: string;
    session_id: string;
    workspace: string;
}
export type BuiltInToolHandler = (ctx: ToolContext, args: any) => Promise<any> | any;
//# sourceMappingURL=types.d.ts.map