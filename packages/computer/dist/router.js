export function stripInternalTags(text) {
    return text.replace(/<internal>[\s\S]*?<\/internal>/g, '').trim();
}
export function formatOutbound(rawText) {
    const text = stripInternalTags(rawText);
    if (!text)
        return '';
    return text;
}
export function routeOutbound(channels, jid, text, options) {
    const channel = channels.find((c) => c.ownsJid(jid) && c.isConnected());
    if (!channel)
        throw new Error(`No channel for JID: ${jid}`);
    return channel.sendMessage(jid, text, options);
}
export async function routeSendReturningId(channels, jid, text) {
    const channel = channels.find((c) => c.ownsJid(jid) && c.isConnected());
    if (!channel || !channel.sendMessageReturningId)
        return null;
    return channel.sendMessageReturningId(jid, text);
}
export async function routeEditMessage(channels, jid, messageId, text) {
    const channel = channels.find((c) => c.ownsJid(jid) && c.isConnected());
    if (channel && channel.editMessage) {
        await channel.editMessage(jid, messageId, text);
    }
}
export function routeOutboundFile(channels, jid, filePath, caption) {
    const channel = channels.find((c) => c.ownsJid(jid) && c.isConnected());
    if (!channel)
        throw new Error(`No channel for JID: ${jid}`);
    return channel.sendFile(jid, filePath, caption);
}
export function routeSetTyping(channels, jid, isTyping) {
    const channel = channels.find((c) => c.ownsJid(jid) && c.isConnected());
    if (channel && channel.setTyping) {
        return channel.setTyping(jid, isTyping);
    }
}
export function findChannel(channels, jid) {
    return channels.find((c) => c.ownsJid(jid));
}
//# sourceMappingURL=router.js.map