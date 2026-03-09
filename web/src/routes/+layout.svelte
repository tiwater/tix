<script lang="ts">
	import favicon from '$lib/assets/favicon.svg';
	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>TiClaw DevUI</title>
	<meta name="description" content="TiClaw HTTP SSE chat interface for development and testing" />
</svelte:head>

{@render children()}
