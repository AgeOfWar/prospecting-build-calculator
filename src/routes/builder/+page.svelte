<script lang="ts">
	import { page } from '$app/state';
	import JewelrySlotCard from '#lib/components/JewelrySlotCard.svelte';
	import StatSummaryPanel from '#lib/components/StatSummaryPanel.svelte';
	import { BOOST_SOURCES, ENCHANTS, EQUIPMENT, PANS, RUNES, SHOVELS, TRINKETS } from '#lib/data/index.ts';
	import {
		calculateBuildEfficiency,
		fmtCompactRate,
		getBuildDigCritChance
	} from '#lib/engine/chance.ts';
	import {
		collectActivePassives,
		computePanPreview,
		computeShovelPreview,
		createDefaultSavedBuild,
		findUniqueRingWarnings,
		isUniqueOnlyEquipment,
		resolveSavedBuild,
	} from '#lib/engine/loadout.ts';
	import { calculateMuseumSummary } from '#lib/engine/museum.ts';
	import { ALL_STAT_KEYS, MAX_RING_SLOTS, STAT_LABELS, calculateBuildStats } from '#lib/engine/stats.ts';
	import {
		deleteSavedBuild,
		generateBuildId,
		loadDraftBuild,
		loadSavedBuilds,
		saveDraftBuild,
		upsertSavedBuild,
	} from '#lib/storage/builds.ts';
	import { loadSavedMuseums } from '#lib/storage/museums.ts';
	import type { EquippedJewelrySelection, SavedBuild, SavedMuseum } from '#lib/types/prospecting.ts';

	const panEnchants = ENCHANTS.filter((e) => e.target === 'pan');
	const shovelEnchants = ENCHANTS.filter((e) => e.target === 'shovel');
	const necklaces = EQUIPMENT.filter((e) => e.slot === 'necklace');
	const charms = EQUIPMENT.filter((e) => e.slot === 'charm');
	const rings = EQUIPMENT.filter((e) => e.slot === 'ring');
	const potions = BOOST_SOURCES.filter((b) => b.category === 'potion');
	const totems = BOOST_SOURCES.filter((b) => b.category === 'totem');

	const pansById = new Map(PANS.map((p) => [p.id, p]));
	const shovelsById = new Map(SHOVELS.map((s) => [s.id, s]));
	const enchantsById = new Map(ENCHANTS.map((e) => [e.id, e]));
	const trinketsById = new Map(TRINKETS.map((t) => [t.id, t]));
	const ringsById = new Map(rings.map((r) => [r.id, r]));

	let build = $state<SavedBuild>(createDefaultSavedBuild('My Build'));
	let savedBuilds = $state<SavedBuild[]>([]);
	let savedMuseums = $state<SavedMuseum[]>([]);
	let hydrated = $state(false);
	let lastLoadedQueryId = $state<string | null>(null);
	let runeQuery = $state('');
	let statusMessage = $state<string | null>(null);
	let isNight = $state(false);

	$effect(() => {
		const stored = loadSavedBuilds();
		savedBuilds = stored;
		savedMuseums = loadSavedMuseums();

		const loadParam = page.url.searchParams.get('load');
		if (!hydrated) {
			if (loadParam) {
				const target = stored.find((b) => b.id === loadParam);
				if (target) {
					build = structuredClone(target);
					lastLoadedQueryId = loadParam;
				}
			} else {
				const draft = loadDraftBuild();
				if (draft) build = draft;
			}
			hydrated = true;
			return;
		}

		if (loadParam && loadParam !== lastLoadedQueryId) {
			const target = stored.find((b) => b.id === loadParam);
			if (target) {
				build = structuredClone(target);
				lastLoadedQueryId = loadParam;
			}
		}
	});

	$effect(() => {
		if (!hydrated) return;
		saveDraftBuild($state.snapshot(build));
	});

	const museumsById = $derived(new Map(savedMuseums.map((m) => [m.id, m])));
	const selectedMuseum = $derived(build.museumId ? (museumsById.get(build.museumId) ?? null) : null);
	const selectedMuseumSummary = $derived(selectedMuseum ? calculateMuseumSummary(selectedMuseum) : null);

	const resolvedLoadout = $derived(resolveSavedBuild(build, selectedMuseum));
	const calculatedStats = $derived(calculateBuildStats(resolvedLoadout, { isNight }));
	const activePassives = $derived(collectActivePassives(build, selectedMuseum));
	const uniqueWarnings = $derived(findUniqueRingWarnings(build));

	const selectedPan = $derived(build.panId ? (pansById.get(build.panId) ?? null) : null);
	const selectedPanEnchant = $derived(build.panEnchantId ? (enchantsById.get(build.panEnchantId) ?? null) : null);
	const selectedPanTrinket = $derived(
		build.panTrinketId ? (trinketsById.get(build.panTrinketId) ?? null) : null,
	);
	const panPreview = $derived(selectedPan ? computePanPreview(selectedPan, selectedPanEnchant) : null);

	const selectedShovel = $derived(build.shovelId ? (shovelsById.get(build.shovelId) ?? null) : null);
	const selectedShovelEnchant = $derived(
		build.shovelEnchantId ? (enchantsById.get(build.shovelEnchantId) ?? null) : null,
	);
	const shovelPreview = $derived(selectedShovel ? computeShovelPreview(selectedShovel, selectedShovelEnchant) : null);

	function formatToolNum(val: number): string {
		const rounded = Math.round(val * 100) / 100;
		return Number.isInteger(rounded) ? rounded.toString() : rounded.toFixed(2);
	}

	const duplicateRingIds = $derived.by(() => {
		const counts = new Map<string, number>();
		for (const sel of build.rings) {
			if (!sel) continue;
			const item = ringsById.get(sel.itemId);
			if (!item || !isUniqueOnlyEquipment(item)) continue;
			counts.set(item.id, (counts.get(item.id) ?? 0) + 1);
		}
		const dupes = new Set<string>();
		for (const [id, count] of counts.entries()) {
			if (count > 1) dupes.add(id);
		}
		return dupes;
	});

	const canCopyFirstRing = $derived.by(() => {
		const first = build.rings[0];
		if (!first) return false;
		const item = ringsById.get(first.itemId);
		if (!item || isUniqueOnlyEquipment(item)) return false;
		return build.rings.slice(1).some((r) => r === null);
	});

	const filteredRunes = $derived.by(() => {
		const q = runeQuery.trim().toLowerCase();
		if (!q) return RUNES;
		return RUNES.filter(
			(r) => r.name.toLowerCase().includes(q) || (r.rawEffects?.some((e) => e.toLowerCase().includes(q)) ?? false),
		);
	});

	let statusTimer: ReturnType<typeof setTimeout> | undefined;
	function notify(message: string): void {
		statusMessage = message;
		if (statusTimer) clearTimeout(statusTimer);
		statusTimer = setTimeout(() => {
			statusMessage = null;
		}, 3000);
	}

	function handleSaveCurrent(): void {
		const snapshot = $state.snapshot(build);
		const id = snapshot.id || generateBuildId();
		const toSave: SavedBuild = {
			...snapshot,
			id,
			name: snapshot.name.trim() || 'Untitled Build',
			updatedAt: new Date().toISOString(),
		};
		savedBuilds = upsertSavedBuild(toSave);
		build = toSave;
		notify(`Build "${toSave.name}" saved.`);
	}

	function handleSaveAsNew(): void {
		const snapshot = $state.snapshot(build);
		const baseName = snapshot.name.trim() || 'New Build';
		const toSave: SavedBuild = {
			...snapshot,
			id: generateBuildId(),
			name: snapshot.id ? `${baseName} (Copy)` : baseName,
			updatedAt: new Date().toISOString(),
		};
		savedBuilds = upsertSavedBuild(toSave);
		build = toSave;
		notify(`Created new build "${toSave.name}".`);
	}

	function handleReset(): void {
		build = createDefaultSavedBuild('New Build');
		lastLoadedQueryId = null;
		notify('Loadout reset.');
	}

	function handleLoadSaved(entry: SavedBuild): void {
		build = structuredClone($state.snapshot(entry));
		notify(`Loaded build "${entry.name}".`);
	}

	function handleDuplicateSaved(entry: SavedBuild): void {
		const copy: SavedBuild = {
			...structuredClone($state.snapshot(entry)),
			id: generateBuildId(),
			name: `${entry.name} (Copy)`,
			updatedAt: new Date().toISOString(),
		};
		savedBuilds = upsertSavedBuild(copy);
		notify(`Duplicated "${entry.name}".`);
	}

	function handleDeleteSaved(entry: SavedBuild): void {
		savedBuilds = deleteSavedBuild(entry.id);
		if (build.id === entry.id) {
			build = { ...build, id: '' };
		}
		notify(`Deleted build "${entry.name}".`);
	}

	function updateRing(index: number, next: EquippedJewelrySelection | null): void {
		const updated = [...build.rings];
		updated[index] = next;
		build = { ...build, rings: updated };
	}

	function copyFirstRingToEmptySlots(): void {
		const first = build.rings[0];
		if (!first) return;
		const updated = build.rings.map((slot, idx) =>
			idx === 0 || slot !== null
				? slot
				: {
						...first,
						statRollQualities: first.statRollQualities ? { ...first.statRollQualities } : undefined
					}
		);
		build = { ...build, rings: updated };
	}

	function toggleIdInList(list: string[], id: string): string[] {
		return list.includes(id) ? list.filter((item) => item !== id) : [...list, id];
	}

	function formatDate(iso: string): string {
		try {
			return new Date(iso).toLocaleString('en-US', {
				month: 'short',
				day: '2-digit',
				hour: '2-digit',
				minute: '2-digit',
			});
		} catch {
			return iso;
		}
	}

	function summarizeSavedBuild(entry: SavedBuild): {
		panName: string;
		luck: string;
		rollsPerSec: string | null;
		sellBoost: string;
		jewelryCount: number;
	} {
		const linkedMuseum = entry.museumId ? (museumsById.get(entry.museumId) ?? null) : null;
		const resolved = resolveSavedBuild(entry, linkedMuseum);
		const stats = calculateBuildStats(resolved);
		const efficiency = calculateBuildEfficiency(stats, {
			hasPurityRune: entry.runeIds.includes('purity'),
			hasMastered: entry.shovelEnchantId === 'shovel-mastered',
			digCritChance: getBuildDigCritChance(entry.shovelEnchantId, entry.runeIds)
		});
		const jewelryCount =
			(entry.necklace ? 1 : 0) + (entry.charm ? 1 : 0) + entry.rings.filter((r) => r !== null).length;

		return {
			panName: resolved.pan?.name ?? 'No Pan',
			luck: Number.isInteger(stats.luck.final) ? stats.luck.final.toString() : stats.luck.final.toFixed(1),
			rollsPerSec: efficiency.hasPanningStats ? fmtCompactRate(efficiency.rollsPerSecond) : null,
			sellBoost: `${Math.round(stats.sellBoost.final * 100)}%`,
			jewelryCount,
		};
	}
