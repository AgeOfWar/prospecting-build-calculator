<script lang="ts">
	import { BOOST_SOURCES, ENCHANTS, EQUIPMENT, PANS, RUNES, SHOVELS } from '#lib/data/index.ts';
	import { resolveSavedBuild } from '#lib/engine/loadout.ts';
	import {
		ALL_STAT_KEYS,
		MAX_RING_SLOTS,
		STAT_LABELS,
		calculateBuildStats,
		createEmptyLoadout,
	} from '#lib/engine/stats.ts';
	import { loadSavedBuilds } from '#lib/storage/builds.ts';
	import { loadSavedMuseums } from '#lib/storage/museums.ts';
	import type { SavedBuild, SavedMuseum } from '#lib/types/prospecting.ts';

	let loadout = $state(createEmptyLoadout());
	let savedBuilds = $state<SavedBuild[]>([]);
	let savedMuseums = $state<SavedMuseum[]>([]);

	$effect(() => {
		savedBuilds = loadSavedBuilds();
		savedMuseums = loadSavedMuseums();
	});

	const museumsById = $derived(new Map(savedMuseums.map((m) => [m.id, m])));

	const calculated = $derived(calculateBuildStats(loadout));

	function formatNumber(value: number): string {
		return Number.isInteger(value) ? value.toString() : value.toFixed(2);
	}
</script>

<svelte:head>
	<title>Dashboard • Prospecting! Build Calculator</title>
</svelte:head>

