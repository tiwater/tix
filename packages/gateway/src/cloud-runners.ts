/**
 * Cloud Runner Provisioning — Render API integration.
 *
 * The gateway owns all infrastructure secrets (RENDER_API_KEY, TICLAW_GATEWAY_SECRET, etc.)
 * and exposes HTTP endpoints for controllers (Supen) to manage cloud runners.
 */

const RENDER_API_BASE = 'https://api.render.com/v1';
const RUNNER_NAME_PREFIX = 'supen-runner-';

// ── Types ──

export type CloudRunnerTier = 'nano' | 'pro' | 'cluster';

export interface LaunchRunnerInput {
  name: string;
  tier: CloudRunnerTier;
  region: string;
  extraEnv?: Record<string, string>;
}

export interface CloudRunnerRecord {
  id: string;
  runnerId: string;
  name: string;
  slug: string;
  url: string | null;
  status: string;
  region: string | null;
  plan: string | null;
  tier: CloudRunnerTier | null;
  imageUrl: string | null;
  suspended: boolean;
  createdAt: string | null;
}

interface RenderConfig {
  apiKey: string;
  ownerId: string;
  imageUrl: string;
  gatewayUrl: string;
  gatewaySecret: string;
  registryCredentialId?: string;
}

const tierPlanMap: Record<CloudRunnerTier, { plan: string }> = {
  nano: { plan: 'starter' },
  pro: { plan: 'standard' },
  cluster: { plan: 'pro' },
};

// ── Config ──

function getConfig(): RenderConfig {
  const apiKey = process.env.RENDER_API_KEY;
  const ownerId = process.env.RENDER_OWNER_ID;
  const gatewayUrl = process.env.TICLAW_GATEWAY_EXTERNAL_URL || '';
  const gatewaySecret = process.env.TICLAW_GATEWAY_SECRET || '';
  const imageUrl = process.env.RENDER_RUNNER_IMAGE || 'ghcr.io/tiwater/ticlaw:latest';
  const registryCredentialId = process.env.RENDER_REGISTRY_CREDENTIAL_ID || undefined;

  if (!apiKey) throw new Error('Missing RENDER_API_KEY');
  if (!ownerId) throw new Error('Missing RENDER_OWNER_ID');

  return { apiKey, ownerId, imageUrl, gatewayUrl, gatewaySecret, registryCredentialId };
}

function isConfigured(): boolean {
  return !!(process.env.RENDER_API_KEY && process.env.RENDER_OWNER_ID);
}

// ── Helpers ──

function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

function normalizeGatewayWsUrl(url: string): string {
  const normalized = normalizeUrl(url.trim());
  if (!normalized) return '';
  if (normalized.startsWith('https://')) return `wss://${normalized.slice('https://'.length)}`;
  if (normalized.startsWith('http://')) return `ws://${normalized.slice('http://'.length)}`;
  return normalized;
}

function makeRandomSecret(length = 40): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

function createRunnerId(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const rand = Math.random().toString(36).slice(2, 8);
  return `${slug}-${rand}`;
}

function buildServiceName(runnerId: string): string {
  return `${RUNNER_NAME_PREFIX}${runnerId}`;
}

