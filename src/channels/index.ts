// Channel self-registration barrel file.
// Each import triggers the channel module's registerChannel() call.

// discord
import './discord.js';

// feishu (飞书)
import './feishu/index.js';

// dingtalk (钉钉)
import './dingtalk/index.js';

// acp / SSE bridge
import './acp.js';

// http / SSE (web UI)
import './http.js';

// hub-client
import './hub-client.js';
