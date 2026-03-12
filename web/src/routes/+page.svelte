<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import '../app.css';

  // --- Config ---
  const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3280';

  // --- Types ---
  type Tab = 'chat' | 'sessions' | 'schedules' | 'skills' | 'claw';

  interface Message {
    id: string;
    role: 'user' | 'bot' | 'system';
    text: string;
    time: string;
    streaming?: boolean;
  }

  interface MindState {
    id: string;
    version: number;
    lifecycle: string;
    persona: { tone?: string; verbosity?: string; emoji?: boolean };
    memory_summary: string;
    updated_at: string;
  }

  interface WorkspaceFile {
    content: string;
    mtimeMs: number;
    updatedRecently?: boolean;
  }

  interface SkillInfo {
    name: string;
    version: string;
    description: string;
    source: string;
    installed: boolean;
    enabled: boolean;
    permissionLevel: number;
    directory: string;
    diagnostics: string[];
  }

  interface AgentInfo {
    agent_id: string;
    session_count: number;
    last_active: string;
  }

  interface SessionInfo {
    session_id: string;
    agent_id: string;
    channel: string;
    status: string;
    created_at: string;
    updated_at: string;
  }

  interface ScheduleInfo {
    id: string;
    agent_id: string;
    prompt: string;
    cron: string;
    status: string;
    next_run: string | null;
    created_at: string;
  }

  interface ClawInfo {
    hostname: string;
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
  }

  // --- State ---
  let activeTab = $state<Tab>('chat');
  let agentId = $state('web-agent');
  let sessionId = $state('web-session');
  let inputText = $state('');
  let messages = $state<Message[]>([]);
  let mindState = $state<MindState | null>(null);
  let sseConnected = $state(false);
  let sseLog = $state<string[]>([]);
  let sending = $state(false);
  let isThinking = $state(false);
  let mindFiles = $state<Record<string, WorkspaceFile>>({});

  // Tab data
  let skills = $state<SkillInfo[]>([]);
  let agents = $state<AgentInfo[]>([]);
  let sessions = $state<SessionInfo[]>([]);
  let schedules = $state<ScheduleInfo[]>([]);
  let clawInfo = $state<ClawInfo | null>(null);
  let selectedAgentId = $state<string | null>(null);

  let skillsLoading = $state(false);
  let agentsLoading = $state(false);
  let schedulesLoading = $state(false);
  let clawLoading = $state(false);

  // Modals
  let showNewAgent = $state(false);
  let showNewSession = $state(false);
  let showNewSchedule = $state(false);
  let newAgentName = $state('');
  let newSessionAgentId = $state('');
  let newScheduleAgentId = $state('');
  let newSchedulePrompt = $state('');
  let newScheduleCron = $state('');

  let messagesEl = $state<HTMLElement>(null!);
  let inputEl = $state<HTMLTextAreaElement>(null!);
  let eventSource: EventSource | null = null;

  const tabs: { id: Tab; icon: string; label: string }[] = [
    { id: 'claw', icon: '🦀', label: 'Claw' },
    { id: 'chat', icon: '💬', label: 'Chat' },
    { id: 'sessions', icon: '📂', label: 'Sessions' },
    { id: 'schedules', icon: '⏰', label: 'Schedules' },
    { id: 'skills', icon: '🧩', label: 'Skills' },
  ];

  // --- Tab switching ---
  function switchTab(tab: Tab) {
    activeTab = tab;
    if (tab === 'skills') fetchSkills();
    if (tab === 'sessions') fetchAgents();
    if (tab === 'schedules') fetchSchedules();
    if (tab === 'claw') fetchClaw();
  }

  // --- SSE ---
  function connectSSE() {
    if (eventSource) { eventSource.close(); eventSource = null; }
    const url = `${API_BASE}/runs/web-run/stream?agent_id=${encodeURIComponent(agentId)}&session_id=${encodeURIComponent(sessionId)}`;
    eventSource = new EventSource(url);

    eventSource.onopen = () => {
      sseConnected = true;
      addLog('SSE connected');
      fetchMessageHistory();
    };

    async function fetchMessageHistory() {
      try {
        const res = await fetch(`${API_BASE}/api/messages?agent_id=${encodeURIComponent(agentId)}&session_id=${encodeURIComponent(sessionId)}&limit=50`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.messages && data.messages.length > 0) {
          const history = data.messages.map((m: any) => ({
            id: m.id || `hist-${Math.random().toString(36).slice(2)}`,
            role: m.role === 'bot' ? 'bot' : (m.role === 'user' ? 'user' : 'system'),
            text: m.text || '',
            time: m.time || '',
          }));
          // Prepend history before the welcome message, replacing welcome
          messages = [...history, ...messages.filter((m) => m.id !== 'welcome')];
          scrollToBottom();
        }
      } catch { /* ignore */ }
    }

    eventSource.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        if (data.type === 'connected') { addLog(`Stream ready: ${data.chat_jid}`); return; }

        // Streaming: handle token-level stream_delta events
        if (data.type === 'stream_delta' && data.text) {
          if (isThinking) { isThinking = false; }

          // Append to existing streaming message or create a new one
          if (streamingMessageId) {
            messages = messages.map((m) =>
              m.id === streamingMessageId ? { ...m, text: m.text + data.text } : m
            );
          } else {
            streamingMessageId = `bot-${Date.now()}`;
            messages = [...messages, {
              id: streamingMessageId,
              role: 'bot',
              text: data.text,
              time: new Date().toLocaleTimeString(),
            }];
          }
          scrollToBottom();
          return;
        }

        // Final complete message — replace streaming content
        if (data.type === 'message' && data.text) {
          if (isThinking) { isThinking = false; fetchMindFiles(); }
          if (streamingMessageId) {
            // Replace the streaming message with the final text
            messages = messages.map((m) =>
              m.id === streamingMessageId ? { ...m, text: data.text } : m
            );
            streamingMessageId = null;
          } else {
            pushBotMessage(data.text);
          }
          fetchMindFiles();
          return;
        }
      } catch { /* ignore malformed */ }
    };

    eventSource.onerror = () => {
      sseConnected = false;
      addLog('SSE disconnected — retrying…');
    };
  }

  function disconnectSSE() {
    eventSource?.close();
    eventSource = null;
    sseConnected = false;
  }

  // --- Helpers ---
  function addLog(msg: string) {
    sseLog = [...sseLog.slice(-8), `${new Date().toLocaleTimeString()} ${msg}`];
  }

  let streamingMessageId: string | null = $state(null);

  function pushBotMessage(text: string) {
    messages = [...messages, {
      id: `bot-${Date.now()}`,
      role: 'bot',
      text,
      time: new Date().toLocaleTimeString(),
    }];
    scrollToBottom();
  }

  async function scrollToBottom() {
    await tick();
    messagesEl?.scrollTo({ top: messagesEl.scrollHeight, behavior: 'smooth' });
  }

  // --- Send message ---
  async function send() {
    const content = inputText.trim();
    if (!content || sending) return;

    messages = [...messages, {
      id: `user-${Date.now()}`,
      role: 'user',
      text: content,
      time: new Date().toLocaleTimeString(),
    }];
    inputText = '';
    scrollToBottom();
    sending = true;
    isThinking = true;

    try {
      const res = await fetch(`${API_BASE}/runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent_id: agentId,
          session_id: sessionId,
          sender: 'web-user',
          content,
        }),
      });
      if (!res.ok) {
        isThinking = false;
        if (res.status === 403) {
          try {
            const errData = await res.json();
            if (errData.error === 'claw_not_trusted') {
              messages = [...messages, { id: `err-${Date.now()}`, role: 'system', text: `🔒 Claw is not trusted (${errData.trust_state}). Go to the Claw tab and click "Trust this Claw" to enable messaging.`, time: '' }];
            } else {
              messages = [...messages, { id: `err-${Date.now()}`, role: 'system', text: `⚠️ Forbidden: ${errData.error || res.status}`, time: '' }];
            }
          } catch {
            messages = [...messages, { id: `err-${Date.now()}`, role: 'system', text: `⚠️ POST failed: ${res.status}`, time: '' }];
          }
        } else {
          messages = [...messages, { id: `err-${Date.now()}`, role: 'system', text: `⚠️ POST failed: ${res.status}`, time: '' }];
        }
      }
    } catch (e: any) {
      isThinking = false;
      messages = [...messages, { id: `err-${Date.now()}`, role: 'system', text: `⚠️ ${e.message}`, time: '' }];
    } finally {
      sending = false;
      await tick();
      inputEl?.focus();
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  }

  // --- Fetch data ---
  async function fetchMind() {
    try { const res = await fetch(`${API_BASE}/api/mind`); mindState = await res.json(); } catch { /* ignore */ }
  }

  async function fetchMessages() {
    try {
      const chatJid = `web:${encodeURIComponent(agentId)}:${encodeURIComponent(sessionId)}`;
      const res = await fetch(`${API_BASE}/api/messages?chat_jid=${encodeURIComponent(chatJid)}`);
      if (res.ok) { messages = await res.json(); scrollToBottom(); }
    } catch { /* ignore */ }
  }

  async function fetchMindFiles() {
    try {
      const res = await fetch(`${API_BASE}/api/mind/files`);
      if (res.ok) {
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
      }
    } catch { /* ignore */ }
  }

  async function fetchSkills() {
    skillsLoading = true;
    try {
      const res = await fetch(`${API_BASE}/api/skills`);
      if (res.ok) { const data = await res.json(); skills = data.skills || []; }
    } catch { /* ignore */ }
    skillsLoading = false;
  }

  async function fetchAgents() {
    agentsLoading = true;
    try {
      const res = await fetch(`${API_BASE}/api/agents`);
      if (res.ok) {
        const data = await res.json();
        agents = data.agents || [];
      }
    } catch { /* ignore */ }
    agentsLoading = false;
  }

  async function fetchSessionsForAgent(agId: string) {
    selectedAgentId = agId;
    try {
      const res = await fetch(`${API_BASE}/api/sessions?agent_id=${encodeURIComponent(agId)}`);
      if (res.ok) {
        const data = await res.json();
        sessions = data.sessions || [];
      }
    } catch { /* ignore */ }
  }

  async function fetchSchedules() {
    schedulesLoading = true;
    try {
      const res = await fetch(`${API_BASE}/api/schedules`);
      if (res.ok) {
        const data = await res.json();
        schedules = data.schedules || [];
      }
    } catch { /* ignore */ }
    schedulesLoading = false;
  }

  async function fetchClaw() {
    clawLoading = true;
    try {
      const res = await fetch(`${API_BASE}/api/claw`);
      if (res.ok) { clawInfo = await res.json(); }
    } catch { /* ignore */ }
    clawLoading = false;
  }

  async function trustClaw() {
    try {
      const res = await fetch(`${API_BASE}/api/claw/trust`, { method: 'POST' });
      if (res.ok) {
        await fetchClaw();
        addLog('Claw trusted ✓');
      }
    } catch { /* ignore */ }
  }

  async function toggleSkill(name: string, enabled: boolean) {
    const action = enabled ? 'disable' : 'enable';
    try {
      await fetch(`${API_BASE}/api/skills/${encodeURIComponent(name)}/${action}`, { method: 'POST' });
      await fetchSkills();
    } catch { /* ignore */ }
  }

  // --- Agent/Session/Schedule creation ---
  async function createAgent() {
    if (!newAgentName.trim()) return;
    try {
      const res = await fetch(`${API_BASE}/api/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newAgentName.trim() }),
      });
      if (res.ok) {
        newAgentName = '';
        showNewAgent = false;
        await fetchAgents();
      }
    } catch { /* ignore */ }
  }

  async function createSession() {
    const aid = newSessionAgentId || selectedAgentId;
    if (!aid) return;
    try {
      const res = await fetch(`${API_BASE}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent_id: aid }),
      });
      if (res.ok) {
        showNewSession = false;
        newSessionAgentId = '';
        await fetchSessionsForAgent(aid);
      }
    } catch { /* ignore */ }
  }

  async function createSchedule_() {
    if (!newScheduleAgentId || !newSchedulePrompt.trim() || !newScheduleCron.trim()) return;
    try {
      const res = await fetch(`${API_BASE}/api/schedules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent_id: newScheduleAgentId,
          prompt: newSchedulePrompt.trim(),
          cron: newScheduleCron.trim(),
        }),
      });
      if (res.ok) {
        newScheduleAgentId = '';
        newSchedulePrompt = '';
        newScheduleCron = '';
        showNewSchedule = false;
        await fetchSchedules();
      }
    } catch { /* ignore */ }
  }

  async function toggleSchedule(id: string, currentStatus: string) {
    const newStatus = currentStatus === 'active' ? 'paused' : 'active';
    try {
      await fetch(`${API_BASE}/api/schedules/${encodeURIComponent(id)}/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      await fetchSchedules();
    } catch { /* ignore */ }
  }

  async function removeSchedule(id: string) {
    try {
      await fetch(`${API_BASE}/api/schedules/${encodeURIComponent(id)}`, { method: 'DELETE' });
      await fetchSchedules();
    } catch { /* ignore */ }
  }

  function selectSession(sess: SessionInfo) {
    agentId = sess.agent_id;
    sessionId = sess.session_id;
    activeTab = 'chat';
    reconnect();
  }

  function reconnect() {
    messages = [...messages, { id: `sys-${Date.now()}`, role: 'system', text: `Reconnecting…`, time: '' }];
    fetchMessages();
    connectSSE();
  }

  function formatDate(iso: string | null): string {
    if (!iso) return '—';
    try {
      const d = new Date(iso);
      return `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
    } catch { return iso; }
  }

  function formatShortDate(iso: string | null): string {
    if (!iso) return '—';
    try {
      const d = new Date(iso);
      const now = new Date();
      if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString();
      return `${d.getMonth()+1}/${d.getDate()} ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
    } catch { return iso; }
  }

  // --- Lifecycle ---
  onMount(async () => {
    await fetchClaw();
    fetchMind();
    fetchMindFiles();
    await fetchMessages();
    if (messages.length === 0) {
      messages = [{ id: 'welcome', role: 'system', text: '🧠 TiClaw Web Client — type a message to start', time: '' }];
    }
    connectSSE();
  });

  onDestroy(() => { disconnectSSE(); });
</script>

<div class="app" class:chat-layout={activeTab === 'chat'}>
  <!-- Left Nav -->
  <nav class="nav">
    <div class="nav-logo">
      <div class="nav-logo-icon">🐾</div>
      TiClaw
    </div>
    {#each tabs as tab}
      <button
        class="nav-btn"
        class:active={activeTab === tab.id}
        onclick={() => switchTab(tab.id)}
        title={tab.label}
      >
        <span class="nav-btn-icon">{tab.icon}</span>
        <span class="nav-btn-label">{tab.label}</span>
      </button>
    {/each}
    <div style="margin-top:auto;display:flex;align-items:center;gap:8px;padding:12px 16px">
      <div
        class="nav-status-dot"
        class:offline={!sseConnected}
      ></div>
      <span style="font-size:11px;color:var(--text-dim)">{sseConnected ? 'Connected' : 'Offline'}</span>
    </div>
  </nav>

  <!-- Main Content -->
  <div class="main-content">
    {#if clawInfo && clawInfo.enrollment.trust_state !== 'trusted'}
      <div class="trust-banner">
        <span>🔒 This claw is not trusted ({clawInfo.enrollment.trust_state}). Messaging is disabled.</span>
        <button class="btn-sm btn-accent" onclick={trustClaw}>🔓 Trust this Claw</button>
      </div>
    {/if}

    {#if activeTab === 'chat'}
      <!-- Chat View -->
      <div class="messages" bind:this={messagesEl}>
        {#each messages as msg (msg.id)}
          {#if msg.role === 'system'}
            <div class="msg-system">{msg.text}</div>
          {:else}
            <div class="msg" class:from-me={msg.role === 'user'}>
              <div class="avatar {msg.role === 'user' ? 'user' : 'bot'}">
                {msg.role === 'user' ? '👤' : '🤖'}
              </div>
              <div>
                <div class="bubble" class:streaming-cursor={msg.streaming}>
                  {msg.text}
                </div>
                {#if msg.time}
                  <div class="bubble-meta">{msg.time}</div>
                {/if}
              </div>
            </div>
          {/if}
        {/each}

        {#if isThinking}
          <div class="msg">
            <div class="avatar bot">🤖</div>
            <div>
              <div class="bubble thinking">
                Thinking<span class="dots"><span>.</span><span>.</span><span>.</span></span>
              </div>
            </div>
          </div>
        {/if}
      </div>

      <div class="input-area">
        <textarea
          class="msg-input"
          bind:this={inputEl}
          bind:value={inputText}
          onkeydown={handleKeydown}
          placeholder="Type a message… (Enter to send)"
          rows="1"
          disabled={sending}
        ></textarea>
        <button class="send-btn" onclick={send} disabled={sending || !inputText.trim()} title="Send">
          {sending ? '⏳' : '➤'}
        </button>
      </div>

    {:else if activeTab === 'sessions'}
      <!-- Sessions View -->
      <div class="tab-header">
        <span class="tab-header-icon">📂</span>
        <h2>Agents & Sessions</h2>
        <div style="margin-left:auto;display:flex;gap:8px">
          <button class="btn-sm btn-accent" onclick={() => { showNewAgent = true; }}>＋ New Agent</button>
          <button class="btn-sm" onclick={fetchAgents}>↻ Refresh</button>
        </div>
      </div>

      <div class="sessions-layout">
        <!-- Agents column -->
        <div class="agents-panel">
          <div class="panel-title">Agents</div>
          {#if agentsLoading}
            <div class="empty-state-sm">⏳ Loading…</div>
          {:else if agents.length === 0}
            <div class="empty-state-sm">No agents yet. Create one!</div>
          {:else}
            {#each agents as agent}
              <button
                class="agent-item"
                class:selected={selectedAgentId === agent.agent_id}
                onclick={() => fetchSessionsForAgent(agent.agent_id)}
              >
                <div class="agent-name">{agent.agent_id}</div>
                <div class="agent-meta">{agent.session_count} session{agent.session_count !== 1 ? 's' : ''}</div>
              </button>
            {/each}
          {/if}
        </div>

        <!-- Sessions column -->
        <div class="sessions-panel">
          {#if selectedAgentId}
            <div class="panel-title">
              Sessions for <strong>{selectedAgentId}</strong>
              <button class="btn-sm btn-accent" style="margin-left:auto" onclick={() => { newSessionAgentId = selectedAgentId || ''; showNewSession = true; }}>＋ New Session</button>
            </div>
            {#if sessions.length === 0}
              <div class="empty-state-sm">No sessions. Create one to start chatting.</div>
            {:else}
              {#each sessions as sess}
                <button class="session-item" onclick={() => selectSession(sess)}>
                  <div class="session-id">{sess.session_id.slice(0, 12)}…</div>
                  <div class="session-meta">
                    <span class="badge small {sess.status}">{sess.status}</span>
                    <span class="session-channel">{sess.channel}</span>
                    <span class="session-time">{formatShortDate(sess.updated_at)}</span>
                  </div>
                </button>
              {/each}
            {/if}
          {:else}
            <div class="empty-state-sm">← Select an agent to see sessions</div>
          {/if}
        </div>
      </div>

      <!-- New Agent Modal -->
      {#if showNewAgent}
        <div class="modal-overlay" onclick={() => showNewAgent = false} role="presentation">
          <div class="modal" onclick={(e) => e.stopPropagation()} role="dialog" tabindex="-1" onkeydown={(e) => { if (e.key === 'Escape') showNewAgent = false }}>
            <h3>Create New Agent</h3>
            <div class="modal-field">
              <label for="new-agent-name">Agent Name</label>
              <input id="new-agent-name" bind:value={newAgentName} placeholder="my-agent" onkeydown={(e) => { if (e.key === 'Enter') createAgent() }} />
            </div>
            <div class="modal-actions">
              <button class="btn-sm" onclick={() => showNewAgent = false}>Cancel</button>
              <button class="btn-sm btn-accent" onclick={createAgent} disabled={!newAgentName.trim()}>Create</button>
            </div>
          </div>
        </div>
      {/if}

      <!-- New Session Modal -->
      {#if showNewSession}
        <div class="modal-overlay" onclick={() => showNewSession = false} role="presentation">
          <div class="modal" onclick={(e) => e.stopPropagation()} role="dialog" tabindex="-1" onkeydown={(e) => { if (e.key === 'Escape') showNewSession = false }}>
            <h3>Create New Session</h3>
            <div class="modal-field">
              <label for="new-session-agent">Agent</label>
              <input id="new-session-agent" bind:value={newSessionAgentId} placeholder="agent-id" />
            </div>
            <div class="modal-actions">
              <button class="btn-sm" onclick={() => showNewSession = false}>Cancel</button>
              <button class="btn-sm btn-accent" onclick={createSession} disabled={!newSessionAgentId}>Create</button>
            </div>
          </div>
        </div>
      {/if}

    {:else if activeTab === 'schedules'}
      <!-- Schedules View -->
      <div class="tab-header">
        <span class="tab-header-icon">⏰</span>
        <h2>Schedules</h2>
        <div style="margin-left:auto;display:flex;gap:8px">
          <button class="btn-sm btn-accent" onclick={() => { showNewSchedule = true; }}>＋ New Schedule</button>
          <button class="btn-sm" onclick={fetchSchedules}>↻ Refresh</button>
        </div>
      </div>
      <div class="schedules-wrapper">
        {#if schedulesLoading}
          <div class="empty-state">
            <div class="empty-state-icon">⏳</div>
            <div class="empty-state-text">Loading schedules…</div>
          </div>
        {:else if schedules.length === 0}
          <div class="empty-state">
            <div class="empty-state-icon">⏰</div>
            <div class="empty-state-text">No schedules yet. Create a cron schedule to automate agent tasks.</div>
          </div>
        {:else}
          <table class="data-table">
            <thead>
              <tr>
                <th>Status</th>
                <th>Agent</th>
                <th>Cron</th>
                <th>Prompt</th>
                <th>Next Run</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {#each schedules as sched}
                <tr>
                  <td>
                    <span class="status-pill {sched.status}">
                      {#if sched.status === 'active'}▶{:else}⏸{/if}
                      {sched.status}
                    </span>
                  </td>
                  <td style="font-size:12px;color:var(--text-muted)">{sched.agent_id}</td>
                  <td><code class="cron-code">{sched.cron}</code></td>
                  <td class="prompt-cell" title={sched.prompt}>{sched.prompt}</td>
                  <td class="time-cell">{formatShortDate(sched.next_run)}</td>
                  <td>
                    <div style="display:flex;gap:4px">
                      <button class="btn-icon" title={sched.status === 'active' ? 'Pause' : 'Resume'} onclick={() => toggleSchedule(sched.id, sched.status)}>
                        {sched.status === 'active' ? '⏸' : '▶'}
                      </button>
                      <button class="btn-icon btn-danger" title="Delete" onclick={() => removeSchedule(sched.id)}>🗑</button>
                    </div>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
      </div>

      <!-- New Schedule Modal -->
      {#if showNewSchedule}
        <div class="modal-overlay" onclick={() => showNewSchedule = false} role="presentation">
          <div class="modal" onclick={(e) => e.stopPropagation()} role="dialog" tabindex="-1" onkeydown={(e) => { if (e.key === 'Escape') showNewSchedule = false }}>
            <h3>Create Schedule</h3>
            <div class="modal-field">
              <label for="sched-agent">Agent ID</label>
              <input id="sched-agent" bind:value={newScheduleAgentId} placeholder="my-agent" />
            </div>
            <div class="modal-field">
              <label for="sched-prompt">Prompt</label>
              <textarea id="sched-prompt" bind:value={newSchedulePrompt} placeholder="Check for updates and summarize…" rows="3"></textarea>
            </div>
            <div class="modal-field">
              <label for="sched-cron">Cron Expression</label>
              <input id="sched-cron" bind:value={newScheduleCron} placeholder="0 9 * * *" />
              <div class="field-hint">e.g. <code>0 9 * * *</code> = every day at 9am</div>
            </div>
            <div class="modal-actions">
              <button class="btn-sm" onclick={() => showNewSchedule = false}>Cancel</button>
              <button class="btn-sm btn-accent" onclick={createSchedule_} disabled={!newScheduleAgentId || !newSchedulePrompt.trim() || !newScheduleCron.trim()}>Create</button>
            </div>
          </div>
        </div>
      {/if}

    {:else if activeTab === 'skills'}
      <!-- Skills View -->
      <div class="tab-header">
        <span class="tab-header-icon">🧩</span>
        <h2>Skills</h2>
        <div style="margin-left:auto">
          <button class="btn-sm" onclick={fetchSkills}>↻ Refresh</button>
        </div>
      </div>
      <div class="skills-grid">
        {#if skillsLoading}
          <div class="empty-state">
            <div class="empty-state-icon">⏳</div>
            <div class="empty-state-text">Loading skills…</div>
          </div>
        {:else if skills.length === 0}
          <div class="empty-state">
            <div class="empty-state-icon">🧩</div>
            <div class="empty-state-text">No skills discovered. Add SKILL.md files to your skills directories.</div>
          </div>
        {:else}
          {#each skills as skill}
            <div class="skill-card">
              <div class="skill-info">
                <div class="skill-name">{skill.name}</div>
                <div class="skill-desc">{skill.description || 'No description'}</div>
                <div class="skill-meta">
                  <span class="skill-tag">v{skill.version || '?'}</span>
                  <span class="skill-tag">L{skill.permissionLevel}</span>
                  {#if skill.source}
                    <span class="skill-tag">{skill.source}</span>
                  {/if}
                  {#if skill.installed}
                    <span class="skill-tag" style="color:var(--green)">installed</span>
                  {/if}
                </div>
              </div>
              <label class="toggle">
                <input
                  type="checkbox"
                  checked={skill.enabled}
                  onchange={() => toggleSkill(skill.name, skill.enabled)}
                />
                <span class="toggle-slider"></span>
              </label>
            </div>
          {/each}
        {/if}
      </div>

    {:else if activeTab === 'claw'}
      <!-- Claw View -->
      <div class="tab-header">
        <span class="tab-header-icon">🦀</span>
        <h2>Claw</h2>
        <div style="margin-left:auto">
          <button class="btn-sm" onclick={fetchClaw}>↻ Refresh</button>
        </div>
      </div>
      <div class="runtime-content">
        {#if clawLoading}
          <div class="empty-state">
            <div class="empty-state-icon">⏳</div>
            <div class="empty-state-text">Loading claw info…</div>
          </div>
        {:else if clawInfo}
          <div class="runtime-card">
            <h3>Identity</h3>
            <div class="runtime-row">
              <span class="runtime-key">Hostname</span>
              <span class="runtime-val">{clawInfo.hostname || '—'}</span>
            </div>
          </div>

          <div class="runtime-card">
            <h3>Enrollment</h3>
            <div class="runtime-row">
              <span class="runtime-key">Trust State</span>
              <span class="badge {clawInfo.enrollment.trust_state}">
                {clawInfo.enrollment.trust_state}
              </span>
            </div>
            {#if clawInfo.enrollment.trust_state !== 'trusted'}
              <div style="margin-top:8px">
                <button class="btn-sm" style="color:var(--green);border-color:var(--green)" onclick={trustClaw}>🔓 Trust this Claw</button>
              </div>
            {/if}
            <div class="runtime-row">
              <span class="runtime-key">Fingerprint</span>
              <span class="runtime-val" style="font-size:11px">{clawInfo.enrollment.fingerprint?.slice(0, 16) || '—'}…</span>
            </div>
            {#if clawInfo.enrollment.trusted_at}
              <div class="runtime-row">
                <span class="runtime-key">Trusted At</span>
                <span class="runtime-val" style="font-size:12px">{formatDate(clawInfo.enrollment.trusted_at)}</span>
              </div>
            {/if}
          </div>

          {#if clawInfo.executor}
            <div class="runtime-card">
              <h3>Executor</h3>
              <div class="stats-row">
                <div class="stat-card">
                  <div class="stat-value">{clawInfo.executor.active_tasks ?? 0}</div>
                  <div class="stat-label">Active</div>
                </div>
                <div class="stat-card">
                  <div class="stat-value">{clawInfo.executor.queued_tasks ?? 0}</div>
                  <div class="stat-label">Queued</div>
                </div>
                <div class="stat-card">
                  <div class="stat-value">{clawInfo.executor.total_slots ?? 0}</div>
                  <div class="stat-label">Slots</div>
                </div>
              </div>
            </div>
          {/if}
        {:else}
          <div class="empty-state">
            <div class="empty-state-icon">⚙️</div>
            <div class="empty-state-text">No claw data available</div>
          </div>
        {/if}
      </div>
    {/if}
  </div>

  {#if activeTab === 'chat'}
  <!-- Right Sidebar (Chat only) -->
  <aside class="sidebar">
    <!-- Session Config -->
    <div class="sidebar-section">
      <h3>Active Session</h3>
      <div style="display:flex;flex-direction:column;gap:6px">
        <div class="sidebar-field">
          <label for="sidebar-agent">Agent</label>
          <input
            id="sidebar-agent"
            class="chat-id-input"
            bind:value={agentId}
            placeholder="web-agent"
            onchange={reconnect}
          />
        </div>
        <div class="sidebar-field">
          <label for="sidebar-session">Session</label>
          <input
            id="sidebar-session"
            class="chat-id-input"
            bind:value={sessionId}
            placeholder="web-session"
            onchange={reconnect}
          />
        </div>
      </div>
    </div>

    <!-- Mind State -->
    <div class="sidebar-section">
      <h3>Mind State</h3>
      {#if mindState}
        <div class="mind-card">
          <div class="mind-row">
            <span class="mind-label">lifecycle</span>
            <span class="badge {mindState.lifecycle}">{mindState.lifecycle}</span>
          </div>
          <div class="mind-row">
            <span class="mind-label">version</span>
            <span style="font-size:12px">v{mindState.version}</span>
          </div>
          <button class="btn-sm" onclick={fetchMind}>↻ refresh</button>
        </div>
      {:else}
        <div class="mind-card" style="color:var(--text-muted);font-size:12px">
          Loading…
        </div>
      {/if}
    </div>

    <!-- Mind Files (Personalization) -->
    <div class="sidebar-section">
      <h3>Mind Files</h3>
      <div class="workspace-files">
        {#each Object.entries(mindFiles) as [fileName, file]}
          <div class="file-card" class:updated={file.updatedRecently}>
            <div class="file-header">
              <strong>{fileName}</strong>
              {#if file.updatedRecently}
                <span class="update-badge">Updated!</span>
              {/if}
            </div>
            <div class="file-content">{file.content}</div>
          </div>
        {/each}
        {#if Object.keys(mindFiles).length === 0}
          <div style="color:var(--text-dim);font-size:11px;padding:6px">No mind files yet</div>
        {/if}
      </div>
      <button class="btn-sm" onclick={fetchMindFiles} style="margin-top:6px">↻ refresh</button>
    </div>

    <!-- SSE Log -->
    <div class="sidebar-section">
      <h3>SSE Log</h3>
      <div class="sse-log">
        {#each sseLog as entry}
          <div>{entry}</div>
        {/each}
        {#if sseLog.length === 0}
          <span style="opacity:.4">waiting…</span>
        {/if}
      </div>
    </div>
  </aside>
  {/if}
</div>
