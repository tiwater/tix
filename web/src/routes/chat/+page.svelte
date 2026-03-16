<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import { marked } from 'marked';
  import DOMPurify from 'isomorphic-dompurify';
  import { appState } from '$lib/stores/app-state.svelte';
  import { resolveProtocolUrls } from '$lib/ticlaw-protocol';

  function renderMarkdown(text: string): string {
    const html = DOMPurify.sanitize(marked.parse(text) as string);
    return resolveProtocolUrls(html);
  }
  import { Send, Loader2, User, Bot, PanelRightOpen, PanelRightClose, FileText, Brain, UserCircle, BookOpen, RefreshCw, ChevronDown, ChevronRight, Puzzle, ToggleLeft, ToggleRight } from 'lucide-svelte';

  let messagesEl = $state<HTMLElement>(null!);
  let inputEl = $state<HTMLTextAreaElement>(null!);
  let showSettings = $state(true);
  let expandedFiles = $state<Record<string, boolean>>({});

  async function scrollToBottom() {
    await tick();
    messagesEl?.scrollTo({ top: messagesEl.scrollHeight, behavior: 'smooth' });
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }

  async function handleSend() {
    await appState.send();
    await tick();
    inputEl?.focus();
    scrollToBottom();
  }

  function toggleFile(name: string) {
    expandedFiles = { ...expandedFiles, [name]: !expandedFiles[name] };
  }

  function fileIcon(name: string) {
    if (name === 'SOUL.md') return 'soul';
    if (name === 'MEMORY.md') return 'memory';
    if (name === 'USER.md') return 'user';
    return 'identity';
  }

  // Watch messages for auto-scroll
  $effect(() => {
    if (appState.messages.length) scrollToBottom();
  });

  onMount(() => {
    appState.connectSSE();
    appState.fetchMindFiles();
    appState.fetchSkills();
  });
  onDestroy(() => { appState.disconnectSSE(); });
</script>

