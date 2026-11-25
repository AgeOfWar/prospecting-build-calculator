<script lang="ts">
	import { page } from '$app/state';
	import {
		MUSEUM_MODIFIER_RIDERS,
		MUSEUM_ORES,
		MUSEUM_RARITY_MULTIPLIERS,
		MUSEUM_SLOT_COUNTS,
	} from '#lib/data/index.ts';
	import {
		MUSEUM_RARITIES_DESC,
		MUSEUM_RARITY_LABELS,
		calculateMuseumSlotBoosts,
		calculateMuseumSummary,
		createDefaultSavedMuseum,
		getMuseumModifierIneligibilityReason,
		isMuseumModifierAllowedForOre,
	} from '#lib/engine/museum.ts';
	import { ALL_STAT_KEYS, STAT_LABELS } from '#lib/engine/stats.ts';
	import {
		deleteSavedMuseum,
		generateMuseumId,
		loadDraftMuseum,
		loadSavedMuseums,
		saveDraftMuseum,
		upsertSavedMuseum,
	} from '#lib/storage/museums.ts';
	import type {
		MuseumOreEntry,
		MuseumRarity,
		MuseumSlotSelection,
		SavedMuseum,
		StatKey,
	} from '#lib/types/prospecting.ts';

	const RARITY_STYLES: Record<MuseumRarity, { badge: string; border: string }> = {
		exotic: {
			badge: 'border-rose-500/40 bg-rose-500/15 text-rose-300',
			border: 'border-rose-500/25',
		},
		mythic: {
			badge: 'border-fuchsia-500/40 bg-fuchsia-500/15 text-fuchsia-300',
			border: 'border-fuchsia-500/25',
		},
		legendary: {
			badge: 'border-amber-500/40 bg-amber-500/15 text-amber-300',
			border: 'border-amber-500/25',
		},
		epic: {
			badge: 'border-violet-500/40 bg-violet-500/15 text-violet-300',
			border: 'border-violet-500/25',
		},
		rare: {
			badge: 'border-sky-500/40 bg-sky-500/15 text-sky-300',
			border: 'border-sky-500/25',
		},
		uncommon: {
			badge: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300',
			border: 'border-emerald-500/25',
		},
		common: {
			badge: 'border-slate-500/40 bg-slate-500/15 text-slate-300',
			border: 'border-slate-700/80',
		},
	};

	const oresByRarity: Record<MuseumRarity, MuseumOreEntry[]> = {
		exotic: [],
		mythic: [],
		legendary: [],
		epic: [],
		rare: [],
		uncommon: [],
		common: [],
	};

	for (const ore of MUSEUM_ORES) {
		oresByRarity[ore.rarity]?.push(ore);
	}
	for (const rarity of MUSEUM_RARITIES_DESC) {
		oresByRarity[rarity].sort((a, b) => a.name.localeCompare(b.name));
	}

	const oresById = new Map(MUSEUM_ORES.map((o) => [o.id, o]));

	let museum = $state<SavedMuseum>(createDefaultSavedMuseum('Il mio Museo'));
	let savedMuseums = $state<SavedMuseum[]>([]);
	let hydrated = $state(false);
	let lastLoadedQueryId = $state<string | null>(null);
	let statusMessage = $state<string | null>(null);
	let onlyActiveStats = $state(true);

	$effect(() => {
		const stored = loadSavedMuseums();
		savedMuseums = stored;

		const loadParam = page.url.searchParams.get('load');
		if (!hydrated) {
			if (loadParam) {
				const target = stored.find((m) => m.id === loadParam);
				if (target) {
					museum = structuredClone(target);
					lastLoadedQueryId = loadParam;
				}
			} else {
				const draft = loadDraftMuseum();
				if (draft) museum = draft;
			}
			hydrated = true;
			return;
		}

		if (loadParam && loadParam !== lastLoadedQueryId) {
			const target = stored.find((m) => m.id === loadParam);
			if (target) {
				museum = structuredClone(target);
				lastLoadedQueryId = loadParam;
			}
		}
	});

	$effect(() => {
		if (!hydrated) return;
		saveDraftMuseum($state.snapshot(museum));
	});

	const summary = $derived(calculateMuseumSummary(museum));
	const visibleStats = $derived(
		onlyActiveStats ? ALL_STAT_KEYS.filter((k) => Math.abs(summary.totalBoosts[k]) > 1e-6) : ALL_STAT_KEYS,
	);

	let statusTimer: ReturnType<typeof setTimeout> | undefined;
	function notify(message: string): void {
		statusMessage = message;
		if (statusTimer) clearTimeout(statusTimer);
		statusTimer = setTimeout(() => {
			statusMessage = null;
		}, 3000);
	}

	function handleSaveCurrent(): void {
		const snapshot = $state.snapshot(museum);
		const id = snapshot.id || generateMuseumId();
		const toSave: SavedMuseum = {
			...snapshot,
			id,
			name: snapshot.name.trim() || 'Museo Senza Nome',
			updatedAt: new Date().toISOString(),
		};
		savedMuseums = upsertSavedMuseum(toSave);
		museum = toSave;
		notify(`Museo "${toSave.name}" salvato.`);
	}

	function handleSaveAsNew(): void {
		const snapshot = $state.snapshot(museum);
		const baseName = snapshot.name.trim() || 'Nuovo Museo';
		const toSave: SavedMuseum = {
			...snapshot,
			id: generateMuseumId(),
			name: snapshot.id ? `${baseName} (Copia)` : baseName,
			updatedAt: new Date().toISOString(),
		};
		savedMuseums = upsertSavedMuseum(toSave);
		museum = toSave;
		notify(`Creato nuovo museo "${toSave.name}".`);
	}

	function handleReset(): void {
		museum = createDefaultSavedMuseum('Il mio Museo');
		lastLoadedQueryId = null;
		notify('Museo azzerato.');
	}

	function setAllSlotsToMinKg(): void {
		const nextSlots = { ...museum.slots };
		for (const rarity of MUSEUM_RARITIES_DESC) {
			nextSlots[rarity] = (museum.slots[rarity] ?? []).map((slot) => {
				if (!slot) return null;
				const ore = oresById.get(slot.oreId);
				if (!ore) return slot;
				return { ...slot, weightKg: ore.minKg };
			});
		}
		museum = { ...museum, slots: nextSlots };
		notify('Tutti i minerali impostati al peso minimo richiesto.');
	}

	function handleLoadSaved(entry: SavedMuseum): void {
		museum = structuredClone($state.snapshot(entry));
		notify(`Caricato museo "${entry.name}".`);
	}

	function handleDuplicateSaved(entry: SavedMuseum): void {
		const copy: SavedMuseum = {
			...structuredClone($state.snapshot(entry)),
			id: generateMuseumId(),
			name: `${entry.name} (Copia)`,
			updatedAt: new Date().toISOString(),
		};
		savedMuseums = upsertSavedMuseum(copy);
		notify(`Duplicato "${entry.name}".`);
	}

	function handleDeleteSaved(entry: SavedMuseum): void {
		savedMuseums = deleteSavedMuseum(entry.id);
		if (museum.id === entry.id) {
			museum = { ...museum, id: '' };
		}
		notify(`Eliminato museo "${entry.name}".`);
	}

	function updateSlot(rarity: MuseumRarity, index: number, next: MuseumSlotSelection | null): void {
		const list = [...(museum.slots[rarity] ?? [])];
		list[index] = next;
		museum = {
			...museum,
			slots: { ...museum.slots, [rarity]: list },
		};
	}

	function handleOreSelect(rarity: MuseumRarity, index: number, oreId: string): void {
		if (!oreId) {
			updateSlot(rarity, index, null);
			return;
		}
		const ore = oresById.get(oreId);
		const current = museum.slots[rarity]?.[index] ?? null;
		const nextModifierId =
			current?.modifierId && ore && isMuseumModifierAllowedForOre(ore, current.modifierId)
				? current.modifierId
				: null;
		updateSlot(rarity, index, {
			oreId,
			weightKg: ore?.minKg ?? 1,
			modifierId: nextModifierId,
		});
	}

	function handleWeightChange(rarity: MuseumRarity, index: number, rawValue: string): void {
		const current = museum.slots[rarity]?.[index];
		if (!current) return;
		const parsed = Number(rawValue);
		updateSlot(rarity, index, {
			...current,
			weightKg: Number.isFinite(parsed) && parsed >= 0 ? parsed : 0,
		});
	}

	function handleModifierSelect(rarity: MuseumRarity, index: number, modifierId: string): void {
		const current = museum.slots[rarity]?.[index];
		if (!current) return;
		updateSlot(rarity, index, {
			...current,
			modifierId: modifierId || null,
		});
	}

	function formatPct(decimalVal: number): string {
		const pct = decimalVal * 100;
		const rounded = Math.round(pct * 100) / 100;
		const sign = rounded > 0 ? '+' : '';
		return `${sign}${Number.isInteger(rounded) ? rounded : rounded.toFixed(2)}%`;
	}

	function formatOreOption(ore: MuseumOreEntry): string {
		const statsText = (Object.keys(ore.maxBoosts) as StatKey[])
			.map((k) => {
				const v = ore.maxBoosts[k]!;
				return `${STAT_LABELS[k]} ${formatPct(v)}`;
			})
			.join(', ');
		return `${ore.name} (${statsText} • min ${ore.minKg}kg)`;
	}

	function formatDate(iso: string): string {
		try {
			return new Date(iso).toLocaleString('it-IT', {
				day: '2-digit',
				month: '2-digit',
				hour: '2-digit',
				minute: '2-digit',
			});
		} catch {
			return iso;
		}
	}

	function getTopMuseumBadges(entry: SavedMuseum): Array<{ label: string; value: string }> {
		const s = calculateMuseumSummary(entry);
		return ALL_STAT_KEYS.filter((k) => Math.abs(s.totalBoosts[k]) > 1e-6)
			.sort((a, b) => Math.abs(s.totalBoosts[b]) - Math.abs(s.totalBoosts[a]))
			.slice(0, 3)
			.map((k) => ({ label: STAT_LABELS[k], value: formatPct(s.totalBoosts[k]) }));
	}
