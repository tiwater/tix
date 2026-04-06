import { tick } from 'svelte';
import { goto } from '$app/navigation';

const isBrowser = typeof window !== 'undefined';
const API_KEY_STORAGE_KEY = 'tix_http_api_key';

function getStoredApiKey(): string {
  if (!isBrowser) return '';
  try {
    return (localStorage.getItem(API_KEY_STORAGE_KEY) || '').trim();
  } catch {
    return '';
  }
}

function withApiKeyQuery(rawUrl: string): string {
  const apiKey = getStoredApiKey();
  if (!apiKey) return rawUrl;
  const separator = rawUrl.includes('?') ? '&' : '?';
  return `${rawUrl}${separator}api_key=${encodeURIComponent(apiKey)}`;
}

function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers || {});
  const apiKey = getStoredApiKey();
  if (apiKey && !headers.has('X-API-Key')) {
    headers.set('X-API-Key', apiKey);
  }
  return fetch(input, { ...init, headers });
}

// --- Types ---
export type Tab = 'chat' | 'sessions' | 'schedules' | 'skills' | 'node';

export interface Message {
  id: string;
  role: 'user' | 'bot' | 'system';
  text: string;
  time: string;
  streaming?: boolean;
  showRaw?: boolean;
}

export interface MindState {
  id: string;
  version: number;
  lifecycle: string;
  persona: { tone?: string; verbosity?: string; emoji?: boolean };
  memory_summary: string;
  updated_at: string;
}

export interface WorkspaceFile {
  content: string;
  mtimeMs: number;
  updatedRecently?: boolean;
}

export interface SkillInfo {
  name: string;
  version: string;
  description: string;
  source: string;
  installed: boolean;
  enabled: boolean;
  status?: 'discovered' | 'installed_disabled' | 'installed_enabled';
  runtimeUsable?: boolean;
  permissionLevel: number;
  directory: string;
  diagnostics: string[];
}

export interface AgentInfo {
  agent_id: string;
  name?: string;
  session_count: number;
  last_active: string;
  model?: string;
}

export interface ModelInfo {
  id: string;
  model: string;
  base_url?: string;
  default?: boolean;
}

