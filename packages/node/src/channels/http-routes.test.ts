import { describe, expect, it } from 'vitest';

import { buildNodeOpenApiSpec } from './http-routes.js';

describe('HTTP routes', () => {
  it('includes the session stop endpoint in the OpenAPI spec', () => {
    const spec = buildNodeOpenApiSpec() as any;
    const stopPath =
      spec.paths['/api/v1/agents/{agent_id}/sessions/{session_id}/stop'];

    expect(stopPath).toBeTruthy();
    expect(stopPath.post.summary).toBe('Stop active session run');
  });
});
