import { describe, expect, it } from 'vitest';

import {
  advanceStreamCursor,
  appendStreamChunk,
  createStreamState,
  finishStream,
  resetStreamCursor,
} from './streaming.js';

describe('streaming helpers', () => {
  it('builds monotonic stream frames with cumulative text', () => {
    const state = createStreamState('chat:run-1');

    expect(appendStreamChunk(state, 'Hello')).toEqual({
      stream_id: 'chat:run-1',
      seq: 1,
      text: 'Hello',
      full_text: 'Hello',
    });

    expect(appendStreamChunk(state, ' world')).toEqual({
      stream_id: 'chat:run-1',
      seq: 2,
      text: ' world',
      full_text: 'Hello world',
    });

    expect(finishStream(state, 'Hello world!')).toEqual({
      stream_id: 'chat:run-1',
      seq: 3,
      text: 'Hello world!',
      full_text: 'Hello world!',
    });
  });

  it('tracks stream boundaries and drops stale frames', () => {
    const cursor = { streamId: null, lastSeq: 0 };

    expect(
      advanceStreamCursor(cursor, {
        stream_id: 'stream-a',
        seq: 1,
      }),
    ).toEqual({
      isDuplicate: false,
      isNewStream: true,
    });

    expect(
      advanceStreamCursor(cursor, {
        stream_id: 'stream-a',
        seq: 1,
      }),
    ).toEqual({
      isDuplicate: true,
      isNewStream: false,
    });

    expect(
      advanceStreamCursor(cursor, {
        stream_id: 'stream-a',
        seq: 2,
      }),
    ).toEqual({
      isDuplicate: false,
      isNewStream: false,
    });

    expect(
      advanceStreamCursor(cursor, {
        stream_id: 'stream-b',
        seq: 1,
      }),
    ).toEqual({
      isDuplicate: false,
      isNewStream: true,
    });
  });

  it('can reset cursor state between sessions', () => {
    const cursor = { streamId: 'stream-a', lastSeq: 7 };

    resetStreamCursor(cursor);

    expect(cursor).toEqual({
      streamId: null,
      lastSeq: 0,
    });
  });
});
