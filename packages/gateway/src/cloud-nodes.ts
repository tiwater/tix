import crypto from 'node:crypto';

/**
 * Cloud Node Provisioning — Render API integration.
 *
 * The gateway owns all infrastructure secrets (RENDER_API_KEY, GATEWAY_SECRET, etc.)
 * and exposes HTTP endpoints for controllers (Supen) to manage cloud nodes.
 */

const RENDER_API_BASE = 'https://api.render.com/v1';
const MANAGED_BY = 'supen';
const NODE_NAME_PREFIX = 'supen-node-';

// ── Types ──

export type CloudNodeTier = 'nano' | 'pro' | 'cluster';

export interface LaunchNodeInput {
  name: string;
  tier: CloudNodeTier;
  region: string;
  extraEnv?: Record<string, string>;
}

export interface CloudNodeRecord {
  id: string;
  nodeId: string;
  name: string;
  slug: string;
  url: string | null;
  status: string;
  region: string | null;
  plan: string | null;
  tier: CloudNodeTier | null;
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

const tierPlanMap: Record<CloudNodeTier, { plan: string }> = {
  nano: { plan: 'starter' },
  pro: { plan: 'standard' },
  cluster: { plan: 'pro' },
};

// ── Config ──

function getConfig(): RenderConfig {
  const apiKey = process.env.RENDER_API_KEY;
  const ownerId = process.env.RENDER_OWNER_ID;
  const gatewayUrl = process.env.GATEWAY_EXTERNAL_URL || process.env.RENDER_EXTERNAL_URL || '';
  const gatewaySecret = process.env.GATEWAY_SECRET || '';
  const imageUrl = process.env.RENDER_NODE_IMAGE || 'ghcr.io/tiwater/ticlaw:latest';
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

function createNodeId(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const rand = Math.random().toString(36).slice(2, 8);
  return `${slug}-${rand}`;
}

function buildServiceName(nodeId: string): string {
  return `${NODE_NAME_PREFIX}${nodeId}`;
}

function createHttpApiKey(): string {
  return crypto.randomBytes(24).toString('hex');
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

function mapRenderService(service: any): CloudNodeRecord {
  const serviceDetails = service.serviceDetails || service;
  const envVars = Array.isArray(service.envVars)
    ? service.envVars
    : Array.isArray(serviceDetails.envVars) ? serviceDetails.envVars : [];
  const envMap = Object.fromEntries(
    envVars.filter((e: any) => e?.key).map((e: any) => [e.key, e.value]),
  );

  const nodeId = envMap.SUPEN_NODE_ID
    || envMap.TICLAW_NODE_ID
    || (typeof service.name === 'string' && service.name.startsWith(NODE_NAME_PREFIX)
      ? service.name.slice(NODE_NAME_PREFIX.length)
      : service.id);

  const plan = service.plan || service.servicePlan || serviceDetails.plan || null;
  const tier = (Object.entries(tierPlanMap).find(([, meta]) => meta.plan === plan)?.[0] ?? null) as CloudNodeTier | null;
  const url = serviceDetails.url || service.url || service.service?.url || null;
  // Derive a user-friendly status
  const isSuspended = service.suspended === 'suspended' || service.suspended === true;
  const deployStatus = serviceDetails.deployStatus || service.service?.serviceDetails?.deployStatus || '';
  let status: string;
  if (
    deployStatus === 'suspended' ||
    deployStatus === 'created' ||
    deployStatus === 'build_in_progress' ||
    deployStatus === 'update_in_progress'
  ) {
    // Render uses 'suspended' before first build, and others during deploys — treat as deploying
    status = 'deploying';
  } else if (isSuspended) {
    status = 'suspended';
  } else if (deployStatus === 'live') {
    status = 'live';
  } else if (deployStatus === 'deactivated' || deployStatus === 'failed' || deployStatus === 'canceled') {
    status = deployStatus;
  } else if (deployStatus) {
    status = deployStatus;
  } else {
    status = 'active';
  }

  return {
    id: service.id,
    nodeId,
    name: service.name || nodeId,
    slug: service.slug || service.name || nodeId,
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

export function getCloudNodeMeta() {
  if (!isConfigured()) return { configured: false, imageUrl: null, gatewayUrl: null };
  const config = getConfig();
  return {
    configured: true,
    imageUrl: config.imageUrl,
    gatewayUrl: config.gatewayUrl,
  };
}

export async function listCloudNodes(): Promise<CloudNodeRecord[]> {
  if (!isConfigured()) return [];
  const config = getConfig();
  const raw = await renderRequest<any>('/services?limit=100', { method: 'GET' }, config.apiKey);
  const items: any[] = Array.isArray(raw) ? raw : Array.isArray(raw?.services) ? raw.services : [];
  const services = items.map((item: any) => item.service || item);

  return services
    .filter((svc: any) => {
      const name = svc?.name || '';
      if (name === 'ticlaw-gateway') return false;
      return name.includes('ticlaw') || name.startsWith(NODE_NAME_PREFIX);
    })
    .map(mapRenderService);
}

export async function launchCloudNode(input: LaunchNodeInput): Promise<{ node: CloudNodeRecord; nodeId: string }> {
  const config = getConfig();
  const nodeId = createNodeId(input.name);
  const imageUrl = normalizeUrl(config.imageUrl);
  const gatewayUrl = normalizeUrl(config.gatewayUrl);
  const nodeRoute = `${gatewayUrl}/api/gateway/nodes/${nodeId}`;
  const httpApiKey =
    typeof input.extraEnv?.HTTP_API_KEY === 'string' && input.extraEnv.HTTP_API_KEY.trim()
      ? input.extraEnv.HTTP_API_KEY.trim()
      : createHttpApiKey();

  const envVars = Object.entries({
    SUPEN_MANAGED_BY: MANAGED_BY,
    SUPEN_NODE_ID: nodeId,
    TICLAW_NODE_ID: nodeId,
    NODE_ID: nodeId,
    TICLAW_GATEWAY_URL: gatewayUrl,
    SUPEN_GATEWAY_URL: gatewayUrl,
    TICLAW_GATEWAY_NODE_URL: nodeRoute,
    SUPEN_GATEWAY_NODE_URL: nodeRoute,
    SUPEN_NODE_NAME: input.name,
    TICLAW_NODE_NAME: input.name,
    HTTP_API_KEY: httpApiKey,
    ...(config.gatewaySecret ? { GATEWAY_SECRET: config.gatewaySecret } : {}),
    ...(input.extraEnv || {}),
  }).map(([key, value]) => ({ key, value, sync: false }));

  const plan = tierPlanMap[input.tier].plan;
  const imageBlock: Record<string, string> = { imagePath: imageUrl };
  if (config.registryCredentialId) {
    imageBlock.registryCredentialId = config.registryCredentialId;
  }

  const payload = {
    ownerId: config.ownerId,
    type: 'web_service',
    name: buildServiceName(nodeId),
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
    node: mapRenderService(created.service || created),
    nodeId,
  };
}

export async function deleteCloudNode(serviceId: string): Promise<void> {
  const config = getConfig();
  await renderRequest<any>(`/services/${serviceId}`, { method: 'DELETE' }, config.apiKey);
}
