/**
 * Feishu Card Renderer - Generates beautiful interactive cards for Lark.
 * Used for system status, command results, and agent updates.
 */
export declare class FeishuCardRenderer {
    /**
     * Generates a "System Status" card with online/offline indicators.
     */
    static renderStatusCard(bots: Array<{
        name: string;
        status: string;
        activity: string;
    }>): {
        config: {
            wide_screen_mode: boolean;
        };
        header: {
            template: string;
            title: {
                tag: string;
                content: string;
            };
        };
        elements: ({
            tag: string;
            text: {
                tag: string;
                content: string;
            };
            extra: {
                tag: string;
                text: {
                    tag: string;
                    content: string;
                };
                type: string;
                value: {
                    action: string;
                    appId: string;
                };
            };
        } | {
            tag: string;
            elements?: undefined;
        } | {
            tag: string;
            elements: {
                tag: string;
                content: string;
            }[];
        })[];
    };
}
//# sourceMappingURL=renderer.d.ts.map