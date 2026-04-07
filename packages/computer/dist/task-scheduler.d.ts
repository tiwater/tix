import type { RegisteredProject, NewMessage } from './core/types.js';
export interface SchedulerDependencies {
    registeredProjects: () => Record<string, RegisteredProject>;
    enqueueMessage: (chatJid: string, msg: NewMessage) => void;
}
export declare function forceSchedulerCheck(): void;
export declare function startSchedulerLoop(_deps: SchedulerDependencies): void;
export declare function _resetSchedulerLoopForTests(): void;
//# sourceMappingURL=task-scheduler.d.ts.map