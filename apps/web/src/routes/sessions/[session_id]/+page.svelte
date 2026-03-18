<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import { marked } from 'marked';
  import DOMPurify from 'isomorphic-dompurify';
  import { appState } from '$lib/stores/app-state.svelte';
  import { resolveProtocolUrls } from '$lib/ticlaw-protocol';
  import { page } from '$app/stores';


  function renderMarkdown(text: string): string {
    const html = DOMPurify.sanitize(marked.parse(text) as string, {
      ALLOWED_URI_REGEXP:
        /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|cid|xmpp|ticlaw):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
    });
    return resolveProtocolUrls(html);
  }

  function renderUserMessage(text: string): string {
    // Parse [Attached file: name → ticlaw://url] into styled cards
    const parts = text.split(/(\[Attached file: .+? → ticlaw:\/\/.+?\])/);
    let html = '';
    for (const part of parts) {
      const match = part.match(/^\[Attached file: (.+?) → (ticlaw:\/\/.+?)\]$/);
      if (match) {
        const [, name, ticlawUrl] = match;
        const httpUrl = ticlawUrl.replace(/^ticlaw:\/\/workspace\/([^/]+)\/(.+)$/, '/api/workspace/$2?agent_id=$1');
        const ext = name.split('.').pop()?.toLowerCase() || '';
        const icon = ['jpg','jpeg','png','gif','svg','webp'].includes(ext) ? '🖼️' : ['pdf'].includes(ext) ? '📄' : ['doc','docx'].includes(ext) ? '📝' : ['xls','xlsx','csv'].includes(ext) ? '📊' : '📎';
        html += `<a href="${httpUrl}" target="_blank" rel="noopener" class="ticlaw-file-chip">${icon} ${DOMPurify.sanitize(name)}</a>`;
      } else if (part.trim()) {
        // Handle 📎 prefixed lines (from displayContent)
        const cleaned = part.replace(/^📎 .+$/gm, '').trim();
        if (cleaned) {
          html += `<span>${DOMPurify.sanitize(cleaned)}</span>`;
        }
      }
    }
    return html || DOMPurify.sanitize(text);
  }
  import {
    Send,
    RefreshCw,
    Brain,
    Puzzle,
    Loader,
    Paperclip,
    X,
    Download,
    ExternalLink,
  } from 'lucide-svelte';

  // File preview state
  interface PreviewFile {
    name: string;
    url: string;
    ext: string;
  }
  let previewFile = $state<PreviewFile | null>(null);

  function isImageExt(ext: string): boolean {
    return ['jpg','jpeg','png','gif','svg','webp','bmp','ico'].includes(ext);
  }
  function isPdfExt(ext: string): boolean {
    return ext === 'pdf';
  }

  /** Intercept clicks on ticlaw file links and open preview */
  function handleMessageClick(e: MouseEvent) {
    const target = (e.target as HTMLElement).closest('.ticlaw-file-chip, .ticlaw-file-card');
    if (!target) return;
    e.preventDefault();
    e.stopPropagation();
    const link = target as HTMLAnchorElement;
    const href = link.getAttribute('href') || '';
    // Extract filename from the link text or href
    const text = link.textContent?.trim() || '';
    // Remove leading emoji from text
    const name = text.replace(/^[^\w\u4e00-\u9fff]+/, '').trim() || href.split('/').pop() || 'file';
    const ext = name.split('.').pop()?.toLowerCase() || '';
    previewFile = { name, url: href, ext };
  }

  let messagesEl = $state<HTMLElement>(null!);
  let inputEl = $state<HTMLTextAreaElement>(null!);
  let fileInputEl = $state<HTMLInputElement>(null!);
  let isDragOver = $state(false);


  let isUserScrolledUp = $state(false);
  let isProgrammaticScroll = false;

  async function scrollToBottom(behavior: ScrollBehavior = 'auto') {
    if (!messagesEl) return;
    await tick();
    isProgrammaticScroll = true;
    messagesEl.scrollTo({ top: messagesEl.scrollHeight, behavior });
    // Reset programmatic flag after a short delay
    setTimeout(() => {
      isProgrammaticScroll = false;
    }, 50);
  }

  function handleScroll() {
    if (!messagesEl || isProgrammaticScroll) return;
    const { scrollTop, scrollHeight, clientHeight } = messagesEl;
    // Consider the user scrolled up if they are more than 50px away from the bottom
    isUserScrolledUp = scrollHeight - scrollTop - clientHeight > 50;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  async function handleSend() {
    const wasScrolledUp = isUserScrolledUp;
    isUserScrolledUp = false; // Force snap to bottom on send
    await appState.send();
    await tick();
    inputEl?.focus();
    if (wasScrolledUp) scrollToBottom('smooth');
  }



  // Watch messages for auto-scroll
  $effect(() => {
    // Read messages so the effect re-runs when it changes
    const _ = appState.messages;
    if (!isUserScrolledUp) {
      scrollToBottom('auto');
    }
  });

  // Reactively switch sessions if navigating between different dynamic routes
  $effect(() => {
    const sid = $page.params.session_id;
    if (sid && appState.sessionId !== sid) {
      appState.sessionId = sid;
      // Find the agent that owns this session
      for (const agent of appState.agents) {
        const sess = appState.sessionsForAgent(agent.agent_id).find(s => s.session_id === sid);
        if (sess) {
          appState.agentId = sess.agent_id;
          break;
        }
      }
      appState.reconnect();
      appState.fetchMindFiles();
    }
  });

  onMount(() => {
    // In case this is a fresh load, ensure we connect using the URL path.
    const sid = $page.params.session_id;
    if (sid && appState.sessionId !== sid) {
      appState.sessionId = sid;
    }
    appState.connectSSE();
    appState.fetchMindFiles();
    appState.fetchSkills();
  });

  onDestroy(() => {
    appState.disconnectSSE();
  });
</script>

<div class="flex flex-1 w-full overflow-hidden h-[100dvh]">
  <!-- Main Chat Area -->
  <div class="flex flex-col flex-1 min-w-0 h-[100dvh]">
    <!-- Messages -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions a11y_click_events_have_key_events -->
    <div
      class="flex-1 overflow-y-auto w-full px-5 flex flex-col items-center bg-background"
      bind:this={messagesEl}
      onscroll={handleScroll}
      onclick={handleMessageClick}
      role="log"
    >
      <div class="w-full max-w-4xl py-6 flex flex-col gap-6 pb-8">
        {#each appState.messages as msg (msg.id)}
          {#if msg.role === 'system'}
            <div
              class="text-center text-[12px] font-medium text-muted-foreground py-1 px-3 bg-muted/50 rounded-full self-center my-2"
            >
              {msg.text}
            </div>
          {:else}
            <div
              class="flex gap-4 {msg.role === 'user'
                ? 'max-w-[85%] self-end flex-row-reverse'
                : 'w-full self-start'}"
            >
              <div
                class="flex flex-col gap-1.5 min-w-0 {msg.role === 'user'
                  ? 'items-end'
                  : 'items-start flex-1'}"
              >
                <div
                  class="{msg.role === 'user'
                    ? 'bg-card border border-border shadow-sm px-4 py-3 bg-primary/5 border-primary/20 rounded-2xl rounded-tr-sm'
                    : 'w-full py-1 text-foreground px-2'} break-words whitespace-pre-wrap text-[14.5px] leading-relaxed {msg.streaming
                    ? 'streaming-cursor'
                    : ''} {msg.role !== 'user' && !msg.showRaw
                    ? 'markdown-body'
                    : ''}"
                >
                  {#if msg.role === 'user'}
                    {@html renderUserMessage(msg.text)}
                  {:else}
                    {@html renderMarkdown(msg.text)}
                  {/if}
                </div>
                {#if msg.time || msg.role !== 'user'}
                  <div
                    class="text-[11px] text-muted-foreground flex items-center gap-2 px-1 {msg.role !==
                    'user'
                      ? 'px-3'
                      : ''}"
                  >
                    {#if msg.time}<span>{msg.time}</span>{/if}
                    {#if msg.role !== 'user'}
                      <button
                        class="hover:text-foreground bg-transparent border-none cursor-pointer transition-colors"
                        onclick={() => (msg.showRaw = !msg.showRaw)}
                      >
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
          <div class="flex gap-4 w-full self-start">
            <div class="flex-1">
              <div
                class="text-muted-foreground w-full py-1.5 text-[13px] flex items-center gap-2.5 px-3"
              >
                {#if appState.progressCategory === 'skill'}
                  <Puzzle size={15} class="text-primary shrink-0" />
                  <span
                    >Using skill <strong>{appState.progressSkill}</strong
                    >{appState.progressArgs
                      ? ` for "${appState.progressArgs}"`
                      : ''}... ({appState.progressElapsed}s)</span
                  >
                {:else if appState.progressCategory === 'tool'}
                  <RefreshCw
                    size={15}
                    class="text-muted-foreground shrink-0 spin"
                  />
                  <span
                    >Running {appState.progressTool}{appState.progressArgs
                      ? `: ${appState.progressArgs}`
                      : ''}... ({appState.progressElapsed}s)</span
                  >
                {:else if appState.progressCategory === 'thinking'}
                  <Brain size={15} class="text-primary shrink-0" />
                  <span>Thinking... ({appState.progressElapsed}s)</span>
                {:else if appState.progressCategory === 'formatting'}
                  <Loader
                    size={15}
                    class="text-muted-foreground shrink-0 animate-spin"
                  />
                  <span>Formatting result... ({appState.progressElapsed}s)</span
                  >
                {:else if appState.progressCategory === 'error'}
                  <Loader
                    size={15}
                    class="text-destructive shrink-0 animate-spin"
                  />
                  <span
                    >Recovering from error... ({appState.progressElapsed}s)</span
                  >
                {:else if appState.progressCategory === 'processing' || appState.progressCategory}
                  <Loader
                    size={15}
                    class="text-muted-foreground shrink-0 animate-spin"
                  />
                  <span>Processing... ({appState.progressElapsed}s)</span>
                {:else}
                  <span>Thinking</span>
                  <span class="inline-flex gap-1.5 ml-1"
                    >{#each [0, 1, 2] as i}<span
                        class="inline-block w-1.5 h-1.5 bg-primary rounded-full"
                        style="animation: dot-bounce 1.2s ease-in-out infinite; animation-delay: {i *
                          0.2}s"
                      ></span>{/each}</span
                  >
                {/if}
              </div>
            </div>
          </div>
        {/if}
      </div>
    </div>

    <!-- Input Area -->
    <div class="px-5 py-4 bg-background flex flex-col items-center">
      <div class="w-full max-w-4xl flex flex-col">
        <!-- Pending file chips -->
        {#if appState.pendingFiles.length > 0}
          <div class="flex flex-wrap gap-1.5 mb-2 px-2">
            {#each appState.pendingFiles as pf, i}
              <div class="inline-flex items-center gap-1.5 text-[11px] bg-muted border border-border rounded-lg px-2.5 py-1 {pf.uploading ? 'opacity-50' : ''}">
                <Paperclip size={10} class="text-muted-foreground shrink-0" />
                <span class="text-foreground max-w-[150px] truncate">{pf.name}</span>
                {#if !pf.uploading}
                  <button
                    class="w-4 h-4 flex items-center justify-center rounded-full hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors cursor-pointer"
                    onclick={() => appState.removeFile(i)}
                  >
                    <X size={10} />
                  </button>
                {/if}
              </div>
            {/each}
          </div>
        {/if}

        <div
          class="flex-1 flex gap-3 items-end bg-card border rounded-3xl shadow-sm px-2 py-2 focus-within:border-primary focus-within:ring-1 focus-within:ring-primary transition-shadow {isDragOver ? 'border-primary ring-1 ring-primary bg-primary/5' : 'border-border'}"
          role="region"
          ondragover={(e) => { e.preventDefault(); isDragOver = true; }}
          ondragleave={() => { isDragOver = false; }}
          ondrop={(e) => { e.preventDefault(); isDragOver = false; if (e.dataTransfer?.files?.length) appState.addFiles(e.dataTransfer.files); }}
        >
          <!-- Paperclip button -->
          <button
            class="w-[38px] h-[38px] rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer shrink-0 mb-1 ml-1"
            onclick={() => fileInputEl?.click()}
            title="Attach files"
          >
            <Paperclip size={17} />
          </button>
          <input
            type="file"
            multiple
            class="hidden"
            bind:this={fileInputEl}
            onchange={(e) => { const t = e.currentTarget as HTMLInputElement; if (t.files?.length) { appState.addFiles(t.files); t.value = ''; } }}
          />

          <textarea
            class="flex-1 px-4 py-3 bg-transparent border-none text-foreground text-[14px] resize-none outline-none min-h-[50px] max-h-[200px] leading-relaxed placeholder:text-muted-foreground disabled:opacity-50 disabled:cursor-not-allowed"
            bind:this={inputEl}
            bind:value={appState.inputText}
            onkeydown={handleKeydown}
            placeholder="Type a message… (Enter to send)"
            rows="1"
            disabled={appState.sending}
          ></textarea>
          <button
            class="w-[42px] h-[42px] rounded-full bg-foreground border-none text-background flex items-center justify-center cursor-pointer shrink-0 transition-all hover:opacity-90 active:scale-95 disabled:opacity-50 disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed mb-1 mr-1"
            onclick={handleSend}
            disabled={appState.sending || (!appState.inputText.trim() && appState.pendingFiles.length === 0)}
            title="Send"
          >
            {#if appState.sending}
              <Loader size={18} class="animate-spin" />
            {:else}
              <Send size={18} class="mr-0.5 mt-0.5" />
            {/if}
          </button>
        </div>
      </div>
    </div>
  </div>

  <!-- Right Session Inspection Pane -->
  <div
    class="w-[300px] border-l border-border bg-card flex flex-col shrink-0 overflow-hidden h-[100dvh]"
  >
    <!-- Header -->
    <div
      class="flex items-center justify-between px-4 py-2.5 border-b border-border"
    >
      <span
        class="text-xs font-semibold text-foreground uppercase tracking-wider"
        >Session</span
      >
    </div>

    <div class="flex-1 overflow-y-auto">
      <!-- Session Info -->
      <div class="px-4 py-3">
        <div
          class="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2.5"
        >
          Details
        </div>
        <div class="space-y-2">
          <div class="flex items-center justify-between text-[11px]">
            <span class="text-muted-foreground">Session ID</span>
            <span class="text-foreground font-mono text-[10px] truncate max-w-[160px]"
              >{appState.sessionId}</span
            >
          </div>
          <div class="flex items-center justify-between text-[11px]">
            <span class="text-muted-foreground">Agent</span>
            <button
              class="text-primary font-mono text-[10px] hover:underline cursor-pointer bg-transparent border-none p-0 truncate max-w-[160px]"
              onclick={() => { appState.openAgentInspector(appState.agentId); }}
              title="Inspect agent {appState.agentId}"
            >
              {appState.agentId}
            </button>
          </div>
        </div>
      </div>

      <!-- Connection -->
      <div class="px-4 py-3 border-t border-border">
        <div
          class="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2.5"
        >
          Connection
        </div>
        <div class="space-y-2">
          <div class="flex items-center justify-between text-[11px]">
            <span class="text-muted-foreground">SSE Status</span>
            <span class="flex items-center gap-1.5">
              <span
                class="w-1.5 h-1.5 rounded-full {appState.sseConnected
                  ? 'bg-green-500'
                  : 'bg-red-400'}"
              ></span>
              <span class="text-foreground"
                >{appState.sseConnected ? 'Connected' : 'Disconnected'}</span
              >
            </span>
          </div>
          {#if !appState.sseConnected}
            <button
              class="w-full text-[11px] text-primary hover:text-primary/80 bg-primary/5 hover:bg-primary/10 border border-primary/20 rounded-md py-1.5 cursor-pointer transition-colors"
              onclick={() => appState.connectSSE()}
            >
              Reconnect
            </button>
          {/if}
        </div>
      </div>

      <!-- SSE Event Log -->
      {#if appState.sseLog.length > 0}
        <div class="px-4 py-3 border-t border-border">
          <div
            class="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2"
          >
            Event Log
          </div>
          <div class="space-y-0.5">
            {#each appState.sseLog as entry}
              <div
                class="text-[10px] text-muted-foreground font-mono leading-tight truncate"
              >
                {entry}
              </div>
            {/each}
          </div>
        </div>
      {/if}
    </div>
  </div>
</div>

<!-- File Preview Dialog -->
{#if previewFile}
  <div
    class="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50"
    onclick={() => { previewFile = null; }}
    role="presentation"
  >
    <div
      class="bg-card border border-border rounded-2xl w-[720px] max-w-[94vw] max-h-[88vh] flex flex-col shadow-2xl"
      onclick={(e) => e.stopPropagation()}
      role="dialog"
      tabindex="-1"
      onkeydown={(e) => { if (e.key === 'Escape') previewFile = null; }}
    >
      <!-- Header -->
      <div class="flex items-center justify-between px-5 py-3.5 border-b border-border">
        <div class="flex items-center gap-2 min-w-0">
          <span class="text-sm font-semibold text-foreground truncate">{previewFile.name}</span>
          <span class="text-[10px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded uppercase shrink-0">{previewFile.ext}</span>
        </div>
        <div class="flex items-center gap-1.5 shrink-0">
          <a
            href={previewFile.url}
            download={previewFile.name}
            class="w-7 h-7 flex items-center justify-center rounded-md hover:bg-muted text-muted-foreground transition-colors"
            title="Download"
          >
            <Download size={14} />
          </a>
          <a
            href={previewFile.url}
            target="_blank"
            rel="noopener"
            class="w-7 h-7 flex items-center justify-center rounded-md hover:bg-muted text-muted-foreground transition-colors"
            title="Open in new tab"
          >
            <ExternalLink size={14} />
          </a>
          <button
            class="w-7 h-7 flex items-center justify-center rounded-md hover:bg-muted text-muted-foreground transition-colors cursor-pointer"
            onclick={() => { previewFile = null; }}
          >
            <X size={15} />
          </button>
        </div>
      </div>

      <!-- Preview body -->
      <div class="flex-1 overflow-auto flex items-center justify-center p-6 min-h-[200px]">
        {#if isImageExt(previewFile.ext)}
          <img
            src={previewFile.url}
            alt={previewFile.name}
            class="max-w-full max-h-[65vh] object-contain rounded-lg"
          />
        {:else if isPdfExt(previewFile.ext)}
          <iframe
            src={previewFile.url}
            title={previewFile.name}
            class="w-full h-[65vh] rounded-lg border border-border"
          ></iframe>
        {:else}
          <div class="text-center flex flex-col items-center gap-4">
            <div class="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center text-3xl">
              {#if ['doc','docx'].includes(previewFile.ext)}📝{:else if ['xls','xlsx','csv'].includes(previewFile.ext)}📊{:else if ['zip','tar','gz','7z','rar'].includes(previewFile.ext)}📦{:else}📄{/if}
            </div>
            <div>
              <p class="text-sm font-medium text-foreground">{previewFile.name}</p>
              <p class="text-xs text-muted-foreground mt-1">Preview not available for .{previewFile.ext} files</p>
            </div>
            <a
              href={previewFile.url}
              download={previewFile.name}
              class="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
            >
              <Download size={14} />
              Download
            </a>
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}

