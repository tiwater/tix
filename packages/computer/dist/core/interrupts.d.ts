export interface InterruptLikeMessage {
    content: string;
}
export declare function isUrgentInterruptMessage(content: string): boolean;
export declare function findLatestInterruptIndex<T extends InterruptLikeMessage>(messages: T[]): number;
export declare function trimMessagesAfterInterrupt<T extends InterruptLikeMessage>(messages: T[]): T[];
//# sourceMappingURL=interrupts.d.ts.map