</script>

<svelte:head>
	<title>Build Builder • Prospecting! Build Calculator</title>
</svelte:head>

<main class="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
	<section class="rounded-xl border border-slate-800 bg-slate-900/70 p-5">
		<div class="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
			<div class="flex-1">
				<label for="build-name" class="block text-xs font-semibold tracking-wider text-slate-400 uppercase">
					Build Name
				</label>
				<div class="mt-1.5 flex flex-wrap items-center gap-3">
					<input
						id="build-name"
						type="text"
						bind:value={build.name}
						placeholder="e.g. Endgame Luck Build"
						class="w-full max-w-sm rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2 text-sm font-medium text-white placeholder:text-slate-500 focus:border-amber-400 focus:outline-none"
					/>
					{#if build.id}
						<span
							class="rounded-md bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-300 ring-1 ring-emerald-500/20"
						>
							Linked to saved build
						</span>
					{:else}
						<span class="rounded-md bg-slate-800 px-2.5 py-1 text-xs text-slate-400">
							Auto-saved draft
						</span>
					{/if}
				</div>
			</div>

			<div class="flex flex-wrap items-center gap-2">
				<button
					type="button"
					onclick={handleSaveCurrent}
					class="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-amber-400"
				>
					{build.id ? 'Update Build' : 'Save Build'}
				</button>
				<button
					type="button"
					onclick={handleSaveAsNew}
					class="rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2 text-sm font-medium text-slate-100 transition hover:border-slate-500 hover:bg-slate-700"
				>
					Save as New
				</button>
				<button
					type="button"
					onclick={handleReset}
					class="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3.5 py-2 text-sm font-medium text-rose-300 transition hover:bg-rose-500/20"
				>
					Reset
				</button>
			</div>
		</div>

		{#if statusMessage}
			<p class="mt-3 text-xs font-medium text-emerald-300" role="status">{statusMessage}</p>
		{/if}

		<div class="mt-5 border-t border-slate-800/80 pt-4">
			<div class="flex flex-wrap items-center justify-between gap-2">
				<h2 class="text-sm font-semibold text-white">
					Saved Builds ({savedBuilds.length})
				</h2>
				<span class="text-xs text-slate-400">Saved in your browser</span>
			</div>

			{#if savedBuilds.length === 0}
				<p
					class="mt-3 rounded-lg border border-dashed border-slate-800 bg-slate-950/40 px-4 py-3 text-xs text-slate-400"
				>
					No saved builds yet. Configure your gear below and click
					<strong class="text-slate-200">Save Build</strong>.
				</p>
			{:else}
				<div class="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
					{#each savedBuilds as entry (entry.id)}
						{@const preview = summarizeSavedBuild(entry)}
						{@const isSelected = build.id === entry.id}
						<div
							class={`flex flex-col justify-between rounded-xl border p-3.5 transition ${
								isSelected
									? 'border-amber-400/60 bg-amber-500/5'
									: 'border-slate-800 bg-slate-950/50 hover:border-slate-700'
							}`}
						>
							<div>
								<div class="flex items-start justify-between gap-2">
									<h3 class="truncate text-sm font-semibold text-white">{entry.name}</h3>
									<span class="shrink-0 text-[11px] text-slate-500">
										{formatDate(entry.updatedAt)}
									</span>
								</div>
								<div class="mt-2 flex flex-wrap gap-1.5 text-[11px]">
									<span class="rounded bg-slate-800 px-2 py-0.5 text-slate-300">
										{preview.panName}
									</span>
									<span class="rounded bg-amber-500/10 px-2 py-0.5 font-mono text-amber-300">
										Luck {preview.luck}
									</span>
									{#if preview.rollsPerSec}
										<span class="rounded bg-sky-500/10 px-2 py-0.5 font-mono text-sky-300">
											{preview.rollsPerSec} rolls/s
										</span>
									{/if}
									<span class="rounded bg-emerald-500/10 px-2 py-0.5 font-mono text-emerald-300">
										Sell +{preview.sellBoost}
									</span>
									<span class="rounded bg-slate-800 px-2 py-0.5 text-slate-400">
										{preview.jewelryCount}/10 equipment
									</span>
								</div>
							</div>

							<div class="mt-3 flex items-center gap-2 border-t border-slate-800/80 pt-2.5 text-xs">
								<button
									type="button"
									onclick={() => handleLoadSaved(entry)}
									class="rounded-md bg-slate-800 px-2.5 py-1 font-medium text-white transition hover:bg-amber-500 hover:text-slate-950"
								>
									Load
								</button>
								<button
									type="button"
									onclick={() => handleDuplicateSaved(entry)}
									class="rounded-md border border-slate-700 px-2.5 py-1 text-slate-300 transition hover:border-slate-500"
								>
									Duplicate
								</button>
								<button
									type="button"
									onclick={() => handleDeleteSaved(entry)}
									class="ml-auto rounded-md px-2 py-1 text-rose-400 transition hover:bg-rose-500/10"
								>
									Delete
								</button>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	</section>

	<div class="grid items-start gap-6 lg:grid-cols-3">
		<div class="min-w-0 space-y-6 lg:col-span-2">
			<section class="grid gap-4 sm:grid-cols-2">
				<div class="min-w-0 rounded-xl border border-slate-800 bg-slate-900/60 p-5">
					<div class="flex flex-wrap items-center justify-between gap-2">
						<h2 class="text-base font-semibold text-white">Pan &amp; Enchant</h2>
						<div class="flex flex-wrap items-center gap-1.5">
							{#if selectedPanEnchant}
								<span
									class="rounded bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-300 ring-1 ring-amber-500/30"
								>
									{selectedPanEnchant.name}
								</span>
							{/if}
							{#if selectedPanTrinket}
								<span
									class="rounded bg-cyan-500/15 px-2 py-0.5 text-[11px] font-medium text-cyan-300 ring-1 ring-cyan-500/30"
								>
									{selectedPanTrinket.name}
								</span>
							{/if}
						</div>
					</div>
					<div class="mt-3 space-y-3">
						<div>
							<label for="select-pan" class="block text-xs font-medium text-slate-400">Pan</label>
							<select
								id="select-pan"
								bind:value={build.panId}
								class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-amber-400 focus:outline-none"
							>
								<option value={null}>— No Pan —</option>
								{#each PANS as pan}
									<option value={pan.id}>{pan.name}</option>
								{/each}
							</select>
						</div>

						<div>
							<label for="select-pan-enchant" class="block text-xs font-medium text-slate-400">
								Pan Enchant (max 1)
							</label>
							<select
								id="select-pan-enchant"
								bind:value={build.panEnchantId}
								class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-amber-400 focus:outline-none"
							>
								<option value={null}>— No Enchant —</option>
								{#each panEnchants as enchant}
									<option value={enchant.id}>{enchant.name}</option>
								{/each}
							</select>
						</div>

						<div>
							<label for="select-pan-trinket" class="block text-xs font-medium text-slate-400">
								Pan Trinket (max 1)
							</label>
							<select
								id="select-pan-trinket"
								bind:value={build.panTrinketId}
								class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-cyan-400 focus:outline-none"
							>
								<option value={null}>— No Trinket —</option>
								{#each TRINKETS as trinket (trinket.id)}
									<option value={trinket.id}>
										{trinket.name}{trinket.modeled ? '' : ' (passive)'}
									</option>
								{/each}
							</select>
						</div>

						{#if panPreview && selectedPan}
							<div class="space-y-2.5 rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-xs">
								<div class="grid grid-cols-2 gap-2">
									{#each panPreview.stats as stat}
										<div class="rounded-md border border-slate-800/80 bg-slate-900/60 px-2.5 py-1.5">
											<div class="text-[11px] text-slate-400">{stat.label}</div>
											<div class="mt-0.5 flex flex-wrap items-baseline justify-between gap-1 font-mono">
												<span class="text-sm font-semibold text-white">
													{formatToolNum(stat.final)}
												</span>
												{#if stat.changed}
													<span class={`text-[10px] ${stat.delta > 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
														{formatToolNum(stat.base)} → {formatToolNum(stat.final)}
													</span>
												{/if}
											</div>
										</div>
									{/each}
								</div>

								{#if panPreview.extraBonuses.length > 0}
									<div class="flex flex-wrap gap-1.5">
										{#each panPreview.extraBonuses as bonus}
											{@const displayVal = bonus.isPercent ? bonus.value * 100 : bonus.value}
											<span
												class={`rounded-md px-2 py-0.5 text-[11px] font-medium ${
													displayVal < 0
														? 'bg-rose-500/10 text-rose-300 ring-1 ring-rose-500/20'
														: 'bg-emerald-500/10 text-emerald-300 ring-1 ring-emerald-500/20'
												}`}
											>
												{displayVal > 0 ? '+' : ''}{formatToolNum(displayVal)}{bonus.isPercent ? '%' : ''}
												{bonus.label}
											</span>
										{/each}
									</div>
								{/if}

								{#if selectedPanEnchant?.rawEffects?.length}
									<p class="text-[11px] text-slate-400">
										Enchant: <span class="text-slate-200">{selectedPanEnchant.rawEffects.join(' • ')}</span>
									</p>
								{/if}
								{#if selectedPan.passive}
									<p class="text-amber-300/90">Passive: {selectedPan.passive}</p>
								{/if}
								{#if selectedPanTrinket}
									<div class="rounded border border-cyan-500/20 bg-cyan-500/5 px-2.5 py-1.5 text-[11px] text-cyan-200">
										<p>
											<strong>Trinket {selectedPanTrinket.name}:</strong>
											{selectedPanTrinket.effect}
										</p>
										{#if selectedPanTrinket.modelNote}
											<p class="mt-0.5 text-cyan-300/80">{selectedPanTrinket.modelNote}</p>
										{/if}
									</div>
								{/if}
							</div>
						{:else if selectedPanEnchant?.rawEffects?.length || selectedPanTrinket}
							<div class="space-y-1.5 rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-xs text-slate-300">
								{#if selectedPanEnchant?.rawEffects?.length}
									<p>Enchant: {selectedPanEnchant.rawEffects.join(' • ')}</p>
								{/if}
								{#if selectedPanTrinket}
									<p class="text-amber-300">
										⚠ Select a Pan to activate the {selectedPanTrinket.name} Trinket ({selectedPanTrinket.effect}).
									</p>
								{/if}
							</div>
						{/if}
					</div>
				</div>

				<div class="min-w-0 rounded-xl border border-slate-800 bg-slate-900/60 p-5">
					<div class="flex flex-wrap items-center justify-between gap-2">
						<h2 class="text-base font-semibold text-white">Shovel &amp; Enchant</h2>
						{#if selectedShovelEnchant}
							<span
								class="rounded bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-300 ring-1 ring-amber-500/30"
							>
								{selectedShovelEnchant.name}
							</span>
						{/if}
					</div>
					<div class="mt-3 space-y-3">
						<div>
							<label for="select-shovel" class="block text-xs font-medium text-slate-400"> Shovel </label>
							<select
								id="select-shovel"
								bind:value={build.shovelId}
								class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-amber-400 focus:outline-none"
							>
								<option value={null}>— No Shovel —</option>
								{#each SHOVELS as shovel}
									<option value={shovel.id}>{shovel.name}</option>
								{/each}
							</select>
						</div>

						<div>
							<label for="select-shovel-enchant" class="block text-xs font-medium text-slate-400">
								Shovel Enchant (max 1)
							</label>
							<select
								id="select-shovel-enchant"
								bind:value={build.shovelEnchantId}
								class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-amber-400 focus:outline-none"
							>
								<option value={null}>— No Enchant —</option>
								{#each shovelEnchants as enchant}
									<option value={enchant.id}>{enchant.name}</option>
								{/each}
							</select>
						</div>

						{#if shovelPreview && selectedShovel}
							<div class="space-y-2.5 rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-xs">
								<div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
									{#each shovelPreview.stats as stat}
										<div class="rounded-md border border-slate-800/80 bg-slate-900/60 px-2.5 py-1.5">
											<div class="text-[11px] text-slate-400">{stat.label}</div>
											<div class="mt-0.5 flex flex-wrap items-baseline justify-between gap-1 font-mono">
												<span class="text-sm font-semibold text-white">
													{formatToolNum(stat.final)}
												</span>
												{#if stat.changed}
													<span class={`text-[10px] ${stat.delta > 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
														{formatToolNum(stat.base)} → {formatToolNum(stat.final)}
													</span>
												{/if}
											</div>
										</div>
									{/each}
								</div>

								{#if selectedShovelEnchant?.rawEffects?.length}
									<p class="text-[11px] text-slate-400">
										Enchant: <span class="text-slate-200">{selectedShovelEnchant.rawEffects.join(' • ')}</span>
									</p>
								{/if}
								{#if selectedShovel.passive}
									<p class="text-amber-300/90">Passive: {selectedShovel.passive}</p>
								{/if}
							</div>
						{:else if selectedShovelEnchant?.rawEffects?.length}
							<div class="rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-xs text-slate-300">
								Enchant: {selectedShovelEnchant.rawEffects.join(' • ')}
							</div>
						{/if}
					</div>
				</div>
			</section>

			<section class="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
				<div class="flex flex-wrap items-center justify-between gap-2">
					<div>
						<h2 class="text-base font-semibold text-white">Equipment</h2>
						<p class="text-xs text-slate-400">
							1 Necklace, 1 Charm, and up to {MAX_RING_SLOTS} Rings. Choose Base or 6★, Mutation, and individual stat rolls.
						</p>
					</div>

					{#if canCopyFirstRing}
						<button
							type="button"
							onclick={copyFirstRingToEmptySlots}
							class="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-300 transition hover:bg-amber-500/20"
						>
							Copy Ring #1 to empty slots
						</button>
					{/if}
				</div>

				<div class="mt-4 grid gap-3 sm:grid-cols-2">
					<JewelrySlotCard
						label="Necklace"
						slot="necklace"
						items={necklaces}
						value={build.necklace}
						onchange={(next) => (build = { ...build, necklace: next })}
					/>
					<JewelrySlotCard
						label="Charm"
						slot="charm"
						items={charms}
						value={build.charm}
						onchange={(next) => (build = { ...build, charm: next })}
					/>
				</div>

				<div class="mt-4 grid gap-3 sm:grid-cols-2">
					{#each build.rings as ringSelection, index}
						<JewelrySlotCard
							label={`Ring #${index + 1}`}
							slot="ring"
							items={rings}
							value={ringSelection}
							duplicateWarning={Boolean(ringSelection && duplicateRingIds.has(ringSelection.itemId))}
							onchange={(next) => updateRing(index, next)}
						/>
					{/each}
				</div>
			</section>

			<section class="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
				<div class="flex flex-wrap items-center justify-between gap-2">
					<div>
						<h2 class="text-base font-semibold text-white">Museum</h2>
						<p class="text-xs text-slate-400">
							Link a saved Museum to apply all its percentage stat boosts.
						</p>
					</div>
					<a
						href={selectedMuseum ? `/museum?load=${encodeURIComponent(selectedMuseum.id)}` : '/museum'}
						class="text-xs font-medium text-amber-300 hover:underline"
					>
						{selectedMuseum ? 'Edit Museum ↗' : 'Open Museum Page →'}
					</a>
				</div>

				<div class="mt-3">
					<select
						aria-label="Select Museum"
						value={build.museumId ?? ''}
						onchange={(e) => {
							const val = (e.currentTarget as HTMLSelectElement).value;
							build = { ...build, museumId: val || null };
						}}
						class="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-amber-400 focus:outline-none"
					>
						<option value="">— No Museum —</option>
						{#each savedMuseums as m (m.id)}
							{@const ms = calculateMuseumSummary(m)}
							<option value={m.id}>{m.name} ({ms.filledSlots}/{ms.totalSlots} displays)</option>
						{/each}
					</select>
				</div>

				{#if savedMuseums.length === 0}
					<p class="mt-2.5 text-xs text-slate-400">
						No saved museums yet. Create your museum on the
						<a href="/museum" class="font-medium text-amber-300 hover:underline">Museum</a>
						page and save it to select it here.
					</p>
				{:else if selectedMuseum && selectedMuseumSummary}
					<div class="mt-3 flex flex-wrap gap-1.5">
						{#each ALL_STAT_KEYS as key}
							{@const val = selectedMuseumSummary.totalBoosts[key]}
							{#if Math.abs(val) > 1e-6}
								{@const pct = Math.round(val * 10000) / 100}
								<span
									class={`rounded-md px-2 py-0.5 font-mono text-[11px] font-medium ${
										pct < 0
											? 'bg-rose-500/10 text-rose-300 ring-1 ring-rose-500/20'
											: 'bg-emerald-500/10 text-emerald-300 ring-1 ring-emerald-500/20'
									}`}
								>
									{pct > 0 ? '+' : ''}{Number.isInteger(pct) ? pct : pct.toFixed(2)}%
									{STAT_LABELS[key]}
								</span>
							{/if}
						{/each}
					</div>
				{:else if build.museumId && !selectedMuseum}
					<p class="mt-2.5 text-xs text-amber-300">
						The previously linked museum is no longer available.
					</p>
				{/if}
			</section>

			<section class="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
				<div class="flex flex-wrap items-center justify-between gap-3">
					<div>
						<h2 class="text-base font-semibold text-white">Runes</h2>
						<p class="text-xs text-slate-400">
							Select equipped runes ({build.runeIds.length} active).
						</p>
					</div>
					<input
						type="search"
						bind:value={runeQuery}
						placeholder="Search runes..."
						class="w-full max-w-xs rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-amber-400 focus:outline-none"
					/>
				</div>

				<div class="mt-4 grid gap-2.5 sm:grid-cols-2">
					{#each filteredRunes as rune (rune.id)}
						{@const active = build.runeIds.includes(rune.id)}
						<button
							type="button"
							onclick={() => (build = { ...build, runeIds: toggleIdInList(build.runeIds, rune.id) })}
							class={`rounded-xl border p-3 text-left transition ${
								active
									? 'border-amber-400/70 bg-amber-500/10'
									: 'border-slate-800 bg-slate-950/50 hover:border-slate-700'
							}`}
						>
							<div class="flex items-center justify-between gap-2">
								<span class="text-sm font-semibold text-white">{rune.name}</span>
								<span
									class={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
										active ? 'bg-amber-500 text-slate-950' : 'bg-slate-800 text-slate-400'
									}`}
								>
									{active ? 'Active' : 'Off'}
								</span>
							</div>
							{#if rune.rawEffects?.length}
								<p class="mt-1 text-xs text-slate-400">{rune.rawEffects.join(' • ')}</p>
							{/if}
						</button>
					{/each}
				</div>
			</section>

			<section class="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
				<div class="flex items-center justify-between">
					<div>
						<h2 class="text-base font-semibold text-white">Potions &amp; Totems</h2>
						<p class="text-xs text-slate-400">
							Toggle temporary buffs to simulate in-game stats ({build.boostIds.length} active).
						</p>
					</div>
				</div>

				<div class="mt-4 space-y-5">
					<div>
						<h3 class="mb-2 text-xs font-semibold tracking-wider text-slate-400 uppercase">Totems</h3>
						<div class="grid gap-2.5 sm:grid-cols-2">
							{#each totems as totem (totem.id)}
								{@const active = build.boostIds.includes(totem.id)}
								<button
									type="button"
									onclick={() => (build = { ...build, boostIds: toggleIdInList(build.boostIds, totem.id) })}
									class={`rounded-xl border p-3 text-left transition ${
										active
											? 'border-cyan-400/70 bg-cyan-500/10'
											: 'border-slate-800 bg-slate-950/50 hover:border-slate-700'
									}`}
								>
									<div class="flex items-center justify-between gap-2">
										<span class="text-sm font-semibold text-white">{totem.name}</span>
										{#if totem.duration}
											<span class="text-[11px] text-slate-400">{totem.duration}</span>
										{/if}
									</div>
									{#if totem.rawEffects?.length}
										<p class="mt-1 text-xs text-slate-400">{totem.rawEffects.join(' • ')}</p>
									{/if}
								</button>
							{/each}
						</div>
					</div>

					<div>
						<h3 class="mb-2 text-xs font-semibold tracking-wider text-slate-400 uppercase">Potions</h3>
						<div class="grid gap-2.5 sm:grid-cols-2">
							{#each potions as potion (potion.id)}
								{@const active = build.boostIds.includes(potion.id)}
								<button
									type="button"
									onclick={() => (build = { ...build, boostIds: toggleIdInList(build.boostIds, potion.id) })}
									class={`rounded-xl border p-3 text-left transition ${
										active
											? 'border-emerald-400/70 bg-emerald-500/10'
											: 'border-slate-800 bg-slate-950/50 hover:border-slate-700'
									}`}
								>
									<div class="flex items-center justify-between gap-2">
										<span class="text-sm font-semibold text-white">{potion.name}</span>
										{#if potion.duration}
											<span class="text-[11px] text-slate-400">{potion.duration}</span>
										{/if}
									</div>
									{#if potion.rawEffects?.length}
										<p class="mt-1 text-xs text-slate-400">{potion.rawEffects.join(' • ')}</p>
									{/if}
								</button>
							{/each}
						</div>
					</div>
				</div>
			</section>
		</div>

		<aside class="min-w-0 lg:sticky lg:top-20">
			<StatSummaryPanel
				stats={calculatedStats}
				passives={activePassives}
				warnings={uniqueWarnings}
				hasPurityRune={build.runeIds.includes('purity')}
				hasMastered={build.shovelEnchantId === 'shovel-mastered'}
				digCritChance={getBuildDigCritChance(build.shovelEnchantId, build.runeIds)}
				bind:isNight
				hasDayNightRune={build.runeIds.includes('abyssal') || build.runeIds.includes('sunblessed')}
			/>
		</aside>
	</div>
</main>
