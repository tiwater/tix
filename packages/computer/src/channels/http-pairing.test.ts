import { describe, expect, it } from 'vitest';
import { buildNodeOpenApiSpec } from './http-routes.js';

describe('HTTP pairing OpenAPI schema', () => {
  it('includes structured success schemas for pairing endpoints', () => {
    const spec = buildNodeOpenApiSpec() as any;
    const paths = spec.paths;

    const listSchema = paths['/api/v1/pairings'].get.responses['200'].content['application/json'].schema;
    expect(listSchema.required).toContain('bindings');
    expect(listSchema.required).toContain('pending');
    expect(listSchema.properties.pending.items.properties.status.enum).toEqual([
      'pending',
      'approved',
      'expired',
    ]);

    const approveSchema = paths['/api/v1/pairings/approve'].post.responses['200'].content['application/json'].schema;
    expect(approveSchema.required).toContain('pairing');
    expect(approveSchema.required).toContain('binding');
    expect(approveSchema.properties.binding.properties.kind.enum).toEqual(['user', 'chat']);

    const deleteSchema = paths['/api/v1/pairings'].delete.responses['200'].content['application/json'].schema;
    expect(deleteSchema.required).toEqual(['ok', 'removed', 'chat_jid']);
  });
});