<div class="flex h-full">
  <!-- Main Chat Area -->
  <div class="flex flex-col flex-1 min-w-0">
    <!-- Chat Header -->
    <div class="flex items-center gap-4 px-5 py-2 border-b border-border bg-card">
      <div class="flex items-center gap-1.5">
        <label for="chat-agent" class="text-[11px] font-medium text-muted-foreground whitespace-nowrap">Agent</label>
        <input id="chat-agent" class="w-[140px] px-2.5 py-1.5 bg-muted border border-border rounded-md text-foreground text-xs outline-none focus:border-primary transition-colors" bind:value={appState.agentId} placeholder="web-agent" onchange={() => appState.reconnect()} />
      </div>
      <div class="flex items-center gap-1.5">
        <label for="chat-session" class="text-[11px] font-medium text-muted-foreground whitespace-nowrap">Session</label>
        <input id="chat-session" class="w-[140px] px-2.5 py-1.5 bg-muted border border-border rounded-md text-foreground text-xs outline-none focus:border-primary transition-colors" bind:value={appState.sessionId} placeholder="web-session" onchange={() => appState.reconnect()} />
      </div>
      <div class="ml-auto">
        <button
          class="w-8 h-8 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          onclick={() => showSettings = !showSettings}
          title={showSettings ? 'Hide settings' : 'Show settings'}
        >
          {#if showSettings}<PanelRightClose size={16} />{:else}<PanelRightOpen size={16} />{/if}
        </button>
      </div>
    </div>

    <!-- Messages -->
    <div class="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-2.5 scroll-smooth" bind:this={messagesEl}>
      {#each appState.messages as msg (msg.id)}
        {#if msg.role === 'system'}
          <div class="text-center text-[11px] text-muted-foreground py-1 px-3">{msg.text}</div>
        {:else}
          <div class="flex gap-2.5 max-w-[720px] {msg.role === 'user' ? 'self-end flex-row-reverse' : ''}">
            <div class="w-[30px] h-[30px] rounded-lg flex items-center justify-center shrink-0 text-white {msg.role === 'user' ? 'bg-gradient-to-br from-primary to-chart-4' : 'bg-gradient-to-br from-green-500 to-cyan-400'}">
              {#if msg.role === 'user'}<User size={15} />{:else}<Bot size={15} />{/if}
            </div>
            <div>
              <div class="bg-card border border-border rounded-xl px-3.5 py-2 max-w-[600px] break-words whitespace-pre-wrap text-[13px] leading-relaxed {msg.role === 'user' ? 'bg-primary/10 border-primary/30 rounded-br-sm' : 'rounded-bl-sm'} {msg.streaming ? 'streaming-cursor' : ''} {msg.role !== 'user' && !msg.showRaw ? 'markdown-body' : ''}">
                {#if msg.role === 'user' || msg.showRaw}
                  <pre class="whitespace-pre-wrap font-sans text-[13px] m-0">{msg.text}</pre>
                {:else}
                  {@html renderMarkdown(msg.text)}
                {/if}
              </div>
              {#if msg.time || msg.role !== 'user'}
                <div class="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-2">
                  {#if msg.time}<span>{msg.time}</span>{/if}
                  {#if msg.role !== 'user'}
                    <button class="text-[10px] text-muted-foreground hover:text-foreground bg-transparent border-none cursor-pointer" onclick={() => msg.showRaw = !msg.showRaw}>
                      {msg.showRaw ? 'Rendered' : 'Raw'}
                    </button>
                  {/if}
                </div>
              {/if}
            </div>
          </div>
        {/if}
      {/each}

      {#if appState.isThinking}
        <div class="flex gap-2.5">
          <div class="w-[30px] h-[30px] rounded-lg flex items-center justify-center shrink-0 text-white bg-gradient-to-br from-green-500 to-cyan-400"><Bot size={15} /></div>
          <div>
            <div class="bg-muted text-muted-foreground px-3.5 py-2 rounded-xl text-[13px] flex items-center gap-2">
              {#if appState.progressCategory === 'skill'}
                <Puzzle size={14} class="text-primary shrink-0" />
                <span>Using skill <strong>{appState.progressSkill}</strong>{appState.progressArgs ? ` for "${appState.progressArgs}"` : ''}... ({appState.progressElapsed}s)</span>
              {:else if appState.progressCategory === 'tool'}
                <RefreshCw size={14} class="text-muted-foreground shrink-0 spin" />
                <span>Running {appState.progressTool}{appState.progressArgs ? `: ${appState.progressArgs}` : ''}... ({appState.progressElapsed}s)</span>
              {:else if appState.progressCategory === 'thinking'}
                <Brain size={14} class="text-primary shrink-0" />
                <span>Thinking... ({appState.progressElapsed}s)</span>
              {:else if appState.progressCategory === 'formatting'}
                <Loader2 size={14} class="text-muted-foreground shrink-0 spin" />
                <span>Formatting result... ({appState.progressElapsed}s)</span>
              {:else if appState.progressCategory === 'error'}
                <Loader2 size={14} class="text-destructive shrink-0" />
                <span>Recovering from error... ({appState.progressElapsed}s)</span>
              {:else if appState.progressCategory === 'processing' || appState.progressCategory}
                <Loader2 size={14} class="text-muted-foreground shrink-0 spin" />
                <span>Processing... ({appState.progressElapsed}s)</span>
              {:else}
                <span>Thinking</span>
                <span class="inline-flex gap-1">{#each [0, 1, 2] as i}<span class="inline-block w-[5px] h-[5px] bg-primary rounded-full" style="animation: dot-bounce 1.2s ease-in-out infinite; animation-delay: {i * 0.2}s"></span>{/each}</span>
              {/if}
            </div>
          </div>
        </div>
      {/if}
    </div>

    <!-- Input Area -->
    <div class="flex gap-2.5 px-5 py-3 border-t border-border bg-card items-end">
      <textarea
        class="flex-1 px-3.5 py-2.5 bg-muted border border-border rounded-xl text-foreground text-[13px] resize-none outline-none min-h-[42px] max-h-[120px] leading-relaxed focus:border-primary transition-colors placeholder:text-muted-foreground disabled:opacity-50 disabled:cursor-not-allowed"
        bind:this={inputEl}
        bind:value={appState.inputText}
        onkeydown={handleKeydown}
        placeholder="Type a message… (Enter to send)"
        rows="1"
        disabled={appState.sending}
      ></textarea>
      <button
        class="w-[42px] h-[42px] rounded-xl bg-gradient-to-br from-primary to-chart-4 border-none text-primary-foreground flex items-center justify-center cursor-pointer shrink-0 transition-all hover:opacity-90 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
        onclick={handleSend}
        disabled={appState.sending || !appState.inputText.trim()}
        title="Send"
      >
        {#if appState.sending}
          <Loader2 size={18} class="spin" />
        {:else}
          <Send size={18} />
        {/if}
      </button>
    </div>
  </div>

  <!-- Right Settings Pane -->
  {#if showSettings}
    <div class="w-[300px] border-l border-border bg-card flex flex-col shrink-0 overflow-hidden">
      <!-- Header -->
      <div class="flex items-center justify-between px-4 py-2.5 border-b border-border">
        <span class="text-xs font-semibold text-foreground uppercase tracking-wider">Agent Mind</span>
        <button
          class="w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          onclick={() => appState.fetchMindFiles()}
          title="Refresh mind files"
        >
          <RefreshCw size={13} />
        </button>
      </div>

      <!-- Mind Files -->
      <div class="flex-1 overflow-y-auto">
        {#if Object.keys(appState.mindFiles).length === 0}
          <div class="px-4 py-8 text-center text-xs text-muted-foreground">
            No mind files found.<br/>
            <span class="text-[10px]">Send a message to initialize the agent's mind.</span>
          </div>
        {:else}
          {#each Object.entries(appState.mindFiles) as [name, file]}
            <div class="border-b border-border/50">
              <!-- File header (clickable to expand/collapse) -->
              <button
                class="w-full flex items-center gap-2 px-4 py-2 text-left hover:bg-muted/50 transition-colors bg-transparent border-none cursor-pointer"
                onclick={() => toggleFile(name)}
              >
                <span class="text-muted-foreground">
                  {#if expandedFiles[name]}<ChevronDown size={12} />{:else}<ChevronRight size={12} />{/if}
                </span>
                <span class="text-muted-foreground">
                  {#if fileIcon(name) === 'soul'}<Brain size={14} />
                  {:else if fileIcon(name) === 'memory'}<BookOpen size={14} />
                  {:else if fileIcon(name) === 'user'}<UserCircle size={14} />
                  {:else}<FileText size={14} />
                  {/if}
                </span>
                <span class="text-xs font-medium text-foreground flex-1">{name}</span>
                {#if file.updatedRecently}
                  <span class="text-[9px] bg-green-500/20 text-green-600 dark:text-green-400 px-1.5 py-0.5 rounded-full font-medium">updated</span>
                {/if}
              </button>

              <!-- File content (expanded) -->
              {#if expandedFiles[name]}
                <div class="px-4 pb-3">
                  <pre class="text-[11px] leading-relaxed text-muted-foreground bg-muted/50 rounded-md p-2.5 overflow-x-auto max-h-[300px] overflow-y-auto whitespace-pre-wrap break-words m-0 font-mono">{file.content || '(empty)'}</pre>
                </div>
              {/if}
            </div>
          {/each}
        {/if}

        <!-- Skills / Permissions -->
        <div class="px-4 py-3 border-t border-border">
          <div class="flex items-center justify-between mb-2">
            <div class="flex items-center gap-1.5">
              <Puzzle size={11} class="text-muted-foreground" />
              <span class="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Skills</span>
            </div>
            <button
              class="w-6 h-6 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              onclick={() => appState.fetchSkills()}
              title="Refresh skills"
            >
              <RefreshCw size={11} />
            </button>
          </div>
          {#if appState.skills.length === 0}
            <div class="text-[11px] text-muted-foreground">No skills available</div>
          {:else}
            <div class="space-y-1">
              {#each appState.skills as skill}
                <button
                  class="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left hover:bg-muted/50 transition-colors bg-transparent border-none cursor-pointer group"
                  onclick={() => appState.toggleSkill(skill.name, skill.enabled)}
                  title="{skill.enabled ? 'Disable' : 'Enable'} {skill.name}"
                >
                  <span class="{skill.enabled ? 'text-green-500' : 'text-muted-foreground/50'}">
                    {#if skill.enabled}<ToggleRight size={16} />{:else}<ToggleLeft size={16} />{/if}
                  </span>
                  <span class="text-[11px] flex-1 {skill.enabled ? 'text-foreground' : 'text-muted-foreground'}">{skill.name}</span>
                  {#if skill.permissionLevel >= 3}
                    <span class="text-[9px] bg-amber-500/20 text-amber-600 dark:text-amber-400 px-1 py-0.5 rounded font-medium">L{skill.permissionLevel}</span>
                  {/if}
                </button>
              {/each}
            </div>
          {/if}
        </div>

        <!-- Connection Info -->
        <div class="px-4 py-3 border-t border-border">
          <div class="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Connection</div>
          <div class="space-y-1.5">
            <div class="flex items-center justify-between text-[11px]">
              <span class="text-muted-foreground">SSE Status</span>
              <span class="flex items-center gap-1.5">
                <span class="w-1.5 h-1.5 rounded-full {appState.sseConnected ? 'bg-green-500' : 'bg-red-400'}"></span>
                <span class="text-foreground">{appState.sseConnected ? 'Connected' : 'Disconnected'}</span>
              </span>
            </div>
            <div class="flex items-center justify-between text-[11px]">
              <span class="text-muted-foreground">Agent</span>
              <span class="text-foreground font-mono text-[10px]">{appState.agentId}</span>
            </div>
            <div class="flex items-center justify-between text-[11px]">
              <span class="text-muted-foreground">Session</span>
              <span class="text-foreground font-mono text-[10px]">{appState.sessionId}</span>
            </div>
          </div>
        </div>

        <!-- SSE Log -->
        {#if appState.sseLog.length > 0}
          <div class="px-4 py-3 border-t border-border">
            <div class="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Event Log</div>
            <div class="space-y-0.5">
              {#each appState.sseLog as entry}
                <div class="text-[10px] text-muted-foreground font-mono leading-tight truncate">{entry}</div>
              {/each}
            </div>
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>
