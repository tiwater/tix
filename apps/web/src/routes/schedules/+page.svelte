<script lang="ts">
  import { onMount } from 'svelte';
  import { appState } from '$lib/stores/app-state.svelte';
  import {
    Zap,
    RefreshCw,
    Play,
    Pause,
    Trash2,
    Plus,
    Bug,
    PackageSearch,
    ShieldCheck,
  } from 'lucide-svelte';
  import NewAutomationDialog from './new-automation-dialog.svelte';

  interface AutomationTemplate {
    title: string;
    description: string;
    rules: string;
    icon: typeof Bug;
    accent: string;
  }

  const templates: AutomationTemplate[] = [
    {
      title: 'Dependency and SDK drift',
      description:
        'Detect dependency and SDK drift and propose a minimal alignment plan.',
      rules:
        '- Cite current and target versions from the repo when possible (lockfiles, package manifests).\n- Do not guess versions; if targets are unclear, propose options and label them as suggestions.',
      icon: PackageSearch,
      accent: 'text-blue-400',
    },
    {
      title: 'Bug finder',
      description:
        'Scan the codebase for likely bugs and propose minimal fixes.',
      rules:
        '- Focus on logic errors, null/undefined hazards, and race conditions.\n- Propose focused, minimal fixes — avoid large refactors.',
      icon: Bug,
      accent: 'text-amber-400',
    },
    {
      title: 'Test coverage gap',
      description:
        'Find untested code paths, write focused tests and use @jest for draft PRs.',
      rules:
        '- Prioritize critical business logic paths.\n- Keep test files next to the source they test.\n- Use existing test patterns and frameworks.',
      icon: ShieldCheck,
      accent: 'text-emerald-400',
    },
  ];

  let activeTemplate = $state<AutomationTemplate | null>(null);

  function useTemplate(tmpl: AutomationTemplate) {
    activeTemplate = {
      title: tmpl.title,
      description: tmpl.description,
      rules: tmpl.rules,
    } as any;
    appState.showNewAutomation = true;
  }

  onMount(() => {
    appState.fetchSchedules();
    if (appState.agents.length === 0) appState.fetchAgents();
  });
</script>

<NewAutomationDialog bind:template={activeTemplate} />

