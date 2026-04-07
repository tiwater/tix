import { ToolContext } from './types.js';
export declare const shellTools: {
    /**
     * Run a simple shell command in the agent's assigned workspace.
     * This is a "First-class" skill that doesn't need external setup.
     */
    run_command(ctx: ToolContext, args: {
        command: string;
    }): Promise<{
        stdout: any;
        stderr: any;
        code: any;
    }>;
};
//# sourceMappingURL=shell.d.ts.map