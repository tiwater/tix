<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { appState } from '$lib/stores/app-state.svelte';
  import {
    Monitor,
    RefreshCw,
    ShieldCheck,
    ShieldAlert,
    Cpu,
    HardDrive,
    Zap,
    Info,
    Clock,
    FingerprintPattern,
    Unlock,
    Activity,
    Database,
    Network,
    Bot,
    Plus,
    Trash2,
  } from 'lucide-svelte';
  import * as Accordion from '$lib/components/ui/accordion';

  let refreshTimer: NodeJS.Timeout;

  onMount(() => {
    appState.fetchNode();
    // Auto-refresh stats every 5 seconds to feel like a dashboard
    refreshTimer = setInterval(() => {
      appState.fetchNode();
    }, 5000);
  });

  onDestroy(() => {
    if (refreshTimer) clearInterval(refreshTimer);
  });
</script>

<div
  class="flex items-center gap-3 px-6 py-4 pb-3 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-10"
>
  <Monitor size={18} class="text-primary" />
  <h2 class="text-base font-semibold">Computer Overview</h2>
  <div class="ml-auto">
    <button
      class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-muted-foreground border border-border rounded-md cursor-pointer hover:bg-accent hover:text-foreground transition-colors group"
      onclick={() => appState.fetchNode()}
    >
      <RefreshCw size={12} class="group-active:animate-spin" /> Refresh
    </button>
  </div>
</div>

