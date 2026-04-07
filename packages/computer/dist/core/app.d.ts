import { Dispatcher } from './dispatcher.js';
/**
 * TixApp: The central application instance.
 * Houses the global Dispatcher and manages system lifecycle.
 */
export declare class TixApp {
    private static instance;
    readonly dispatcher: Dispatcher;
    private initialized;
    private constructor();
    static getInstance(): TixApp;
    private listeners;
    on(event: string, fn: Function): void;
    emit(event: string, data: any): void;
    init(): Promise<void>;
}
export declare const app: TixApp;
//# sourceMappingURL=app.d.ts.map