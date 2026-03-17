import fs from 'fs';
import path from 'path';

import {
  SECURITY_ALLOW_INSECURE_REMOTE_ENDPOINTS,
  SECURITY_TRUSTED_REMOTE_HOSTS,
} from './config.js';

const MAX_PATH_SEGMENT_LENGTH = 128;

function normalizeHost(host: string): string {
  const lowered = host.trim().toLowerCase();
  if (lowered.startsWith('[') && lowered.endsWith(']')) {
    return lowered.slice(1, -1);
  }
  return lowered;
}

export function isLocalHost(host: string): boolean {
  const normalized = normalizeHost(host);
  return (
    normalized === 'localhost' ||
    normalized === '127.0.0.1' ||
    normalized === '::1'
  );
}

function matchesHostPattern(host: string, pattern: string): boolean {
  const normalizedHost = normalizeHost(host);
  const normalizedPattern = normalizeHost(pattern);
  if (!normalizedPattern) return false;
  if (normalizedPattern.startsWith('*.')) {
    const suffix = normalizedPattern.slice(2);
    return (
      normalizedHost === suffix || normalizedHost.endsWith(`.${suffix}`)
    );
  }
  return normalizedHost === normalizedPattern;
}

export function isTrustedRemoteHost(host: string): boolean {
  if (SECURITY_TRUSTED_REMOTE_HOSTS.length === 0) return true;
  return SECURITY_TRUSTED_REMOTE_HOSTS.some((pattern) =>
    matchesHostPattern(host, pattern),
  );
}

export function validateOutboundEndpoint(
  rawUrl: string,
  options: {
    allowedProtocols: string[];
    label: string;
  },
): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(
      `Invalid ${options.label}: ${JSON.stringify(rawUrl)} is not a valid URL.`,
    );
  }

  if (!options.allowedProtocols.includes(parsed.protocol)) {
    throw new Error(
      `Invalid ${options.label}: protocol "${parsed.protocol}" is not allowed. Expected one of: ${options.allowedProtocols.join(', ')}`,
    );
  }

  if (
    !SECURITY_ALLOW_INSECURE_REMOTE_ENDPOINTS &&
    (parsed.protocol === 'http:' || parsed.protocol === 'ws:') &&
    !isLocalHost(parsed.hostname)
  ) {
    throw new Error(
      `Refusing insecure ${options.label} "${parsed.origin}". Set SECURITY_ALLOW_INSECURE_REMOTE_ENDPOINTS=true to override.`,
    );
  }

  if (!isTrustedRemoteHost(parsed.hostname)) {
    throw new Error(
      `Refusing ${options.label} host "${parsed.hostname}". It is not in SECURITY_TRUSTED_REMOTE_HOSTS.`,
    );
  }

  return parsed;
}

export function assertSafePathSegment(
  input: string,
  label = 'path segment',
): string {
  const value = (input || '').trim();
  if (!value) {
    throw new Error(`Invalid ${label}: empty value.`);
  }
  if (value === '.' || value === '..') {
    throw new Error(`Invalid ${label}: "${value}" is not allowed.`);
  }
  if (
    value.includes('/') ||
    value.includes('\\') ||
    value.includes('\0') ||
    value.length > MAX_PATH_SEGMENT_LENGTH
  ) {
    throw new Error(`Invalid ${label}: "${value}" is not a safe segment.`);
  }
  return value;
}

export function resolveWithin(root: string, ...segments: string[]): string {
  const base = path.resolve(root);
  const candidate = path.resolve(base, ...segments);
  if (candidate === base || candidate.startsWith(`${base}${path.sep}`)) {
    return candidate;
  }
  throw new Error(`Path escapes allowed root: ${candidate} not under ${base}`);
}

export function isPathWithin(root: string, candidate: string): boolean {
  try {
    const resolvedRoot = path.resolve(root);
    const resolvedCandidate = fs.existsSync(candidate)
      ? fs.realpathSync(candidate)
      : path.resolve(candidate);
    return (
      resolvedCandidate === resolvedRoot ||
      resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`)
    );
  } catch {
    return false;
  }
}
