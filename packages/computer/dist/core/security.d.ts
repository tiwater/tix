export declare function isLocalHost(host: string): boolean;
export declare function isTrustedRemoteHost(host: string): boolean;
export declare function validateOutboundEndpoint(rawUrl: string, options: {
    allowedProtocols: string[];
    label: string;
}): URL;
export declare function assertSafePathSegment(input: string, label?: string): string;
export declare function resolveWithin(root: string, ...segments: string[]): string;
export declare function isPathWithin(root: string, candidate: string): boolean;
//# sourceMappingURL=security.d.ts.map