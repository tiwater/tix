/**
 * Controlled Built-in Shell Executor.
 * Directly using Host Exec but with Agent-specific restrictions.
 */
import { exec } from 'child_process';
import { promisify } from 'util';
import { logger } from '../core/logger.js';
const execAsync = promisify(exec);
export const shellTools = {
    /**
     * Run a simple shell command in the agent's assigned workspace.
     * This is a "First-class" skill that doesn't need external setup.
     */
    async run_command(ctx, args) {
        if (!ctx.workspace) {
            throw new Error('Workspace is not properly initialized for this agent');
        }
        try {
            logger.info({ agent_id: ctx.agent_id, command: args.command }, 'Executing built-in shell command');
            const { stdout, stderr } = await execAsync(args.command, {
                cwd: ctx.workspace,
                timeout: 15_000, // 15s limit for safety
                env: {
                    ...process.env,
                    AGENT_ID: ctx.agent_id,
                    SESSION_ID: ctx.session_id,
                    WORKSPACE_PATH: ctx.workspace
                }
            });
            return {
                stdout: stdout.trim(),
                stderr: stderr.trim(),
                code: 0
            };
        }
        catch (err) {
            return {
                stdout: err.stdout || '',
                stderr: err.stderr || err.message,
                code: err.code || 1
            };
        }
    }
};
//# sourceMappingURL=shell.js.map