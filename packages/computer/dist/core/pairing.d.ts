export type BindingKind = 'user' | 'chat';
export interface AgentBindingRecord {
    chat_jid: string;
    agent_id: string;
    kind: BindingKind;
    channel: string;
    pair_code?: string;
    approved_by?: string;
    created_at: string;
    updated_at: string;
}
export interface PendingPairingRecord {
    pair_code: string;
    chat_jid: string;
    requested_agent_id: string;
    kind: BindingKind;
    channel: string;
    status: 'pending' | 'approved' | 'expired';
    created_at: string;
    expires_at: string;
    approved_at?: string;
    approved_by?: string;
    bound_agent_id?: string;
}
/**
 * Derive the identity key used for pairing/binding lookups.
 *
 * For the web (HTTP) channel the full chat_jid has the shape
 * `web:<agentId>:<sessionId>`.  We strip the session suffix so the
 * binding granularity is `web:<agentId>` — once a web user is paired
 * to an agent, every session under that agent is automatically trusted.
 *
 * Other channels (Feishu, Discord…) already carry per-user identity in
 * the JID, so we return them unchanged.
 */
export declare function pairingIdentity(chatJid: string): string;
export declare function getBinding(chatJid: string): AgentBindingRecord | undefined;
export declare function listBindings(): AgentBindingRecord[];
export declare function listPendingPairings(): PendingPairingRecord[];
export declare function upsertBinding(input: {
    chatJid: string;
    agentId: string;
    approvedBy?: string;
    pairCode?: string;
}): AgentBindingRecord;
export declare function getPendingPairingByCode(code: string): PendingPairingRecord | undefined;
export declare function ensurePendingPairing(chatJid: string): PendingPairingRecord;
export declare function removeBinding(chatJid: string): boolean;
export declare function approvePairing(code: string, approvedBy: string, agentId?: string): PendingPairingRecord | null;
//# sourceMappingURL=pairing.d.ts.map