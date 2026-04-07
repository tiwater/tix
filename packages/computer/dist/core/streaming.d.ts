export interface StreamState {
    streamId: string;
    nextSeq: number;
    fullText: string;
}
export interface StreamFrame {
    stream_id: string;
    seq: number;
    text: string;
    full_text: string;
}
export interface StreamCursor {
    streamId: string | null;
    lastSeq: number;
}
export declare function createStreamState(streamId: string): StreamState;
export declare function appendStreamChunk(state: StreamState, chunk: string): StreamFrame | null;
export declare function finishStream(state: StreamState, finalText: string): StreamFrame;
export declare function advanceStreamCursor(cursor: StreamCursor, event: Partial<Pick<StreamFrame, 'stream_id' | 'seq'>>): {
    isDuplicate: boolean;
    isNewStream: boolean;
};
export declare function resetStreamCursor(cursor: StreamCursor): void;
//# sourceMappingURL=streaming.d.ts.map