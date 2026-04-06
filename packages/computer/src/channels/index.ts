// Channel self-registration barrel file.
// Each import triggers the channel module's registerChannel() call.
// Channels self-register at startup; configure credentials in ~/.tix/config.yaml.

// discord
import './discord.js';

// feishu (飞书)
import './feishu/index.js';

// acp / SSE bridge
import './acp.js';

// http / SSE (web UI)
import './http.js';


// gmail

// slack

// telegram

// whatsapp
