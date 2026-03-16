<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { page } from '$app/stores';
  import favicon from '$lib/assets/favicon.svg';
  import { appState } from '$lib/stores/app-state.svelte';
  import '../app.css';
  import {
    Bot, MessageSquare, Clock, Puzzle, Server, Wifi, WifiOff, Unlock,
  } from 'lucide-svelte';

  let { children } = $props();

  const navItems = [
    { href: '/nodes', icon: 'node', label: 'Nodes' },
    { href: '/sessions', icon: 'sessions', label: 'Agents' },
    { href: '/chat', icon: 'chat', label: 'Chat' },
    { href: '/schedules', icon: 'schedules', label: 'Schedules' },
    { href: '/skills', icon: 'skills', label: 'Skills' },
  ];

  function isActive(href: string): boolean {
    const path = $page.url.pathname;
    if (href === '/sessions') return path === '/' || path === '/sessions';
    return path === href;
  }

  onMount(async () => {
    await appState.fetchNode();
    appState.fetchMind();
    appState.fetchMindFiles();
  });

  onDestroy(() => {
    appState.disconnectSSE();
  });
</script>

<svelte:head>
  <link rel="icon" href={favicon} />
  <title>TiClaw DevUI</title>
  <meta name="description" content="TiClaw HTTP SSE chat interface for development and testing" />
</svelte:head>

<div class="grid h-screen font-sans" style:grid-template-columns="180px 1fr">
  <!-- Left Nav -->
  <nav class="bg-sidebar border-r border-sidebar-border flex flex-col overflow-y-auto">
    <a href="/sessions" class="flex items-center gap-2.5 px-4 pt-4 pb-5 font-bold text-[15px] text-primary tracking-tight no-underline">TiClaw DevUI</a>
    {#each navItems as item}
      <a
        href={item.href}
        class="w-full flex items-center gap-2.5 px-4 py-2.5 text-[13px] text-muted-foreground transition-all relative no-underline hover:bg-accent hover:text-foreground {isActive(item.href) ? 'bg-primary/10 text-primary' : ''}"
      >
        {#if isActive(item.href)}<span class="absolute left-0 top-0 w-[3px] h-full bg-primary rounded-r"></span>{/if}
        {#if item.icon === 'chat'}<MessageSquare size={15} />
        {:else if item.icon === 'schedules'}<Clock size={15} />
        {:else if item.icon === 'skills'}<Puzzle size={15} />
        {:else if item.icon === 'node'}<Server size={15} />
        {:else}<Bot size={15} />
        {/if}
        <span class="font-medium whitespace-nowrap overflow-hidden text-ellipsis">{item.label}</span>
      </a>
    {/each}
    <div class="mt-auto flex items-center gap-2 px-4 py-3">
      {#if appState.sseConnected}
        <Wifi size={12} class="text-green-500" />
        <span class="text-[11px] text-green-500">Connected</span>
      {:else}
        <WifiOff size={12} class="text-muted-foreground" />
        <span class="text-[11px] text-muted-foreground">Offline</span>
      {/if}
    </div>
  </nav>

  <!-- Main Content + optional sidebar -->
  <div class="flex flex-col overflow-hidden bg-background">
    {#if appState.nodeInfo && appState.nodeInfo.enrollment.trust_state !== 'trusted'}
      <div class="flex items-center justify-between gap-3 px-5 py-2.5 bg-destructive/10 border-b border-destructive/20 text-sm">
        <span>🔒 This node is not trusted ({appState.nodeInfo.enrollment.trust_state}). Messaging is disabled.</span>
        <button class="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium bg-primary/10 text-primary border border-primary rounded-md cursor-pointer hover:bg-primary/20" onclick={appState.trustNode}>
          <Unlock size={12} /> Trust this Node
        </button>
      </div>
    {/if}
    {@render children()}
  </div>
</div>
