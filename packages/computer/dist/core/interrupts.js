const INTERRUPT_PATTERNS = [
    /^\s*\/?(?:stop|interrupt|cancel)\s*[.!?]*\s*$/i,
    /^\s*(?:please\s+)?(?:stop|interrupt|cancel)(?:\s+(?:it|this|now|please))?\s*[.!?]*\s*$/i,
    /^\s*(?:wait|hold on)\s*[.!?]*\s*$/i,
    /^\s*(?:停止|打断|取消|等一下|等等|停下)(?:一下)?[。！？!?.\s]*$/u,
];
export function isUrgentInterruptMessage(content) {
    const text = (content || '').trim();
    if (!text)
        return false;
    return INTERRUPT_PATTERNS.some((pattern) => pattern.test(text));
}
export function findLatestInterruptIndex(messages) {
    let latestIndex = -1;
    for (let i = 0; i < messages.length; i++) {
        if (isUrgentInterruptMessage(messages[i]?.content || '')) {
            latestIndex = i;
        }
    }
    return latestIndex;
}
export function trimMessagesAfterInterrupt(messages) {
    const latestInterruptIndex = findLatestInterruptIndex(messages);
    return latestInterruptIndex >= 0
        ? messages.slice(latestInterruptIndex + 1)
        : messages;
}
//# sourceMappingURL=interrupts.js.map