<script lang="ts">
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { appState } from '$lib/stores/app-state.svelte';
  import { Bot, Plus, RefreshCw } from 'lucide-svelte';

  onMount(() => { appState.fetchAgents(); });
</script>

<div class="flex items-center gap-3 px-6 py-4 pb-3 border-b border-border">
  <Bot size={18} class="text-primary" />
  <h2 class="text-base font-semibold">Agents</h2>
  <div class="ml-auto flex gap-2">
    <button class="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium bg-primary/10 text-primary border border-primary rounded-md cursor-pointer hover:bg-primary/20" onclick={() => { appState.showNewAgent = true; }}><Plus size={12} /> New Agent</button>
    <button class="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium text-muted-foreground border border-border rounded-md cursor-pointer hover:bg-accent hover:text-foreground" onclick={() => appState.fetchAgents()}><RefreshCw size={12} /> Refresh</button>
  </div>
</div>

<div class="flex-1 overflow-y-auto p-6">
  {#if appState.agentsLoading}
    <div class="p-4 text-xs text-muted-foreground text-center">⏳ Loading…</div>
  {:else if appState.agents.length === 0}
    <div class="p-8 flex flex-col items-center justify-center text-center">
      <Bot size={48} class="text-muted/50 mb-4" />
      <h3 class="text-lg font-medium text-foreground mb-1">No agents found</h3>
      <p class="text-sm text-muted-foreground mb-4">Create your first agent to get started.</p>
      <button class="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-md shadow hover:bg-primary/90" onclick={() => { appState.showNewAgent = true; }}><Plus size={16} /> New Agent</button>
    </div>
  {:else}
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {#each appState.agents as agent}
        <button
          class="flex flex-col items-start bg-card border border-border text-left px-5 py-4 rounded-xl cursor-pointer transition-all hover:bg-accent hover:border-accent-foreground/20 hover:shadow-sm"
          onclick={() => {
            appState.fetchSessionsForAgent(agent.agent_id);
            appState.newSessionAgentId = agent.agent_id;
            appState.showNewSession = true;
          }}
        >
          <div class="flex items-center gap-3 w-full mb-3">
            <div class="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary shrink-0">
              <Bot size={20} />
            </div>
            <div class="flex-1 min-w-0">
              <div class="text-[15px] font-semibold text-foreground truncate">{agent.agent_id}</div>
              <div class="text-[12px] text-muted-foreground mt-0.5">{agent.session_count} active session{agent.session_count !== 1 ? 's' : ''}</div>
            </div>
          </div>
          <div class="w-full mt-auto pt-3 border-t border-border flex flex-row-reverse items-center justify-between text-[11px] text-muted-foreground">
            <span class="inline-flex items-center gap-1 font-medium text-primary bg-primary/10 px-2 py-0.5 rounded-md hover:bg-primary/20"><Plus size={11} /> New Session</span>
          </div>
        </button>
      {/each}
    </div>
  {/if}
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
