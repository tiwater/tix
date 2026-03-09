<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import '../app.css';

  // --- Config ---
  const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3280';

  // --- State ---
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

  let chatJid = $state('web:default');
  let inputText = $state('');
  let messages = $state<Message[]>([]);
  let mindState = $state<MindState | null>(null);
  let sseConnected = $state(false);
  let sseLog = $state<string[]>([]);
  let sending = $state(false);

  let messagesEl: HTMLElement;
  let inputEl: HTMLTextAreaElement;
  let eventSource: EventSource | null = null;

  // --- SSE ---
  function connectSSE() {
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }

    const url = `${API_BASE}/api/stream?chat_jid=${encodeURIComponent(chatJid)}`;
    eventSource = new EventSource(url);

    eventSource.onopen = () => {
      sseConnected = true;
      addLog('SSE connected');
    };

    eventSource.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        if (data.type === 'connected') {
          addLog(`Stream ready: ${data.chat_jid}`);
          return;
        }
        if (data.type === 'message' && data.text) {
          pushBotMessage(data.text);
        }
      } catch { /* ignore malformed */ }
    };

    eventSource.onerror = () => {
      sseConnected = false;
      addLog('SSE disconnected — retrying…');
      // Browser auto-retries EventSource
    };
  }

  function disconnectSSE() {
    eventSource?.close();
    eventSource = null;
    sseConnected = false;
  }

  // --- Messages ---
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

  // --- Send ---
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

    try {
      const res = await fetch(`${API_BASE}/api/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_jid: chatJid, sender: 'web-user', content }),
      });
      if (!res.ok) {
        messages = [...messages, { id: `err-${Date.now()}`, role: 'system', text: `⚠️ POST failed: ${res.status}`, time: '' }];
      }
    } catch (e: any) {
      messages = [...messages, { id: `err-${Date.now()}`, role: 'system', text: `⚠️ ${e.message}`, time: '' }];
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

  // --- Mind ---
  async function fetchMind() {
    try {
      const res = await fetch(`${API_BASE}/api/mind`);
      mindState = await res.json();
    } catch { /* ignore */ }
  }

  function reconnect() {
    messages = [...messages, { id: `sys-${Date.now()}`, role: 'system', text: `Reconnecting to ${chatJid}…`, time: '' }];
    connectSSE();
  }

  // --- Lifecycle ---
  onMount(() => {
    fetchMind();
    connectSSE();
    messages = [{ id: 'welcome', role: 'system', text: '🧠 TiClaw Web Client — type a message to start', time: '' }];
  });

  onDestroy(() => {
    disconnectSSE();
  });
</script>

<div class="app">
  <!-- Header -->
  <header class="header">
    <div class="logo">
      <div class="logo-icon">🐾</div>
      TiClaw DevUI
    </div>
    <span class="header-sep" />
    <div class="status-dot" class:offline={!sseConnected} title={sseConnected ? 'SSE connected' : 'SSE offline'} />
  </header>

  <!-- Sidebar -->
  <aside class="sidebar">
    <!-- Channel ID -->
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
          {#if mindState.persona.tone}
          <div class="mind-row">
            <span class="mind-label">tone</span>
            <span style="font-size:12px">{mindState.persona.tone}</span>
          </div>
          {/if}
          {#if mindState.persona.verbosity}
          <div class="mind-row">
            <span class="mind-label">verbosity</span>
            <span style="font-size:12px">{mindState.persona.verbosity}</span>
          </div>
          {/if}
          <div class="mind-row">
            <span class="mind-label">emoji</span>
            <span style="font-size:12px">{mindState.persona.emoji ? '✅' : '❌'}</span>
          </div>
          <button class="mind-refresh" onclick={fetchMind}>↻ refresh</button>
        </div>
      {:else}
        <div class="mind-card" style="color:var(--text-muted);font-size:12px">Loading…</div>
      {/if}
    </div>

    <!-- SSE Log -->
    <div class="sidebar-section">
      <h3>SSE Log</h3>
      <div class="sse-log">
        {#each sseLog as entry}
          <div>{entry}</div>
        {/each}
        {#if sseLog.length === 0}
          <span style="opacity:.5">waiting…</span>
        {/if}
      </div>
    </div>
  </aside>

  <!-- Chat -->
  <main class="chat-area">
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
              <div class="bubble" class:streaming-cursor={msg.streaming}>{msg.text}</div>
              {#if msg.time}
                <div class="bubble-meta">{msg.time}</div>
              {/if}
            </div>
          </div>
        {/if}
      {/each}
    </div>

    <div class="input-area">
      <textarea
        class="msg-input"
        bind:this={inputEl}
        bind:value={inputText}
        onkeydown={handleKeydown}
        placeholder="Type a message… (Enter to send, Shift+Enter for newline)"
        rows="1"
        disabled={sending}
      ></textarea>
      <button class="send-btn" onclick={send} disabled={sending || !inputText.trim()} title="Send">
        {sending ? '⏳' : '➤'}
      </button>
    </div>
  </main>
</div>
