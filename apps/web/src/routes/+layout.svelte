<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { page } from '$app/stores';
  import favicon from '$lib/assets/favicon.svg';
  import { appState } from '$lib/stores/app-state.svelte';
  import '../app.css';
  import {
    Bot,
    BotMessageSquare,
    Clock,
    Puzzle,
    Monitor,
    Unlock,
    ChevronsUpDown,
    Plus,
    Archive,
    Info,
  } from 'lucide-svelte';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import * as Collapsible from '$lib/components/ui/collapsible';
  import * as Sidebar from '$lib/components/ui/sidebar';
  import AgentInspectorDialog from '$lib/components/agent-inspector-dialog.svelte';

  let { children } = $props();

  function isActive(href: string) {
    const path = $page.url.pathname;
    if (href === '/computers') return path === '/' || path === '/computers';
    return path === href;
  }

  // Auto-expand the agent that owns the currently active session
  $effect(() => {
    const sessionMatch = $page.url.pathname.match(/^\/sessions\/(.+)$/);
    if (sessionMatch) {
      const activeSessionId = sessionMatch[1];
      for (const agent of appState.agents) {
        const sessions = appState.sessionsForAgent(agent.agent_id);
        if (sessions.some(s => s.session_id === activeSessionId)) {
          if (!appState.expandedAgents.has(agent.agent_id)) {
            appState.toggleAgentExpanded(agent.agent_id);
          }
          break;
        }
      }
    }
  });

  onMount(async () => {
    await appState.fetchNode();
    appState.fetchMind();
    appState.fetchMindFiles();
    await appState.fetchAgents();
  });

  onDestroy(() => {
    appState.disconnectSSE();
  });
</script>

<svelte:head>
  <link rel="icon" href={favicon} />
  <title>TiClaw DevUI</title>
  <meta
    name="description"
    content="TiClaw HTTP SSE chat interface for development and testing"
  />
</svelte:head>

