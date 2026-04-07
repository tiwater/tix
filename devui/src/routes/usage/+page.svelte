<script lang="ts">
  import { onMount } from 'svelte';
  import { appState } from '$lib/stores/app-state.svelte';
  import {
    BarChart3,
    RefreshCw,
    Calendar,
    Cpu,
    MessageSquare,
    ChevronRight,
    ChevronDown,
    DollarSign,
    Coins
  } from 'lucide-svelte';

  onMount(() => {
    appState.fetchDailyUsage();
  });

  let expandedDays = $state<Set<string>>(new Set());
  let expandedModels = $state<Set<string>>(new Set());

  function toggleDay(date: string) {
    const next = new Set(expandedDays);
    if (next.has(date)) next.delete(date);
    else next.add(date);
    expandedDays = next;
  }

  function toggleModel(key: string) {
    const next = new Set(expandedModels);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    expandedModels = next;
  }

  const sortedDates = $derived(
    Object.keys(appState.dailyUsage).sort((a, b) => b.localeCompare(a))
  );

  function formatNum(n: number) {
    return n.toLocaleString();
  }

  function formatUsd(n: number) {
    return n.toFixed(4);
  }

  const todayStr = new Date().toISOString().split('T')[0];
  const todayData = $derived(appState.dailyUsage[todayStr]);
</script>

<div
  class="flex items-center gap-3 px-6 py-4 pb-3 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-10"
>
  <BarChart3 size={18} class="text-primary" />
  <h2 class="text-base font-semibold">Token Usage</h2>
  <div class="ml-auto">
    <button
      class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-muted-foreground border border-border rounded-md cursor-pointer hover:bg-accent hover:text-foreground transition-colors group"
      onclick={() => appState.fetchDailyUsage()}
    >
      <RefreshCw size={12} class={appState.dailyUsageLoading ? "animate-spin" : "group-active:animate-spin"} /> Refresh
    </button>
  </div>
</div>

