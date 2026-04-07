/**
 * Cloud Runner Provisioning — Render API integration.
 *
 * The gateway owns all infrastructure secrets (RENDER_API_KEY, TICLAW_GATEWAY_SECRET, etc.)
 * and exposes HTTP endpoints for controllers (Supen) to manage cloud runners.
 */
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
export declare function getCloudRunnerMeta(): {
    configured: boolean;
    imageUrl: null;
    gatewayUrl: null;
} | {
    configured: boolean;
    imageUrl: string;
    gatewayUrl: string;
};
export declare function listCloudRunners(): Promise<CloudRunnerRecord[]>;
export declare function launchCloudRunner(input: LaunchRunnerInput): Promise<{
    runner: CloudRunnerRecord;
    runnerId: string;
}>;
export declare function deleteCloudRunner(serviceId: string): Promise<void>;
//# sourceMappingURL=cloud-runners.d.ts.map