async function renderRequest<T>(path: string, init: RequestInit, apiKey: string): Promise<T> {
  const response = await fetch(`${RENDER_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });

  if (!response.ok) {
    let message: string;
    try {
      const payload = await response.json() as any;
      message = payload?.message || payload?.error || JSON.stringify(payload?.errors) || response.statusText;
    } catch {
      message = response.statusText || `HTTP ${response.status}`;
    }
    throw new Error(message);
  }

  if (response.status === 204) {
    return undefined as unknown as T;
  }

  return response.json() as Promise<T>;
}

function mapRenderService(service: any): CloudRunnerRecord {
  const serviceDetails = service.serviceDetails || service;
  const envVars = Array.isArray(service.envVars)
    ? service.envVars
    : Array.isArray(serviceDetails.envVars) ? serviceDetails.envVars : [];
  const envMap = Object.fromEntries(
    envVars.filter((e: any) => e?.key).map((e: any) => [e.key, e.value]),
  );

  const runnerId = envMap.TICLAW_RUNNER_NAME
    || (typeof service.name === 'string' && service.name.startsWith(RUNNER_NAME_PREFIX)
      ? service.name.slice(RUNNER_NAME_PREFIX.length)
      : service.id);

  const plan = service.plan || service.servicePlan || serviceDetails.plan || null;
  const tier = (Object.entries(tierPlanMap).find(([, meta]) => meta.plan === plan)?.[0] ?? null) as CloudRunnerTier | null;
  const url = serviceDetails.url || service.url || service.service?.url || null;
  // Derive a user-friendly status
  const isSuspended = service.suspended === 'suspended' || service.suspended === true;
  const deployStatus = serviceDetails.deployStatus || service.service?.serviceDetails?.deployStatus || '';
  let status: string;
  if (isSuspended) {
    status = 'suspended';
  } else if (deployStatus === 'live') {
    status = 'live';
  } else if (deployStatus === 'deactivated' || deployStatus === 'failed') {
    status = deployStatus;
  } else if (deployStatus === 'suspended') {
    // Render uses 'suspended' as initial deployStatus before first build — treat as deploying
    status = 'deploying';
  } else if (deployStatus) {
    status = deployStatus;
  } else {
    status = 'active';
  }

  return {
    id: service.id,
    runnerId,
    name: service.name || runnerId,
    slug: service.slug || service.name || runnerId,
    url,
    status,
    region: service.region || serviceDetails.region || null,
    plan,
    tier,
    imageUrl: serviceDetails.image?.url || null,
    suspended: isSuspended,
    createdAt: service.createdAt || null,
  };
}

// ── Public API ──

export function getCloudRunnerMeta() {
  if (!isConfigured()) return { configured: false, imageUrl: null, gatewayUrl: null };
  const config = getConfig();
  return {
    configured: true,
    imageUrl: config.imageUrl,
    gatewayUrl: config.gatewayUrl,
  };
}

export async function listCloudRunners(): Promise<CloudRunnerRecord[]> {
  if (!isConfigured()) return [];
  const config = getConfig();
  const raw = await renderRequest<any>('/services', { method: 'GET' }, config.apiKey);
  const items: any[] = Array.isArray(raw) ? raw : Array.isArray(raw?.services) ? raw.services : [];
  const services = items.map((item: any) => item.service || item);

  return services
    .filter((svc: any) => {
      const name = svc?.name || '';
      if (name === 'ticlaw-gateway') return false;
      return name.includes('ticlaw') || name.startsWith(RUNNER_NAME_PREFIX);
    })
    .map(mapRenderService);
}

export async function launchCloudRunner(input: LaunchRunnerInput): Promise<{ runner: CloudRunnerRecord; runnerId: string }> {
  const config = getConfig();
  const runnerId = createRunnerId(input.name);
  const imageUrl = normalizeUrl(config.imageUrl);
  const gatewayUrl = normalizeGatewayWsUrl(config.gatewayUrl);
  if (!gatewayUrl) {
    throw new Error('Missing TICLAW_GATEWAY_EXTERNAL_URL: cannot provision cloud runner without gateway URL');
  }

  const callerEnv = input.extraEnv || {};
  const envVars = Object.entries({
    TICLAW_RUNNER_NAME: runnerId,
    TICLAW_GATEWAY_URL: gatewayUrl,
    HTTP_API_KEY: callerEnv.HTTP_API_KEY || makeRandomSecret(),
    ...(config.gatewaySecret ? { TICLAW_GATEWAY_SECRET: config.gatewaySecret } : {}),
    ...callerEnv,
  }).map(([key, value]) => ({ key, value: String(value), sync: false }));

  const plan = tierPlanMap[input.tier].plan;
  const imageBlock: Record<string, string> = { imagePath: imageUrl };
  if (config.registryCredentialId) {
    imageBlock.registryCredentialId = config.registryCredentialId;
  }

  const payload = {
    ownerId: config.ownerId,
    type: 'web_service',
    name: buildServiceName(runnerId),
    image: imageBlock,
    envVars,
    serviceDetails: {
      runtime: 'image',
      plan,
      region: input.region.trim(),
      numInstances: 1,
      healthCheckPath: '/health',
      autoDeploy: 'no',
    },
  };

  const created = await renderRequest<any>('/services', {
    method: 'POST',
    body: JSON.stringify(payload),
  }, config.apiKey);

  return {
    runner: mapRenderService(created.service || created),
    runnerId,
  };
}

export async function deleteCloudRunner(serviceId: string): Promise<void> {
  const config = getConfig();
  await renderRequest<any>(`/services/${serviceId}`, { method: 'DELETE' }, config.apiKey);
}
