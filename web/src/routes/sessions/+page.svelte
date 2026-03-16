<script lang="ts">
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { appState } from '$lib/stores/app-state.svelte';
  import { Bot, Plus, RefreshCw } from 'lucide-svelte';

  onMount(() => { appState.fetchAgents(); });
</script>

<div class="flex items-center gap-3 px-6 py-4 pb-3 border-b border-border">
  <Bot size={18} class="text-primary" />
  <h2 class="text-base font-semibold">Agents & Sessions</h2>
  <div class="ml-auto flex gap-2">
    <button class="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium bg-primary/10 text-primary border border-primary rounded-md cursor-pointer hover:bg-primary/20" onclick={() => { appState.showNewAgent = true; }}><Plus size={12} /> New Agent</button>
    <button class="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium text-muted-foreground border border-border rounded-md cursor-pointer hover:bg-accent hover:text-foreground" onclick={() => appState.fetchAgents()}><RefreshCw size={12} /> Refresh</button>
  </div>
</div>

<div class="grid flex-1 overflow-hidden" style="grid-template-columns: 200px 1fr">
  <!-- Agents column -->
  <div class="border-r border-border overflow-y-auto p-2">
    <div class="text-[11px] font-semibold tracking-wider uppercase text-muted-foreground px-2 py-1.5 pb-2.5">Agents</div>
    {#if appState.agentsLoading}
      <div class="p-4 text-xs text-muted-foreground text-center">⏳ Loading…</div>
    {:else if appState.agents.length === 0}
      <div class="p-4 text-xs text-muted-foreground text-center">No agents yet. Create one!</div>
    {:else}
      {#each appState.agents as agent}
        <button
          class="block w-full bg-transparent border-none text-left px-2.5 py-2 rounded-lg cursor-pointer text-foreground transition-colors hover:bg-accent {appState.selectedAgentId === agent.agent_id ? 'bg-primary/10' : ''}"
          onclick={() => appState.fetchSessionsForAgent(agent.agent_id)}
        >
          <div class="text-[13px] font-medium">{agent.agent_id}</div>
          <div class="text-[11px] text-muted-foreground mt-0.5">{agent.session_count} session{agent.session_count !== 1 ? 's' : ''}</div>
        </button>
      {/each}
    {/if}
  </div>

  <!-- Sessions column -->
  <div class="overflow-y-auto p-2">
    {#if appState.selectedAgentId}
      <div class="flex items-center text-[11px] font-semibold tracking-wider uppercase text-muted-foreground px-2 py-1.5 pb-2.5">
        Sessions for <strong class="ml-1">{appState.selectedAgentId}</strong>
        <button class="ml-auto inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium bg-primary/10 text-primary border border-primary rounded-md cursor-pointer hover:bg-primary/20" onclick={() => { appState.newSessionAgentId = appState.selectedAgentId || ''; appState.showNewSession = true; }}><Plus size={12} /> New Session</button>
      </div>
      {#if appState.sessions.length === 0}
        <div class="p-4 text-xs text-muted-foreground text-center">No sessions. Create one to start chatting.</div>
      {:else}
        {#each appState.sessions as sess}
          <button class="block w-full bg-transparent border border-border rounded-lg text-left px-3 py-2.5 mb-1.5 cursor-pointer text-foreground transition-colors hover:bg-accent" onclick={() => { appState.selectSession(sess); goto('/chat'); }}>
            <div class="text-xs font-medium font-mono">{sess.session_id.slice(0, 12)}…</div>
            <div class="flex items-center gap-2 mt-1 text-[11px]">
              <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium {sess.status === 'active' ? 'bg-green-500/10 text-green-500' : 'bg-destructive/10 text-destructive'}">{sess.status}</span>
              <span class="text-muted-foreground">{sess.channel}</span>
              <span class="text-muted-foreground/60 ml-auto">{appState.formatShortDate(sess.updated_at)}</span>
            </div>
          </button>
        {/each}
      {/if}
    {:else}
      <div class="p-4 text-xs text-muted-foreground text-center">← Select an agent to see sessions</div>
    {/if}
  </div>
</div>

<!-- New Agent Modal -->
{#if appState.showNewAgent}
  <div class="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50" onclick={() => (appState.showNewAgent = false)} role="presentation">
    <div class="bg-card border border-border rounded-2xl p-6 w-[400px] max-w-[90vw]" onclick={(e) => e.stopPropagation()} role="dialog" tabindex="-1" onkeydown={(e) => { if (e.key === 'Escape') appState.showNewAgent = false; }}>
      <h3 class="text-base font-semibold mb-4">Create New Agent</h3>
      <div class="mb-3.5">
        <label for="new-agent-name" class="block text-xs text-muted-foreground mb-1.5">Agent Name</label>
        <input id="new-agent-name" class="w-full bg-muted border border-border rounded-lg text-foreground text-[13px] px-3 py-2 outline-none focus:border-primary" bind:value={appState.newAgentName} placeholder="my-agent" onkeydown={(e) => { if (e.key === 'Enter') appState.createAgent(); }} />
      </div>
      <div class="flex justify-end gap-2 mt-2">
        <button class="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium text-muted-foreground border border-border rounded-md cursor-pointer hover:bg-accent hover:text-foreground" onclick={() => (appState.showNewAgent = false)}>Cancel</button>
        <button class="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium bg-primary/10 text-primary border border-primary rounded-md cursor-pointer hover:bg-primary/20 disabled:opacity-40 disabled:cursor-not-allowed" onclick={() => appState.createAgent()} disabled={!appState.newAgentName.trim()}>Create</button>
      </div>
    </div>
  </div>
{/if}

<!-- New Session Modal -->
{#if appState.showNewSession}
  <div class="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50" onclick={() => (appState.showNewSession = false)} role="presentation">
    <div class="bg-card border border-border rounded-2xl p-6 w-[400px] max-w-[90vw]" onclick={(e) => e.stopPropagation()} role="dialog" tabindex="-1" onkeydown={(e) => { if (e.key === 'Escape') appState.showNewSession = false; }}>
      <h3 class="text-base font-semibold mb-4">Create New Session</h3>
      <div class="mb-3.5">
        <label for="new-session-agent" class="block text-xs text-muted-foreground mb-1.5">Agent</label>
        <input id="new-session-agent" class="w-full bg-muted border border-border rounded-lg text-foreground text-[13px] px-3 py-2 outline-none focus:border-primary" bind:value={appState.newSessionAgentId} placeholder="agent-id" />
      </div>
      <div class="flex justify-end gap-2 mt-2">
        <button class="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium text-muted-foreground border border-border rounded-md cursor-pointer hover:bg-accent hover:text-foreground" onclick={() => (appState.showNewSession = false)}>Cancel</button>
        <button class="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium bg-primary/10 text-primary border border-primary rounded-md cursor-pointer hover:bg-primary/20 disabled:opacity-40 disabled:cursor-not-allowed" onclick={() => appState.createSession()} disabled={!appState.newSessionAgentId}>Create</button>
      </div>
    </div>
  </div>
{/if}
