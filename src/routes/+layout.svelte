<script lang="ts">
	import './layout.css';

	let { children } = $props();
	const currentYear = new Date().getFullYear();

	function resetToHome(event: MouseEvent): void {
		event.preventDefault();
		window.location.assign('/');
	}
</script>

<svelte:head>
	<title>EMBER — Cloudflare Snippets Manager</title>
	<meta
		name="description"
		content="Create and manage Cloudflare Snippets across zones with a lightweight UI."
	/>
</svelte:head>

<div class="app-shell">
	<header class="app-header">
		<div class="brand-block">
			<h1><a href="/" onclick={resetToHome}>EMBER</a></h1>
			<span class="brand-kicker">Cloudflare Snippets Manager</span>
		</div>
	</header>

	<main>
		{@render children()}
	</main>

	<footer class="muted" style="margin-top: 0.7rem; text-align: center;">
		&copy; {currentYear} Chris K. Harris ·
		<a href="https://github.com/ckh-rcit/ember" target="_blank" rel="noreferrer">GitHub</a>
	</footer>
</div>
