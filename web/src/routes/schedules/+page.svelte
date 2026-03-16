<script lang="ts">
  import { onMount } from 'svelte';
  import { appState } from '$lib/stores/app-state.svelte';
  import { Clock, RefreshCw, Play, Pause, Trash2 } from 'lucide-svelte';

  onMount(() => { appState.fetchSchedules(); });
</script>

<div class="flex items-center gap-3 px-6 py-4 pb-3 border-b border-border">
  <Clock size={18} class="text-primary" />
  <h2 class="text-base font-semibold">Schedules</h2>
  <div class="ml-auto flex gap-2">
    <button class="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium text-muted-foreground border border-border rounded-md cursor-pointer hover:bg-accent hover:text-foreground" onclick={() => appState.fetchSchedules()}><RefreshCw size={12} /> Refresh</button>
  </div>
</div>

<div class="flex-1 overflow-y-auto">
  {#if appState.schedulesLoading}
    <div class="flex flex-col items-center justify-center flex-1 gap-2.5 p-10 text-muted-foreground">
      <div class="text-4xl">⏳</div>
      <div class="text-sm text-center max-w-[280px]">Loading schedules…</div>
    </div>
  {:else if appState.schedules.length === 0}
    <div class="flex flex-col items-center justify-center flex-1 gap-2.5 p-10 text-muted-foreground">
      <div class="text-4xl">⏰</div>
      <div class="text-sm text-center max-w-[280px]">No schedules yet. Ask an agent to schedule a task via chat.</div>
    </div>
  {:else}
    <table class="w-full border-collapse">
      <thead>
        <tr>
          {#each ['Status', 'Agent', 'Cron', 'Prompt', 'Next Run', 'Actions'] as col}
            <th class="text-left text-[11px] font-semibold tracking-wider text-muted-foreground uppercase px-3 py-2 border-b border-border">{col}</th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#each appState.schedules as sched}
          <tr class="hover:bg-accent/50">
            <td class="px-3 py-2.5 text-[13px] border-b border-border">
              <span class="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full {sched.status === 'active' ? 'bg-green-500/10 text-green-500' : 'bg-destructive/10 text-destructive'}">
                {#if sched.status === 'active'}▶{:else}⏸{/if} {sched.status}
              </span>
            </td>
            <td class="px-3 py-2.5 text-xs text-muted-foreground border-b border-border">{sched.agent_id}</td>
            <td class="px-3 py-2.5 border-b border-border"><code class="font-mono text-xs text-cyan-500">{sched.cron}</code></td>
            <td class="px-3 py-2.5 text-[13px] border-b border-border max-w-[280px] whitespace-nowrap overflow-hidden text-ellipsis" title={sched.prompt}>{sched.prompt}</td>
            <td class="px-3 py-2.5 text-xs text-muted-foreground whitespace-nowrap border-b border-border">{appState.formatShortDate(sched.next_run)}</td>
            <td class="px-3 py-2.5 border-b border-border">
              <div class="flex gap-1">
                <button class="w-[30px] h-[30px] inline-flex items-center justify-center bg-muted border border-border rounded-md cursor-pointer text-muted-foreground hover:bg-accent hover:text-foreground transition-colors" title={sched.status === 'active' ? 'Pause' : 'Resume'} onclick={() => appState.toggleSchedule(sched.id, sched.status)}>
                  {#if sched.status === 'active'}<Pause size={13} />{:else}<Play size={13} />{/if}
                </button>
                <button class="w-[30px] h-[30px] inline-flex items-center justify-center bg-muted border border-border rounded-md cursor-pointer text-muted-foreground hover:bg-destructive/10 hover:text-destructive hover:border-destructive transition-colors" title="Delete" onclick={() => appState.removeSchedule(sched.id)}><Trash2 size={13} /></button>
              </div>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>
