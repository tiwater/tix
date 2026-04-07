export type ComputerTrustState = 'discovered_untrusted' | 'pending_verification' | 'trusted' | 'suspended' | 'revoked';
export interface EnrollmentState {
    computer_id: string;
    computer_fingerprint: string;
    trust_state: ComputerTrustState;
    token_hash?: string;
    token_salt?: string;
    token_expires_at?: string;
    token_created_at?: string;
    token_used_at?: string;
    failed_attempts: number;
    frozen_until?: string;
    trusted_at?: string;
    revoked_at?: string;
    suspended_at?: string;
    updated_at: string;
}
export declare function readEnrollmentState(computerId?: string): EnrollmentState;
export declare function writeEnrollmentState(state: EnrollmentState): void;
export declare function createEnrollmentToken(opts?: {
    ttlMinutes?: number;
    computerId?: string;
}): {
    token: string;
    expires_at: string;
    computer_id: string;
    computer_fingerprint: string;
};
export declare function verifyEnrollmentToken(input: {
    token: string;
    computerFingerprint: string;
    computerId?: string;
}): {
    ok: boolean;
    code: 'ok' | 'missing_token' | 'not_pending' | 'frozen' | 'expired' | 'computer_fingerprint_mismatch' | 'token_mismatch';
    state: EnrollmentState;
};
export declare function setTrustState(target: ComputerTrustState, opts?: {
    computerId?: string;
}): EnrollmentState;
//# sourceMappingURL=enrollment.d.ts.map