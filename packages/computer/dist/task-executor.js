/**
 * Task Executor - Sync Implementation using AgentComputer
 */
import { AgentComputer } from './core/computer.js';
import { logger } from './core/logger.js';
export async function executeTask(task) {
    try {
        const computer = new AgentComputer(task.agent_id, task.session_id, {
            onReply: async (text) => {
                logger.info({ taskId: task.id, text }, 'Task Reply');
            },
        });
        await computer.run([{ role: 'user', content: task.prompt }], task.id);
    }
    catch (err) {
        logger.error({ err }, 'Task Execution Failed');
    }
}
export function submitTask(input) {
    return { id: 'stub' };
}
export function getActiveTaskById(id) {
    return null;
}
export function listActiveTasks() {
    return [];
}
export function getExecutorStats() {
    return {};
}
//# sourceMappingURL=task-executor.js.map