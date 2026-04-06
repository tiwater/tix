#!/usr/bin/env ts-node
/**
 * Tix System Tools CLI.
 * Injected into Agent context to provide built-in capabilities.
 */
import { builtInTools } from '../tools/index.js';
import { logger } from '../core/logger.js';

async function main() {
  const [,, toolName, ...args] = process.argv;
  
  const ctx = {
    agent_id: process.env.TIX_AGENT_ID || '',
    session_id: process.env.TIX_SESSION_ID || '',
    workspace: process.cwd()
  };

  if (!toolName) {
    console.log('Usage: tix-sys <tool_name> [args_json]');
    process.exit(1);
  }

  const handler = (builtInTools as any)[toolName];
  if (!handler) {
    console.error(`Unknown system tool: ${toolName}`);
    process.exit(1);
  }

  try {
    const parsedArgs = args.length > 0 ? JSON.parse(args[0]) : {};
    const result = await handler(ctx, parsedArgs);
    console.log(JSON.stringify(result, null, 2));
  } catch (err: any) {
    console.error(JSON.stringify({ error: err.message }, null, 2));
    process.exit(1);
  }
}

main().catch(err => {
  logger.error({ err }, 'tix-sys crash');
  process.exit(1);
});
