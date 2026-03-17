<script lang="ts">
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { appState } from '$lib/stores/app-state.svelte';
  import { Bot, Plus, RefreshCw, MessageSquare, Trash2, ExternalLink } from 'lucide-svelte';
  import * as Accordion from "$lib/components/ui/accordion";

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
    <div class="max-w-4xl mx-auto">
      <Accordion.Root type="multiple" class="w-full space-y-3">
        {#each appState.agents as agent}
          <Accordion.Item value={agent.agent_id} class="bg-card border border-border rounded-xl overflow-hidden shadow-sm px-1 data-[state=open]:border-primary/30 transition-colors">
            <Accordion.Trigger class="px-5 py-4 hover:no-underline hover:bg-accent/50 rounded-lg group" onclick={() => { if (!appState.sessions.some(s => s.agent_id === agent.agent_id)) appState.fetchSessionsForAgent(agent.agent_id); }}>
              <div class="flex gap-4 w-full text-left items-center mr-4">
                <div class="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary shrink-0 group-hover:bg-primary/20 transition-colors">
                  <Bot size={20} />
                </div>
                <div class="flex flex-col flex-1">
                  <div class="text-base font-semibold text-foreground truncate">{agent.agent_id}</div>
                  <div class="text-xs text-muted-foreground mt-0.5">{agent.session_count} active session{agent.session_count !== 1 ? 's' : ''}</div>
                </div>
                <div class="hidden sm:flex text-[11px] text-muted-foreground">
                  Last Active: {appState.formatDate(agent.last_active) || 'Unknown'}
                </div>
              </div>
            </Accordion.Trigger>
            
            <Accordion.Content class="px-5 pb-5 pt-2">
              <div class="px-2">
                <div class="flex items-center justify-between mb-3">
                  <h4 class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Active Sessions</h4>
                  <button 
                    class="inline-flex items-center gap-1.5 font-medium text-primary bg-primary/10 px-2 py-1 rounded-md hover:bg-primary/20 text-xs transition-colors"
                    onclick={() => {
                      appState.newSessionAgentId = agent.agent_id;
                      appState.showNewSession = true;
                    }}
                  >
                    <Plus size={12} /> New Session
                  </button>
                </div>
                
                {#if appState.sessions.filter(s => s.agent_id === agent.agent_id).length === 0}
                  <div class="px-2 py-4 text-center flex flex-col items-center justify-center gap-2">
                    <MessageSquare size={16} class="text-muted-foreground/50" />
                    <span class="text-xs text-muted-foreground">No active sessions for this agent.</span>
                  </div>
                {:else}
                  <div class="flex flex-col">
                    {#each appState.sessions.filter(s => s.agent_id === agent.agent_id) as sess}
                      <div class="flex items-center justify-between px-3 py-2.5 hover:bg-muted/50 rounded-md transition-colors group cursor-default">
                        <div class="flex items-center gap-3 overflow-hidden">
                          <MessageSquare size={14} class="text-primary/70 shrink-0" />
                          <span class="text-sm font-medium truncate" title={sess.session_id}>{sess.session_id}</span>
                          {#if sess.channel !== 'web' && sess.channel !== 'http'}
                            <span class="text-[9px] uppercase font-semibold bg-muted px-1.5 py-0.5 rounded border border-border/50 text-muted-foreground shrink-0">{sess.channel}</span>
                          {/if}
                        </div>
                        
                        <div class="flex items-center gap-4 shrink-0">
                          <span class="text-[11px] text-muted-foreground w-16 text-right">{appState.formatShortDate(sess.created_at)}</span>
                          <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button 
                              class="p-1 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded" 
                              title="Open chat"
                              onclick={() => {
                                appState.selectSession(sess);
                                goto('/chat');
                              }}
                            >
                              <ExternalLink size={14} />
                            </button>
                            <button 
                              class="p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded" 
                              title="Delete session"
                              onclick={(e) => {
                                e.stopPropagation();
                                appState.deleteSession(sess.session_id);
                              }}
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      </div>
                    {/each}
                  </div>
                {/if}
              </div>
            </Accordion.Content>
          </Accordion.Item>
        {/each}
      </Accordion.Root>
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
