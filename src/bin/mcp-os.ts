#!/usr/bin/env ts-node
/**
 * MCP Server: OS
 * Specialized in system metadata, execution, and identity.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { systemTools } from '../tools/system.js';
import { shellTools } from '../tools/shell.js';

const server = new Server({
  name: "mcp-os",
  version: "1.0.0",
}, {
  capabilities: { tools: {} }
});

const ctx = {
  agent_id: process.env.TICLAW_AGENT_ID || '',
  session_id: process.env.TICLAW_SESSION_ID || '',
  workspace: process.cwd()
};

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "get_current_time",
      description: "Get real-time system date, time, and timezone.",
      inputSchema: { type: "object", properties: {} }
    },
    {
      name: "get_system_status",
      description: "Get OS info, memory utilization, and uptime.",
      inputSchema: { type: "object", properties: {} }
    },
    {
      name: "run_system_command",
      description: "Execute a shell command in the agent workspace with safety constraints.",
      inputSchema: {
        type: "object",
        properties: {
          command: { type: "string", description: "Bash command" }
        },
        required: ["command"]
      }
    }
  ]
}));

const handlers: any = { ...systemTools, ...shellTools };

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    const handler = handlers[name];
    if (!handler) throw new Error(`Tool not found: ${name}`);
    
    const result = await handler(ctx, args || {});
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (err: any) {
    return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
