/**
 * Tix Node — declarative route registry.
 *
 * This is the single source of truth for all HTTP routes. Both:
 *   1. The OpenAPI spec (GET /api/v1/openapi.json) is generated from here.
 *   2. Route matching in http.ts can reference ROUTES for consistency.
 *
 * Adding a new endpoint? Add an entry here. The spec updates automatically.
 */
export interface RouteParam {
    name: string;
    in: 'path' | 'query' | 'header';
    required?: boolean;
    type?: string;
    description?: string;
}
export interface RouteBody {
    description?: string;
    required?: boolean;
    /** Simplified JSON schema for the request body. */
    schema: Record<string, unknown>;
}
export interface RouteDef {
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    path: string;
    tag: string;
    summary: string;
    description?: string;
    params?: RouteParam[];
    body?: RouteBody;
    /** Simplified response description. */
    response?: string;
    /** Optional success response schema override for application/json. */
    responseSchema?: Record<string, unknown>;
}
export declare const ROUTES: RouteDef[];
/** Build an OpenAPI 3.0 paths object from ROUTES. */
export declare function buildNodePaths(): Record<string, unknown>;
/** Full OpenAPI spec for the node's HTTP API. */
export declare function buildNodeOpenApiSpec(opts?: {
    serverUrl?: string;
}): object;
//# sourceMappingURL=http-routes.d.ts.map