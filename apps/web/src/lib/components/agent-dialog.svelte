<script lang="ts">
  import { appState } from '$lib/stores/app-state.svelte';
  import { goto } from '$app/navigation';
  import * as Dialog from '$lib/components/ui/dialog';
  import * as Tabs from '$lib/components/ui/tabs';
  import {
    Bot,
    Brain,
    BookOpen,
    CircleUser,
    FileText,
    Puzzle,
    ToggleLeft,
    ToggleRight,
    RefreshCw,
    Info,
    ChevronDown,
    ChevronRight,
    FolderOpen,
    File,
    FolderUp,
  } from 'lucide-svelte';

  interface MindFile {
    content: string;
    mtimeMs: number;
    updatedRecently?: boolean;
  }

  let expandedFiles = $state<Record<string, boolean>>({});
  let activeTab = $state('mind');
  let localMindFiles = $state<Record<string, MindFile>>({});
  let mindLoading = $state(false);

  interface MemoryRollFile {
    date: string;
    content: string;
    mtimeMs: number;
  }
  interface AgentMemoryData {
    core_memory: { content: string; mtimeMs: number } | null;
    roll: MemoryRollFile[];
  }
  let agentMemoryData = $state<AgentMemoryData | null>(null);
  let agentMemoryLoading = $state(false);

  async function fetchAgentMemory(aid: string) {
    agentMemoryLoading = true;
    try {
      const res = await fetch(`/api/v1/agents/${encodeURIComponent(aid)}/memory`);
      if (res.ok) {
        agentMemoryData = await res.json();
      }
    } catch { /* */ }
    agentMemoryLoading = false;
  }

  // Workspace tab state
  interface WorkspaceEntry {
    name: string;
    type: 'file' | 'directory';
    size?: number;
    modified: string;
  }
  let workspacePath = $state('.');
  let workspaceEntries = $state<WorkspaceEntry[]>([]);
  let workspaceLoading = $state(false);

  function formatSize(bytes?: number): string {
    if (bytes === undefined) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  async function fetchWorkspace(relPath: string = '.') {
    workspaceLoading = true;
    workspacePath = relPath;
    try {
      const urlPath = relPath === '.' ? '' : encodeURIComponent(relPath);
      const res = await fetch(`/api/v1/agents/${encodeURIComponent(agentId)}/workspace/${urlPath}`);
      if (res.ok) {
        const data = await res.json();
        workspaceEntries = (data.entries || []).sort((a: WorkspaceEntry, b: WorkspaceEntry) => {
          if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
      } else {
        workspaceEntries = [];
      }
    } catch {
      workspaceEntries = [];
    }
    workspaceLoading = false;
  }

  function navigateWorkspace(entry: WorkspaceEntry) {
    if (entry.type === 'directory') {
      const newPath = workspacePath === '.' ? entry.name : `${workspacePath}/${entry.name}`;
      fetchWorkspace(newPath);
    }
  }

  function navigateUp() {
    if (workspacePath === '.') return;
    const parts = workspacePath.split('/');
    parts.pop();
    fetchWorkspace(parts.length === 0 ? '.' : parts.join('/'));
  }

  const workspaceBreadcrumbs = $derived(() => {
    if (workspacePath === '.') return [{ label: 'workspace', path: '.' }];
    const parts = workspacePath.split('/');
    const crumbs = [{ label: 'workspace', path: '.' }];
    let current = '';
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      crumbs.push({ label: part, path: current });
    }
    return crumbs;
  });

  function toggleFile(name: string) {
    expandedFiles = { ...expandedFiles, [name]: !expandedFiles[name] };
  }

  function fileIcon(name: string) {
    if (name === 'SOUL.md') return 'soul';
    if (name === 'MEMORY.md') return 'memory';
    if (name === 'USER.md') return 'user';
    return 'identity';
  }

  async function fetchMindFilesForAgent(aid: string) {
    mindLoading = true;
    try {
      const res = await fetch(`/api/v1/agents/${encodeURIComponent(aid)}/mind`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.files) {
        localMindFiles = data.files as Record<string, MindFile>;
      }
    } catch { /* */ }
    mindLoading = false;
  }

  // Get session count for this agent
  let agentId = $derived(appState.inspectedAgentId);
  let agentSessions = $derived(appState.sessionsForAgent(agentId));
  let agentInfo = $derived(appState.agents.find(a => a.agent_id === agentId));

  // Fetch mind files when dialog opens
  $effect(() => {
    if (appState.showAgentInspector && agentId) {
      fetchMindFilesForAgent(agentId);
      fetchAgentMemory(agentId);
      fetchWorkspace('.');
    }
  });
</script>

<Dialog.Root bind:open={appState.showAgentInspector}>
  <Dialog.Content class="max-w-[880px] sm:max-w-[880px] w-[95vw] sm:w-[880px] h-[600px] flex flex-col p-0 gap-0">
    <Dialog.Header class="px-6 pt-5 pb-0 shrink-0">
      <Dialog.Title class="flex items-center gap-2.5 text-base">
        <div class="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
          <Bot size={16} class="text-primary" />
        </div>
        <div class="flex flex-col">
          <span class="font-semibold">{agentId}</span>
          <span class="text-[11px] text-muted-foreground font-normal">
            {agentSessions.length} session{agentSessions.length !== 1 ? 's' : ''}
            {#if agentInfo?.last_active}
              · Last active {appState.formatShortDate(agentInfo.last_active)}
            {/if}
          </span>
        </div>
      </Dialog.Title>
    </Dialog.Header>

    <Tabs.Root bind:value={activeTab} class="flex-1 flex flex-col min-h-0 mt-4">
      <div class="px-6 pb-2 shrink-0">
        <Tabs.List class="grid w-full grid-cols-5 max-w-[600px]">
          <Tabs.Trigger
            value="mind"
            class="text-[13px] font-medium gap-1.5"
          >
            <Brain size={14} /> Mind
          </Tabs.Trigger>
          <Tabs.Trigger
            value="memory"
            class="text-[13px] font-medium gap-1.5"
          >
            <BookOpen size={14} /> Memory
          </Tabs.Trigger>
          <Tabs.Trigger
            value="skills"
            class="text-[13px] font-medium gap-1.5"
          >
            <Puzzle size={14} /> Skills
          </Tabs.Trigger>
          <Tabs.Trigger
            value="info"
            class="text-[13px] font-medium gap-1.5"
          >
            <Info size={14} /> Info
          </Tabs.Trigger>
          <Tabs.Trigger
            value="workspace"
            class="text-[13px] font-medium gap-1.5"
          >
            <FolderOpen size={14} /> Workspace
          </Tabs.Trigger>
        </Tabs.List>
      </div>

      <!-- Mind Tab -->
      <Tabs.Content value="mind" class="flex-1 overflow-y-auto p-0 m-0 mt-0">
        <div class="px-6 py-1">
          <div class="flex items-center justify-between py-2">
            <span class="text-[11px] text-muted-foreground">Agent mind files are updated as the agent learns.</span>
            <button
              class="w-6 h-6 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
              onclick={() => fetchMindFilesForAgent(agentId)}
              title="Refresh mind files"
            >
              <RefreshCw size={12} class={mindLoading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>
        {#if Object.keys(localMindFiles).length === 0}
          <div class="px-6 py-8 text-center text-xs text-muted-foreground">
            {#if mindLoading}
              Loading mind files…
            {:else}
              No mind files found.<br />
              <span class="text-[10px]">Send a message to initialize the agent's mind.</span>
            {/if}
          </div>
        {:else}
          {#each Object.entries(localMindFiles).filter(([name]) => name !== 'MEMORY.md') as [name, file]}
            <div class="border-b border-border/30">
              <button
                class="w-full flex items-center gap-2.5 px-6 py-3 text-left hover:bg-muted/40 transition-colors bg-transparent border-none cursor-pointer"
                onclick={() => toggleFile(name)}
              >
                <span class="text-muted-foreground">
                  {#if expandedFiles[name]}<ChevronDown size={12} />{:else}<ChevronRight size={12} />{/if}
                </span>
                <span class="text-muted-foreground">
                  {#if fileIcon(name) === 'soul'}<Brain size={15} />
                  {:else if fileIcon(name) === 'memory'}<BookOpen size={15} />
                  {:else if fileIcon(name) === 'user'}<CircleUser size={15} />
                  {:else}<FileText size={15} />
                  {/if}
                </span>
                <span class="text-sm font-medium text-foreground flex-1">{name}</span>
                {#if file.updatedRecently}
                  <span class="text-[9px] bg-green-500/20 text-green-600 dark:text-green-400 px-1.5 py-0.5 rounded-full font-medium">updated</span>
                {/if}
              </button>

              {#if expandedFiles[name]}
                <div class="px-6 pb-4">
                  <pre class="text-[11px] leading-relaxed text-muted-foreground bg-muted/50 rounded-lg p-3 overflow-x-auto max-h-[250px] overflow-y-auto whitespace-pre-wrap break-words m-0 font-mono border border-border/30">{file.content || '(empty)'}</pre>
                </div>
              {/if}
            </div>
          {/each}
        {/if}
      </Tabs.Content>

      <!-- Memory Tab -->
      <Tabs.Content value="memory" class="flex-1 overflow-y-auto p-0 m-0 mt-0">
        <div class="px-6 py-1">
          <div class="flex items-center justify-between py-2">
            <span class="text-[11px] text-muted-foreground">Long-term core memory and daily memory roll.</span>
            <button
              class="w-6 h-6 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
              onclick={() => fetchAgentMemory(agentId)}
              title="Refresh memory"
            >
              <RefreshCw size={12} class={agentMemoryLoading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>
        
        {#if agentMemoryLoading && !agentMemoryData}
          <div class="px-6 py-8 text-center text-xs text-muted-foreground">Loading memory…</div>
        {:else if agentMemoryData}
          <div class="px-4 pb-4 space-y-4 pt-2">
            <!-- Core Memory -->
            <div class="border border-border/50 bg-card rounded-xl overflow-hidden shadow-sm">
               <div class="bg-muted/30 px-4 py-2 border-b border-border/50 flex items-center gap-2">
                 <BookOpen size={14} class="text-primary" />
                 <span class="text-xs font-semibold">Core Memory (MEMORY.md)</span>
                 {#if agentMemoryData.core_memory}
                    <span class="ml-auto text-[9px] text-muted-foreground">{new Date(agentMemoryData.core_memory.mtimeMs).toLocaleString()}</span>
                 {/if}
               </div>
               <div class="p-4">
                 {#if agentMemoryData.core_memory}
                   <pre class="text-[11px] leading-relaxed text-muted-foreground bg-muted/50 rounded-lg p-3 overflow-x-auto max-h-[250px] overflow-y-auto whitespace-pre-wrap break-words m-0 font-mono border border-border/30">{agentMemoryData.core_memory.content || '(empty)'}</pre>
                 {:else}
                   <p class="text-xs text-muted-foreground italic">No core memory initialized.</p>
                 {/if}
               </div>
            </div>

            <!-- Memory Roll -->
            {#if agentMemoryData.roll && agentMemoryData.roll.length > 0}
              <div class="space-y-3">
                <h4 class="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider px-2">Memory Roll</h4>
                {#each agentMemoryData.roll as rollDef}
                  <div class="border border-border/50 bg-card rounded-xl overflow-hidden shadow-sm">
                    <button class="w-full flex items-center gap-2.5 px-4 py-3 text-left hover:bg-muted/40 transition-colors bg-transparent border-none cursor-pointer" onclick={() => toggleFile(`roll_${rollDef.date}`)}>
                      <span class="text-muted-foreground">
                        {#if expandedFiles[`roll_${rollDef.date}`]}<ChevronDown size={14} />{:else}<ChevronRight size={14} />{/if}
                      </span>
                      <FileText size={15} class="text-muted-foreground" />
                      <span class="text-sm font-medium text-foreground flex-1">{rollDef.date}</span>
                    </button>
                    {#if expandedFiles[`roll_${rollDef.date}`]}
                      <div class="px-4 pb-4 pt-1 border-t border-border/20">
                        <pre class="text-[11px] leading-relaxed text-muted-foreground bg-muted/30 rounded-lg p-3 overflow-x-auto max-h-[300px] overflow-y-auto whitespace-pre-wrap break-words m-0 font-mono border border-border/30">{rollDef.content || '(empty)'}</pre>
                      </div>
                    {/if}
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        {/if}
      </Tabs.Content>

      <!-- Skills Tab -->
      <Tabs.Content value="skills" class="flex-1 overflow-y-auto p-0 m-0 mt-0">
        <div class="px-6 py-1">
          <div class="flex items-center justify-between py-2">
            <span class="text-[11px] text-muted-foreground">Toggle skills this agent can use.</span>
            <button
              class="w-6 h-6 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
              onclick={() => appState.fetchSkills()}
              title="Refresh skills"
            >
              <RefreshCw size={12} />
            </button>
          </div>
        </div>
        {#if appState.skills.length === 0}
          <div class="px-6 py-8 text-center text-xs text-muted-foreground">
            No skills available for this agent.
          </div>
        {:else}
          <div class="px-4 pb-4">
            {#each appState.skills as skill}
              <button
                class="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left hover:bg-muted/40 transition-colors bg-transparent border-none cursor-pointer group"
                onclick={() => appState.toggleSkill(skill.name, skill.enabled)}
                title="{skill.enabled ? 'Disable' : 'Enable'} {skill.name}"
              >
                <span class={skill.enabled ? 'text-green-500' : 'text-muted-foreground/50'}>
                  {#if skill.enabled}<ToggleRight size={18} />{:else}<ToggleLeft size={18} />{/if}
                </span>
                <span class="text-sm flex-1 {skill.enabled ? 'text-foreground' : 'text-muted-foreground'}">{skill.name}</span>
                {#if skill.permissionLevel >= 3}
                  <span class="text-[9px] bg-amber-500/20 text-amber-600 dark:text-amber-400 px-1.5 py-0.5 rounded font-medium">L{skill.permissionLevel}</span>
                {/if}
              </button>
            {/each}
          </div>
        {/if}
      </Tabs.Content>

      <!-- Info Tab -->
      <Tabs.Content value="info" class="flex-1 overflow-y-auto p-0 m-0 mt-0">
        <div class="px-6 py-4 space-y-4">
          <!-- Agent Details -->
          <div class="space-y-3">
            <h4 class="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Agent Details</h4>
            <div class="bg-muted/30 rounded-xl border border-border/50 divide-y divide-border/30">
              <div class="flex items-center justify-between px-4 py-3">
                <span class="text-xs text-muted-foreground">Agent ID</span>
                <span class="text-xs font-mono text-foreground">{agentId}</span>
              </div>
              <div class="flex items-center justify-between px-4 py-3">
                <span class="text-xs text-muted-foreground">Sessions</span>
                <span class="text-xs font-medium text-foreground">{agentSessions.length}</span>
              </div>
              {#if agentInfo?.last_active}
                <div class="flex items-center justify-between px-4 py-3">
                  <span class="text-xs text-muted-foreground">Last Active</span>
                  <span class="text-xs text-foreground">{appState.formatShortDate(agentInfo.last_active)}</span>
                </div>
              {/if}
              {#if agentInfo?.session_count !== undefined}
                <div class="flex items-center justify-between px-4 py-3">
                  <span class="text-xs text-muted-foreground">Total Sessions (all time)</span>
                  <span class="text-xs font-medium text-foreground">{agentInfo.session_count}</span>
                </div>
              {/if}
            </div>
          </div>

          <!-- Language Model -->
          <div class="space-y-3">
            <div class="flex items-center justify-between">
              <h4 class="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Language Model</h4>
              {#if !agentInfo?.model}
                <span class="text-[10px] bg-secondary text-secondary-foreground px-1.5 py-0.5 rounded font-medium">System Default</span>
              {:else}
                <span class="text-[10px] bg-primary/20 text-primary px-1.5 py-0.5 rounded font-medium">Custom</span>
              {/if}
            </div>
            <div class="bg-muted/30 rounded-xl border border-border/50 divide-y divide-border/30">
              <div class="p-4 flex items-center justify-between">
                <div class="flex flex-col gap-1">
                  <span class="text-xs text-muted-foreground">Selected Model</span>
                  <span class="text-[10px] text-muted-foreground/70">The language model powering this agent's capabilities.</span>
                </div>
                <select
                  class="bg-background text-sm font-medium rounded-lg px-3 py-2 border border-border focus:ring-1 focus:ring-primary outline-none min-w-[240px]"
                  value={agentInfo?.model || ''}
                  onchange={(e) => appState.updateAgentModel(agentId, e.currentTarget.value)}
                >
                  <option value="">Auto (System Default)</option>
                  {#each appState.models as m}
                    <option value={m.id}>{m.model || m.id}</option>
                  {/each}
                </select>
              </div>
            </div>
          </div>

          <!-- Active Sessions -->
          <div class="space-y-3">
            <h4 class="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Active Sessions</h4>
            {#if agentSessions.length === 0}
              <div class="text-xs text-muted-foreground">No active sessions.</div>
            {:else}
              <div class="bg-muted/30 rounded-xl border border-border/50 divide-y divide-border/30">
                {#each agentSessions as sess}
                  <a
                    href="/sessions/{sess.session_id}"
                    class="flex items-center justify-between px-4 py-2.5 hover:bg-muted/40 transition-colors cursor-pointer no-underline"
                    onclick={(e) => {
                      e.preventDefault();
                      appState.showAgentInspector = false;
                      appState.selectSession(sess);
                      goto(`/sessions/${sess.session_id}`);
                    }}
                  >
                    <span class="text-xs font-mono text-foreground truncate max-w-[300px]">{sess.session_id}</span>
                    <span class="text-[10px] text-muted-foreground shrink-0 ml-2">{sess.channel}</span>
                  </a>
                {/each}
              </div>
            {/if}
          </div>
        </div>
      </Tabs.Content>

      <!-- Workspace Tab -->
      <Tabs.Content value="workspace" class="flex-1 overflow-y-auto p-0 m-0 mt-0">
        <div class="px-6 py-1">
          <div class="flex items-center justify-between py-2">
            <!-- Breadcrumbs -->
            <div class="flex items-center gap-1 text-[11px] text-muted-foreground min-w-0 overflow-hidden">
              {#each workspaceBreadcrumbs() as crumb, i}
                {#if i > 0}<span class="text-muted-foreground/40">/</span>{/if}
                <button
                  class="hover:text-foreground transition-colors cursor-pointer bg-transparent border-none text-[11px] {i === workspaceBreadcrumbs().length - 1 ? 'text-foreground font-medium' : 'text-muted-foreground'}"
                  onclick={() => fetchWorkspace(crumb.path)}
                >{crumb.label}</button>
              {/each}
            </div>
            <button
              class="w-6 h-6 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
              onclick={() => fetchWorkspace(workspacePath)}
              title="Refresh"
            >
              <RefreshCw size={12} class={workspaceLoading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>
        {#if workspaceLoading && workspaceEntries.length === 0}
          <div class="px-6 py-8 text-center text-xs text-muted-foreground">Loading…</div>
        {:else if workspaceEntries.length === 0}
          <div class="px-6 py-8 text-center text-xs text-muted-foreground">Empty directory</div>
        {:else}
          <div class="pb-4">
            {#if workspacePath !== '.'}
              <button
                class="w-full flex items-center gap-2.5 px-6 py-2 text-left hover:bg-muted/40 transition-colors bg-transparent border-none cursor-pointer text-muted-foreground"
                onclick={navigateUp}
              >
                <FolderUp size={14} />
                <span class="text-xs">..</span>
              </button>
            {/if}
            {#each workspaceEntries as entry (entry.name)}
              <button
                class="w-full flex items-center gap-2.5 px-6 py-2 text-left hover:bg-muted/40 transition-colors bg-transparent border-none cursor-pointer group"
                onclick={() => {
                  if (entry.type === 'directory') {
                    navigateWorkspace(entry);
                  } else {
                    // Open file preview — build the workspace URL
                    const filePath = workspacePath === '.' ? entry.name : `${workspacePath}/${entry.name}`;
                    const url = `/api/workspace/${encodeURIComponent(filePath)}?agent_id=${encodeURIComponent(agentId)}`;
                    window.dispatchEvent(new CustomEvent('ticlaw:preview-file', { detail: { name: entry.name, url, ext: entry.name.split('.').pop()?.toLowerCase() || '' } }));
                  }
                }}
              >
                {#if entry.type === 'directory'}
                  <FolderOpen size={14} class="text-primary/70 shrink-0" />
                {:else}
                  <File size={14} class="text-muted-foreground shrink-0" />
                {/if}
                <span class="text-xs text-foreground flex-1 truncate">{entry.name}</span>
                {#if entry.type === 'file' && entry.size !== undefined}
                  <span class="text-[10px] text-muted-foreground shrink-0">{formatSize(entry.size)}</span>
                {/if}
              </button>
            {/each}
          </div>
        {/if}
      </Tabs.Content>
    </Tabs.Root>
  </Dialog.Content>
</Dialog.Root>
