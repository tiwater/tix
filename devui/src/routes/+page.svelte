<script lang="ts">
  import { appState } from '$lib/stores/app-state.svelte';
  import { Bot, MessageSquare, Plus, ArrowRight } from 'lucide-svelte';
</script>

<div class="flex flex-col items-center justify-center flex-1 h-full gap-8 text-center px-6 overflow-y-auto py-12">
  <div class="flex flex-col items-center gap-4 max-w-[480px]">
    <!-- Logo / icon -->
    <div class="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-2">
      <Bot size={32} class="text-primary" />
    </div>

    <h2 class="text-2xl font-bold text-foreground">Welcome to Tix DevUI</h2>
    
    {#if appState.agents.length === 0}
      <p class="text-[15px] text-muted-foreground leading-relaxed px-4">
        You don't have any agents yet. Create your first agent to start conversing and exploring capabilities.
      </p>
    {:else}
      <p class="text-[15px] text-muted-foreground leading-relaxed px-4">
        Select an agent below to start a new chat session, or manage them in the sidebar.
      </p>
    {/if}
  </div>

  <!-- Primary Actions -->
  <div class="w-full max-w-[560px]">
    {#if appState.agents.length === 0}
      <div class="flex justify-center mt-2">
        <button
          class="flex items-center gap-2.5 px-6 py-3 text-[15px] font-medium text-primary-foreground bg-primary rounded-xl hover:bg-primary/90 transition-all cursor-pointer shadow-sm active:scale-95"
          onclick={() => { appState.showNewAgent = true; }}
        >
          <Plus size={18} class="shrink-0" />
          Create Your First Agent
        </button>
      </div>
    {:else}
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
        {#each appState.agents as agent (agent.agent_id)}
          <button
            class="group text-left flex flex-col gap-3 p-4 bg-card border border-border rounded-2xl hover:border-primary/40 hover:shadow-sm transition-all cursor-pointer relative overflow-hidden"
            onclick={() => appState.createSession(agent.agent_id)}
          >
            <div class="flex items-center justify-between w-full">
              <div class="flex items-center gap-2.5 text-foreground font-semibold">
                <div class="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                  <Bot size={16} class="text-primary" />
                </div>
                <span class="truncate">{agent.agent_id}</span>
              </div>
              <ArrowRight size={16} class="text-muted-foreground group-hover:text-primary transition-colors group-hover:translate-x-0.5" />
            </div>
            
            <div class="text-xs text-muted-foreground line-clamp-2">
              Start a new session with <span class="font-medium text-foreground/70">{agent.agent_id}</span>.
            </div>
          </button>
        {/each}
        
        <button
          class="group text-left flex flex-col items-center justify-center gap-2 p-4 border border-dashed border-border rounded-2xl hover:border-primary/40 hover:bg-muted/30 transition-all cursor-pointer min-h-[100px]"
          onclick={() => { appState.showNewAgent = true; }}
        >
          <Plus size={20} class="text-muted-foreground group-hover:text-primary transition-colors" />
          <span class="text-sm font-medium text-muted-foreground group-hover:text-foreground transition-colors">Create New Agent</span>
        </button>
      </div>
    {/if}
  </div>
</div>
