export interface GatewayConfig {
    gateway_url?: string;
    trust_token?: string;
    reporting_interval?: number;
}
/**
 * Default gateway URLs used by the Gateway class when no URL is configured.
 * Exported so callers can apply them explicitly rather than having readGatewayConfig
 * silently inject a value.
 */
export declare const DEFAULT_GATEWAY_URL_DEV = "ws://127.0.0.1:2755";
export declare const DEFAULT_GATEWAY_URL_PROD = "wss://tix-gateway.onrender.com";
export declare function readGatewayConfig(): GatewayConfig;
export declare function writeGatewayConfig(config: GatewayConfig): void;
//# sourceMappingURL=gateway-config.d.ts.map