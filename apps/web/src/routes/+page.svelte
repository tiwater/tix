<script lang="ts">
  import { appState } from '$lib/stores/app-state.svelte';
  import { Bot, MessageSquare, Zap, Plus } from 'lucide-svelte';
</script>

<div class="flex flex-col items-center justify-center flex-1 h-full gap-6 text-center px-6">
  <!-- Logo / icon -->
  <div class="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
    <Bot size={32} class="text-primary" />
  </div>

  <div class="flex flex-col gap-1.5 max-w-[360px]">
    <h2 class="text-lg font-semibold text-foreground">TiClaw DevUI</h2>
    <p class="text-sm text-muted-foreground leading-relaxed">
      Select a session from the sidebar to start chatting, or create a new one.
    </p>
  </div>

  <!-- Quick actions -->
  <div class="flex flex-col gap-2 w-full max-w-[280px]">
    {#if appState.agents.length > 0}
      <button
        class="flex items-center gap-2.5 px-4 py-2.5 text-sm font-medium text-foreground bg-card border border-border rounded-xl hover:bg-accent hover:border-primary/30 transition-all cursor-pointer"
        onclick={() => appState.createSession(appState.agents[0].agent_id)}
      >
        <MessageSquare size={15} class="text-primary shrink-0" />
        New Session
      </button>
    {/if}
    <a
      href="/schedules"
      class="flex items-center gap-2.5 px-4 py-2.5 text-sm font-medium text-foreground bg-card border border-border rounded-xl hover:bg-accent hover:border-primary/30 transition-all cursor-pointer no-underline"
    >
      <Zap size={15} class="text-primary shrink-0" />
      Automations
    </a>
  </div>
</div>
