export function createStreamState(streamId) {
    return {
        streamId,
        nextSeq: 1,
        fullText: '',
    };
}
export function appendStreamChunk(state, chunk) {
    if (!chunk)
        return null;
    state.fullText += chunk;
    return {
        stream_id: state.streamId,
        seq: state.nextSeq++,
        text: chunk,
        full_text: state.fullText,
    };
}
export function finishStream(state, finalText) {
    state.fullText = finalText;
    return {
        stream_id: state.streamId,
        seq: state.nextSeq++,
        text: finalText,
        full_text: finalText,
    };
}
export function advanceStreamCursor(cursor, event) {
    const streamId = typeof event.stream_id === 'string' && event.stream_id.trim()
        ? event.stream_id
        : null;
    const seq = typeof event.seq === 'number' ? event.seq : null;
    if (!streamId || seq === null) {
        return {
            isDuplicate: false,
            isNewStream: false,
        };
    }
    const isNewStream = streamId !== cursor.streamId;
    if (!isNewStream && seq <= cursor.lastSeq) {
        return {
            isDuplicate: true,
            isNewStream: false,
        };
    }
    cursor.streamId = streamId;
    cursor.lastSeq = seq;
    return {
        isDuplicate: false,
        isNewStream,
    };
}
export function resetStreamCursor(cursor) {
    cursor.streamId = null;
    cursor.lastSeq = 0;
}
//# sourceMappingURL=streaming.js.map