#!/usr/bin/env ts-node
/**
 * MCP Server: Scheduler
 * Specialized in task orchestration and recurring jobs.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { scheduleTools } from '../tools/schedules.js';
const server = new Server({
    name: "mcp-scheduler",
    version: "1.0.0",
}, {
    capabilities: { tools: {} }
});
const ctx = {
    agent_id: process.env.TIX_AGENT_ID || '',
    session_id: process.env.TIX_SESSION_ID || '',
    workspace: process.cwd()
};
server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
        {
            name: "create_schedule",
            description: "Submit a recurring task. Linked to your owner/agent identity.",
            inputSchema: {
                type: "object",
                properties: {
                    prompt: { type: "string", description: "Task description" },
                    cron: { type: "string", description: "Cron expression (e.g. '0 9 * * *')" }
                },
                required: ["prompt", "cron"]
            }
        },
        {
            name: "list_my_schedules",
            description: "Retrieve all your active recurring tasks.",
            inputSchema: { type: "object", properties: {} }
        }
    ]
}));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
        const handler = scheduleTools[name];
        if (!handler)
            throw new Error(`Tool not found: ${name}`);
        const result = await handler(ctx, args || {});
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
    catch (err) {
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
});
const transport = new StdioServerTransport();
await server.connect(transport);
//# sourceMappingURL=mcp-scheduler.js.map