<main class="mx-auto max-w-6xl space-y-6 px-6 py-8">
	<section
		class="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-amber-500/30 bg-gradient-to-r from-amber-500/10 via-slate-900/80 to-slate-900/80 p-6"
	>
		<div>
			<h1 class="text-xl font-bold text-white">Crea e salva il tuo equipaggiamento</h1>
			<p class="mt-1 text-sm text-slate-300">
				Componi Pan, Shovel, 1 Necklace, 1 Charm, 8 Rings (Base o 6★), Runes e Potions, salva nel browser e controlla il
				riepilogo completo delle statistiche.
			</p>
		</div>
		<div class="flex flex-wrap gap-2.5">
			<a
				href="/builder"
				class="inline-flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-amber-400"
			>
				Apri Equipaggiamento
				<span aria-hidden="true">→</span>
			</a>
			<a
				href="/museum"
				class="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm font-semibold text-slate-100 transition hover:border-amber-400/50 hover:text-amber-200"
			>
				Configura Museo
			</a>
			<a
				href="/optimizer"
				class="inline-flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-4 py-2.5 text-sm font-semibold text-emerald-200 transition hover:bg-emerald-500/25"
			>
				Ottimizzatore Build + Museo
			</a>
			<a
				href="/chance"
				class="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm font-semibold text-slate-100 transition hover:border-amber-400/50 hover:text-amber-200"
			>
				Calcolo Probabilità Minerali
			</a>
		</div>
	</section>

	{#if savedBuilds.length > 0}
		<section class="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
			<div class="flex items-center justify-between">
				<h2 class="text-base font-semibold text-white">
					Equipaggiamenti Salvati ({savedBuilds.length})
				</h2>
				<a href="/builder" class="text-xs font-medium text-amber-300 hover:underline"> Gestisci tutti → </a>
			</div>
			<div class="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
				{#each savedBuilds as entry (entry.id)}
					{@const linkedMuseum = entry.museumId ? (museumsById.get(entry.museumId) ?? null) : null}
					{@const resolved = resolveSavedBuild(entry, linkedMuseum)}
					{@const stats = calculateBuildStats(resolved)}
					<div class="rounded-xl border border-slate-800 bg-slate-950/60 p-4 transition hover:border-amber-400/50">
						<div class="flex items-center justify-between gap-2">
							<h3 class="truncate text-sm font-semibold text-white">{entry.name}</h3>
							<div class="flex shrink-0 items-center gap-2 text-xs">
								<a
									href={`/builder?load=${encodeURIComponent(entry.id)}`}
									class="font-medium text-amber-300 hover:underline"
								>
									Modifica
								</a>
								<span class="text-slate-600">•</span>
								<a
									href={`/chance?build=${encodeURIComponent(entry.id)}`}
									class="font-medium text-emerald-300 hover:underline"
								>
									Calcola %
								</a>
							</div>
						</div>
						<div class="mt-2 flex flex-wrap gap-1.5 text-[11px]">
							<span class="rounded bg-slate-800 px-2 py-0.5 text-slate-300">
								{resolved.pan?.name ?? 'Nessuna Pan'}
							</span>
							<span class="rounded bg-amber-500/10 px-2 py-0.5 font-mono text-amber-300">
								Luck {formatNumber(stats.luck.final)}
							</span>
							<span class="rounded bg-emerald-500/10 px-2 py-0.5 font-mono text-emerald-300">
								Sell +{Math.round(stats.sellBoost.final * 100)}%
							</span>
						</div>
					</div>
				{/each}
			</div>
		</section>
	{/if}

	<div class="grid gap-6 lg:grid-cols-3">
		<section class="space-y-6 lg:col-span-2">
			<div class="grid gap-4 sm:grid-cols-2">
				<div class="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
					<div class="flex items-center justify-between">
						<h2 class="text-base font-semibold text-white">Pan &amp; Enchant</h2>
						<span class="rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-300">
							{PANS.length} pans
						</span>
					</div>
					<p class="mt-2 text-xs text-slate-400">
						Stats: Luck, Capacity, Shake Strength, Shake Speed • Max 1 Enchant (Mysterious Altar / Books)
					</p>
				</div>

				<div class="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
					<div class="flex items-center justify-between">
						<h2 class="text-base font-semibold text-white">Shovel &amp; Enchant</h2>
						<span class="rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-300">
							{SHOVELS.length} shovels
						</span>
					</div>
					<p class="mt-2 text-xs text-slate-400">
						Stats: Dig Strength, Dig Speed, Toughness • Max 1 Enchant (Oasis Enchantment Altar)
					</p>
				</div>
			</div>

			<div class="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
				<div class="flex items-center justify-between">
					<h2 class="text-base font-semibold text-white">Jewelry Loadout</h2>
					<span class="rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-300">
						{EQUIPMENT.length} items in catalogo
					</span>
				</div>
				<p class="mt-1 text-xs text-slate-400">
					1 Necklace, 1 Charm e fino a {MAX_RING_SLOTS} Rings (con supporto per Base e 6★).
				</p>
			</div>

			<div class="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
				<div class="flex items-center justify-between">
					<h2 class="text-base font-semibold text-white">Runes, Totems &amp; Museum</h2>
					<span class="rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-300">
						{RUNES.length} runes • {ENCHANTS.length} enchants • {BOOST_SOURCES.length} boosts
					</span>
				</div>
				<p class="mt-1 text-xs text-slate-400">
					Bonus passivi e moltiplicatori globali: Runes, Museum Collections, Totems, Potions e Mastery.
				</p>
			</div>
		</section>

		<aside class="space-y-6">
			<div class="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
				<div class="flex items-center justify-between">
					<h2 class="text-base font-semibold text-white">Stat Summary</h2>
					<span class="text-xs text-slate-400">(Base + Flats) × (1 + Boosts)</span>
				</div>

				<dl class="mt-4 divide-y divide-slate-800/80 text-sm">
					{#each ALL_STAT_KEYS as key}
						{@const stat = calculated[key]}
						<div class="flex items-center justify-between py-2">
							<dt class="text-slate-300">{STAT_LABELS[key]}</dt>
							<dd class="font-mono text-xs text-amber-300">
								{formatNumber(stat.final)}
							</dd>
						</div>
					{/each}
				</dl>
			</div>
		</aside>
	</div>
</main>