export interface SessionInfo {
  session_id: string;
  agent_id: string;
  channel: string;
  title?: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface ScheduleInfo {
  id: string;
  agent_id: string;
  prompt: string;
  cron: string;
  status: string;
  next_run: string | null;
  created_at: string;
}

export interface NodeInfo {
  hostname: string;
  skills?: {
    total_available: number;
  };
  enrollment: {
    trust_state: string;
    fingerprint: string;
    trusted_at: string | null;
    failed_attempts: number;
  };
  executor: {
    active_tasks?: number;
    queued_tasks?: number;
    total_slots?: number;
  };
  os?: {
    platform: string;
    arch: string;
    cpus: number;
    cpu_model: string;
    load_avg: number[];
    mem_total: number;
    mem_free: number;
    mem_used: number;
    uptime: number;
  };
}

export interface UsageEntry {
  tokens_in: number;
  tokens_out: number;
  tokens_total: number;
  estimated_cost_usd: number;
}

export interface DailyUsageModel {
  total: UsageEntry;
  sessions: Record<string, UsageEntry & { agent_id: string; agent_name?: string }>;
}

export interface DailyUsageDay {
  total: UsageEntry;
  models: Record<string, DailyUsageModel>;
}

export type DailyUsageLedger = Record<string, DailyUsageDay>;

// --- Shared app state (Svelte 5 runes) ---
function createAppState() {
  let sseConnected = $state(false);
  let sseLog = $state<string[]>([]);
  let nodeInfo = $state<NodeInfo | null>(null);
  let nodeLoading = $state(false);
  let dailyUsage = $state<DailyUsageLedger>({});
  let dailyUsageLoading = $state(false);

  // Chat state
  let agentId = $state(isBrowser ? (localStorage.getItem('agentId') || 'web-agent') : 'web-agent');
  let sessionId = $state(isBrowser ? (localStorage.getItem('sessionId') || 'web-session') : 'web-session');
  let inputText = $state('');
  let messages = $state<Message[]>([]);
  let mindState = $state<MindState | null>(null);
  let mindFiles = $state<Record<string, WorkspaceFile>>({});
  let sending = $state(false);
  let isThinking = $state(false);

  let progressCategory = $state<string>('');
  let progressSkill = $state<string | undefined>(undefined);
  let progressTool = $state<string | undefined>(undefined);
  let progressArgs = $state<string | undefined>(undefined);
  let progressElapsed = $state(0);
  let streamingMessageId: string | null = $state(null);
  let activeStreamId = $state<string | null>(null);
  let lastStreamSeq = $state(0);

  // Tab data
  let skills = $state<SkillInfo[]>([]);
  let agents = $state<AgentInfo[]>([]);
  let agentSessions = $state<Record<string, SessionInfo[]>>({});
  let expandedAgents = $state<Set<string>>(new Set());
  let schedules = $state<ScheduleInfo[]>([]);
  let models = $state<ModelInfo[]>([]);
  let skillsLoading = $state(false);
  let agentsLoading = $state(false);
  let schedulesLoading = $state(false);

  // Modals
  let showNewAgent = $state(false);
  let showNewSession = $state(false);
  let showNewAutomation = $state(false);
  let showAgentInspector = $state(false);
  let inspectedAgentId = $state('');
  let newAgentName = $state('');
  let newSessionAgentId = $state('');

  // File uploads
  interface PendingFile {
    file: File;
    name: string;
    uploading: boolean;
    tixUrl?: string;
  }
  let pendingFiles = $state<PendingFile[]>([]);

  function addFiles(files: FileList | File[]) {
    const arr = Array.from(files);
    pendingFiles = [...pendingFiles, ...arr.map(f => ({ file: f, name: f.name, uploading: false }))];
  }

  function removeFile(index: number) {
    pendingFiles = pendingFiles.filter((_, i) => i !== index);
  }

  async function uploadPendingFiles(): Promise<{ refs: string[]; names: string[] }> {
    if (pendingFiles.length === 0) return { refs: [], names: [] };
    const refs: string[] = [];
    const names: string[] = [];
    const toUpload = [...pendingFiles];
    pendingFiles = toUpload.map(f => ({ ...f, uploading: true }));

    // Convert files to base64 for JSON transport (works through gateway relay)
    const filesPayload: { name: string; data: string }[] = [];
    for (const pf of toUpload) {
      names.push(pf.name);
      const buf = await pf.file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = '';
      const chunkSize = 8192;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
      }
      const base64 = btoa(binary);
      filesPayload.push({ name: pf.name, data: base64 });
    }

    try {
      const res = await fetch(`/api/workspace/upload?agent_id=${encodeURIComponent(agentId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: filesPayload }),
      });
      if (res.ok) {
        const data = await res.json();
        for (const f of data.files || []) {
          refs.push(f.tixUrl);
        }
      } else {
        const errText = await res.text().catch(() => '');
        messages = [...messages, { id: `err-${Date.now()}`, role: 'system', text: `⚠️ File upload failed (${res.status}): ${errText}`, time: '' }];
      }
    } catch (e: any) {
      messages = [...messages, { id: `err-${Date.now()}`, role: 'system', text: `⚠️ File upload error: ${e.message || 'Network error'}`, time: '' }];
    }

    pendingFiles = [];
    return { refs, names };
  }

  let eventSource: EventSource | null = null;

  // --- SSE Helpers ---
  let lastLoggedCategory = '';
  let lastLoggedTool = '';
  function addLog(msg: string) {
    sseLog = [...sseLog.slice(-29), `${new Date().toLocaleTimeString()} ${msg}`];
  }

  function advanceStreamEvent(data: { stream_id?: string; seq?: number }): { isDuplicate: boolean; isNewStream: boolean } {
    const sid = typeof data.stream_id === 'string' && data.stream_id.trim() ? data.stream_id : null;
    const seq = typeof data.seq === 'number' ? data.seq : null;
    if (!sid || seq === null) return { isDuplicate: false, isNewStream: false };
    const isNew = sid !== activeStreamId;
    if (!isNew && seq <= lastStreamSeq) return { isDuplicate: true, isNewStream: false };
    activeStreamId = sid;
    lastStreamSeq = seq;
    return { isDuplicate: false, isNewStream: isNew };
  }

  function resetStreamingState() {
    streamingMessageId = null;
    activeStreamId = null;
    lastStreamSeq = 0;
  }

  function pushBotMessage(text: string, id?: string) {
    if (id && messages.some((m) => m.id === id)) return; // Strict deduplication
    messages = [...messages, { id: id || `bot-${Date.now()}`, role: 'bot', text, time: new Date().toLocaleTimeString() }];
  }

  // Strip any channel-prefix from a sessionId before using it in API paths.
  // A sessionId should never contain colons — if it does it has been accidentally
  // set to the full JID (e.g. "web:agent:session") and only the last segment is valid.
  function bareSessionId(sid: string): string {
    // Full JID format: "<prefix>:<agentId>:<sessionId>"
    // If we detect more than one colon we assume it's still a JID and take the last segment.
    const parts = sid.split(':');
    return parts.length >= 3 ? parts[parts.length - 1] : sid;
  }

  // --- SSE Connection ---
  function connectSSE() {
    if (eventSource) { eventSource.close(); eventSource = null; }
    const rawSessionId = bareSessionId(sessionId);
    const url = `/api/v1/agents/${encodeURIComponent(agentId)}/sessions/${encodeURIComponent(rawSessionId)}/stream`;
    eventSource = new EventSource(url);

    eventSource.onopen = () => {
      sseConnected = true;
      addLog('SSE connected');
      fetchMessageHistory();
    };

    async function fetchMessageHistory() {
      try {
        const res = await fetch(`/api/v1/agents/${encodeURIComponent(agentId)}/sessions/${encodeURIComponent(bareSessionId(sessionId))}/messages?limit=50`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.messages?.length > 0) {
          const history = data.messages.map((m: any) => ({
            id: m.id || `hist-${Math.random().toString(36).slice(2)}`,
            role: m.role === 'bot' ? 'bot' : m.role === 'user' ? 'user' : 'system',
            text: m.text || '',
            time: m.time || '',
          }));
          const historyIds = new Set(history.map((m: any) => m.id));
          const historyTexts = new Set(history.map((m: any) => m.text));
          messages = [
            ...history,
            ...messages.filter((m) => {
              if (m.id === 'welcome') return false;
              if (historyIds.has(m.id)) return false;
              if (m.role === 'bot' && m.id.startsWith('bot-')) return false; // discard temporary SSE bubbles
              if (m.role === 'user' && historyTexts.has(m.text)) return false; // discard local user bubbles now in DB
              return true;
            }),
          ];
        }
      } catch { /* ignore */ }
    }

    eventSource.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        if (data.type === 'connected') { addLog(`Session connected`); return; }
        if (data.type === 'progress') {
          progressCategory = data.category || '';
          progressSkill = data.skill;
          progressTool = data.tool;
          progressArgs = data.args || data.target;
          progressElapsed = data.elapsed_s || 0;
          if (!streamingMessageId) isThinking = true;

          // Log meaningful progress events (deduplicate consecutive thinking)
          if (data.category === 'skill' && data.skill) {
            const argStr = data.args ? ` → ${data.args}` : '';
            addLog(`⚡ Skill: ${data.skill}${argStr}`);
            lastLoggedCategory = 'skill';
          } else if (data.category === 'tool' && data.tool) {
            const toolKey = `${data.tool}|${data.target || ''}`;
            if (toolKey !== lastLoggedTool) {
              const targetStr = data.target ? ` → ${data.target}` : '';
              addLog(`🔧 ${data.tool}${targetStr}`);
              lastLoggedTool = toolKey;
            }
            lastLoggedCategory = 'tool';
          } else if (data.category === 'thinking' && lastLoggedCategory !== 'thinking') {
            addLog('💭 Thinking…');
            lastLoggedCategory = 'thinking';
          } else if (data.category === 'error') {
            addLog('⚠️ Recovering from error…');
            lastLoggedCategory = 'error';
          } else if (data.category === 'formatting' && lastLoggedCategory !== 'formatting') {
            addLog('📝 Formatting response…');
            lastLoggedCategory = 'formatting';
          }
          return;
        }
        if (data.type === 'progress_end') { progressCategory = ''; lastLoggedCategory = ''; lastLoggedTool = ''; return; }

        if (data.type === 'stream_delta' && data.text) {
          const { isDuplicate, isNewStream } = advanceStreamEvent(data);
          if (isDuplicate) return;
          if (isThinking) { isThinking = false; progressCategory = ''; }
          if (isNewStream && streamingMessageId) {
            messages = messages.map((m) => m.id === streamingMessageId ? { ...m, streaming: false } : m);
          }
          if (isNewStream) streamingMessageId = null;

          const currentText = streamingMessageId ? messages.find((m) => m.id === streamingMessageId)?.text || '' : '';
          const nextText = typeof data.full_text === 'string' ? data.full_text : currentText + data.text;

          if (streamingMessageId) {
            messages = messages.map((m) => m.id === streamingMessageId ? { ...m, text: nextText, streaming: true } : m);
          } else {
            streamingMessageId = `bot-${Date.now()}`;
            messages = [...messages, { id: streamingMessageId, role: 'bot', text: nextText, time: new Date().toLocaleTimeString(), streaming: true }];
          }
          return;
        }

        if (data.type === 'computer_state') {
          if (data.agent_id && data.session_id) {
            const nextStatus =
              data.status === 'busy'
                ? 'running'
                : data.status === 'error'
                  ? 'error'
                  : 'idle';
            updateSessionLocal(data.agent_id, data.session_id, { status: nextStatus });
          }

          if (data.status === 'interrupted') {
            if (streamingMessageId) {
              messages = messages.map((m) =>
                m.id === streamingMessageId ? { ...m, streaming: false } : m,
              );
              resetStreamingState();
            }
            if (isThinking) { isThinking = false; progressCategory = ''; }
            addLog('⏹️ Task stopped');
            lastLoggedCategory = '';
            return;
          }

          if (data.status === 'idle' || data.activity?.phase === 'done' || data.status === 'error') {
            if (streamingMessageId && data.status === 'error') {
              messages = messages.map((m) =>
                m.id === streamingMessageId ? { ...m, streaming: false } : m,
              );
              resetStreamingState();
            }
            if (isThinking) { isThinking = false; progressCategory = ''; }
            addLog(data.status === 'error' ? '❌ Task failed' : '✅ Task completed');
            lastLoggedCategory = '';
          } else if (data.activity?.action === 'speaking' && data.activity?.target) {
            if (isThinking) { isThinking = false; progressCategory = ''; }
          }
          return;
        }

        // stream_end: backward compat — just mark streaming as done
        if (data.type === 'stream_end') {
          if (isThinking) { isThinking = false; progressCategory = ''; }
          return;
        }

        if (data.type === 'session_updated' && data.session && data.session.session_id) {
          const updated = { ...agentSessions };
          let found = false;
          for (const aid in updated) {
            updated[aid] = updated[aid].map(s => {
              if (s.session_id === data.session.session_id) {
                found = true;
                return { ...s, ...data.session };
              }
              return s;
            });
          }
          if (found) agentSessions = updated;
          return;
        }

        // message: the authoritative final response or standalone file
        if (data.type === 'message' && data.text) {
          if (isThinking) { isThinking = false; progressCategory = ''; }

          if (data.is_file) {
            pushBotMessage(data.text, data.id);
            fetchMindFiles();
            return;
          }

          if (streamingMessageId) {
            // Streaming was active — replace with authoritative text
            messages = messages.map((m) => m.id === streamingMessageId ? { ...m, id: data.id || m.id, text: data.text, streaming: false } : m);
            resetStreamingState();
          } else {
            pushBotMessage(data.text, data.id);
          }
          fetchMindFiles();
          return;
        }
      } catch { /* ignore */ }
    };

    eventSource.onerror = () => { sseConnected = false; progressCategory = ''; addLog('SSE disconnected — retrying…'); };
  }

  function disconnectSSE() {
    eventSource?.close();
    eventSource = null;
    sseConnected = false;
    progressCategory = '';
  }

  // --- Data fetching ---
  async function fetchMind() {
    try {
      const res = await fetch(`/api/mind?agent_id=${encodeURIComponent(agentId)}`);
      mindState = await res.json();
    } catch {
      /* */
    }
  }

  async function fetchMindFiles() {
    try {
      const res = await fetch(
        `/api/mind/files?agent_id=${encodeURIComponent(agentId)}`,
      );
      if (!res.ok) return;
      const data = await res.json();
      if (data.files) {
        const newFiles = data.files as Record<string, WorkspaceFile>;
        for (const [name, file] of Object.entries(newFiles)) {
          if (mindFiles[name] && file.mtimeMs > mindFiles[name].mtimeMs) {
            file.updatedRecently = true;
            setTimeout(() => { if (mindFiles[name]) mindFiles[name].updatedRecently = false; }, 5000);
          }
        }
        mindFiles = newFiles;
      }
    } catch { /* */ }
  }

  async function fetchSkills() {
    skillsLoading = true;
    try { const res = await fetch('/api/v1/skills'); if (res.ok) { const data = await res.json(); skills = data.skills || []; } } catch { /* */ }
    skillsLoading = false;
  }

  async function fetchAgents() {
    agentsLoading = true;
    try {
      const res = await fetch('/api/v1/agents');
      if (res.ok) {
        const data = await res.json();
        agents = data.agents || [];
        // Fetch sessions per-agent using the nested route
        const grouped: Record<string, SessionInfo[]> = {};
        for (const agent of agents) {
          try {
            const sessRes = await fetch(`/api/v1/agents/${encodeURIComponent(agent.agent_id)}/sessions`);
            if (sessRes.ok) {
              const sessData = await sessRes.json();
              grouped[agent.agent_id] = sessData.sessions || [];
            } else {
              grouped[agent.agent_id] = [];
            }
          } catch {
            grouped[agent.agent_id] = [];
          }
        }
        agentSessions = grouped;
      }
    } catch { /* */ }
    agentsLoading = false;
  }

  async function fetchModels() {
    try { const res = await fetch('/api/v1/models'); if (res.ok) { const data = await res.json(); models = data.models || []; } } catch { /* */ }
  }

  async function updateAgentModel(agent_id: string, model: string | undefined) {
    try {
      const payload = { model: model || undefined };
      const res = await fetch(`/api/v1/agents/${encodeURIComponent(agent_id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        await fetchAgents();
      }
    } catch { /* */ }
  }

  function toggleAgentExpanded(agentId: string) {
    const next = new Set(expandedAgents);
    if (next.has(agentId)) next.delete(agentId);
    else next.add(agentId);
    expandedAgents = next;
  }

  function sessionsForAgent(agentId: string): SessionInfo[] {
    return agentSessions[agentId] || [];
  }

  function updateSessionLocal(
    agentIdValue: string,
    sessionIdValue: string,
    patch: Partial<SessionInfo>,
  ) {
    const sessions = agentSessions[agentIdValue];
    if (!sessions || sessions.length === 0) return;
    let changed = false;
    const next = sessions.map((session) => {
      if (session.session_id !== sessionIdValue) return session;
      changed = true;
      return { ...session, ...patch };
    });
    if (changed) {
      agentSessions = { ...agentSessions, [agentIdValue]: next };
    }
  }

  function findSession(id: string) {
    for (const sessions of Object.values(agentSessions)) {
      const found = sessions.find((s) => s.session_id === id);
      if (found) return found;
    }
    return undefined;
  }

  async function fetchSchedules() {
    schedulesLoading = true;
    try { const res = await fetch('/api/v1/schedules'); if (res.ok) { const data = await res.json(); schedules = data.schedules || []; } } catch { /* */ }
    schedulesLoading = false;
  }

  async function fetchDailyUsage() {
    dailyUsageLoading = true;
    try {
      const res = await fetch('/api/v1/usage/daily');
      if (res.ok) {
        const data = await res.json();
        dailyUsage = data.daily || {};
      }
    } catch { /* */ }
    dailyUsageLoading = false;
  }

  async function fetchNode() {
    nodeLoading = true;
    try { const res = await fetch('/api/v1/node'); if (res.ok) { nodeInfo = await res.json(); } } catch { /* */ }
    nodeLoading = false;
  }

  async function trustNode() {
    try { const res = await fetch('/api/v1/node/trust', { method: 'POST' }); if (res.ok) { await fetchNode(); addLog('Node trusted ✓'); } } catch { /* */ }
  }

  async function toggleSkill(name: string, enabled: boolean) {
    const action = enabled ? 'disable' : 'enable';
    try {
      const res = await fetch(`/api/v1/skills/${encodeURIComponent(name)}/${action}`, { method: 'POST' });
      if (!res.ok) { const err = await res.json().catch(() => ({ detail: 'Unknown error' })); addLog(`⚠️ Skill ${action} failed: ${err.detail || err.message || 'Unknown error'}`); }
      await fetchSkills();
    } catch (e: any) { addLog(`⚠️ Skill ${action} failed: ${e.message}`); }
  }

  async function createAgent() {
    if (!newAgentName.trim()) return;
    try { const res = await fetch('/api/v1/agents', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newAgentName.trim() }) }); if (res.ok) { newAgentName = ''; showNewAgent = false; await fetchAgents(); } } catch { /* */ }
  }

  async function createSession(agentIdOverride?: string) {
    const aid = agentIdOverride || newSessionAgentId;
    if (!aid) return;
    try { 
      const res = await fetch(`/api/v1/agents/${encodeURIComponent(aid)}/sessions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) }); 
      if (res.ok) { 
        const data = await res.json();
        showNewSession = false; 
        newSessionAgentId = ''; 
        // Insert into agentSessions
        const newSess = data.session as SessionInfo;
        agentSessions = { ...agentSessions, [aid]: [...(agentSessions[aid] || []), newSess] };
        // Auto-expand the agent folder
        if (!expandedAgents.has(aid)) {
          expandedAgents = new Set([...expandedAgents, aid]);
        }
        if (typeof window !== "undefined") {
          goto(`/sessions/${data.session.session_id}`);
        }
      } 
    } catch { /* */ }
  }

  async function toggleSchedule(id: string, currentStatus: string) {
    const newStatus = currentStatus === 'active' ? 'paused' : 'active';
    try { await fetch(`/api/v1/schedules/${encodeURIComponent(id)}/toggle`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: newStatus }) }); await fetchSchedules(); } catch { /* */ }
  }

  async function removeSchedule(id: string) {
    try { await fetch(`/api/v1/schedules/${encodeURIComponent(id)}`, { method: 'DELETE' }); await fetchSchedules(); } catch { /* */ }
  }

  async function createSchedule(agentIdVal: string, prompt: string, cron: string) {
    if (!agentIdVal || !prompt || !cron) return;
    try {
      const res = await fetch('/api/v1/schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent_id: agentIdVal, prompt, cron }),
      });
      if (res.ok) {
        showNewAutomation = false;
        await fetchSchedules();
      }
    } catch { /* */ }
  }

  async function deleteSession(id: string) {
    try {
      // Find which agent this session belongs to
      let ownerAgentId = '';
      let ownerSessions: SessionInfo[] = [];
      for (const [aid, sessions] of Object.entries(agentSessions)) {
        const idx = sessions.findIndex(s => s.session_id === id);
        if (idx !== -1) {
          ownerAgentId = aid;
          ownerSessions = sessions;
          break;
        }
      }

      // Find next session to navigate to
      let nextSessionId = '';
      if (ownerAgentId) {
        const idx = ownerSessions.findIndex(s => s.session_id === id);
        if (idx !== -1 && ownerSessions.length > 1) {
          const nextIdx = idx < ownerSessions.length - 1 ? idx + 1 : idx - 1;
          nextSessionId = ownerSessions[nextIdx].session_id;
        }
        // Remove from agentSessions
        agentSessions = { ...agentSessions, [ownerAgentId]: ownerSessions.filter(s => s.session_id !== id) };
      }

      // Use nested v1 route: DELETE /api/v1/agents/:agent_id/sessions/:session_id
      if (ownerAgentId) {
        await fetch(`/api/v1/agents/${encodeURIComponent(ownerAgentId)}/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });
      } else {
        await fetch(`/api/v1/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });
      } 

      // Check if we're currently viewing this session (use URL as source of truth)
      const isViewingDeleted = typeof window !== 'undefined' && 
        window.location.pathname === `/sessions/${id}`;

      if (isViewingDeleted || sessionId === id) {
        if (nextSessionId) {
          goto(`/sessions/${nextSessionId}`);
        } else {
          // No sibling session — search across all agents for any session
          let fallbackSessionId = '';
          for (const sessions of Object.values(agentSessions)) {
            if (sessions.length > 0) {
              fallbackSessionId = sessions[0].session_id;
              break;
            }
          }
          if (fallbackSessionId) {
            goto(`/sessions/${fallbackSessionId}`);
          } else {
            sessionId = '';
            if (isBrowser) localStorage.removeItem('sessionId');
            messages = [];
            resetStreamingState();
            isThinking = false;
            progressCategory = '';
            disconnectSSE();
            goto('/');
          }
        }
      }
    } catch { /* */ }
  }

  async function stopSession() {
    try {
      const res = await fetch(
        `/api/v1/agents/${encodeURIComponent(agentId)}/sessions/${encodeURIComponent(bareSessionId(sessionId))}/stop`,
        { method: 'POST' },
      );
      if (res.ok) {
        addLog('Stop requested');
        return true;
      }
      const err = await res.json().catch(() => null);
      messages = [
        ...messages,
        {
          id: `err-${Date.now()}`,
          role: 'system',
          text: `⚠️ Stop failed: ${err?.message || err?.error || res.status}`,
          time: '',
        },
      ];
    } catch (e: any) {
      messages = [
        ...messages,
        {
          id: `err-${Date.now()}`,
          role: 'system',
          text: `⚠️ ${e.message}`,
          time: '',
        },
      ];
    }
    return false;
  }

  async function send() {
    const content = inputText.trim();
    if ((!content && pendingFiles.length === 0) || sending) return;

    // Upload pending files first
    const { refs, names } = await uploadPendingFiles();

    // Build the content sent to the agent (includes tix:// paths)
    let fullContent = content;
    if (refs.length > 0) {
      const refLines = refs.map((url, i) => `[Attached file: ${names[i] || 'file'} → ${url}]`).join('\n');
      fullContent = fullContent ? `${refLines}\n\n${fullContent}` : refLines;
    }
    if (!fullContent) return;

    // Build the user-visible message (friendly file names)
    let displayContent = content;
    if (names.length > 0) {
      const fileChips = names.map(n => `📎 ${n}`).join('  ');
      displayContent = displayContent ? `${fileChips}\n${displayContent}` : fileChips;
    }

    messages = [...messages, { id: `user-${Date.now()}`, role: 'user', text: displayContent, time: new Date().toLocaleTimeString() }];
    inputText = '';
    sending = true;
    isThinking = true;
    progressCategory = '';

    try {
      const res = await fetch(`/api/v1/agents/${encodeURIComponent(agentId)}/sessions/${encodeURIComponent(bareSessionId(sessionId))}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sender: 'web-user', content: fullContent })
      });
      if (!res.ok) {
        isThinking = false; progressCategory = '';
        if (res.status === 403) {
          try {
            const errData = await res.json();
            if (errData.error === 'node_not_trusted') {
              messages = [...messages, { id: `err-${Date.now()}`, role: 'system', text: `🔒 Node is not trusted (${errData.trust_state}). Go to the Node tab and click "Trust this Node" to enable messaging.`, time: '' }];
            } else {
              messages = [...messages, { id: `err-${Date.now()}`, role: 'system', text: `⚠️ Forbidden: ${errData.error || res.status}`, time: '' }];
            }
          } catch { messages = [...messages, { id: `err-${Date.now()}`, role: 'system', text: `⚠️ POST failed: ${res.status}`, time: '' }]; }
        } else {
          messages = [...messages, { id: `err-${Date.now()}`, role: 'system', text: `⚠️ POST failed: ${res.status}`, time: '' }];
        }
      }
    } catch (e: any) {
      isThinking = false; progressCategory = '';
      messages = [...messages, { id: `err-${Date.now()}`, role: 'system', text: `⚠️ ${e.message}`, time: '' }];
    } finally { sending = false; }
  }

  function selectSession(sess: SessionInfo) {
    if (sessionId === sess.session_id) return; // already active — do nothing
    agentId = sess.agent_id;
    if (isBrowser) localStorage.setItem('agentId', agentId);
    sessionId = sess.session_id;
    if (isBrowser) localStorage.setItem('sessionId', sessionId);
    messages = [];
    resetStreamingState();
    isThinking = false;
    progressCategory = '';
    // Reconnect SSE to reload messages (fixes blank page when clicking active session)
    connectSSE();
  }

  function reconnect() {
    messages = [];
    resetStreamingState();
    isThinking = false;
    progressCategory = '';
    connectSSE();
  }

  // --- Formatters ---
  function formatDate(iso: string | null): string {
    if (!iso) return '—';
    try { const d = new Date(iso); return `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`; } catch { return iso; }
  }

  function formatShortDate(iso: string | null): string {
    if (!iso) return '—';
    try {
      const d = new Date(iso);
      const now = new Date();
      if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString();
      return `${d.getMonth() + 1}/${d.getDate()} ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
    } catch { return iso; }
  }

  return {
    // Getters (reactive)
    get sseConnected() { return sseConnected; },
    get sseLog() { return sseLog; },
    get nodeInfo() { return nodeInfo; },
    get nodeLoading() { return nodeLoading; },
    get agentId() { return agentId; },
    set agentId(v: string) { 
      agentId = v; 
      if (isBrowser) localStorage.setItem('agentId', v); 
    },
    get sessionId() { return sessionId; },
    set sessionId(v: string) { 
      sessionId = v; 
      if (isBrowser) localStorage.setItem('sessionId', v); 
    },
    get inputText() { return inputText; },
    set inputText(v: string) { inputText = v; },
    get messages() { return messages; },
    get mindState() { return mindState; },
    get mindFiles() { return mindFiles; },
    get sending() { return sending; },
    get isThinking() { return isThinking; },
    get progressCategory() { return progressCategory; },
    get progressSkill() { return progressSkill; },
    get progressTool() { return progressTool; },
    get progressArgs() { return progressArgs; },
    get progressElapsed() { return progressElapsed; },
    get skills() { return skills; },
    get agents() { return agents; },
    get agentSessions() { return agentSessions; },
    get expandedAgents() { return expandedAgents; },
    get schedules() { return schedules; },
    get models() { return models; },
    get skillsLoading() { return skillsLoading; },
    get agentsLoading() { return agentsLoading; },
    get schedulesLoading() { return schedulesLoading; },
    get dailyUsage() { return dailyUsage; },
    get dailyUsageLoading() { return dailyUsageLoading; },
    get showNewAgent() { return showNewAgent; },
    set showNewAgent(v: boolean) { showNewAgent = v; },
    get showNewSession() { return showNewSession; },
    set showNewSession(v: boolean) { showNewSession = v; },
    get showNewAutomation() { return showNewAutomation; },
    set showNewAutomation(v: boolean) { showNewAutomation = v; },
    get newAgentName() { return newAgentName; },
    set newAgentName(v: string) { newAgentName = v; },
    get newSessionAgentId() { return newSessionAgentId; },
    set newSessionAgentId(v: string) { newSessionAgentId = v; },
    get showAgentInspector() { return showAgentInspector; },
    set showAgentInspector(v: boolean) { showAgentInspector = v; },
    get inspectedAgentId() { return inspectedAgentId; },

    get pendingFiles() { return pendingFiles; },

    // Methods
    connectSSE, disconnectSSE, addLog,
    fetchMind, fetchMindFiles, fetchSkills, fetchAgents, fetchDailyUsage,
    fetchSchedules, fetchNode, trustNode, toggleSkill, fetchModels,
    createAgent, createSession, createSchedule, toggleSchedule, removeSchedule, deleteSession, stopSession,
    send, selectSession, reconnect, toggleAgentExpanded, sessionsForAgent, updateAgentModel,
    addFiles, removeFile,
    formatDate, formatShortDate,
    openAgentInspector(agentId: string) { inspectedAgentId = agentId; showAgentInspector = true; },
  };
}

export const appState = createAppState();
