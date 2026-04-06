import { query } from "./node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs";
async function run() {
  const q = query({
    prompt: "Count from 1 to 5 slowly",
    options: { 
      cwd: process.cwd(), 
      pathToClaudeCodeExecutable: "/Users/hugh/tc/tix/node_modules/@anthropic-ai/claude-agent-sdk/cli.js", 
      env: { ...process.env, ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || "dummy" }
    }
  });
  for await (const msg of await q) {
    if (msg.type === "stream_event" && msg.event?.delta?.text) {
      console.log("DELTA:", JSON.stringify(msg.event.delta.text));
    }
  }
}
run().catch(console.error);
