// Channel self-registration barrel file.
// Each import triggers the channel module's registerChannel() call.
// Channels self-register at startup; configure credentials in ~/.ticlaw/config.yaml.

// discord
import './discord.js';

// feishu (飞书)
import './feishu.js';

// acp / SSE bridge
import './acp.js';

// http / SSE (web UI)
import './http.js';

// hub-client
import './hub-client.js';

// gmail

// slack

// telegram

// whatsapp
