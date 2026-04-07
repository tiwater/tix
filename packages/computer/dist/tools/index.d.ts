export declare const BUILTIN_TOOLS_DEFINITION: ({
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            prompt: {
                type: string;
                description: string;
            };
            cron: {
                type: string;
                description: string;
            };
            command?: undefined;
        };
        required: string[];
    };
    handler: (ctx: import("./types.js").ToolContext, args: {
        prompt: string;
        cron: string;
    }) => Promise<{
        ok: boolean;
        message: string;
        schedule_id: string;
        agent_id: string;
        cron: string;
    }>;
} | {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            prompt?: undefined;
            cron?: undefined;
            command?: undefined;
        };
        required?: undefined;
    };
    handler: (ctx: import("./types.js").ToolContext) => Promise<{
        count: number;
        agent_id: string;
        items: {
            id: string;
            cron: string;
            prompt: string;
            status: "active" | "paused";
            next_run: string;
        }[];
    }>;
} | {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            prompt?: undefined;
            cron?: undefined;
            command?: undefined;
        };
        required?: undefined;
    };
    handler: () => Promise<{
        iso: string;
        local: string;
        timezone: string;
        day_of_week: string;
        timestamp: number;
    }>;
} | {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            command: {
                type: string;
                description: string;
            };
            prompt?: undefined;
            cron?: undefined;
        };
        required: string[];
    };
    handler: (ctx: import("./types.js").ToolContext, args: {
        command: string;
    }) => Promise<{
        stdout: any;
        stderr: any;
        code: any;
    }>;
})[];
export declare const builtInTools: {
    run_command(ctx: import("./types.js").ToolContext, args: {
        command: string;
    }): Promise<{
        stdout: any;
        stderr: any;
        code: any;
    }>;
    get_current_time(): Promise<{
        iso: string;
        local: string;
        timezone: string;
        day_of_week: string;
        timestamp: number;
    }>;
    get_system_status(): Promise<{
        platform: NodeJS.Platform;
        release: string;
        uptime: number;
        loadavg: number[];
        memory: {
            total_gb: number;
            used_percent: number;
        };
    }>;
    whoami(_args: any, context: {
        agent_id: string;
    }): Promise<{
        agent_id: string;
        description: string;
    }>;
    create_schedule(ctx: import("./types.js").ToolContext, args: {
        prompt: string;
        cron: string;
    }): Promise<{
        ok: boolean;
        message: string;
        schedule_id: string;
        agent_id: string;
        cron: string;
    }>;
    list_my_schedules(ctx: import("./types.js").ToolContext): Promise<{
        count: number;
        agent_id: string;
        items: {
            id: string;
            cron: string;
            prompt: string;
            status: "active" | "paused";
            next_run: string;
        }[];
    }>;
    delete_schedule(ctx: import("./types.js").ToolContext, args: {
        id: string;
    }): Promise<{
        ok: boolean;
        message: string;
    }>;
};
//# sourceMappingURL=index.d.ts.map