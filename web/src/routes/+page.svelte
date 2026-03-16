  import { onMount, onDestroy, tick } from 'svelte';
  import { marked } from 'marked';
  import DOMPurify from 'isomorphic-dompurify';
  import '../app.css';

  // --- Types ---
  type Tab = 'chat' | 'sessions' | 'schedules' | 'skills' | 'node';

  interface Attachment {
    type: 'image' | 'video' | 'audio' | 'file';
    url?: string;
    base64?: string;
    mime_type?: string;
  }

  interface Message {
    id: string;
    role: 'user' | 'bot' | 'system';
    text: string;
    time: string;
    streaming?: boolean;
    showRaw?: boolean;
    attachments?: Attachment[];
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
    status?: 'discovered' | 'installed_disabled' | 'installed_enabled';
    runtimeUsable?: boolean;
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

  interface NodeInfo {
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
  let activeTab = $state<Tab>('sessions');
  let agentId = $state('web-agent');
  let sessionId = $state('web-session');
  let inputText = $state('');
  let messages = $state<Message[]>([]);
  let mindState = $state<MindState | null>(null);
  let sseConnected = $state(false);
  let sseLog = $state<string[]>([]);
  let sending = $state(false);
  let isThinking = $state(false);
  let progressText = $state('');
  let mindFiles = $state<Record<string, WorkspaceFile>>({});

  // Tab data
  let skills = $state<SkillInfo[]>([]);
  let agents = $state<AgentInfo[]>([]);
  let sessions = $state<SessionInfo[]>([]);
  let schedules = $state<ScheduleInfo[]>([]);
  let nodeInfo = $state<NodeInfo | null>(null);
  let selectedAgentId = $state<string | null>(null);

  let skillsLoading = $state(false);
  let agentsLoading = $state(false);
  let schedulesLoading = $state(false);
  let nodeLoading = $state(false);

  // Modals
  let showNewAgent = $state(false);
  let showNewSession = $state(false);
  let newAgentName = $state('');
  let newSessionAgentId = $state('');

  let messagesEl = $state<HTMLElement>(null!);
  let inputEl = $state<HTMLTextAreaElement>(null!);
  let eventSource: EventSource | null = null;
  let streamingMessageId: string | null = $state(null);
  let activeStreamId = $state<string | null>(null);
  let lastStreamSeq = $state(0);

  const staticTabs: { id: Tab; icon: string; label: string }[] = [
    { id: 'sessions', icon: '🤖', label: 'Agents' },
    { id: 'chat', icon: '💬', label: 'Chat' },
    { id: 'schedules', icon: '⏰', label: 'Schedules' },
    { id: 'skills', icon: '🧩', label: 'Skills' },
  ];

  const tabs = $derived([
    { id: 'node' as Tab, icon: '🦀', label: nodeInfo?.hostname || 'Node' },
    ...staticTabs,
  ]);

  // --- Tab switching ---
  function switchTab(tab: Tab) {
    activeTab = tab;
    if (tab === 'skills') fetchSkills();
    if (tab === 'sessions') fetchAgents();
    if (tab === 'schedules') fetchSchedules();
    if (tab === 'node') fetchNode();
    if (tab === 'chat') connectSSE();
  }

  // --- SSE ---
  function connectSSE() {
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
    const url = `/runs/web-run/stream?agent_id=${encodeURIComponent(agentId)}&session_id=${encodeURIComponent(sessionId)}`;
    eventSource = new EventSource(url);

    eventSource.onopen = () => {
      sseConnected = true;
      addLog('SSE connected');
      fetchMessageHistory();
    };

    async function fetchMessageHistory() {
      try {
        const res = await fetch(
          `/api/messages?agent_id=${encodeURIComponent(agentId)}&session_id=${encodeURIComponent(sessionId)}&limit=50`,
        );
        if (!res.ok) return;
        const data = await res.json();
        if (data.messages && data.messages.length > 0) {
          const history = data.messages.map((m: any) => ({
            id: m.id || `hist-${Math.random().toString(36).slice(2)}`,
            role:
              m.role === 'bot' ? 'bot' : m.role === 'user' ? 'user' : 'system',
            text: m.text || '',
            time: m.time || '',
            attachments: m.attachments || [],
          }));
          const historyIds = new Set(history.map((m: Message) => m.id));
          // Prepend persisted history and preserve any live-only streaming message.
          messages = [
            ...history,
            ...messages.filter(
              (m) => m.id !== 'welcome' && !historyIds.has(m.id),
            ),
          ];
          scrollToBottom();
        }
      } catch {
        /* ignore */
      }
    }

    eventSource.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        if (data.type === 'connected') {
          addLog(`Stream ready: ${data.chat_jid}`);
          return;
        }

        if (data.type === 'progress' && data.text) {
          progressText = data.text;
          if (!streamingMessageId) {
            isThinking = true;
          }
          return;
        }

        if (data.type === 'progress_end') {
          progressText = '';
          return;
        }

        // Streaming: handle token-level stream_delta events
        if (data.type === 'stream_delta' && data.text) {
          const { isDuplicate, isNewStream } = advanceStreamEvent(data);
          if (isDuplicate) {
            return;
          }
          if (isThinking) {
            isThinking = false;
            progressText = '';
          }
          if (isNewStream && streamingMessageId) {
            messages = messages.map((m) =>
              m.id === streamingMessageId ? { ...m, streaming: false } : m,
            );
          }
          if (isNewStream) {
            streamingMessageId = null;
          }

          const currentText =
            streamingMessageId
              ? messages.find((m) => m.id === streamingMessageId)?.text || ''
              : '';
          const nextText =
            typeof data.full_text === 'string'
              ? data.full_text
              : currentText + data.text;

          // Replace the in-flight message with the server's current snapshot.
          if (streamingMessageId) {
            messages = messages.map((m) =>
              m.id === streamingMessageId
                ? { ...m, text: nextText, streaming: true, attachments: data.attachments || m.attachments }
                : m,
            );
          } else {
            streamingMessageId = `bot-${Date.now()}`;
            messages = [
              ...messages,
              {
                id: streamingMessageId,
                role: 'bot',
                text: nextText,
                time: new Date().toLocaleTimeString(),
                streaming: true,
                attachments: data.attachments || [],
              },
            ];
          }
          scrollToBottom();
          return;
        }

        // Stream complete — finalize the streaming message with authoritative text
        if (data.type === 'stream_end') {
          const { isDuplicate } = advanceStreamEvent(data);
          if (isDuplicate) {
            return;
          }
          if (isThinking) {
            isThinking = false;
            progressText = '';
          }
          const finalText =
            typeof data.full_text === 'string' ? data.full_text : data.text;
          if (streamingMessageId && finalText) {
            messages = messages.map((m) =>
              m.id === streamingMessageId
                ? { ...m, text: finalText, streaming: false, attachments: data.attachments || m.attachments }
                : m,
            );
          } else if (finalText) {
            pushBotMessage(finalText, data.attachments);
          }
          resetStreamingState();
          fetchMindFiles();
          return;
        }

        // Final complete message (non-streaming path or fallback)
        if (data.type === 'message' && data.text) {
          if (isThinking) {
            isThinking = false;
            progressText = '';
            fetchMindFiles();
          }
          if (streamingMessageId) {
            // Replace the streaming message with the final text
            messages = messages.map((m) =>
              m.id === streamingMessageId
                ? { ...m, text: data.text, streaming: false, attachments: data.attachments || m.attachments }
                : m,
            );
            resetStreamingState();
          } else {
            pushBotMessage(data.text, data.attachments);
          }
          fetchMindFiles();
          return;
        }
      } catch {
        /* ignore malformed */
      }
    };

    eventSource.onerror = () => {
      sseConnected = false;
      progressText = '';
      addLog('SSE disconnected — retrying…');
    };
  }

  function disconnectSSE() {
    eventSource?.close();
    eventSource = null;
    sseConnected = false;
    progressText = '';
  }

  // --- Helpers ---
  function addLog(msg: string) {
    sseLog = [...sseLog.slice(-8), `${new Date().toLocaleTimeString()} ${msg}`];
  }

  function advanceStreamEvent(data: {
    stream_id?: string;
    seq?: number;
  }): {
    isDuplicate: boolean;
    isNewStream: boolean;
  } {
    const streamId =
      typeof data.stream_id === 'string' && data.stream_id.trim()
        ? data.stream_id
        : null;
    const seq = typeof data.seq === 'number' ? data.seq : null;

    if (!streamId || seq === null) {
      return {
        isDuplicate: false,
        isNewStream: false,
      };
    }

    const isNewStream = streamId !== activeStreamId;
    if (!isNewStream && seq <= lastStreamSeq) {
      return {
        isDuplicate: true,
        isNewStream: false,
      };
    }

    activeStreamId = streamId;
    lastStreamSeq = seq;
    return {
      isDuplicate: false,
      isNewStream,
    };
  }

  function resetStreamingState() {
    streamingMessageId = null;
    activeStreamId = null;
    lastStreamSeq = 0;
  }

  function pushBotMessage(text: string, attachments?: Attachment[]) {
    // Auto-extract ticlaw protocol links if any
    const extra: Attachment[] = [];
    const imageMatches = text.matchAll(/ticlaw:\/\/image\/([^\s\n`<>"]+)/g);
    for (const match of imageMatches) {
      extra.push({ type: 'image', url: match[1] });
    }
    const fileMatches = text.matchAll(/ticlaw:\/\/file\/([^\s\n`<>"]+)/g);
    for (const match of fileMatches) {
      extra.push({ type: 'file', url: match[1] });
    }

    messages = [
      ...messages,
      {
        id: `bot-${Date.now()}`,
        role: 'bot',
        text,
        time: new Date().toLocaleTimeString(),
        attachments: [...(attachments || []), ...extra],
      },
    ];
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

    messages = [
      ...messages,
      {
        id: `user-${Date.now()}`,
        role: 'user',
        text: content,
        time: new Date().toLocaleTimeString(),
      },
    ];
    inputText = '';
    scrollToBottom();
    sending = true;
    isThinking = true;
    progressText = '';

    try {
      const res = await fetch(`/runs`, {
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
        progressText = '';
        if (res.status === 403) {
          try {
            const errData = await res.json();
            if (errData.error === 'node_not_trusted') {
              messages = [
                ...messages,
                {
                  id: `err-${Date.now()}`,
                  role: 'system',
                  text: `🔒 Node is not trusted (${errData.trust_state}). Go to the Node tab and click "Trust this Node" to enable messaging.`,
                  time: '',
                },
              ];
            } else {
              messages = [
                ...messages,
                {
                  id: `err-${Date.now()}`,
                  role: 'system',
                  text: `⚠️ Forbidden: ${errData.error || res.status}`,
                  time: '',
                },
              ];
            }
          } catch {
            messages = [
              ...messages,
              {
                id: `err-${Date.now()}`,
                role: 'system',
                text: `⚠️ POST failed: ${res.status}`,
                time: '',
              },
            ];
          }
        } else {
          messages = [
            ...messages,
            {
              id: `err-${Date.now()}`,
              role: 'system',
              text: `⚠️ POST failed: ${res.status}`,
              time: '',
            },
          ];
        }
      }
    } catch (e: any) {
      isThinking = false;
      progressText = '';
      messages = [
        ...messages,
        {
          id: `err-${Date.now()}`,
          role: 'system',
          text: `⚠️ ${e.message}`,
          time: '',
        },
      ];
    } finally {
      sending = false;
      await tick();
      inputEl?.focus();
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  // --- Fetch data ---
  async function fetchMind() {
    try {
      const res = await fetch(`/api/mind`);
      mindState = await res.json();
    } catch {
      /* ignore */
    }
  }

  async function fetchMindFiles() {
    try {
      const res = await fetch(`/api/mind/files`);
      if (res.ok) {
        const data = await res.json();
        if (data.files) {
          const newFiles = data.files as Record<string, WorkspaceFile>;
          for (const [name, file] of Object.entries(newFiles)) {
            if (mindFiles[name] && file.mtimeMs > mindFiles[name].mtimeMs) {
              file.updatedRecently = true;
              setTimeout(() => {
                if (mindFiles[name]) mindFiles[name].updatedRecently = false;
              }, 5000);
            }
          }
          mindFiles = newFiles;
        }
      }
    } catch {
      /* ignore */
    }
  }

  async function fetchSkills() {
    skillsLoading = true;
    try {
      const res = await fetch(`/api/skills`);
      if (res.ok) {
        const data = await res.json();
        skills = data.skills || [];
      }
    } catch {
      /* ignore */
    }
    skillsLoading = false;
  }

  async function fetchAgents() {
    agentsLoading = true;
    try {
      const res = await fetch(`/api/agents`);
      if (res.ok) {
        const data = await res.json();
        agents = data.agents || [];
      }
    } catch {
      /* ignore */
    }
    agentsLoading = false;
  }

  async function fetchSessionsForAgent(agId: string) {
    selectedAgentId = agId;
    try {
      const res = await fetch(
        `/api/sessions?agent_id=${encodeURIComponent(agId)}`,
      );
      if (res.ok) {
        const data = await res.json();
        sessions = data.sessions || [];
      }
    } catch {
      /* ignore */
    }
  }

  async function fetchSchedules() {
    schedulesLoading = true;
    try {
      const res = await fetch(`/api/schedules`);
      if (res.ok) {
        const data = await res.json();
        schedules = data.schedules || [];
      }
    } catch {
      /* ignore */
    }
    schedulesLoading = false;
  }

  async function fetchNode() {
    nodeLoading = true;
    try {
      const res = await fetch(`/api/node`);
      if (res.ok) {
        nodeInfo = await res.json();
      }
    } catch {
      /* ignore */
    }
    nodeLoading = false;
  }

  async function trustNode() {
    try {
      const res = await fetch(`/api/node/trust`, { method: 'POST' });
      if (res.ok) {
        await fetchNode();
        addLog('Node trusted ✓');
      }
    } catch {
      /* ignore */
    }
  }

  async function toggleSkill(name: string, enabled: boolean) {
    const action = enabled ? 'disable' : 'enable';
    try {
      const res = await fetch(
        `/api/skills/${encodeURIComponent(name)}/${action}`,
        { method: 'POST' },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Unknown error' }));
        addLog(
          `⚠️ Skill ${action} failed: ${err.detail || err.message || 'Unknown error'}`,
        );
      }
      await fetchSkills();
    } catch (e: any) {
      addLog(`⚠️ Skill ${action} failed: ${e.message}`);
    }
  }

  // --- Agent/Session/Schedule creation ---
  async function createAgent() {
    if (!newAgentName.trim()) return;
    try {
      const res = await fetch(`/api/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newAgentName.trim() }),
      });
      if (res.ok) {
        newAgentName = '';
        showNewAgent = false;
        await fetchAgents();
      }
    } catch {
      /* ignore */
    }
  }

  async function createSession() {
    const aid = newSessionAgentId || selectedAgentId;
    if (!aid) return;
    try {
      const res = await fetch(`/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent_id: aid }),
      });
      if (res.ok) {
        showNewSession = false;
        newSessionAgentId = '';
        await fetchSessionsForAgent(aid);
      }
    } catch {
      /* ignore */
    }
  }

  async function toggleSchedule(id: string, currentStatus: string) {
    const newStatus = currentStatus === 'active' ? 'paused' : 'active';
    try {
      await fetch(`/api/schedules/${encodeURIComponent(id)}/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      await fetchSchedules();
    } catch {
      /* ignore */
    }
  }

  async function removeSchedule(id: string) {
    try {
      await fetch(`/api/schedules/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      await fetchSchedules();
    } catch {
      /* ignore */
    }
  }

  function selectSession(sess: SessionInfo) {
    agentId = sess.agent_id;
    sessionId = sess.session_id;
    // Clear previous session state
    messages = [];
    resetStreamingState();
    isThinking = false;
    progressText = '';
    activeTab = 'chat';
    connectSSE();
  }

  function reconnect() {
    messages = [];
    resetStreamingState();
    isThinking = false;
    progressText = '';
    connectSSE();
  }

  function formatDate(iso: string | null): string {
    if (!iso) return '—';
    try {
      const d = new Date(iso);
      return `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
    } catch {
      return iso;
    }
  }

  function formatShortDate(iso: string | null): string {
    if (!iso) return '—';
    try {
      const d = new Date(iso);
      const now = new Date();
      if (d.toDateString() === now.toDateString())
        return d.toLocaleTimeString();
      return `${d.getMonth() + 1}/${d.getDate()} ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
    } catch {
      return iso;
    }
  }

  // --- Lifecycle ---
  onMount(async () => {
    await fetchNode();
    fetchMind();
    fetchMindFiles();
    fetchAgents();
  });

  onDestroy(() => {
    disconnectSSE();
  });
