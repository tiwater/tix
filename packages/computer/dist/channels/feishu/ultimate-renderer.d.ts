/**
 * Tix Ultimate Feishu Card Renderer
 * Designed to provide better-than-OpenTix visual experience.
 */
export declare class UltimateFeishuRenderer {
    /**
     * Status Card with Dashboard look
     */
    static renderDashboard(bots: any[]): {
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
            flex_mode: string;
            background_style: string;
            columns: {
                tag: string;
                width: string;
                weight: number;
                elements: ({
                    tag: string;
                    text: {
                        tag: string;
                        content: string;
                    };
                    actions?: undefined;
                } | {
                    tag: string;
                    actions: ({
                        tag: string;
                        text: {
                            tag: string;
                            content: string;
                        };
                        type: string;
                        value: {
                            action: string;
                            id: any;
                        };
                        confirm?: undefined;
                    } | {
                        tag: string;
                        text: {
                            tag: string;
                            content: string;
                        };
                        type: string;
                        confirm: {
                            title: {
                                tag: string;
                                content: string;
                            };
                            text: {
                                tag: string;
                                content: string;
                            };
                        };
                        value: {
                            action: string;
                            id: any;
                        };
                    })[];
                    text?: undefined;
                })[];
            }[];
            text?: undefined;
        } | {
            tag: string;
            flex_mode?: undefined;
            background_style?: undefined;
            columns?: undefined;
            text?: undefined;
        } | {
            tag: string;
            text: {
                tag: string;
                content: string;
            };
            flex_mode?: undefined;
            background_style?: undefined;
            columns?: undefined;
        })[];
    };
}
//# sourceMappingURL=ultimate-renderer.d.ts.map