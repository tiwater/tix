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
      const res = await fetch(`/api/workspace/${urlPath}?agent_id=${encodeURIComponent(agentId)}`);
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
      const res = await fetch(`/api/mind/files?agent_id=${encodeURIComponent(aid)}`);
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
      fetchWorkspace('.');
    }
  });
</script>

<Dialog.Root bind:open={appState.showAgentInspector}>
  <Dialog.Content class="max-w-3xl w-[780px] h-[600px] flex flex-col p-0 gap-0">
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

    <Tabs.Root bind:value={activeTab} class="flex-1 flex flex-col min-h-0 mt-3">
      <Tabs.List class="px-6 border-b border-border rounded-none bg-transparent h-auto pb-0 justify-start gap-1 shrink-0">
        <Tabs.Trigger
          value="mind"
          class="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-3.5 pb-2.5 pt-1.5 text-[13px] font-medium gap-1.5"
        >
          <Brain size={14} /> Mind
        </Tabs.Trigger>
        <Tabs.Trigger
          value="skills"
          class="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-3.5 pb-2.5 pt-1.5 text-[13px] font-medium gap-1.5"
        >
          <Puzzle size={14} /> Skills
        </Tabs.Trigger>
        <Tabs.Trigger
          value="info"
          class="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-3.5 pb-2.5 pt-1.5 text-[13px] font-medium gap-1.5"
        >
          <Info size={14} /> Info
        </Tabs.Trigger>
        <Tabs.Trigger
          value="workspace"
          class="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-3.5 pb-2.5 pt-1.5 text-[13px] font-medium gap-1.5"
        >
          <FolderOpen size={14} /> Workspace
        </Tabs.Trigger>
      </Tabs.List>

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
          {#each Object.entries(localMindFiles) as [name, file]}
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
