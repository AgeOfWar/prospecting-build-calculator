<script lang="ts">
	import './layout.css';
	import { page } from '$app/state';
	import favicon from '#lib/assets/favicon.svg';
	import { WIKI_BASE_URL } from '#lib/data/index.ts';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();

	const navLinks = [
		{ href: '/', label: 'Dashboard' },
		{ href: '/builder', label: 'Equipaggiamento' },
		{ href: '/museum', label: 'Museo' },
		{ href: '/optimizer', label: 'Ottimizzatore' },
		{ href: '/chance', label: 'Calcolo Probabilità' },
	];
</script>

<svelte:head>
	<link rel="icon" type="image/svg+xml" href={favicon} />
</svelte:head>

<div class="min-h-screen bg-slate-950 text-slate-100">
	<header class="sticky top-0 z-30 border-b border-slate-800/80 bg-slate-900/85 backdrop-blur">
		<div class="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-4">
			<div class="flex flex-wrap items-center gap-6">
				<a href="/" class="group flex flex-col">
					<span class="text-[11px] font-semibold tracking-wider text-amber-400 uppercase"> Roblox • Prospecting! </span>
					<span class="text-lg font-bold tracking-tight text-white transition group-hover:text-amber-200">
						Build Calculator
					</span>
				</a>

				<nav class="flex items-center gap-1.5" aria-label="Navigazione principale">
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

			<a
				href={WIKI_BASE_URL}
				target="_blank"
				rel="noopener noreferrer"
				class="inline-flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3.5 py-1.5 text-xs font-medium text-amber-300 transition hover:bg-amber-500/20"
			>
				Wiki Ufficiale
				<span aria-hidden="true">↗</span>
			</a>
		</div>
	</header>

	{@render children()}
</div>
