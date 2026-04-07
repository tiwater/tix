/**
 * Feishu (飞书 / Lark) message parsing helpers.
 * Adapted from OpenTix's robust Feishu implementation.
 */
export type PostParseResult = {
    textContent: string;
    imageKeys: string[];
    mediaKeys: Array<{
        fileKey: string;
        fileName?: string;
    }>;
    mentionedOpenIds: string[];
};
export declare function parsePostContent(content: string): PostParseResult;
export declare function parseMessageContent(content: string, type: string): string;
//# sourceMappingURL=helpers.d.ts.map