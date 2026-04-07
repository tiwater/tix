/**
 * Cloud Node Provisioning — Render API integration.
 *
 * The gateway owns all infrastructure secrets (RENDER_API_KEY, TICLAW_GATEWAY_SECRET, etc.)
 * and exposes HTTP endpoints for controllers (Supen) to manage cloud nodes.
 */
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
export declare function getCloudNodeMeta(): {
    configured: boolean;
    imageUrl: null;
    gatewayUrl: null;
} | {
    configured: boolean;
    imageUrl: string;
    gatewayUrl: string;
};
export declare function listCloudNodes(): Promise<CloudNodeRecord[]>;
export declare function launchCloudNode(input: LaunchNodeInput): Promise<{
    node: CloudNodeRecord;
    nodeId: string;
}>;
export declare function deleteCloudNode(serviceId: string): Promise<void>;
//# sourceMappingURL=cloud-nodes.d.ts.map