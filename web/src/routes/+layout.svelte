<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { page } from '$app/stores';
  import favicon from '$lib/assets/favicon.svg';
  import { appState } from '$lib/stores/app-state.svelte';
  import '../app.css';
  import {
    Bot,
    MessageSquare,
    Clock,
    Puzzle,
    Server,
    Wifi,
    WifiOff,
    Unlock,
    ChevronsUpDown,
    Plus,
    Archive,
  } from 'lucide-svelte';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import * as Sidebar from '$lib/components/ui/sidebar';

  let { children } = $props();

  function isActive(href: string) {
    const path = $page.url.pathname;
    if (href === '/agents') return path === '/' || path === '/agents';
    return path === href;
  }

  onMount(async () => {
    await appState.fetchNode();
    appState.fetchMind();
    appState.fetchMindFiles();
    await appState.fetchAgents();
    if (appState.agents.length > 0) {
      if (!appState.selectedAgentId) {
        appState.fetchSessionsForAgent(appState.agents[0].agent_id);
      } else {
        appState.fetchSessionsForAgent(appState.selectedAgentId);
      }
    }
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

<Sidebar.Provider>
  <Sidebar.Root>
    <Sidebar.Header class="px-4 pt-4">
      <a
        href="/nodes"
        class="flex items-center gap-2.5 font-bold text-[15px] text-primary tracking-tight no-underline mb-2"
        >TiClaw DevUI</a
      >
    </Sidebar.Header>

    <Sidebar.Content>
      <Sidebar.Group class="py-0">
        <Sidebar.GroupContent class="flex flex-col gap-1">
          <Sidebar.Menu>
            <!-- Node Switcher -->
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
                        href="/nodes"
                        {...props}
                        class="{props.class} flex-1 justify-start"
                      >
                        <Server size={15} />
                        <span class="truncate"
                          >{appState.nodeInfo?.hostname || 'Manage Nodes'}</span
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
                        <span class="sr-only">Toggle Node Menu</span>
                      </Sidebar.MenuAction>
                    {/snippet}
                  </DropdownMenu.Trigger>
                </div>
                <DropdownMenu.Content class="w-[200px]" align="start">
                  <DropdownMenu.Label>Nodes</DropdownMenu.Label>
                  {#if appState.nodeInfo}
                    <DropdownMenu.Item
                      class="flex flex-col items-start gap-1 cursor-default opacity-100 hover:bg-transparent focus:bg-transparent"
                    >
                      <div class="font-medium flex items-center gap-1.5">
                        <Server size={13} />
                        {appState.nodeInfo.hostname}
                      </div>
                      <div class="text-[10px] opacity-70">
                        Trust: {appState.nodeInfo.enrollment.trust_state}
                      </div>
                    </DropdownMenu.Item>
                  {/if}
                  <DropdownMenu.Separator />
                  <DropdownMenu.Item
                    class="cursor-pointer text-muted-foreground"
                    onclick={() => (window.location.href = '/nodes')}
                  >
                    <Server size={14} class="mr-2" /> Manage Nodes...
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Root>
            </Sidebar.MenuItem>

            {#if appState.nodeInfo?.enrollment?.trust_state === 'trusted'}
              <!-- Agent Switcher -->
              <Sidebar.MenuItem>
              <DropdownMenu.Root>
                <div class="flex items-center w-full">
                  <Sidebar.MenuButton isActive={isActive('/agents')}>
                    {#snippet child({
                      props,
                    }: {
                      props: Record<string, unknown>;
                    })}
                      <a
                        href="/agents"
                        {...props}
                        class="{props.class} flex-1 justify-start"
                      >
                        <Bot size={15} />
                        <span class="truncate"
                          >{appState.selectedAgentId || 'Select Agent'}</span
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
                        <span class="sr-only">Toggle Agent Menu</span>
                      </Sidebar.MenuAction>
                    {/snippet}
                  </DropdownMenu.Trigger>
                </div>
                <DropdownMenu.Content class="w-[200px]" align="start">
                  <DropdownMenu.Label>Agents</DropdownMenu.Label>
                  <DropdownMenu.Separator />
                  {#each appState.agents as agent}
                    <DropdownMenu.Item
                      class="cursor-pointer"
                      onclick={() =>
                        appState.fetchSessionsForAgent(agent.agent_id)}
                    >
                      <div class="flex flex-col">
                        <span class="font-medium">{agent.agent_id}</span>
                        <span class="text-[10px] opacity-70"
                          >{agent.session_count} sessions</span
                        >
                      </div>
                    </DropdownMenu.Item>
                  {/each}
                  {#if appState.agents.length === 0}
                    <div class="px-2 py-1 text-xs text-muted-foreground">
                      No agents found
                    </div>
                  {/if}
                  <DropdownMenu.Separator />
                  <DropdownMenu.Item
                    class="cursor-pointer"
                    onclick={() => {
                      appState.showNewAgent = true;
                    }}
                  >
                    <Plus size={14} class="mr-2" /> New Agent...
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    class="cursor-pointer"
                    onclick={() => (window.location.href = '/agents')}
                  >
                    Manage Agents...
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Root>
            </Sidebar.MenuItem>

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
            {/if}
          </Sidebar.Menu>
        </Sidebar.GroupContent>
      </Sidebar.Group>
      <!-- Sessions Group -->
      {#if appState.nodeInfo?.enrollment?.trust_state === 'trusted'}
        <Sidebar.Group
          class="flex flex-col gap-1 flex-1 min-h-0 overflow-hidden px-2 py-0"
        >
        <div class="flex items-center justify-between px-2 py-1.5 relative">
          <div
            class="flex items-center gap-2 text-sm font-medium text-foreground cursor-default flex-1"
          >
            <MessageSquare size={15} />
            <span>Sessions</span>
          </div>

          <button
            title="New Session"
            class="w-6 h-6 flex items-center justify-center rounded-md hover:bg-muted text-muted-foreground transition-colors cursor-pointer z-10"
            onclick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (appState.selectedAgentId) {
                appState.newSessionAgentId = appState.selectedAgentId;
                appState.showNewSession = true;
              } else {
                appState.showNewAgent = true;
              }
            }}
          >
            <Plus size={14} />
          </button>
        </div>

        <Sidebar.GroupContent
          class="flex flex-col gap-0.5 overflow-y-auto flex-1 pb-4 px-1"
        >
          <Sidebar.Menu>
            {#if !appState.selectedAgentId}
              <div class="px-2.5 py-2 text-xs text-muted-foreground">
                Select an agent first
              </div>
            {:else if appState.sessions.length === 0}
              <div class="px-2.5 py-2 text-xs text-muted-foreground">
                No sessions
              </div>
            {:else}
              {#each appState.sessions as sess}
                <Sidebar.MenuItem>
                  <Sidebar.MenuButton
                    isActive={appState.sessionId === sess.session_id &&
                      isActive('/chat')}
                  >
                    {#snippet child({
                      props,
                    }: {
                      props: Record<string, unknown>;
                    })}
                      <a
                        href="/chat"
                        {...props}
                        class={[
                          props.class,
                          'flex-1',
                          'justify-start',
                          'group/session-link',
                        ].join(' ')}
                        onclick={() => appState.selectSession(sess)}
                      >
                        <div
                          class="flex flex-col overflow-hidden leading-tight group-hover/session-link:pr-6 transition-all"
                        >
                          <span
                            class="font-medium whitespace-nowrap overflow-hidden text-ellipsis"
                            >{sess.session_id}</span
                          >
                          {#if sess.channel !== 'web' && sess.channel !== 'http'}
                            <span class="text-[10px] opacity-70 mt-0.5"
                              >{sess.channel}</span
                            >
                          {/if}
                        </div>
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
                    <Archive size={13} />
                    <span class="sr-only">Archive session</span>
                  </Sidebar.MenuAction>
                </Sidebar.MenuItem>
              {/each}
            {/if}
          </Sidebar.Menu>
        </Sidebar.GroupContent>
      </Sidebar.Group>
      {/if}
    </Sidebar.Content>

    <Sidebar.Footer>
      <!-- Status indicator -->
      <div class="flex items-center gap-2 px-2 py-1">
        {#if appState.sseConnected}
          <Wifi size={12} class="text-green-500" />
          <span class="text-[11px] text-green-500 font-medium">Connected</span>
        {:else}
          <WifiOff size={12} class="text-muted-foreground" />
          <span class="text-[11px] text-muted-foreground font-medium"
            >Offline</span
          >
        {/if}
      </div>
    </Sidebar.Footer>
  </Sidebar.Root>

  <!-- Main Content + optional sidebar -->
  <main class="w-full flex-1 flex flex-col overflow-hidden bg-background">
    {#if appState.nodeInfo && appState.nodeInfo.enrollment.trust_state !== 'trusted'}
      <div
        class="flex items-center justify-between gap-3 px-5 py-2.5 bg-destructive/10 border-b border-destructive/20 text-sm"
      >
        <span
          >🔒 This node is not trusted ({appState.nodeInfo.enrollment
            .trust_state}). Messaging is disabled.</span
        >
        <button
          class="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium bg-primary/10 text-primary border border-primary rounded-md cursor-pointer hover:bg-primary/20"
          onclick={appState.trustNode}
        >
          <Unlock size={12} /> Trust this Node
        </button>
      </div>
    {/if}
    {@render children()}
  </main>
</Sidebar.Provider>
