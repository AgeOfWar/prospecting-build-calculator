<script lang="ts">
	import './layout.css';
	import { page } from '$app/state';
	import favicon from '#lib/assets/favicon.svg';
	import { WIKI_BASE_URL } from '#lib/data/index.ts';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();

	let mobileMenuOpen = $state(false);

	const navLinks = [
		{ href: '/', label: 'Dashboard' },
		{ href: '/builder', label: 'Build Builder' },
		{ href: '/museum', label: 'Museum' },
		{ href: '/optimizer', label: 'Optimizer' },
		{ href: '/chance', label: 'Drop Chances' },
	];

	$effect(() => {
		page.url.pathname;
		mobileMenuOpen = false;
	});
</script>

<svelte:head>
	<link rel="icon" type="image/svg+xml" href={favicon} />
</svelte:head>

<div class="min-h-screen overflow-x-clip bg-slate-950 text-slate-100">
	<header class="sticky top-0 z-30 border-b border-slate-800/80 bg-slate-900/85 backdrop-blur">
		<div class="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6 sm:py-4">
			<div class="flex min-w-0 items-center gap-6">
				<a href="/" class="group flex shrink-0 flex-col">
					<span class="text-[11px] font-semibold tracking-wider text-amber-400 uppercase"> Roblox • Prospecting! </span>
					<span class="text-lg font-bold tracking-tight text-white transition group-hover:text-amber-200">
						Build Calculator
					</span>
				</a>

				<nav class="hidden lg:flex lg:flex-wrap lg:items-center lg:gap-1.5" aria-label="Main navigation">
					{#each navLinks as link}
						{@const isActive = link.href === '/' ? page.url.pathname === '/' : page.url.pathname.startsWith(link.href)}
						<a
							href={link.href}
							class={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
								isActive
									? 'bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30'
									: 'text-slate-300 hover:bg-slate-800/80 hover:text-white'
							}`}
						>
							{link.label}
						</a>
					{/each}
				</nav>
			</div>

			<div class="flex shrink-0 items-center gap-2">
				<a
					href={WIKI_BASE_URL}
					target="_blank"
					rel="noopener noreferrer"
					class="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-300 transition hover:bg-amber-500/20 sm:px-3.5"
				>
					<span class="hidden sm:inline">Official Wiki</span>
					<span class="sm:hidden">Wiki</span>
					<span aria-hidden="true">↗</span>
				</a>

				<button
					type="button"
					onclick={() => (mobileMenuOpen = !mobileMenuOpen)}
					aria-expanded={mobileMenuOpen}
					aria-controls="mobile-nav"
					aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
					class="inline-flex items-center justify-center rounded-lg border border-slate-700 bg-slate-800/80 p-2 text-slate-200 transition hover:border-amber-400/50 hover:text-white lg:hidden"
				>
					{#if mobileMenuOpen}
						<svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
						</svg>
					{:else}
						<svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h16M4 18h16" />
						</svg>
					{/if}
				</button>
			</div>
		</div>

		{#if mobileMenuOpen}
			<nav
				id="mobile-nav"
				class="border-t border-slate-800/80 bg-slate-900/95 px-4 py-3 lg:hidden"
				aria-label="Mobile navigation"
			>
				<div class="mx-auto flex max-w-6xl flex-col gap-1">
					{#each navLinks as link}
						{@const isActive = link.href === '/' ? page.url.pathname === '/' : page.url.pathname.startsWith(link.href)}
						<a
							href={link.href}
							onclick={() => (mobileMenuOpen = false)}
							class={`block rounded-lg px-3 py-2.5 text-sm font-medium transition ${
								isActive
									? 'bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30'
									: 'text-slate-300 hover:bg-slate-800/80 hover:text-white'
							}`}
						>
							{link.label}
						</a>
					{/each}
				</div>
			</nav>
		{/if}
	</header>

	{@render children()}
</div>
