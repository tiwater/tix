/**
 * Cloud Computer Provisioning — Render API integration.
 *
 * The gateway owns all infrastructure secrets (RENDER_API_KEY, TIX_GATEWAY_SECRET, etc.)
 * and exposes HTTP endpoints for controllers (Supen) to manage cloud computers.
 */
export type CloudComputerTier = 'nano' | 'pro' | 'cluster';
export interface LaunchComputerInput {
    name: string;
    tier: CloudComputerTier;
    region: string;
    extraEnv?: Record<string, string>;
}
export interface CloudComputerRecord {
    id: string;
    computerId: string;
    name: string;
    slug: string;
    url: string | null;
    status: string;
    region: string | null;
    plan: string | null;
    tier: CloudComputerTier | null;
    imageUrl: string | null;
    suspended: boolean;
    createdAt: string | null;
}
export declare function getCloudComputerMeta(): {
    configured: boolean;
    imageUrl: null;
    gatewayUrl: null;
} | {
    configured: boolean;
    imageUrl: string;
    gatewayUrl: string;
};
export declare function listCloudComputers(): Promise<CloudComputerRecord[]>;
export declare function launchCloudComputer(input: LaunchComputerInput): Promise<{
    computer: CloudComputerRecord;
    computerId: string;
}>;
export declare function deleteCloudComputer(serviceId: string): Promise<void>;
//# sourceMappingURL=cloud-computers.d.ts.map