</script>

<svelte:head>
	<title>Museo • Prospecting! Build Calculator</title>
</svelte:head>

<main class="mx-auto max-w-6xl space-y-6 px-6 py-8">
	<section class="rounded-xl border border-slate-800 bg-slate-900/70 p-5">
		<div class="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
			<div class="flex-1">
				<label for="museum-name" class="block text-xs font-semibold tracking-wider text-slate-400 uppercase">
					Nome Museo
				</label>
				<div class="mt-1.5 flex flex-wrap items-center gap-3">
					<input
						id="museum-name"
						type="text"
						bind:value={museum.name}
						placeholder="Es. Museo Max Luck"
						class="w-full max-w-sm rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2 text-sm font-medium text-white placeholder:text-slate-500 focus:border-amber-400 focus:outline-none"
					/>
					{#if museum.id}
						<span
							class="rounded-md bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-300 ring-1 ring-emerald-500/20"
						>
							Museo salvato
						</span>
					{:else}
						<span class="rounded-md bg-slate-800 px-2.5 py-1 text-xs text-slate-400">
							Bozza locale (auto-salvata)
						</span>
					{/if}
					<span class="rounded-md bg-slate-800 px-2.5 py-1 font-mono text-xs text-amber-300">
						{summary.filledSlots}/{summary.totalSlots} display
					</span>
				</div>
			</div>

			<div class="flex flex-wrap items-center gap-2">
				<button
					type="button"
					onclick={handleSaveCurrent}
					class="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-amber-400"
				>
					{museum.id ? 'Aggiorna Museo' : 'Salva in LocalStorage'}
				</button>
				<button
					type="button"
					onclick={handleSaveAsNew}
					class="rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2 text-sm font-medium text-slate-100 transition hover:border-slate-500 hover:bg-slate-700"
				>
					Salva come Nuovo
				</button>
				<button
					type="button"
					onclick={setAllSlotsToMinKg}
					class="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2 text-sm font-medium text-emerald-300 transition hover:bg-emerald-500/20"
				>
					Tutti a Peso Min
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
			<div class="flex items-center justify-between">
				<h2 class="text-sm font-semibold text-white">
					Musei Salvati ({savedMuseums.length})
				</h2>
				<span class="text-xs text-slate-400"> Selezionabili nella pagina Equipaggiamento </span>
			</div>

			{#if savedMuseums.length === 0}
				<p
					class="mt-3 rounded-lg border border-dashed border-slate-800 bg-slate-950/40 px-4 py-3 text-xs text-slate-400"
				>
					Nessun museo salvato. Inserisci i tuoi minerali negli slot qui sotto e clicca
					<strong class="text-slate-200">Salva in LocalStorage</strong> per poterlo collegare alle tue build.
				</p>
			{:else}
				<div class="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
					{#each savedMuseums as entry (entry.id)}
						{@const entrySummary = calculateMuseumSummary(entry)}
						{@const topBadges = getTopMuseumBadges(entry)}
						{@const isSelected = museum.id === entry.id}
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
										{entrySummary.filledSlots}/{entrySummary.totalSlots} display
									</span>
									{#each topBadges as b}
										<span class="rounded bg-emerald-500/10 px-2 py-0.5 font-mono text-emerald-300">
											{b.value}
											{b.label}
										</span>
									{/each}
								</div>
							</div>

							<div class="mt-3 flex items-center gap-2 border-t border-slate-800/80 pt-2.5 text-xs">
								<button
									type="button"
									onclick={() => handleLoadSaved(entry)}
									class="rounded-md bg-slate-800 px-2.5 py-1 font-medium text-white transition hover:bg-amber-500 hover:text-slate-950"
								>
									Carica
								</button>
								<button
									type="button"
									onclick={() => handleDuplicateSaved(entry)}
									class="rounded-md border border-slate-700 px-2.5 py-1 text-slate-300 transition hover:border-slate-500"
								>
									Duplica
								</button>
								<button
									type="button"
									onclick={() => handleDeleteSaved(entry)}
									class="ml-auto rounded-md px-2 py-1 text-rose-400 transition hover:bg-rose-500/10"
								>
									Elimina
								</button>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	</section>

	<div class="grid items-start gap-6 lg:grid-cols-3">
		<div class="space-y-5 lg:col-span-2">
			{#each MUSEUM_RARITIES_DESC as rarity}
				{@const slotCount = MUSEUM_SLOT_COUNTS[rarity]}
				{@const raritySlots = museum.slots[rarity] ?? []}
				{@const filledInRarity = raritySlots.filter((s) => s !== null).length}
				{@const riderPct = (MUSEUM_RARITY_MULTIPLIERS[rarity] * 100).toFixed(2).replace(/\.00$/, '')}
				{@const style = RARITY_STYLES[rarity]}
				<section class={`rounded-xl border bg-slate-900/60 p-5 ${style.border}`}>
					<div class="flex flex-wrap items-center justify-between gap-2">
						<div class="flex items-center gap-2.5">
							<span class={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${style.badge}`}>
								{MUSEUM_RARITY_LABELS[rarity]}
							</span>
							<span class="text-xs text-slate-400">
								{filledInRarity}/{slotCount} display occupati
							</span>
						</div>
						<span class="text-[11px] text-slate-400">
							Rider Modificatore: <strong class="font-mono text-slate-200">+{riderPct}%</strong>
							<span class="text-slate-500">(2× per Treasured/Entombed)</span>
						</span>
					</div>

					<div class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
						{#each Array.from({ length: slotCount }, (_, i) => i) as slotIndex}
							{@const slot = raritySlots[slotIndex] ?? null}
							{@const calc = calculateMuseumSlotBoosts(rarity, slot)}
							<div
								class={`rounded-xl border p-3.5 transition ${
									calc.ore ? 'border-slate-700 bg-slate-950/70' : 'border-slate-800/90 bg-slate-950/40'
								}`}
							>
								<div class="flex items-center justify-between gap-2">
									<span class="text-xs font-semibold tracking-wide text-slate-300 uppercase">
										Display #{slotIndex + 1}
									</span>
									{#if calc.ore}
										<button
											type="button"
											onclick={() => updateSlot(rarity, slotIndex, null)}
											class="rounded px-1.5 py-0.5 text-xs text-slate-400 transition hover:bg-slate-800 hover:text-rose-300"
											title="Svuota display"
										>
											✕
										</button>
									{/if}
								</div>

								<select
									aria-label={`${MUSEUM_RARITY_LABELS[rarity]} Display ${slotIndex + 1}`}
									value={slot?.oreId ?? ''}
									onchange={(e) => handleOreSelect(rarity, slotIndex, (e.currentTarget as HTMLSelectElement).value)}
									class="mt-2 w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-2 text-xs text-slate-100 focus:border-amber-400 focus:outline-none"
								>
									<option value="">— Display Vuoto —</option>
									{#each oresByRarity[rarity] as ore (ore.id)}
										<option value={ore.id}>{formatOreOption(ore)}</option>
									{/each}
								</select>

								{#if slot && calc.ore}
									<div class="mt-3 space-y-2.5">
										<div>
											<div class="flex items-center justify-between text-[11px]">
												<label for={`weight-${rarity}-${slotIndex}`} class="font-medium text-slate-400">
													Peso (kg)
												</label>
												<div class="flex items-center gap-1.5">
													<button
														type="button"
														onclick={() =>
															updateSlot(rarity, slotIndex, {
																...slot,
																weightKg: calc.ore!.minKg,
															})}
														class="rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-300 hover:border-amber-400"
													>
														Min {calc.ore.minKg}kg
													</button>
													{#if calc.isMaxWeight}
														<span
															class="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300"
														>
															MAX
														</span>
													{:else}
														<span
															class="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300"
														>
															{Math.round(calc.weightRatio * 100)}%
														</span>
													{/if}
												</div>
											</div>
											<input
												id={`weight-${rarity}-${slotIndex}`}
												type="number"
												min="0"
												step="0.1"
												value={slot.weightKg}
												oninput={(e) =>
													handleWeightChange(rarity, slotIndex, (e.currentTarget as HTMLInputElement).value)}
												class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 font-mono text-xs text-slate-100 focus:border-amber-400 focus:outline-none"
											/>
										</div>

										<div>
											<label for={`mod-${rarity}-${slotIndex}`} class="block text-[11px] font-medium text-slate-400">
												Modificatore
											</label>
											<select
												id={`mod-${rarity}-${slotIndex}`}
												value={slot.modifierId ?? ''}
												onchange={(e) =>
													handleModifierSelect(rarity, slotIndex, (e.currentTarget as HTMLSelectElement).value)}
												class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-100 focus:border-fuchsia-400 focus:outline-none"
											>
												<option value="">— Nessuno —</option>
												{#each MUSEUM_MODIFIER_RIDERS as rider (rider.id)}
													{@const allowed = isMuseumModifierAllowedForOre(calc.ore, rider.id)}
													<option value={rider.id} disabled={!allowed && slot.modifierId !== rider.id}>
														{rider.name} ({rider.stats.map((s) => STAT_LABELS[s]).join(' + ')}{rider.multiplierFactor >
														1
															? ` • ${rider.multiplierFactor}×`
															: ''}){allowed ? '' : ' (non ottenibile)'}
													</option>
												{/each}
											</select>
											{#if getMuseumModifierIneligibilityReason(calc.ore, slot.modifierId)}
												<p class="mt-1 text-[11px] text-amber-300">
													⚠ {getMuseumModifierIneligibilityReason(calc.ore, slot.modifierId)}
												</p>
											{/if}
										</div>

										<div class="flex flex-wrap gap-1 pt-0.5">
											{#each ALL_STAT_KEYS as key}
												{@const val = calc.totalBoosts[key]}
												{#if val !== undefined && Math.abs(val) > 1e-6}
													<span
														class={`rounded-md px-2 py-0.5 font-mono text-[11px] font-medium ${
															val < 0
																? 'bg-rose-500/10 text-rose-300 ring-1 ring-rose-500/20'
																: 'bg-emerald-500/10 text-emerald-300 ring-1 ring-emerald-500/20'
														}`}
													>
														{formatPct(val)}
														{STAT_LABELS[key]}
													</span>
												{/if}
											{/each}
										</div>
									</div>
								{/if}
							</div>
						{/each}
					</div>
				</section>
			{/each}
		</div>

		<aside class="space-y-4 lg:sticky lg:top-20">
			<div class="rounded-xl border border-slate-800 bg-slate-900/70 p-5">
				<div class="flex flex-wrap items-center justify-between gap-2">
					<div>
						<h2 class="text-base font-semibold text-white">Bonus Totali Museo</h2>
						<p class="text-[11px] text-slate-400">Sommati nei Boost del personaggio</p>
					</div>

					<div class="inline-flex rounded-lg border border-slate-700 bg-slate-950 p-0.5 text-xs">
						<button
							type="button"
							onclick={() => (onlyActiveStats = true)}
							class={`rounded-md px-2 py-1 font-medium transition ${
								onlyActiveStats ? 'bg-amber-500/20 text-amber-300' : 'text-slate-400 hover:text-slate-200'
							}`}
						>
							Solo attive
						</button>
						<button
							type="button"
							onclick={() => (onlyActiveStats = false)}
							class={`rounded-md px-2 py-1 font-medium transition ${
								!onlyActiveStats ? 'bg-amber-500/20 text-amber-300' : 'text-slate-400 hover:text-slate-200'
							}`}
						>
							Tutte
						</button>
					</div>
				</div>

				{#if summary.duplicateWarnings.length > 0 || summary.modifierWarnings.length > 0}
					<div class="mt-4 space-y-1 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200">
						{#each summary.duplicateWarnings as warning}
							<p>⚠ {warning}</p>
						{/each}
						{#each summary.modifierWarnings as warning}
							<p>⚠ {warning}</p>
						{/each}
					</div>
				{/if}

				{#if visibleStats.length === 0}
					<p class="mt-4 rounded-lg border border-dashed border-slate-800 bg-slate-950/40 p-4 text-xs text-slate-400">
						Nessun minerale inserito nei display. Aggiungi un minerale a sinistra per calcolare i bonus percentuali del
						museo.
					</p>
				{:else}
					<dl class="mt-4 divide-y divide-slate-800/80 rounded-lg border border-slate-800/80 bg-slate-950/40">
						{#each visibleStats as key}
							{@const total = summary.totalBoosts[key]}
							{@const orePart = summary.oreBoosts[key]}
							{@const riderPart = summary.riderBoosts[key]}
							{@const active = Math.abs(total) > 1e-6}
							<div class="px-3.5 py-2.5">
								<div class="flex items-center justify-between gap-2">
									<dt class={`text-sm ${active ? 'font-medium text-slate-100' : 'text-slate-500'}`}>
										{STAT_LABELS[key]}
									</dt>
									<dd
										class={`font-mono text-sm font-semibold ${
											!active ? 'text-slate-600' : total < 0 ? 'text-rose-300' : 'text-amber-300'
										}`}
									>
										{active ? formatPct(total) : '0%'}
									</dd>
								</div>

								{#if active}
									<div class="mt-0.5 flex flex-wrap gap-x-3 font-mono text-[11px] text-slate-400">
										{#if Math.abs(orePart) > 1e-6}
											<span>Ore {formatPct(orePart)}</span>
										{/if}
										{#if Math.abs(riderPart) > 1e-6}
											<span class="text-fuchsia-300">Mod {formatPct(riderPart)}</span>
										{/if}
									</div>
								{/if}
							</div>
						{/each}
					</dl>
				{/if}

				<div class="mt-4 border-t border-slate-800/80 pt-4">
					<a
						href="/builder"
						class="flex w-full items-center justify-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs font-semibold text-amber-300 transition hover:bg-amber-500/20"
					>
						Usa questo Museo in Equipaggiamento →
					</a>
				</div>
			</div>
		</aside>
	</div>
</main>
