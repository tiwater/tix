import { tick } from 'svelte';
import { goto } from '$app/navigation';

const isBrowser = typeof window !== 'undefined';
const API_KEY_STORAGE_KEY = 'ticlaw_http_api_key';

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
  session_count: number;
  last_active: string;
}

export interface SessionInfo {
  session_id: string;
  agent_id: string;
  channel: string;
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

// --- Shared app state (Svelte 5 runes) ---
function createAppState() {
  let sseConnected = $state(false);
  let sseLog = $state<string[]>([]);
  let nodeInfo = $state<NodeInfo | null>(null);
  let nodeLoading = $state(false);

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

  let eventSource: EventSource | null = null;

  // --- SSE Helpers ---
  let lastLoggedCategory = '';
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

  // --- SSE Connection ---
  function connectSSE() {
    if (eventSource) { eventSource.close(); eventSource = null; }
    // Ensure we don't accidentally pass a full JID as the session_id
    const rawSessionId = sessionId.startsWith('web:') ? sessionId.split(':').pop() || sessionId : sessionId;
    const url = `/runs/web-run/stream?agent_id=${encodeURIComponent(agentId)}&session_id=${encodeURIComponent(rawSessionId)}`;
    eventSource = new EventSource(url);

    eventSource.onopen = () => {
      sseConnected = true;
      addLog('SSE connected');
      fetchMessageHistory();
    };

    async function fetchMessageHistory() {
      try {
        const res = await fetch(`/api/messages?agent_id=${encodeURIComponent(agentId)}&session_id=${encodeURIComponent(sessionId)}&limit=50`);
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
            const targetStr = data.target ? ` → ${data.target}` : '';
            addLog(`🔧 ${data.tool}${targetStr}`);
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
        if (data.type === 'progress_end') { progressCategory = ''; lastLoggedCategory = ''; return; }

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

        if (data.type === 'runner_state') {
          if (data.status === 'idle' || data.activity?.phase === 'done' || data.status === 'error') {
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
    try { const res = await fetch('/api/skills'); if (res.ok) { const data = await res.json(); skills = data.skills || []; } } catch { /* */ }
    skillsLoading = false;
  }

  async function fetchAgents() {
    agentsLoading = true;
    try {
      const res = await fetch('/api/agents');
      if (res.ok) {
        const data = await res.json();
        agents = data.agents || [];
        // Fetch all sessions and group by agent
        const sessRes = await fetch('/api/sessions');
        if (sessRes.ok) {
          const sessData = await sessRes.json();
          const allSessions: SessionInfo[] = sessData.sessions || [];
          const grouped: Record<string, SessionInfo[]> = {};
          for (const agent of agents) {
            grouped[agent.agent_id] = allSessions.filter(s => s.agent_id === agent.agent_id);
          }
          agentSessions = grouped;
        }
      }
    } catch { /* */ }
    agentsLoading = false;
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

  async function fetchSchedules() {
    schedulesLoading = true;
    try { const res = await fetch('/api/schedules'); if (res.ok) { const data = await res.json(); schedules = data.schedules || []; } } catch { /* */ }
    schedulesLoading = false;
  }

  async function fetchNode() {
    nodeLoading = true;
    try { const res = await fetch('/api/node'); if (res.ok) { nodeInfo = await res.json(); } } catch { /* */ }
    nodeLoading = false;
  }

  async function trustNode() {
    try { const res = await fetch('/api/node/trust', { method: 'POST' }); if (res.ok) { await fetchNode(); addLog('Node trusted ✓'); } } catch { /* */ }
  }

  async function toggleSkill(name: string, enabled: boolean) {
    const action = enabled ? 'disable' : 'enable';
    try {
      const res = await fetch(`/api/skills/${encodeURIComponent(name)}/${action}`, { method: 'POST' });
      if (!res.ok) { const err = await res.json().catch(() => ({ detail: 'Unknown error' })); addLog(`⚠️ Skill ${action} failed: ${err.detail || err.message || 'Unknown error'}`); }
      await fetchSkills();
    } catch (e: any) { addLog(`⚠️ Skill ${action} failed: ${e.message}`); }
  }

  async function createAgent() {
    if (!newAgentName.trim()) return;
    try { const res = await fetch('/api/agents', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newAgentName.trim() }) }); if (res.ok) { newAgentName = ''; showNewAgent = false; await fetchAgents(); } } catch { /* */ }
  }

  async function createSession(agentIdOverride?: string) {
    const aid = agentIdOverride || newSessionAgentId;
    if (!aid) return;
    try { 
      const res = await fetch('/api/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agent_id: aid }) }); 
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
    try { await fetch(`/api/schedules/${encodeURIComponent(id)}/toggle`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: newStatus }) }); await fetchSchedules(); } catch { /* */ }
  }

  async function removeSchedule(id: string) {
    try { await fetch(`/api/schedules/${encodeURIComponent(id)}`, { method: 'DELETE' }); await fetchSchedules(); } catch { /* */ }
  }

  async function createSchedule(agentIdVal: string, prompt: string, cron: string) {
    if (!agentIdVal || !prompt || !cron) return;
    try {
      const res = await fetch('/api/schedules', {
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

      await fetch(`/api/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }); 
      if (sessionId === id) {
        if (nextSessionId && typeof window !== 'undefined') {
          goto(`/sessions/${nextSessionId}`);
        } else {
          sessionId = '';
          if (isBrowser) localStorage.removeItem('sessionId');
          messages = [];
          resetStreamingState();
          isThinking = false;
          progressCategory = '';
          disconnectSSE();
          if (typeof window !== 'undefined') {
            goto('/');
          }
        }
      }
    } catch { /* */ }
  }

  async function send() {
    const content = inputText.trim();
    if (!content || sending) return;
    messages = [...messages, { id: `user-${Date.now()}`, role: 'user', text: content, time: new Date().toLocaleTimeString() }];
    inputText = '';
    sending = true;
    isThinking = true;
    progressCategory = '';

    try {
      const res = await fetch('/runs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agent_id: agentId, session_id: sessionId, sender: 'web-user', content }) });
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
    agentId = sess.agent_id;
    if (isBrowser) localStorage.setItem('agentId', agentId);
    sessionId = sess.session_id;
    if (isBrowser) localStorage.setItem('sessionId', sessionId);
    messages = [];
    resetStreamingState();
    isThinking = false;
    progressCategory = '';
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
    get skillsLoading() { return skillsLoading; },
    get agentsLoading() { return agentsLoading; },
    get schedulesLoading() { return schedulesLoading; },
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

    // Methods
    connectSSE, disconnectSSE, addLog,
    fetchMind, fetchMindFiles, fetchSkills, fetchAgents,
    fetchSchedules, fetchNode, trustNode, toggleSkill,
    createAgent, createSession, createSchedule, toggleSchedule, removeSchedule, deleteSession,
    send, selectSession, reconnect, toggleAgentExpanded, sessionsForAgent,
    formatDate, formatShortDate,
    openAgentInspector(agentId: string) { inspectedAgentId = agentId; showAgentInspector = true; },
  };
}

export const appState = createAppState();
