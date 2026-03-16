<script lang="ts">
  import { onMount } from 'svelte';
  import { appState } from '$lib/stores/app-state.svelte';
  import { Server, RefreshCw, Unlock } from 'lucide-svelte';

  onMount(() => { appState.fetchNode(); });
</script>

<div class="flex items-center gap-3 px-6 py-4 pb-3 border-b border-border">
  <Server size={18} class="text-primary" />
  <h2 class="text-base font-semibold">Node</h2>
  <div class="ml-auto">
    <button class="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium text-muted-foreground border border-border rounded-md cursor-pointer hover:bg-accent hover:text-foreground" onclick={() => appState.fetchNode()}><RefreshCw size={12} /> Refresh</button>
  </div>
</div>

<div class="p-4 overflow-y-auto flex-1">
  {#if appState.nodeLoading}
    <div class="flex flex-col items-center justify-center flex-1 gap-2.5 p-10 text-muted-foreground">
      <div class="text-4xl">⏳</div>
      <div class="text-sm text-center max-w-[280px]">Loading node info…</div>
    </div>
  {:else if appState.nodeInfo}
    <div class="bg-card border border-border rounded-xl p-3.5 mb-3">
      <h3 class="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2.5">Identity</h3>
      <div class="flex justify-between items-center py-1 text-[13px]">
        <span class="text-muted-foreground">Hostname</span>
        <span>{appState.nodeInfo.hostname || '—'}</span>
      </div>
    </div>

    <div class="bg-card border border-border rounded-xl p-3.5 mb-3">
      <h3 class="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2.5">Enrollment</h3>
      <div class="flex justify-between items-center py-1 text-[13px]">
        <span class="text-muted-foreground">Trust State</span>
        <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold {appState.nodeInfo.enrollment.trust_state === 'trusted' ? 'bg-green-500/10 text-green-500' : appState.nodeInfo.enrollment.trust_state === 'pending' ? 'bg-yellow-500/10 text-yellow-500' : 'bg-destructive/10 text-destructive'}">{appState.nodeInfo.enrollment.trust_state}</span>
      </div>
      {#if appState.nodeInfo.enrollment.trust_state !== 'trusted'}
        <div class="mt-2">
          <button class="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium text-green-500 border border-green-500 rounded-md cursor-pointer hover:bg-green-500/10" onclick={() => appState.trustNode()}><Unlock size={12} /> Trust this Node</button>
        </div>
      {/if}
      <div class="flex justify-between items-center py-1 text-[13px]">
        <span class="text-muted-foreground">Fingerprint</span>
        <span class="text-[11px]">{appState.nodeInfo.enrollment.fingerprint?.slice(0, 16) || '—'}…</span>
      </div>
      {#if appState.nodeInfo.enrollment.trusted_at}
        <div class="flex justify-between items-center py-1 text-[13px]">
          <span class="text-muted-foreground">Trusted At</span>
          <span class="text-xs">{appState.formatDate(appState.nodeInfo.enrollment.trusted_at)}</span>
        </div>
      {/if}
    </div>

    {#if appState.nodeInfo.executor}
      <div class="bg-card border border-border rounded-xl p-3.5 mb-3">
        <h3 class="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2.5">Executor</h3>
        <div class="flex gap-3">
          {#each [
            { label: 'Active', value: appState.nodeInfo.executor.active_tasks ?? 0 },
            { label: 'Queued', value: appState.nodeInfo.executor.queued_tasks ?? 0 },
            { label: 'Slots', value: appState.nodeInfo.executor.total_slots ?? 0 },
          ] as stat}
            <div class="flex-1 bg-muted border border-border rounded-lg p-2.5 text-center">
              <div class="text-2xl font-bold text-primary">{stat.value}</div>
              <div class="text-[11px] text-muted-foreground mt-0.5">{stat.label}</div>
            </div>
          {/each}
        </div>
      </div>
    {/if}
  {:else}
    <div class="flex flex-col items-center justify-center flex-1 gap-2.5 p-10 text-muted-foreground">
      <div class="text-4xl">⚙️</div>
      <div class="text-sm text-center max-w-[280px]">No node data available</div>
    </div>
  {/if}
</div>
