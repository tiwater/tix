import { describe, it, expect } from 'vitest';
import {
  deriveHttpSenderIdentity,
  getHttpSecurityPosture,
  isOriginAllowed,
  requiresAdminApiAccess,
  resolveHttpAdminContextFromInput,
} from './http.js';

describe('HTTP security guards', () => {
  it('requires admin auth for legacy and v1 api endpoints', () => {
    expect(requiresAdminApiAccess('/runs', 'POST')).toBe(true);
    expect(requiresAdminApiAccess('/api/v1/agents', 'GET')).toBe(true);
    expect(requiresAdminApiAccess('/api/agents', 'GET')).toBe(true);
    expect(requiresAdminApiAccess('/health', 'GET')).toBe(false);
    expect(requiresAdminApiAccess('/api/v1/agents', 'OPTIONS')).toBe(false);
  });

  it('matches api key inputs when explicitly provided', () => {
    expect(resolveHttpAdminContextFromInput('secret-123', false, 'secret-123')).toMatchObject({
      actor: 'http-api-key',
      isAdmin: true,
    });
    expect(resolveHttpAdminContextFromInput('wrong', false, 'secret-123')).toBeNull();
    expect(resolveHttpAdminContextFromInput(null, true, 'secret-123')).toBeNull();
  });

  it('falls back to loopback-only admin when no API key is configured', () => {
    const prev = process.env.HTTP_API_KEY;
    delete process.env.HTTP_API_KEY;
    try {
      expect(resolveHttpAdminContextFromInput(null, true, '')).toMatchObject({
        actor: 'http-loopback',
        isAdmin: true,
      });
      expect(resolveHttpAdminContextFromInput(null, false, '')).toBeNull();
    } finally {
      if (prev !== undefined) process.env.HTTP_API_KEY = prev;
    }
  });

  it('derives sender identity from authenticated context instead of trusting payload values', () => {
    expect(
      deriveHttpSenderIdentity({ actor: 'http-api-key', isAdmin: true, approveLevel3: true }),
    ).toEqual({ sender: 'http-api-key', sender_name: 'HTTP API Client' });
    expect(
      deriveHttpSenderIdentity({ actor: 'http-loopback', isAdmin: true, approveLevel3: true }),
    ).toEqual({ sender: 'http-loopback', sender_name: 'Local HTTP Admin' });
  });

  it('disables wildcard CORS by default when no allowlist is configured', () => {
    const prev = process.env.ALLOWED_ORIGINS;
    delete process.env.ALLOWED_ORIGINS;
    try {
      expect(isOriginAllowed('https://example.com')).toBe(false);
    } finally {
      if (prev !== undefined) process.env.ALLOWED_ORIGINS = prev;
    }
  });

  it('reports dev-loopback posture warnings when HTTP API key is missing', () => {
    expect(
      getHttpSecurityPosture({
        httpEnabled: true,
        httpApiKey: '',
        allowedOrigins: '',
      }),
    ).toEqual({
      mode: 'dev_loopback_only',
      warnings: [
        'HTTP_API_KEY is not configured; admin/API access falls back to loopback-only local development mode.',
        'HTTP listener is restricted to 127.0.0.1 until HTTP_API_KEY is configured.',
        'Do not expose this node beyond localhost without setting HTTP_API_KEY.',
        'ALLOWED_ORIGINS is not configured; browser origins are denied by default.',
      ],
      bindHost: '127.0.0.1',
    });
  });

  it('reports protected posture when HTTP API key is configured', () => {
    expect(
      getHttpSecurityPosture({
        httpEnabled: true,
        httpApiKey: 'secret-123',
        allowedOrigins: '^https://app\\.example\\.com$',
      }),
    ).toEqual({
      mode: 'protected',
      warnings: [],
      bindHost: undefined,
    });
  });
});
