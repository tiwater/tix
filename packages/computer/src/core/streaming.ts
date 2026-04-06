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

export function createStreamState(streamId: string): StreamState {
  return {
    streamId,
    nextSeq: 1,
    fullText: '',
  };
}

export function appendStreamChunk(
  state: StreamState,
  chunk: string,
): StreamFrame | null {
  if (!chunk) return null;

  state.fullText += chunk;
  return {
    stream_id: state.streamId,
    seq: state.nextSeq++,
    text: chunk,
    full_text: state.fullText,
  };
}

export function finishStream(
  state: StreamState,
  finalText: string,
): StreamFrame {
  state.fullText = finalText;
  return {
    stream_id: state.streamId,
    seq: state.nextSeq++,
    text: finalText,
    full_text: finalText,
  };
}

export function advanceStreamCursor(
  cursor: StreamCursor,
  event: Partial<Pick<StreamFrame, 'stream_id' | 'seq'>>,
): {
  isDuplicate: boolean;
  isNewStream: boolean;
} {
  const streamId =
    typeof event.stream_id === 'string' && event.stream_id.trim()
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

export function resetStreamCursor(cursor: StreamCursor): void {
  cursor.streamId = null;
  cursor.lastSeq = 0;
}
