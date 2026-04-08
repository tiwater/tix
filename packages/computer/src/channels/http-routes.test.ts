import { describe, expect, it } from 'vitest';

import { buildComputerOpenApiSpec } from './http-routes.js';

describe('HTTP routes', () => {
  it('includes the session stop endpoint in the OpenAPI spec', () => {
    const spec = buildComputerOpenApiSpec() as any;
    const stopPath =
      spec.paths['/api/v1/agents/{agent_id}/sessions/{session_id}/stop'];

    expect(stopPath).toBeTruthy();
    expect(stopPath.post.summary).toBe('Stop active session run');
  });

  it('marks nullable pairing fields consistently in OpenAPI schemas', () => {
    const spec = buildComputerOpenApiSpec() as any;
    const listResponse =
      spec.paths['/api/v1/pairings'].get.responses['200'].content[
        'application/json'
      ].schema;
    const approveResponse =
      spec.paths['/api/v1/pairings/approve'].post.responses['200'].content[
        'application/json'
      ].schema;

    expect(
      listResponse.properties.pending.items.properties.approved_at.nullable,
    ).toBe(true);
    expect(
      listResponse.properties.pending.items.properties.approved_by.nullable,
    ).toBe(true);
    expect(
      listResponse.properties.pending.items.properties.bound_agent_id.nullable,
    ).toBe(true);
    expect(approveResponse.properties.binding.properties.pair_code.nullable).toBe(
      true,
    );
    expect(
      approveResponse.properties.binding.properties.approved_by.nullable,
    ).toBe(true);
  });
});