<div class="p-6 overflow-y-auto flex-1 bg-muted/10">
  {#if appState.nodeLoading && !appState.nodeInfo}
    <div
      class="flex flex-col items-center justify-center h-[60vh] gap-4 text-muted-foreground"
    >
      <Monitor size={32} class="text-muted/50 mb-2" />
      <div class="text-sm font-medium">Connecting to Computer…</div>
    </div>
  {:else if appState.nodeInfo}
    <div class="max-w-5xl mx-auto space-y-6">
      <!-- Top Row: Identity & Primary Status -->
      <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
        <!-- Identity Card -->
        <div
          class="md:col-span-2 bg-gradient-to-br from-card to-muted/30 border border-border rounded-2xl p-6 shadow-sm flex flex-col justify-between relative overflow-hidden group"
        >
          <div
            class="absolute -right-4 -top-4 w-32 h-32 bg-primary/5 rounded-full blur-2xl group-hover:bg-primary/10 transition-colors duration-500"
          ></div>

          <div>
            <div class="flex items-center gap-2 mb-2">
              <span
                class="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10 text-primary"
              >
                <Monitor size={16} />
              </span>
              <h3
                class="text-sm font-semibold text-muted-foreground uppercase tracking-wider"
              >
                Host Identity
              </h3>
            </div>

            <div class="mt-4 flex items-end gap-3">
              <h2 class="text-3xl font-bold tracking-tight text-foreground">
                {appState.nodeInfo.hostname || 'Unknown Host'}
              </h2>
            </div>
          </div>

          <div class="mt-8 flex items-center gap-4">
            <div
              class="flex items-center gap-2 border border-border/50 bg-background/50 backdrop-blur-sm rounded-full px-3 py-1.5 shadow-sm"
            >
              {#if appState.nodeInfo.enrollment.trust_state === 'trusted'}
                <ShieldCheck size={14} class="text-emerald-500" />
                <span
                  class="text-xs font-medium text-emerald-600 dark:text-emerald-400"
                  >Trusted Access</span
                >
              {:else if appState.nodeInfo.enrollment.trust_state === 'pending'}
                <ShieldAlert size={14} class="text-amber-500" />
                <span
                  class="text-xs font-medium text-amber-600 dark:text-amber-400"
                  >Pending Trust</span
                >
              {:else}
                <ShieldAlert size={14} class="text-rose-500" />
                <span
                  class="text-xs font-medium text-rose-600 dark:text-rose-400 capitalize"
                  >{appState.nodeInfo.enrollment.trust_state}</span
                >
              {/if}
            </div>

            {#if appState.nodeInfo.enrollment.trust_state !== 'trusted'}
              <button
                class="inline-flex items-center gap-2 px-4 py-1.5 text-xs font-semibold bg-emerald-500 hover:bg-emerald-600 text-white rounded-full shadow-sm transition-colors cursor-pointer"
                onclick={() => appState.trustNode()}
              >
                <Unlock size={14} /> Trust this Computer
              </button>
            {/if}
          </div>
        </div>

        <!-- Mini Metrics / Quick Stats -->
        {#if appState.nodeInfo.executor}
          <div
            class="bg-card border border-border rounded-2xl p-6 shadow-sm flex flex-col"
          >
            <div class="flex items-center justify-between mb-6">
              <h3 class="text-base font-semibold text-foreground">
                Task Executor
              </h3>
              <Zap size={16} class="text-primary hidden sm:block" />
            </div>

            <div class="flex-1 flex flex-col justify-center gap-4">
              <!-- Skill Pool Overview -->
              <div
                class="bg-muted/30 border border-border/50 rounded-xl p-4 flex items-center justify-between"
              >
                <div class="flex items-center gap-1.5 text-primary">
                  <Zap size={14} />
                  <span class="text-xs font-semibold uppercase tracking-wider"
                    >Global Skill Pool</span
                  >
                </div>
                <div
                  class="text-xs font-medium text-muted-foreground flex items-center gap-2"
                >
                  <span class="text-foreground font-bold text-sm"
                    >{appState.nodeInfo.skills?.total_available ?? 0}</span
                  >
                  Available
                </div>
              </div>

              <!-- Agent Isolation -->
              <div
                class="bg-muted/30 border border-border/50 rounded-xl p-4 flex items-center justify-between"
              >
                <div class="flex items-center gap-1.5 text-muted-foreground">
                  <ShieldCheck size={14} class="text-emerald-500" />
                  <span class="text-xs font-semibold uppercase tracking-wider"
                    >Skill Isolation Guard</span
                  >
                </div>
                <span
                  class="text-xs font-bold text-emerald-500 bg-emerald-500/10 px-2 py-0.5 rounded-full"
                >
                  Active
                </span>
              </div>
            </div>
          </div>
        {/if}
      </div>

      <!-- System Telemetry Row -->
      {#if appState.nodeInfo.os}
        <div class="bg-card border border-border rounded-2xl p-6 shadow-sm">
          <div class="flex items-center gap-2 mb-6">
            <Activity size={18} class="text-primary" />
            <h3 class="text-base font-semibold text-foreground">
              System Telemetry
            </h3>
            <div
              class="ml-auto text-xs text-muted-foreground font-mono bg-muted px-2 py-0.5 rounded"
            >
              {appState.nodeInfo.os.platform} ({appState.nodeInfo.os.arch})
            </div>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <!-- CPU -->
            <div
              class="bg-muted/30 border border-border/50 rounded-xl p-4 flex flex-col justify-between"
            >
              <div class="flex items-center justify-between mb-3">
                <div class="flex items-center gap-1.5 text-muted-foreground">
                  <Cpu size={14} />
                  <span class="text-xs font-semibold uppercase tracking-wider"
                    >CPU Compute</span
                  >
                </div>
                <span class="text-xs font-bold text-foreground"
                  >{appState.nodeInfo.os.cpus} Cores</span
                >
              </div>
              <div>
                <div
                  class="text-[11px] text-muted-foreground mb-1 truncate"
                  title={appState.nodeInfo.os.cpu_model}
                >
                  {appState.nodeInfo.os.cpu_model}
                </div>
                <div class="flex items-end gap-2">
                  <span class="text-xl font-bold text-foreground"
                    >{appState.nodeInfo.os.load_avg[0].toFixed(2)}</span
                  >
                  <span class="text-[10px] text-muted-foreground pb-1"
                    >1m avg</span
                  >
                </div>
              </div>
            </div>

            <!-- Memory -->
            <div
              class="bg-muted/30 border border-border/50 rounded-xl p-4 flex flex-col justify-between"
            >
              <div class="flex items-center justify-between mb-3">
                <div class="flex items-center gap-1.5 text-muted-foreground">
                  <Database size={14} />
                  <span class="text-xs font-semibold uppercase tracking-wider"
                    >Memory Usage</span
                  >
                </div>
                <span class="text-xs font-bold text-foreground"
                  >{Math.round(
                    (appState.nodeInfo.os.mem_used /
                      appState.nodeInfo.os.mem_total) *
                      100,
                  )}%</span
                >
              </div>
              <div
                class="w-full bg-border/50 rounded-full h-1.5 mb-2 overflow-hidden"
              >
                <div
                  class="bg-primary h-1.5 rounded-full"
                  style="width: {(appState.nodeInfo.os.mem_used /
                    appState.nodeInfo.os.mem_total) *
                    100}%"
                ></div>
              </div>
              <div class="flex justify-between items-center text-[11px]">
                <span class="font-medium text-foreground"
                  >{(
                    appState.nodeInfo.os.mem_used /
                    1024 /
                    1024 /
                    1024
                  ).toFixed(1)} GB</span
                >
                <span class="text-muted-foreground"
                  >/ {(
                    appState.nodeInfo.os.mem_total /
                    1024 /
                    1024 /
                    1024
                  ).toFixed(1)} GB</span
                >
              </div>
            </div>

            <!-- Load Averages -->
            <div
              class="bg-muted/30 border border-border/50 rounded-xl p-4 flex flex-col justify-between"
            >
              <div class="flex items-center justify-between mb-3">
                <div class="flex items-center gap-1.5 text-muted-foreground">
                  <Activity size={14} />
                  <span class="text-xs font-semibold uppercase tracking-wider"
                    >System Load</span
                  >
                </div>
              </div>
              <div class="flex gap-2 h-full items-end mt-2">
                {#each [{ label: '1m', val: appState.nodeInfo.os.load_avg[0] }, { label: '5m', val: appState.nodeInfo.os.load_avg[1] }, { label: '15m', val: appState.nodeInfo.os.load_avg[2] }] as loadItem}
                  <div
                    class="flex-1 flex flex-col items-center justify-end gap-1"
                  >
                    <div class="text-[13px] font-bold text-foreground">
                      {loadItem.val.toFixed(2)}
                    </div>
                    <div class="text-[10px] text-muted-foreground">
                      {loadItem.label}
                    </div>
                  </div>
                {/each}
              </div>
            </div>

            <!-- Uptime -->
            <div
              class="bg-muted/30 border border-border/50 rounded-xl p-4 flex flex-col justify-between"
            >
              <div class="flex items-center gap-1.5 text-muted-foreground mb-3">
                <Clock size={14} />
                <span class="text-xs font-semibold uppercase tracking-wider"
                  >Host Uptime</span
                >
              </div>

              <div class="mt-auto">
                <div class="flex gap-3">
                  <div class="flex flex-col">
                    <span class="text-xl font-bold text-foreground"
                      >{Math.floor(appState.nodeInfo.os.uptime / 86400)}</span
                    >
                    <span class="text-[10px] text-muted-foreground uppercase"
                      >Days</span
                    >
                  </div>
                  <div class="flex flex-col">
                    <span class="text-xl font-bold text-foreground"
                      >{Math.floor(
                        (appState.nodeInfo.os.uptime % 86400) / 3600,
                      )}</span
                    >
                    <span class="text-[10px] text-muted-foreground uppercase"
                      >Hrs</span
                    >
                  </div>
                  <div class="flex flex-col">
                    <span class="text-xl font-bold text-foreground"
                      >{Math.floor(
                        (appState.nodeInfo.os.uptime % 3600) / 60,
                      )}</span
                    >
                    <span class="text-[10px] text-muted-foreground uppercase"
                      >Min</span
                    >
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      {/if}

      <!-- Technical Details Section -->
      <Accordion.Root type="single" class="w-full">
        <Accordion.Item
          value="technical-details"
          class="bg-card border border-border rounded-2xl shadow-sm overflow-hidden px-0 data-[state=open]:border-primary/30 transition-colors"
        >
          <Accordion.Trigger
            class="px-6 py-4 hover:no-underline hover:bg-muted/30 border-b border-transparent data-[state=open]:border-border group"
          >
            <div class="flex items-center gap-2">
              <Info
                size={16}
                class="text-muted-foreground group-hover:text-foreground transition-colors"
              />
              <h3 class="text-sm font-semibold">Technical Details</h3>
            </div>
          </Accordion.Trigger>

          <Accordion.Content class="divide-y divide-border pt-0 pb-0">
            <!-- Fingerprint -->
            <div
              class="px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
            >
              <div class="flex items-center gap-2 text-muted-foreground">
                <FingerprintPattern size={15} />
                <span class="text-[13px] font-medium">Hardware Fingerprint</span
                >
              </div>
              <code
                class="text-xs bg-muted/80 px-2.5 py-1.5 rounded-md border border-border/50 text-foreground break-all max-w-full sm:max-w-md text-right"
              >
                {appState.nodeInfo.enrollment.fingerprint || 'Not Registered'}
              </code>
            </div>

            <!-- Trust Issue Date -->
            {#if appState.nodeInfo.enrollment.trusted_at}
              <div
                class="px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
              >
                <div class="flex items-center gap-2 text-muted-foreground">
                  <ShieldCheck size={15} />
                  <span class="text-[13px] font-medium">Trust Issued</span>
                </div>
                <span class="text-[13px] font-medium text-foreground">
                  {appState.formatDate(appState.nodeInfo.enrollment.trusted_at)}
                </span>
              </div>
            {/if}

            <!-- Failure Log (if any) -->
            {#if appState.nodeInfo.enrollment.failed_attempts && appState.nodeInfo.enrollment.failed_attempts > 0}
              <div
                class="px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
              >
                <div class="flex items-center gap-2 text-rose-500">
                  <ShieldAlert size={15} />
                  <span class="text-[13px] font-medium"
                    >Failed Connection Attempts</span
                  >
                </div>
                <span
                  class="inline-flex items-center justify-center px-2 py-1 rounded-md bg-rose-500/10 text-rose-600 font-bold text-xs"
                >
                  {appState.nodeInfo.enrollment.failed_attempts}
                </span>
              </div>
            {/if}
          </Accordion.Content>
        </Accordion.Item>
      </Accordion.Root>

      <!-- Agents Section -->
      <div class="bg-card border border-border rounded-2xl p-6 shadow-sm">
        <div class="flex items-center justify-between mb-6">
          <div class="flex items-center gap-2">
            <Bot size={18} class="text-primary" />
            <h3 class="text-base font-semibold text-foreground">Agents</h3>
          </div>
          <button
            class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-primary/10 text-primary border border-primary rounded-md cursor-pointer hover:bg-primary/20 transition-colors"
            onclick={() => {
              appState.showNewAgent = true;
            }}
          >
            <Plus size={12} /> New Agent
          </button>
        </div>
        {#if appState.agents.length === 0}
          <div class="text-center py-8 text-muted-foreground">
            <Bot size={32} class="mx-auto mb-3 opacity-40" />
            <p class="text-sm">No agents configured yet.</p>
          </div>
        {:else}
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {#each appState.agents as agent}
              <button
                class="bg-muted/30 border border-border/50 rounded-xl p-4 flex flex-col gap-2 group hover:border-primary/30 transition-colors cursor-pointer text-left w-full"
                onclick={() => appState.openAgentInspector(agent.agent_id)}
              >
                <div class="flex items-center gap-2">
                  <Bot size={16} class="text-primary/70" />
                  <span class="font-semibold text-sm text-foreground truncate"
                    >{agent.agent_id}</span
                  >
                </div>
                <div class="flex items-center justify-between">
                  <span class="text-[11px] text-muted-foreground">
                    {agent.session_count} session{agent.session_count !== 1
                      ? 's'
                      : ''}
                  </span>
                  {#if agent.last_active}
                    <span class="text-[10px] text-muted-foreground"
                      >{appState.formatShortDate(agent.last_active)}</span
                    >
                  {/if}
                </div>
              </button>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  {:else}
    <div
      class="flex flex-col items-center justify-center h-[60vh] gap-4 text-muted-foreground"
    >
      <Monitor size={48} class="text-muted/50 mb-2" />
      <h3 class="text-lg font-medium text-foreground">No Computer Target</h3>
      <p class="text-sm text-center max-w-[300px]">
        Computer information could not be retrieved. Ensure backend services are
        running.
      </p>
      <button
        class="mt-4 px-4 py-2 border border-border rounded-md hover:bg-accent text-sm font-medium transition-colors cursor-pointer"
        onclick={() => appState.fetchNode()}
      >
        Retry Connection
      </button>
    </div>
  {/if}
</div>