<Sidebar.Provider class="h-[100dvh] overflow-hidden">
  <Sidebar.Root>
    <Sidebar.Header class="px-4 pt-4">
      <a
        href="/computers"
        class="flex items-center gap-2.5 font-bold text-[15px] text-primary tracking-tight no-underline mb-2"
        >TiClaw DevUI</a
      >
    </Sidebar.Header>

    <Sidebar.Content>
      <Sidebar.Group class="py-0">
        <Sidebar.GroupContent class="flex flex-col gap-1">
          <Sidebar.Menu>
            <!-- Computer Switcher -->
            <Sidebar.MenuItem>
              <DropdownMenu.Root>
                <div class="flex items-center w-full">
                  <Sidebar.MenuButton>
                    {#snippet child({
                      props,
                    }: {
                      props: Record<string, unknown>;
                    })}
                      <a
                        href="/computers"
                        {...props}
                        class="{props.class} flex-1 justify-start"
                      >
                        <div class="relative">
                          <Monitor size={15} />
                          <span class="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-sidebar {appState.sseConnected ? 'bg-green-500' : 'bg-muted-foreground/50'}"></span>
                        </div>
                        <span class="truncate"
                          >{appState.nodeInfo?.hostname || 'Manage Computers'}</span
                        >
                      </a>
                    {/snippet}
                  </Sidebar.MenuButton>

                  <DropdownMenu.Trigger>
                    {#snippet child({
                      props,
                    }: {
                      props: Record<string, unknown>;
                    })}
                      <Sidebar.MenuAction {...props} showOnHover={false}>
                        <ChevronsUpDown size={14} class="opacity-50" />
                        <span class="sr-only">Toggle Computer Menu</span>
                      </Sidebar.MenuAction>
                    {/snippet}
                  </DropdownMenu.Trigger>
                </div>
                <DropdownMenu.Content class="w-[200px]" align="start">
                  <DropdownMenu.Label>Computers</DropdownMenu.Label>
                  {#if appState.nodeInfo}
                    <DropdownMenu.Item
                      class="flex flex-col items-start gap-1 cursor-default opacity-100 hover:bg-transparent focus:bg-transparent"
                    >
                      <div class="font-medium flex items-center gap-1.5">
                        <Monitor size={13} />
                        {appState.nodeInfo.hostname}
                      </div>
                      <div class="text-[10px] opacity-70 flex items-center gap-1.5">
                        <span class="w-1.5 h-1.5 rounded-full {appState.sseConnected ? 'bg-green-500' : 'bg-muted-foreground/50'}"></span>
                        {appState.sseConnected ? 'Connected' : 'Offline'} · Trust: {appState.nodeInfo.enrollment.trust_state}
                      </div>
                    </DropdownMenu.Item>
                  {/if}
                  <DropdownMenu.Separator />
                  <DropdownMenu.Item
                    class="cursor-pointer text-muted-foreground"
                    onclick={() => (window.location.href = '/computers')}
                  >
                    <Monitor size={14} class="mr-2" /> Manage Computers...
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Root>
            </Sidebar.MenuItem>

          </Sidebar.Menu>
        </Sidebar.GroupContent>
      </Sidebar.Group>

      <!-- Agent/Session Folder Tree -->
      {#if appState.nodeInfo?.enrollment?.trust_state === 'trusted'}
        <Sidebar.Group
          class="flex flex-col gap-0 flex-1 min-h-0 overflow-hidden px-2 py-0"
        >
          <div class="flex items-center justify-between px-2 py-1.5">
            <span class="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Agents</span>
            <button
              title="New Agent"
              class="w-5 h-5 flex items-center justify-center rounded hover:bg-muted text-muted-foreground transition-colors cursor-pointer"
              onclick={() => { appState.showNewAgent = true; }}
            >
              <Plus size={12} />
            </button>
          </div>

          <Sidebar.GroupContent class="flex flex-col gap-0 overflow-y-auto flex-1 pb-4">
            {#if appState.agentsLoading && appState.agents.length === 0}
              <div class="px-3 py-2 text-xs text-muted-foreground">Loading…</div>
            {:else if appState.agents.length === 0}
              <div class="px-3 py-4 text-xs text-muted-foreground text-center">
                No agents yet
              </div>
            {:else}
              {#each appState.agents as agent (agent.agent_id)}
                {@const isExpanded = appState.expandedAgents.has(agent.agent_id)}
                {@const agentSessions = appState.sessionsForAgent(agent.agent_id)}
                <Collapsible.Root open={isExpanded} onOpenChange={() => appState.toggleAgentExpanded(agent.agent_id)} class="group/agent">
                  <div class="flex items-center w-full">
                    <Collapsible.Trigger
                      class="flex items-center gap-1.5 flex-1 px-2 py-1.5 text-sm rounded-md hover:bg-muted cursor-pointer transition-colors text-left"
                    >
                      {#if isExpanded}
                        <BotMessageSquare size={14} class="text-primary shrink-0" />
                      {:else}
                        <Bot size={14} class="text-primary/70 shrink-0" />
                      {/if}
                      <span class="truncate text-foreground font-medium text-[13px]">{agent.agent_id}</span>
                      {#if agentSessions.length > 0}
                        <span class="ml-auto text-[10px] text-muted-foreground tabular-nums">{agentSessions.length}</span>
                      {/if}
                    </Collapsible.Trigger>
                    <button
                      title="Inspect {agent.agent_id}"
                      class="w-5 h-5 flex items-center justify-center rounded hover:bg-muted text-muted-foreground opacity-0 group-hover/agent:opacity-100 transition-all cursor-pointer"
                      onclick={(e) => {
                        e.stopPropagation();
                        appState.openAgentInspector(agent.agent_id);
                      }}
                    >
                      <Info size={12} />
                    </button>
                    <button
                      title="New session for {agent.agent_id}"
                      class="w-5 h-5 flex items-center justify-center rounded hover:bg-muted text-muted-foreground opacity-0 group-hover/agent:opacity-100 transition-all cursor-pointer mr-1"
                      onclick={(e) => {
                        e.stopPropagation();
                        appState.createSession(agent.agent_id);
                      }}
                    >
                      <Plus size={11} />
                    </button>
                  </div>

                  <Collapsible.Content class="overflow-visible" style="overflow: visible !important;">
                    <Sidebar.Menu class="pl-5 ml-0 mt-0.5 mb-1">
                      {#if agentSessions.length === 0}
                        <div class="px-2 py-1.5 text-[11px] text-muted-foreground">No sessions</div>
                      {:else}
                        {#each agentSessions as sess (sess.session_id)}
                          <Sidebar.MenuItem>
                            <Sidebar.MenuButton
                              isActive={$page.url.pathname === `/sessions/${sess.session_id}`}
                            >
                              {#snippet child({
                                props,
                              }: {
                                props: Record<string, unknown>;
                              })}
                                <a
                                  href={`/sessions/${sess.session_id}`}
                                  {...props}
                                  class={[
                                    props.class,
                                    'flex-1',
                                    'justify-start',
                                    'group/session-link',
                                    'py-1',
                                  ].join(' ')}
                                  onclick={() => {
                                    appState.selectSession(sess);
                                  }}
                                >
                                  <span
                                    class={[
                                      "whitespace-nowrap overflow-hidden text-ellipsis text-[12px] transition-colors min-w-0",
                                      $page.url.pathname === `/sessions/${sess.session_id}` 
                                        ? "text-foreground font-medium" 
                                        : "text-muted-foreground group-hover/session-link:text-foreground/80"
                                    ].join(' ')}
                                    >{sess.title || sess.session_id.slice(0, 8)}</span
                                  >
                                </a>
                              {/snippet}
                            </Sidebar.MenuButton>
                            <Sidebar.MenuAction
                              showOnHover={true}
                              onclick={async (e: MouseEvent) => {
                                e.preventDefault();
                                e.stopPropagation();
                                await appState.deleteSession(sess.session_id);
                              }}
                              title="Archive session"
                            >
                              <Archive size={12} />
                              <span class="sr-only">Archive session</span>
                            </Sidebar.MenuAction>
                          </Sidebar.MenuItem>
                        {/each}
                      {/if}
                    </Sidebar.Menu>
                  </Collapsible.Content>
                </Collapsible.Root>
              {/each}
            {/if}
          </Sidebar.GroupContent>
        </Sidebar.Group>
      {/if}
    </Sidebar.Content>

    <Sidebar.Footer>
      {#if appState.nodeInfo?.enrollment?.trust_state === 'trusted'}
      <Sidebar.Menu class="px-2">
        <Sidebar.MenuItem>
          <Sidebar.MenuButton isActive={isActive('/schedules')}>
            {#snippet child({ props }: { props: Record<string, unknown> })}
              <a href="/schedules" {...props}>
                <Clock size={15} />
                <span>Automations</span>
              </a>
            {/snippet}
          </Sidebar.MenuButton>
        </Sidebar.MenuItem>

        <Sidebar.MenuItem>
          <Sidebar.MenuButton isActive={isActive('/skills')}>
            {#snippet child({ props }: { props: Record<string, unknown> })}
              <a href="/skills" {...props}>
                <Puzzle size={15} />
                <span>Skills</span>
              </a>
            {/snippet}
          </Sidebar.MenuButton>
        </Sidebar.MenuItem>
      </Sidebar.Menu>
      {/if}
    </Sidebar.Footer>
  </Sidebar.Root>

  <!-- Main Content + optional sidebar -->
  <main class="w-full flex-1 flex flex-col min-h-0 h-full overflow-hidden bg-background">
    {#if appState.nodeInfo && appState.nodeInfo.enrollment.trust_state !== 'trusted'}
      <div
        class="flex items-center justify-between gap-3 px-5 py-2.5 bg-destructive/10 border-b border-destructive/20 text-sm"
      >
        <span
          >🔒 This computer is not trusted ({appState.nodeInfo.enrollment
            .trust_state}). Messaging is disabled.</span
        >
        <button
          class="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium bg-primary/10 text-primary border border-primary rounded-md cursor-pointer hover:bg-primary/20"
          onclick={appState.trustNode}
        >
          <Unlock size={12} /> Trust this Computer
        </button>
      </div>
    {/if}
    {@render children()}
  </main>
</Sidebar.Provider>

<!-- New Agent Modal -->
{#if appState.showNewAgent}
  <div class="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50" onclick={() => (appState.showNewAgent = false)} role="presentation">
    <div class="bg-card border border-border rounded-2xl p-6 w-[400px] max-w-[90vw]" onclick={(e) => e.stopPropagation()} role="dialog" tabindex="-1" onkeydown={(e) => { if (e.key === 'Escape') appState.showNewAgent = false; }}>
      <h3 class="text-base font-semibold mb-4">Create New Agent</h3>
      <div class="mb-3.5">
        <label for="new-agent-name" class="block text-xs text-muted-foreground mb-1.5">Agent Name</label>
        <input id="new-agent-name" class="w-full bg-muted border border-border rounded-lg text-foreground text-[13px] px-3 py-2 outline-none focus:border-primary" bind:value={appState.newAgentName} placeholder="my-agent" onkeydown={(e) => { if (e.key === 'Enter') appState.createAgent(); }} />
      </div>
      <div class="flex justify-end gap-2 mt-2">
        <button class="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium text-muted-foreground border border-border rounded-md cursor-pointer hover:bg-accent hover:text-foreground" onclick={() => (appState.showNewAgent = false)}>Cancel</button>
        <button class="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium bg-primary/10 text-primary border border-primary rounded-md cursor-pointer hover:bg-primary/20 disabled:opacity-40 disabled:cursor-not-allowed" onclick={() => appState.createAgent()} disabled={!appState.newAgentName.trim()}>Create</button>
      </div>
    </div>
  </div>
{/if}

<!-- Agent Inspector Dialog -->
<AgentInspectorDialog />
