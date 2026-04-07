/**
 * Tix System Tools - MCP Definitions.
 */
import { scheduleTools } from './schedules.js';
import { systemTools } from './system.js';
import { shellTools } from './shell.js';
export const BUILTIN_TOOLS_DEFINITION = [
    {
        name: 'create_schedule',
        description: 'Create a recurring task. The agent_id is automatically linked to your identity.',
        inputSchema: {
            type: 'object',
            properties: {
                prompt: { type: 'string', description: 'What the agent should do when triggered' },
                cron: { type: 'string', description: 'Standard cron expression (e.g. "0 9 * * *")' }
            },
            required: ['prompt', 'cron']
        },
        handler: scheduleTools.create_schedule
    },
    {
        name: 'list_my_schedules',
        description: 'Check all your currently active recurring tasks.',
        inputSchema: { type: 'object', properties: {} },
        handler: scheduleTools.list_my_schedules
    },
    {
        name: 'get_current_time',
        description: 'Get current system date, time and day of week.',
        inputSchema: { type: 'object', properties: {} },
        handler: systemTools.get_current_time
    },
    {
        name: 'run_system_command',
        description: 'Run a shell command in your workspace. Use for system inspection.',
        inputSchema: {
            type: 'object',
            properties: {
                command: { type: 'string', description: 'Shell command to execute' }
            },
            required: ['command']
        },
        handler: shellTools.run_command
    }
];
export const builtInTools = {
    ...scheduleTools,
    ...systemTools,
    ...shellTools
};
//# sourceMappingURL=index.js.map