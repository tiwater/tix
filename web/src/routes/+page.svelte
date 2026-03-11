<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import '../app.css';

  // --- Config ---
  const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3280';

  // --- Types ---
  type Tab = 'chat' | 'skills' | 'jobs' | 'runtime';

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
    expanded?: boolean;
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

  interface JobInfo {
    id: string;
    status: string;
    prompt: string;
    agent_id: string;
    session_id: string;
    created_at: string;
    started_at: string | null;
    finished_at: string | null;
    result: any;
    error: any;
  }

  interface RuntimeInfo {
    runtime_id: string;
    runtime: any;
    enrollment: {
      trust_state: string;
      runtime_fingerprint: string;
      trusted_at: string | null;
      failed_attempts: number;
    };
    executor: any;
  }

  // --- State ---
  let activeTab = $state<Tab>('chat');
  let chatJid = $state('web:default');
  let inputText = $state('');
  let messages = $state<Message[]>([]);
  let mindState = $state<MindState | null>(null);
  let sseConnected = $state(false);
  let sseLog = $state<string[]>([]);
  let sending = $state(false);
  let isThinking = $state(false);
  let workspaceFiles = $state<Record<string, WorkspaceFile>>({});

  // Tab data
  let skills = $state<SkillInfo[]>([]);
  let jobs = $state<JobInfo[]>([]);
  let runtimeInfo = $state<RuntimeInfo | null>(null);
  let skillsLoading = $state(false);
  let jobsLoading = $state(false);
  let runtimeLoading = $state(false);

  let messagesEl = $state<HTMLElement>(null!);
  let inputEl = $state<HTMLTextAreaElement>(null!);
  let eventSource: EventSource | null = null;

  const tabs: { id: Tab; icon: string; label: string }[] = [
    { id: 'chat', icon: '💬', label: 'Chat' },
    { id: 'skills', icon: '🧩', label: 'Skills' },
    { id: 'jobs', icon: '📋', label: 'Jobs' },
    { id: 'runtime', icon: '⚙️', label: 'Claw' },
  ];

  // --- Tab switching ---
  function switchTab(tab: Tab) {
    activeTab = tab;
    if (tab === 'skills') fetchSkills();
    if (tab === 'jobs') fetchJobs();
    if (tab === 'runtime') fetchRuntime();
  }

  // --- SSE ---
  function connectSSE() {
    if (eventSource) { eventSource.close(); eventSource = null; }
    const url = `${API_BASE}/runs/${encodeURIComponent(chatJid)}/stream`;
    eventSource = new EventSource(url);

    eventSource.onopen = () => {
      sseConnected = true;
      addLog('SSE connected');
    };

    eventSource.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        if (data.type === 'connected') { addLog(`Stream ready: ${data.chat_jid}`); return; }
        if (data.type === 'message' && data.text) {
          if (isThinking) { isThinking = false; fetchWorkspaceFiles(); }
          pushBotMessage(data.text);
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
        body: JSON.stringify({ chat_jid: chatJid, sender: 'web-user', content }),
      });
      if (!res.ok) {
        messages = [...messages, { id: `err-${Date.now()}`, role: 'system', text: `⚠️ POST failed: ${res.status}`, time: '' }];
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
      const res = await fetch(`${API_BASE}/api/messages?chat_jid=${encodeURIComponent(chatJid)}`);
      if (res.ok) { messages = await res.json(); scrollToBottom(); }
    } catch { /* ignore */ }
  }

  async function fetchWorkspaceFiles() {
    try {
      const res = await fetch(`${API_BASE}/api/workspace?chat_jid=${encodeURIComponent(chatJid)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.files) {
          const newFiles = data.files as Record<string, WorkspaceFile>;
          for (const [name, file] of Object.entries(newFiles)) {
            if (workspaceFiles[name] && file.mtimeMs > workspaceFiles[name].mtimeMs) {
              file.updatedRecently = true;
              setTimeout(() => { if (workspaceFiles[name]) workspaceFiles[name].updatedRecently = false; }, 5000);
            }
          }
          workspaceFiles = newFiles;
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

  async function fetchJobs() {
    jobsLoading = true;
    try {
      const res = await fetch(`${API_BASE}/api/jobs?limit=50`);
      if (res.ok) { const data = await res.json(); jobs = data.jobs || []; }
    } catch { /* ignore */ }
    jobsLoading = false;
  }

  async function fetchRuntime() {
    runtimeLoading = true;
    try {
      const res = await fetch(`${API_BASE}/api/runtime`);
      if (res.ok) { runtimeInfo = await res.json(); }
    } catch { /* ignore */ }
    runtimeLoading = false;
  }

  async function toggleSkill(name: string, enabled: boolean) {
    const action = enabled ? 'disable' : 'enable';
    try {
      await fetch(`${API_BASE}/api/skills/${encodeURIComponent(name)}/${action}`, { method: 'POST' });
      await fetchSkills();
    } catch { /* ignore */ }
  }

  function reconnect() {
    messages = [...messages, { id: `sys-${Date.now()}`, role: 'system', text: `Reconnecting to ${chatJid}…`, time: '' }];
    fetchMessages();
    connectSSE();
  }

  function formatTime(iso: string | null): string {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleTimeString(); } catch { return iso; }
  }

  function formatDate(iso: string | null): string {
    if (!iso) return '—';
    try {
      const d = new Date(iso);
      return `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
    } catch { return iso; }
  }

  // --- Lifecycle ---
  onMount(async () => {
    fetchMind();
    fetchWorkspaceFiles();
    await fetchMessages();
    if (messages.length === 0) {
      messages = [{ id: 'welcome', role: 'system', text: '🧠 TiClaw Web Client — type a message to start', time: '' }];
    }
    connectSSE();
  });

  onDestroy(() => { disconnectSSE(); });
</script>

<div class="app">
  <!-- Header -->
  <header class="header">
    <div class="logo">
      <div class="logo-icon">🐾</div>
      TiClaw
    </div>
    <div class="header-right">
      <span class="status-label">{sseConnected ? 'Connected' : 'Offline'}</span>
      <div
        class="status-dot"
        class:offline={!sseConnected}
        title={sseConnected ? 'SSE connected' : 'SSE offline'}
      ></div>
    </div>
  </header>

  <!-- Left Nav -->
  <nav class="nav">
    {#each tabs as tab}
      <button
        class="nav-btn"
        class:active={activeTab === tab.id}
        onclick={() => switchTab(tab.id)}
        title={tab.label}
      >
        {tab.icon}
        <span class="nav-tooltip">{tab.label}</span>
      </button>
    {/each}
  </nav>

  <!-- Main Content -->
  <div class="main-content">
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

    {:else if activeTab === 'jobs'}
      <!-- Jobs View -->
      <div class="tab-header">
        <span class="tab-header-icon">📋</span>
        <h2>Jobs</h2>
        <div style="margin-left:auto">
          <button class="btn-sm" onclick={fetchJobs}>↻ Refresh</button>
        </div>
      </div>
      <div class="jobs-table-wrapper">
        {#if jobsLoading}
          <div class="empty-state">
            <div class="empty-state-icon">⏳</div>
            <div class="empty-state-text">Loading jobs…</div>
          </div>
        {:else if jobs.length === 0}
          <div class="empty-state">
            <div class="empty-state-icon">📋</div>
            <div class="empty-state-text">No jobs yet. Send a message to create a job.</div>
          </div>
        {:else}
          <table class="jobs-table">
            <thead>
              <tr>
                <th>Status</th>
                <th>Agent</th>
                <th>Prompt</th>
                <th>Created</th>
                <th>Finished</th>
              </tr>
            </thead>
            <tbody>
              {#each jobs as job}
                <tr>
                  <td>
                    <span class="status-pill {job.status}">
                      {#if job.status === 'queued'}⏳{:else if job.status === 'running'}🔄{:else if job.status === 'succeeded'}✅{:else if job.status === 'failed'}❌{:else}⊘{/if}
                      {job.status}
                    </span>
                  </td>
                  <td style="font-size:12px;color:var(--text-muted)">{job.agent_id || '—'}</td>
                  <td class="prompt-cell" title={job.prompt}>{job.prompt}</td>
                  <td class="time-cell">{formatDate(job.created_at)}</td>
                  <td class="time-cell">{formatDate(job.finished_at)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
      </div>

    {:else if activeTab === 'runtime'}
      <!-- Runtime View -->
      <div class="tab-header">
        <span class="tab-header-icon">⚙️</span>
        <h2>Claw</h2>
        <div style="margin-left:auto">
          <button class="btn-sm" onclick={fetchRuntime}>↻ Refresh</button>
        </div>
      </div>
      <div class="runtime-content">
        {#if runtimeLoading}
          <div class="empty-state">
            <div class="empty-state-icon">⏳</div>
            <div class="empty-state-text">Loading runtime info…</div>
          </div>
        {:else if runtimeInfo}
          <div class="runtime-card">
            <h3>Identity</h3>
            <div class="runtime-row">
              <span class="runtime-key">Runtime ID</span>
              <span class="runtime-val">{runtimeInfo.runtime_id}</span>
            </div>
            {#if runtimeInfo.runtime}
              <div class="runtime-row">
                <span class="runtime-key">Hostname</span>
                <span class="runtime-val">{runtimeInfo.runtime.hostname || '—'}</span>
              </div>
              <div class="runtime-row">
                <span class="runtime-key">Version</span>
                <span class="runtime-val">{runtimeInfo.runtime.version || '—'}</span>
              </div>
              <div class="runtime-row">
                <span class="runtime-key">OS</span>
                <span class="runtime-val">{runtimeInfo.runtime.os || '—'}</span>
              </div>
            {/if}
          </div>

          <div class="runtime-card">
            <h3>Enrollment</h3>
            <div class="runtime-row">
              <span class="runtime-key">Trust State</span>
              <span class="badge {runtimeInfo.enrollment.trust_state}">
                {runtimeInfo.enrollment.trust_state}
              </span>
            </div>
            <div class="runtime-row">
              <span class="runtime-key">Fingerprint</span>
              <span class="runtime-val" style="font-size:11px">{runtimeInfo.enrollment.runtime_fingerprint?.slice(0, 16) || '—'}…</span>
            </div>
            {#if runtimeInfo.enrollment.trusted_at}
              <div class="runtime-row">
                <span class="runtime-key">Trusted At</span>
                <span class="runtime-val" style="font-size:12px">{formatDate(runtimeInfo.enrollment.trusted_at)}</span>
              </div>
            {/if}
          </div>

          {#if runtimeInfo.executor}
            <div class="runtime-card">
              <h3>Executor</h3>
              <div class="stats-row">
                <div class="stat-card">
                  <div class="stat-value">{runtimeInfo.executor.active_jobs ?? 0}</div>
                  <div class="stat-label">Active</div>
                </div>
                <div class="stat-card">
                  <div class="stat-value">{runtimeInfo.executor.queued_jobs ?? 0}</div>
                  <div class="stat-label">Queued</div>
                </div>
                <div class="stat-card">
                  <div class="stat-value">{runtimeInfo.executor.total_slots ?? 0}</div>
                  <div class="stat-label">Slots</div>
                </div>
              </div>
              {#if runtimeInfo.executor.capabilities}
                <div class="runtime-row">
                  <span class="runtime-key">Capabilities</span>
                  <span class="runtime-val" style="font-size:11px">{runtimeInfo.executor.capabilities?.join(', ') || '—'}</span>
                </div>
              {/if}
            </div>
          {/if}
        {:else}
          <div class="empty-state">
            <div class="empty-state-icon">⚙️</div>
            <div class="empty-state-text">No runtime data available</div>
          </div>
        {/if}
      </div>
    {/if}
  </div>

  <!-- Right Sidebar -->
  <aside class="sidebar">
    <!-- Chat ID -->
    <div class="sidebar-section">
      <h3>Chat ID</h3>
      <input
        class="chat-id-input"
        bind:value={chatJid}
        placeholder="web:default"
        onchange={reconnect}
      />
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

    <!-- Workspace Data -->
    <div class="sidebar-section">
      <h3>Workspace Data</h3>
      <div class="workspace-files">
        {#each Object.entries(workspaceFiles) as [fileName, file]}
          <div class="file-card" class:updated={file.updatedRecently}>
            <div
              class="file-header"
              role="button"
              tabindex="0"
              onclick={() => file.expanded = !file.expanded}
              onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') file.expanded = !file.expanded; }}
            >
              <strong>{fileName}</strong>
              <div>
                {#if file.updatedRecently}
                  <span class="update-badge">Updated!</span>
                {/if}
                <span style="font-size:10px; margin-left:4px; color:var(--text-dim)">{file.expanded ? '▼' : '▶'}</span>
              </div>
            </div>
            {#if file.expanded}
              <div class="file-content">{file.content}</div>
            {/if}
          </div>
        {/each}
        {#if Object.keys(workspaceFiles).length === 0}
          <div style="color:var(--text-dim);font-size:11px;padding:6px">No files yet</div>
        {/if}
      </div>
      <button class="btn-sm" onclick={fetchWorkspaceFiles} style="margin-top:6px">↻ refresh</button>
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
</div>