<div class="flex flex-col h-full">
  <!-- Header -->
  <div class="flex items-center justify-between px-6 py-5 border-b border-border">
    <div>
      <h2 class="text-lg font-semibold flex items-center gap-2">
        <Zap size={18} class="text-primary" />
        Automations
      </h2>
      <p class="text-xs text-muted-foreground mt-0.5">
        Automate work by setting up scheduled threads.
      </p>
    </div>
    <div class="flex gap-2">
      <button
        class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-muted-foreground border border-border rounded-lg cursor-pointer hover:bg-accent hover:text-foreground transition-colors"
        onclick={() => appState.fetchSchedules()}
      >
        <RefreshCw size={12} />
        Refresh
      </button>
      <button
        class="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold bg-primary text-primary-foreground rounded-lg cursor-pointer hover:bg-primary/90 transition-colors"
        onclick={() => { appState.showNewAutomation = true; }}
      >
        <Plus size={13} />
        New automation
      </button>
    </div>
  </div>

  <div class="flex-1 min-h-0 overflow-y-auto">
    <!-- Template Cards -->
    <div class="px-6 pt-5 pb-2">
      <h3 class="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">
        Growth & exploration templates
      </h3>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
        {#each templates as tmpl}
          <button
            class="group text-left border border-border rounded-xl p-4 hover:border-primary/40 hover:bg-accent/30 transition-all cursor-pointer"
            onclick={() => useTemplate(tmpl)}
          >
            <div class="flex items-start gap-2.5 mb-2">
              <div class="w-7 h-7 rounded-lg bg-muted flex items-center justify-center shrink-0">
                <tmpl.icon size={14} class={tmpl.accent} />
              </div>
              <h4 class="text-[13px] font-semibold text-foreground leading-snug pt-0.5">
                {tmpl.title}
              </h4>
            </div>
            <p class="text-[11px] text-muted-foreground leading-relaxed line-clamp-2">
              {tmpl.description}
            </p>
          </button>
        {/each}
      </div>
    </div>

    <!-- Active Automations -->
    <div class="px-6 pt-4 pb-6">
      <h3 class="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">
        Active automations
      </h3>

      {#if appState.schedulesLoading}
        <div class="flex flex-col items-center justify-center gap-2.5 py-10 text-muted-foreground">
          <div class="text-3xl">⏳</div>
          <div class="text-xs">Loading automations…</div>
        </div>
      {:else if appState.schedules.length === 0}
        <div class="flex flex-col items-center justify-center gap-2.5 py-10 text-muted-foreground border border-dashed border-border rounded-xl">
          <Zap size={24} class="opacity-30" />
          <div class="text-xs text-center max-w-[260px]">
            No automations yet. Use a template above or create a new one.
          </div>
        </div>
      {:else}
        <div class="border border-border rounded-xl overflow-hidden">
          <table class="w-full border-collapse">
            <thead>
              <tr class="bg-muted/40">
                {#each ['Status', 'Agent', 'Cron', 'Prompt', 'Next Run', 'Actions'] as col}
                  <th class="text-left text-[10px] font-semibold tracking-wider text-muted-foreground uppercase px-3 py-2.5 border-b border-border">
                    {col}
                  </th>
                {/each}
              </tr>
            </thead>
            <tbody>
              {#each appState.schedules as sched}
                <tr class="hover:bg-accent/30 transition-colors">
                  <td class="px-3 py-2.5 text-[13px] border-b border-border/50">
                    <span class="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full {sched.status === 'active' ? 'bg-green-500/10 text-green-500' : 'bg-destructive/10 text-destructive'}">
                      {#if sched.status === 'active'}<span class="w-1.5 h-1.5 rounded-full bg-green-500"></span>{:else}<span class="w-1.5 h-1.5 rounded-full bg-destructive"></span>{/if}
                      {sched.status}
                    </span>
                  </td>
                  <td class="px-3 py-2.5 text-xs text-muted-foreground border-b border-border/50">{sched.agent_id}</td>
                  <td class="px-3 py-2.5 border-b border-border/50"><code class="font-mono text-xs text-cyan-500 bg-cyan-500/5 px-1.5 py-0.5 rounded">{sched.cron}</code></td>
                  <td class="px-3 py-2.5 text-[12px] border-b border-border/50 max-w-[300px]">
                    <span class="whitespace-nowrap overflow-hidden text-ellipsis block" title={sched.prompt}>{sched.prompt.split('\n')[0]}</span>
                  </td>
                  <td class="px-3 py-2.5 text-xs text-muted-foreground whitespace-nowrap border-b border-border/50">{appState.formatShortDate(sched.next_run)}</td>
                  <td class="px-3 py-2.5 border-b border-border/50">
                    <div class="flex gap-1">
                      <button
                        class="w-[28px] h-[28px] inline-flex items-center justify-center bg-muted/60 border border-border rounded-md cursor-pointer text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                        title={sched.status === 'active' ? 'Pause' : 'Resume'}
                        onclick={() => appState.toggleSchedule(sched.id, sched.status)}
                      >
                        {#if sched.status === 'active'}<Pause size={12} />{:else}<Play size={12} />{/if}
                      </button>
                      <button
                        class="w-[28px] h-[28px] inline-flex items-center justify-center bg-muted/60 border border-border rounded-md cursor-pointer text-muted-foreground hover:bg-destructive/10 hover:text-destructive hover:border-destructive transition-colors"
                        title="Delete"
                        onclick={() => appState.removeSchedule(sched.id)}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </div>
  </div>
</div>
