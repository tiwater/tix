<script lang="ts">
  import { appState } from '$lib/stores/app-state.svelte';
  import { X } from 'lucide-svelte';

  interface AutomationTemplate {
    title: string;
    description: string;
    rules: string;
  }

  let { template = $bindable<AutomationTemplate | null>(null) } = $props();

  let title = $state('');
  let description = $state('');
  let rules = $state('');
  let selectedAgentId = $state('');
  let schedulePreset = $state('daily');
  let customCron = $state('');

  const presets: { label: string; value: string; cron: string }[] = [
    { label: 'Hourly', value: 'hourly', cron: '0 * * * *' },
    { label: 'Daily', value: 'daily', cron: '0 9 * * *' },
    { label: 'Weekdays', value: 'weekdays', cron: '0 9 * * 1-5' },
    { label: 'Weekly', value: 'weekly', cron: '0 9 * * 1' },
    { label: 'Custom', value: 'custom', cron: '' },
  ];

  const cronExpression = $derived(
    schedulePreset === 'custom'
      ? customCron
      : presets.find((p) => p.value === schedulePreset)?.cron || '0 9 * * *',
  );

  const canCreate = $derived(
    title.trim() && description.trim() && selectedAgentId && cronExpression.trim(),
  );

  // When template changes, populate fields
  $effect(() => {
    if (template) {
      title = template.title;
      description = template.description;
      rules = template.rules;
      template = null; // consume once
    }
  });

  // Default agent selection — pick first agent when agents load
  $effect(() => {
    if (!selectedAgentId && appState.agents.length > 0) {
      selectedAgentId = appState.agents[0].agent_id;
    }
  });

  function clear() {
    title = '';
    description = '';
    rules = '';
    schedulePreset = 'daily';
    customCron = '';
  }

  function close() {
    appState.showNewAutomation = false;
    clear();
  }

  function create() {
    if (!canCreate) return;
    const parts = [description.trim()];
    if (rules.trim()) {
      parts.push(`\nGrounding rules:\n${rules.trim()}`);
    }
    const fullPrompt = `${title.trim()}\n\n${parts.join('\n')}`;
    appState.createSchedule(selectedAgentId, fullPrompt, cronExpression);
    clear();
  }
</script>

{#if appState.showNewAutomation}
  <div
    class="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50"
    onclick={close}
    role="presentation"
  >
    <div
      class="bg-card border border-border rounded-2xl w-[560px] max-w-[94vw] max-h-[88vh] flex flex-col shadow-2xl"
      onclick={(e) => e.stopPropagation()}
      role="dialog"
      tabindex="-1"
      onkeydown={(e) => { if (e.key === 'Escape') close(); }}
    >
      <!-- Header -->
      <div class="flex items-center justify-between px-6 pt-5 pb-3">
        <h3 class="text-base font-semibold text-foreground">New Automation</h3>
        <button
          class="w-7 h-7 flex items-center justify-center rounded-md hover:bg-muted text-muted-foreground transition-colors cursor-pointer"
          onclick={close}
        >
          <X size={15} />
        </button>
      </div>

      <!-- Body -->
      <div class="flex-1 overflow-y-auto px-6 pb-2 flex flex-col gap-4">
        <!-- Title -->
        <div>
          <label for="auto-title" class="block text-xs font-medium text-muted-foreground mb-1.5">Title</label>
          <input
            id="auto-title"
            class="w-full bg-muted border border-border rounded-lg text-foreground text-[13px] px-3 py-2 outline-none focus:border-primary transition-colors"
            bind:value={title}
            placeholder="e.g. Dependency and SDK drift"
          />
        </div>

        <!-- Description / Prompt -->
        <div>
          <label for="auto-desc" class="block text-xs font-medium text-muted-foreground mb-1.5">Description</label>
          <textarea
            id="auto-desc"
            class="w-full bg-muted border border-border rounded-lg text-foreground text-[13px] px-3 py-2 outline-none focus:border-primary transition-colors resize-none"
            rows={3}
            bind:value={description}
            placeholder="Describe what the automation should do…"
          ></textarea>
        </div>

        <!-- Grounding Rules -->
        <div>
          <label for="auto-rules" class="block text-xs font-medium text-muted-foreground mb-1.5">
            Grounding rules <span class="text-muted-foreground/60 font-normal">(optional)</span>
          </label>
          <textarea
            id="auto-rules"
            class="w-full bg-muted border border-border rounded-lg text-foreground text-[13px] px-3 py-2 outline-none focus:border-primary transition-colors resize-none font-mono text-xs"
            rows={3}
            bind:value={rules}
            placeholder="- Cite current and target versions from the repo&#10;- Do not guess versions; label unclear targets as suggestions"
          ></textarea>
        </div>

        <!-- Agent + Schedule row -->
        <div class="flex gap-3">
          <!-- Agent selector -->
          <div class="flex-1">
            <label for="auto-agent" class="block text-xs font-medium text-muted-foreground mb-1.5">Agent</label>
            <select
              id="auto-agent"
              class="w-full bg-muted border border-border rounded-lg text-foreground text-[13px] px-3 py-2 outline-none focus:border-primary transition-colors cursor-pointer"
              bind:value={selectedAgentId}
            >
              {#each appState.agents as agent}
                <option value={agent.agent_id}>{agent.agent_id}</option>
              {/each}
            </select>
          </div>

          <!-- Schedule preset -->
          <div class="flex-1">
            <label for="auto-schedule" class="block text-xs font-medium text-muted-foreground mb-1.5">Schedule</label>
            <select
              id="auto-schedule"
              class="w-full bg-muted border border-border rounded-lg text-foreground text-[13px] px-3 py-2 outline-none focus:border-primary transition-colors cursor-pointer"
              bind:value={schedulePreset}
            >
              {#each presets as preset}
                <option value={preset.value}>{preset.label}</option>
              {/each}
            </select>
          </div>
        </div>

        <!-- Custom cron input (visible only when 'Custom' selected) -->
        {#if schedulePreset === 'custom'}
          <div>
            <label for="auto-cron" class="block text-xs font-medium text-muted-foreground mb-1.5">Cron expression</label>
            <input
              id="auto-cron"
              class="w-full bg-muted border border-border rounded-lg text-foreground text-[13px] px-3 py-2 outline-none focus:border-primary transition-colors font-mono"
              bind:value={customCron}
              placeholder="0 */6 * * *"
            />
            <p class="text-[10px] text-muted-foreground/70 mt-1">Standard cron format: minute hour day month weekday</p>
          </div>
        {/if}
      </div>

      <!-- Footer -->
      <div class="flex items-center justify-between px-6 py-4 border-t border-border">
        <button
          class="text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          onclick={clear}
        >
          Clear
        </button>
        <div class="flex gap-2">
          <button
            class="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-muted-foreground border border-border rounded-lg cursor-pointer hover:bg-accent hover:text-foreground transition-colors"
            onclick={close}
          >
            Cancel
          </button>
          <button
            class="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold bg-primary text-primary-foreground rounded-lg cursor-pointer hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            onclick={create}
            disabled={!canCreate}
          >
            Create
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}