<div class="p-6 overflow-y-auto flex-1 bg-muted/10">
  <div class="max-w-5xl mx-auto space-y-6">
    <!-- Summary Cards -->
    <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div class="bg-card border border-border rounded-xl p-4 shadow-sm">
        <div class="flex items-center gap-2 text-muted-foreground mb-2 text-xs font-medium uppercase tracking-wider">
          <Calendar size={14} /> Today's Tokens
        </div>
        <div class="text-2xl font-bold tabular-nums">
          {todayData ? formatNum(todayData.total.tokens_total) : '0'}
        </div>
        <div class="text-[10px] text-muted-foreground mt-1">
          {todayData ? `${formatNum(todayData.total.tokens_in)} in / ${formatNum(todayData.total.tokens_out)} out` : '0 in / 0 out'}
        </div>
      </div>

      <div class="bg-card border border-border rounded-xl p-4 shadow-sm">
        <div class="flex items-center gap-2 text-muted-foreground mb-2 text-xs font-medium uppercase tracking-wider">
          <DollarSign size={14} /> Today's Est. Cost
        </div>
        <div class="text-2xl font-bold tabular-nums">
          ${todayData ? formatUsd(todayData.total.estimated_cost_usd) : '0.0000'}
        </div>
        <div class="text-[10px] text-muted-foreground mt-1 uppercase">USD</div>
      </div>

      <div class="bg-card border border-border rounded-xl p-4 shadow-sm">
        <div class="flex items-center gap-2 text-muted-foreground mb-2 text-xs font-medium uppercase tracking-wider">
          <Coins size={14} /> Total Lifetime
        </div>
        <div class="text-2xl font-bold tabular-nums">
          {formatNum(Object.values(appState.dailyUsage).reduce((sum, d) => sum + d.total.tokens_total, 0))}
        </div>
        <div class="text-[10px] text-muted-foreground mt-1">Tokens across all agents</div>
      </div>
    </div>

    <!-- Daily Breakdown -->
    <div class="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
      <div class="px-4 py-3 border-b border-border bg-muted/30">
        <h3 class="text-sm font-semibold">Usage Ledger</h3>
      </div>

      <div class="divide-y border-border">
        {#if sortedDates.length === 0}
          <div class="p-8 text-center text-muted-foreground text-sm">
            No usage data recorded yet.
          </div>
        {:else}
          {#each sortedDates as date}
            {@const day = appState.dailyUsage[date]}
            {@const isDayExpanded = expandedDays.has(date)}
            
            <div class="flex flex-col">
              <!-- Day Row -->
              <button 
                class="flex items-center gap-4 px-4 py-3 hover:bg-muted/50 transition-colors text-left w-full"
                onclick={() => toggleDay(date)}
              >
                <div class="text-muted-foreground">
                  {#if isDayExpanded}<ChevronDown size={16} />{:else}<ChevronRight size={16} />{/if}
                </div>
                <div class="flex-1">
                  <div class="text-sm font-medium">{date === todayStr ? 'Today' : date}</div>
                  <div class="text-[10px] text-muted-foreground">
                    {Object.keys(day.models).length} models · {Object.values(day.models).reduce((sum, m) => sum + Object.keys(m.sessions).length, 0)} sessions
                  </div>
                </div>
                <div class="text-right">
                  <div class="text-sm font-bold tabular-nums">{formatNum(day.total.tokens_total)}</div>
                  <div class="text-[10px] text-muted-foreground">${formatUsd(day.total.estimated_cost_usd)}</div>
                </div>
              </button>

              <!-- Models Breakdown -->
              {#if isDayExpanded}
                <div class="bg-muted/20 border-t border-border/50">
                  {#each Object.entries(day.models) as [modelId, model]}
                    {@const modelKey = `${date}:${modelId}`}
                    {@const isModelExpanded = expandedModels.has(modelKey)}
                    
                    <div class="flex flex-col border-b border-border/30 last:border-0">
                      <button 
                        class="flex items-center gap-4 pl-10 pr-4 py-2 hover:bg-muted/50 transition-colors text-left w-full"
                        onclick={() => toggleModel(modelKey)}
                      >
                        <div class="text-muted-foreground/60">
                          {#if isModelExpanded}<ChevronDown size={14} />{:else}<ChevronRight size={14} />{/if}
                        </div>
                        <div class="flex-1 flex items-center gap-2">
                          <Cpu size={12} class="text-primary/60" />
                          <span class="text-xs font-semibold font-mono truncate">{modelId}</span>
                        </div>
                        <div class="text-right">
                          <div class="text-xs font-medium tabular-nums">{formatNum(model.total.tokens_total)}</div>
                          <div class="text-[9px] text-muted-foreground">${formatUsd(model.total.estimated_cost_usd)}</div>
                        </div>
                      </button>

                      <!-- Sessions Breakdown -->
                      {#if isModelExpanded}
                        <div class="bg-background/40 divide-y divide-border/20">
                          {#each Object.entries(model.sessions) as [sid, sess]}
                            <div class="flex items-center gap-4 pl-16 pr-4 py-1.5">
                              <div class="flex-1 min-w-0">
                                <div class="flex items-center gap-1.5 mb-0.5">
                                  <span class="text-[11px] font-medium text-foreground truncate">{sess.agent_name || sess.agent_id}</span>
                                  <span class="text-[9px] px-1 rounded bg-muted text-muted-foreground font-mono">...{sid.slice(-6)}</span>
                                </div>
                                <div class="text-[9px] text-muted-foreground truncate">
                                  {formatNum(sess.tokens_in)} in / {formatNum(sess.tokens_out)} out
                                </div>
                              </div>
                              <div class="text-right shrink-0">
                                <div class="text-[11px] font-medium tabular-nums">{formatNum(sess.tokens_total)}</div>
                                <div class="text-[9px] text-muted-foreground">${formatUsd(sess.estimated_cost_usd)}</div>
                              </div>
                            </div>
                          {/each}
                        </div>
                      {/if}
                    </div>
                  {/each}
                </div>
              {/if}
            </div>
          {/each}
        {/if}
      </div>
    </div>
  </div>
</div>
