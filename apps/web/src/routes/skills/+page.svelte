<script lang="ts">
  import { onMount } from 'svelte';
  import { appState } from '$lib/stores/app-state.svelte';
  import { Puzzle, RefreshCw } from 'lucide-svelte';

  onMount(() => { appState.fetchSkills(); });
</script>

<div class="flex items-center gap-3 px-6 py-4 pb-3 border-b border-border">
  <Puzzle size={18} class="text-primary" />
  <h2 class="text-base font-semibold">Skills</h2>
  <div class="ml-auto">
    <button class="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium text-muted-foreground border border-border rounded-md cursor-pointer hover:bg-accent hover:text-foreground" onclick={() => appState.fetchSkills()}><RefreshCw size={12} /> Refresh</button>
  </div>
</div>

{#if appState.skillsLoading}
  <div class="flex flex-col items-center justify-center flex-1 gap-2.5 p-10 text-muted-foreground">
    <div class="text-4xl">⏳</div>
    <div class="text-sm text-center max-w-[280px]">Loading skills…</div>
  </div>
{:else if appState.skills.length === 0}
  <div class="flex flex-col items-center justify-center flex-1 gap-2.5 p-10 text-muted-foreground">
    <div class="text-4xl">🧩</div>
    <div class="text-sm text-center max-w-[280px]">No skills discovered. Add SKILL.md files to your skills directories.</div>
  </div>
{:else}
  {@const installedSkills = appState.skills.filter((s) => s.installed)}
  {@const availableSkills = appState.skills.filter((s) => !s.installed)}

  <div class="p-6 flex flex-col gap-6 overflow-y-auto flex-1 min-h-0">
    <div>
      <h3 class="text-[13px] font-semibold text-muted-foreground uppercase tracking-wider mb-2.5 pb-1.5 border-b border-border">Installed</h3>
      {#if installedSkills.length === 0}
        <div class="text-[13px] text-muted-foreground py-3">No skills installed yet. Enable one from Available below.</div>
      {:else}
        <div class="flex flex-col gap-2.5">
          {#each installedSkills as skill}
            <div class="bg-card border border-border rounded-xl px-4 py-3.5 flex justify-between items-center hover:border-primary transition-colors">
              <div class="flex flex-col gap-0.5">
                <div class="font-semibold text-sm">{skill.name}</div>
                <div class="text-xs text-muted-foreground">{skill.description || 'No description'}</div>
                <div class="flex gap-2 mt-1 flex-wrap">
                  <span class="text-[10px] px-1.5 py-0.5 rounded bg-muted border border-border text-muted-foreground">v{skill.version || '?'}</span>
                  <span class="text-[10px] px-1.5 py-0.5 rounded bg-muted border border-border text-muted-foreground">L{skill.permissionLevel}</span>
                  {#if skill.source}<span class="text-[10px] px-1.5 py-0.5 rounded bg-muted border border-border text-muted-foreground">{skill.source}</span>{/if}
                  <span class="text-[10px] px-1.5 py-0.5 rounded bg-muted border border-border text-muted-foreground">{skill.status || (skill.enabled ? 'enabled' : 'disabled')}</span>
                  {#if skill.runtimeUsable}<span class="text-[10px] px-1.5 py-0.5 rounded bg-muted border border-border text-muted-foreground">runtime:usable</span>{/if}
                </div>
              </div>
              <label class="relative inline-flex shrink-0">
                <input type="checkbox" checked={skill.enabled} onchange={() => appState.toggleSkill(skill.name, skill.enabled)} class="sr-only peer" />
                <div class="w-9 h-5 bg-muted border border-border rounded-full cursor-pointer transition-all peer-checked:bg-primary/20 peer-checked:border-primary after:content-[''] after:absolute after:w-3.5 after:h-3.5 after:left-[3px] after:top-[3px] after:bg-muted-foreground after:rounded-full after:transition-all peer-checked:after:translate-x-4 peer-checked:after:bg-primary"></div>
              </label>
            </div>
          {/each}
        </div>
      {/if}
    </div>

    {#if availableSkills.length > 0}
      <div>
        <h3 class="text-[13px] font-semibold text-muted-foreground uppercase tracking-wider mb-2.5 pb-1.5 border-b border-border">Available</h3>
        <div class="flex flex-col gap-2.5">
          {#each availableSkills as skill}
            <div class="bg-card border border-border border-dashed rounded-xl px-4 py-3.5 flex justify-between items-center opacity-85 hover:opacity-100 hover:border-primary transition-all">
              <div class="flex flex-col gap-0.5">
                <div class="font-semibold text-sm">{skill.name}</div>
                <div class="text-xs text-muted-foreground">{skill.description || 'No description'}</div>
                <div class="flex gap-2 mt-1 flex-wrap">
                  <span class="text-[10px] px-1.5 py-0.5 rounded bg-muted border border-border text-muted-foreground">v{skill.version || '?'}</span>
                  <span class="text-[10px] px-1.5 py-0.5 rounded bg-muted border border-border text-muted-foreground">L{skill.permissionLevel}</span>
                  {#if skill.source}<span class="text-[10px] px-1.5 py-0.5 rounded bg-muted border border-border text-muted-foreground">{skill.source}</span>{/if}
                  <span class="text-[10px] px-1.5 py-0.5 rounded bg-muted border border-border text-muted-foreground">{skill.status || 'discovered'}</span>
                </div>
              </div>
              <button class="px-3.5 py-1 text-xs font-semibold bg-green-500 text-white border-none rounded-lg cursor-pointer hover:opacity-85 transition-opacity" onclick={() => appState.toggleSkill(skill.name, false)}>Enable</button>
            </div>
          {/each}
        </div>
      </div>
    {/if}
  </div>
{/if}
