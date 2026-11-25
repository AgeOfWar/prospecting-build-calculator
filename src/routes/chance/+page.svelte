<script lang="ts">
	import { page } from '$app/state';
	import { MINERALS, MODIFIERS } from '#lib/data/index.ts';
	import {
		DEFAULT_CHANCE_INPUTS,
		calculateMineralChances,
		extractChanceInputsFromBuild,
		fmtDuration,
		fmtOneIn,
		fmtPct,
		getRarityBadgeClass,
		type ChanceInputs,
	} from '#lib/engine/chance.ts';
	import { loadSavedBuilds } from '#lib/storage/builds.ts';
	import { loadSavedMuseums } from '#lib/storage/museums.ts';
	import {
		type ChanceSearchState,
		type SavedChanceSearch,
		deleteSavedChanceSearch,
		loadChanceDraft,
		loadSavedChanceSearches,
		saveChanceDraft,
		upsertSavedChanceSearch
	} from '#lib/storage/searches.ts';
	import type { MineralRarity, SavedBuild, SavedMuseum } from '#lib/types/prospecting.ts';

	const WEIGHT_PRESETS = [null, 20, 40, 60, 100] as const;

	const RARITY_OPTIONS: Array<{ value: 'all' | MineralRarity; label: string }> = [
		{ value: 'all', label: 'Tutte le rarità' },
		{ value: 'common', label: 'Common' },
		{ value: 'uncommon', label: 'Uncommon' },
		{ value: 'rare', label: 'Rare' },
		{ value: 'epic', label: 'Epic' },
		{ value: 'legendary', label: 'Legendary' },
		{ value: 'mythic', label: 'Mythic' },
		{ value: 'exotic', label: 'Exotic' },
	];

	const allLocationNames = Array.from(
		new Set(
			MINERALS.flatMap((m) => [
				...(m.locations ?? []).map((l) => l.location),
				...(m.chests ?? []).map((c) => c.name),
			]).filter(Boolean),
		),
	).sort((a, b) => a.localeCompare(b));

	let mineralSearch = $state('');
	let rarityFilter = $state<'all' | MineralRarity>('all');
	let selectedMineralName = $state<string>(MINERALS[0]?.mineral ?? '');
	let locationFilter = $state<string>('all');

	let savedBuilds = $state<SavedBuild[]>([]);
	let savedMuseums = $state<SavedMuseum[]>([]);
	let savedSearches = $state<SavedChanceSearch[]>([]);
	let selectedBuildId = $state<string>('');
	let inputs = $state<ChanceInputs>({ ...DEFAULT_CHANCE_INPUTS });
	let hydratedQueryBuild = $state<string | null>(null);
	let hydrated = $state(false);
	let searchSaveName = $state('');

	const savedBuildsById = $derived(new Map(savedBuilds.map((b) => [b.id, b])));
	const savedMuseumsById = $derived(new Map(savedMuseums.map((m) => [m.id, m])));
	const selectedSavedBuild = $derived(selectedBuildId ? (savedBuildsById.get(selectedBuildId) ?? null) : null);
	const selectedLinkedMuseum = $derived(
		selectedSavedBuild?.museumId ? (savedMuseumsById.get(selectedSavedBuild.museumId) ?? null) : null,
	);

	const baseBuildInputs = $derived(
		selectedSavedBuild ? extractChanceInputsFromBuild(selectedSavedBuild, inputs, selectedLinkedMuseum) : null,
	);

	const isManuallyEdited = $derived.by(() => {
		if (!baseBuildInputs) return false;
		return (
			inputs.luck !== baseBuildInputs.luck ||
			inputs.capacity !== baseBuildInputs.capacity ||
			inputs.shakeSpeedPct !== baseBuildInputs.shakeSpeedPct ||
			inputs.shakeStrength !== baseBuildInputs.shakeStrength ||
			inputs.digsToFill !== baseBuildInputs.digsToFill ||
			inputs.digSpeedPct !== baseBuildInputs.digSpeedPct ||
			inputs.sizeBoostPct !== baseBuildInputs.sizeBoostPct ||
			inputs.modifierBoostPct !== baseBuildInputs.modifierBoostPct ||
			inputs.hasCrystalTouch !== baseBuildInputs.hasCrystalTouch ||
			inputs.hasVoidTouched !== baseBuildInputs.hasVoidTouched ||
			inputs.hasPurityRune !== baseBuildInputs.hasPurityRune
		);
	});

	$effect(() => {
		const stored = loadSavedBuilds();
		const storedMuseums = loadSavedMuseums();
		const storedSearches = loadSavedChanceSearches();
		savedBuilds = stored;
		savedMuseums = storedMuseums;
		savedSearches = storedSearches;

		let workingInputs = inputs;
		if (!hydrated) {
			const draft = loadChanceDraft();
			if (draft) {
				mineralSearch = '';
				rarityFilter = draft.rarityFilter;
				selectedMineralName = draft.selectedMineralName || (MINERALS[0]?.mineral ?? '');
				locationFilter = draft.locationFilter || 'all';
				selectedBuildId =
					draft.selectedBuildId && stored.some((b) => b.id === draft.selectedBuildId)
						? draft.selectedBuildId
						: '';
				workingInputs = { ...draft.inputs };
				inputs = workingInputs;
			}
		}

		const queryBuildId = page.url.searchParams.get('build');
		if (queryBuildId && queryBuildId !== hydratedQueryBuild) {
			const match = stored.find((b) => b.id === queryBuildId);
			if (match) {
				const linkedMuseum = match.museumId ? (storedMuseums.find((m) => m.id === match.museumId) ?? null) : null;
				selectedBuildId = match.id;
				inputs = extractChanceInputsFromBuild(match, workingInputs, linkedMuseum);
				hydratedQueryBuild = queryBuildId;
			}
		}

		hydrated = true;
	});

	$effect(() => {
		if (!hydrated) return;
		saveChanceDraft({
			selectedMineralName,
			rarityFilter,
			locationFilter,
			selectedBuildId,
			inputs: $state.snapshot(inputs)
		});
	});

	const filteredMinerals = $derived.by(() => {
		const q = mineralSearch.trim().toLowerCase();
		return MINERALS.filter((m) => {
			const okName = !q || m.mineral.toLowerCase().includes(q);
			const okRarity = rarityFilter === 'all' || m.rarity.toLowerCase() === rarityFilter;
			return okName && okRarity;
		});
	});

	$effect(() => {
		if (filteredMinerals.length > 0 && !filteredMinerals.some((m) => m.mineral === selectedMineralName)) {
			selectedMineralName = filteredMinerals[0].mineral;
		}
	});

	const selectedMineral = $derived(
		filteredMinerals.find((m) => m.mineral === selectedMineralName) ??
			MINERALS.find((m) => m.mineral === selectedMineralName) ??
			null,
	);

	const summary = $derived(selectedMineral ? calculateMineralChances(selectedMineral, inputs) : null);

	const visibleRows = $derived.by(() => {
		if (!summary) return [];
		if (locationFilter === 'all') return summary.rows;
		return summary.rows.filter((r) => r.locationName === locationFilter || r.sourceName.includes(locationFilter));
	});

	const rarityClasses = $derived(getRarityBadgeClass(selectedMineral?.rarity ?? 'unknown'));

	function applySavedBuild(buildId: string): void {
		selectedBuildId = buildId;
		if (!buildId) return;
		const match = savedBuildsById.get(buildId);
		if (!match) return;
		const linkedMuseum = match.museumId ? (savedMuseumsById.get(match.museumId) ?? null) : null;
		inputs = extractChanceInputsFromBuild(match, inputs, linkedMuseum);
	}

	function restoreFromBuild(): void {
		if (!selectedSavedBuild) return;
		inputs = extractChanceInputsFromBuild(selectedSavedBuild, inputs, selectedLinkedMuseum);
	}

	function handleMinWeightInput(event: Event): void {
		const raw = (event.currentTarget as HTMLInputElement).value.trim();
		if (!raw) {
			inputs.minWeightKg = null;
			return;
		}
		const num = Number(raw);
		inputs.minWeightKg = Number.isFinite(num) && num > 0 ? num : null;
	}

	function handleTargetModifierChange(event: Event): void {
		const val = (event.currentTarget as HTMLSelectElement).value;
		inputs.targetModifierId = val || null;
	}

	const modifiersById = new Map(MODIFIERS.map((m) => [m.id, m]));
	const selectedTargetModifier = $derived(
		inputs.targetModifierId && inputs.targetModifierId !== 'any'
			? (modifiersById.get(inputs.targetModifierId) ?? null)
			: null,
	);

	function formatAttempts(val: number): string {
		if (!Number.isFinite(val)) return '∞';
		return Number.isInteger(val) ? val.toLocaleString('en-US') : val.toFixed(2);
	}

	function buildDefaultSearchName(): string {
		const parts = [selectedMineralName || 'Minerale'];
		if (inputs.minWeightKg) parts.push(`>= ${inputs.minWeightKg}kg`);
		if (inputs.targetModifierId === 'any') parts.push('Qualsiasi Mod');
		else if (selectedTargetModifier) parts.push(selectedTargetModifier.name);
		return parts.join(' • ');
	}

	function summarizeChanceSearch(st: ChanceSearchState): string {
		const bits = [st.selectedMineralName || 'Minerale'];
		if (st.inputs.minWeightKg) bits.push(`>=${st.inputs.minWeightKg}kg`);
		if (st.inputs.targetModifierId === 'any') bits.push('Any Mod');
		else if (st.inputs.targetModifierId) bits.push(st.inputs.targetModifierId);
		return bits.join(' • ');
	}

	function handleSaveSearch(): void {
		const name = searchSaveName.trim() || buildDefaultSearchName();
		savedSearches = upsertSavedChanceSearch({
			id: '',
			name,
			updatedAt: new Date().toISOString(),
			state: {
				selectedMineralName,
				rarityFilter,
				locationFilter,
				selectedBuildId,
				inputs: $state.snapshot(inputs)
			}
		});
		searchSaveName = '';
	}

	function handleLoadSavedSearch(entry: SavedChanceSearch): void {
		mineralSearch = '';
		rarityFilter = entry.state.rarityFilter;
		selectedMineralName = entry.state.selectedMineralName || (MINERALS[0]?.mineral ?? '');
		locationFilter = entry.state.locationFilter || 'all';
		selectedBuildId =
			entry.state.selectedBuildId && savedBuilds.some((b) => b.id === entry.state.selectedBuildId)
				? entry.state.selectedBuildId
				: '';
		inputs = { ...entry.state.inputs };
	}

	function handleDeleteSavedSearch(id: string): void {
		savedSearches = deleteSavedChanceSearch(id);
	}
</script>

<svelte:head>
	<title>Calcolo Probabilità Minerali • Prospecting! Build Calculator</title>
</svelte:head>

<main class="mx-auto max-w-[1520px] space-y-6 px-6 py-8">
	<section class="flex flex-wrap items-end justify-between gap-4">
		<div>
			<p class="text-xs font-semibold tracking-wider text-amber-400 uppercase">Mineral Drop &amp; Location Odds</p>
			<h1 class="text-2xl font-bold tracking-tight text-white">Calcolo Probabilità Minerali</h1>
			<p class="mt-1 text-sm text-slate-400">
				Calcola le probabilità di drop per pan, tentativi e tempi stimati in ogni location — caricando le statistiche da
				una build salvata o modificandole manualmente.
			</p>
		</div>
		<span class="rounded-lg border border-slate-800 bg-slate-900/70 px-3 py-1.5 text-xs text-slate-400">
			{MINERALS.length} minerali • {allLocationNames.length} location/chest
		</span>
	</section>

	<div class="grid items-start gap-6 xl:grid-cols-12">
		<!-- LEFT COLUMN: SETUP -->
		<section class="space-y-5 rounded-xl border border-slate-800 bg-slate-900/70 p-5 xl:col-span-4">
			<!-- SAVED SEARCHES -->
			<div class="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5">
				<div class="flex items-center justify-between gap-2">
					<h2 class="text-xs font-semibold tracking-wider text-slate-300 uppercase">
						Ricerche Salvate ({savedSearches.length})
					</h2>
					<span class="text-[10px] text-emerald-300/90">Bozza auto-salvata</span>
				</div>

				<div class="mt-2 flex gap-1.5">
					<input
						type="text"
						bind:value={searchSaveName}
						placeholder={buildDefaultSearchName()}
						class="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-amber-400 focus:outline-none"
					/>
					<button
						type="button"
						onclick={handleSaveSearch}
						class="shrink-0 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-slate-950 transition hover:bg-amber-400"
					>
						Salva
					</button>
				</div>

				{#if savedSearches.length > 0}
					<div class="mt-2.5 max-h-40 space-y-1.5 overflow-y-auto pr-0.5">
						{#each savedSearches as entry (entry.id)}
							<div class="flex items-center justify-between gap-1.5 rounded-lg border border-slate-800 bg-slate-900/70 px-2.5 py-1.5">
								<button
									type="button"
									onclick={() => handleLoadSavedSearch(entry)}
									class="min-w-0 flex-1 text-left"
								>
									<p class="truncate text-xs font-semibold text-slate-100 hover:text-amber-300">
										{entry.name}
									</p>
									<p class="truncate text-[10px] text-slate-400">
										{summarizeChanceSearch(entry.state)}
									</p>
								</button>
								<button
									type="button"
									aria-label={`Elimina ricerca ${entry.name}`}
									onclick={() => handleDeleteSavedSearch(entry.id)}
									class="shrink-0 rounded px-1.5 py-0.5 text-xs text-slate-500 transition hover:bg-rose-500/15 hover:text-rose-300"
								>
									×
								</button>
							</div>
						{/each}
					</div>
				{/if}
			</div>

			<div class="border-t border-slate-800/80 pt-4">
				<h2 class="text-xs font-semibold tracking-wider text-slate-400 uppercase">
					{summary?.isChestOnly ? 'Chest Drop' : 'Pan & Mineral Setup'}
				</h2>

				<div class="mt-3 space-y-3">
					<div>
						<label for="mineral-search" class="block text-xs font-medium text-slate-400"> Cerca minerale </label>
						<input
							id="mineral-search"
							type="search"
							bind:value={mineralSearch}
							placeholder="Es. Celestium, Diamond, Voidstone..."
							class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-amber-400 focus:outline-none"
						/>
					</div>

					<div class="grid gap-3 sm:grid-cols-2">
						<div>
							<label for="rarity-filter" class="block text-xs font-medium text-slate-400"> Filtra per rarità </label>
							<select
								id="rarity-filter"
								bind:value={rarityFilter}
								class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-amber-400 focus:outline-none"
							>
								{#each RARITY_OPTIONS as opt}
									<option value={opt.value}>{opt.label}</option>
								{/each}
							</select>
						</div>

						<div>
							<label for="mineral-select" class="block text-xs font-medium text-slate-400">
								Seleziona minerale ({filteredMinerals.length})
							</label>
							<select
								id="mineral-select"
								bind:value={selectedMineralName}
								class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-amber-400 focus:outline-none"
							>
								{#if filteredMinerals.length === 0}
									<option value="">Nessun minerale trovato</option>
								{:else}
									{#each filteredMinerals as mineral}
										<option value={mineral.mineral}>{mineral.mineral}</option>
									{/each}
								{/if}
							</select>
						</div>
					</div>
				</div>
			</div>

			{#if summary?.isChestOnly}
				<div class="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3.5 text-xs text-amber-200">
					Minerale esclusivo da <strong>Chest</strong>. Ogni apertura è un tentativo indipendente: Luck, Capacity e
					velocità della Pan non influenzano la probabilità.
				</div>
			{:else}
				<!-- SAVED BUILD LOADER -->
				<div class="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
					<div class="flex flex-wrap items-center justify-between gap-2">
						<label for="saved-build-select" class="text-xs font-semibold tracking-wider text-slate-300 uppercase">
							Statistiche da Build Salvata
						</label>
						{#if selectedSavedBuild}
							{#if isManuallyEdited}
								<span
									class="rounded bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-300 ring-1 ring-amber-500/30"
								>
									Modificata a mano
								</span>
							{:else}
								<span
									class="rounded bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-300 ring-1 ring-emerald-500/30"
								>
									Sincronizzata con build
								</span>
							{/if}
						{/if}
					</div>

					<div class="mt-2 flex flex-wrap items-center gap-2">
						<select
							id="saved-build-select"
							value={selectedBuildId}
							onchange={(e) => applySavedBuild((e.currentTarget as HTMLSelectElement).value)}
							class="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-amber-400 focus:outline-none"
						>
							<option value="">— Inserimento Manuale —</option>
							{#each savedBuilds as b (b.id)}
								<option value={b.id}>{b.name}</option>
							{/each}
						</select>

						{#if selectedSavedBuild && isManuallyEdited}
							<button
								type="button"
								onclick={restoreFromBuild}
								class="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-300 transition hover:bg-amber-500/20"
							>
								Ripristina
							</button>
						{/if}
					</div>

					{#if savedBuilds.length === 0}
						<p class="mt-2 text-[11px] text-slate-400">
							Nessuna build salvata in localStorage. Puoi crearne una in
							<a href="/builder" class="text-amber-300 hover:underline">Equipaggiamento</a>
							oppure inserire i valori a mano qui sotto.
						</p>
					{/if}
				</div>

				<!-- MANUAL STAT INPUTS -->
				<div class="space-y-3 border-t border-slate-800/80 pt-4">
					<div class="grid gap-3 sm:grid-cols-2">
						<div>
							<label for="luck-input" class="block text-xs font-medium text-slate-400"> Luck (in-game) </label>
							<input
								id="luck-input"
								type="number"
								min="0"
								step="any"
								bind:value={inputs.luck}
								class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100 focus:border-amber-400 focus:outline-none"
							/>
						</div>

						<div>
							<label for="capacity-input" class="block text-xs font-medium text-slate-400"> Pan Capacity (C) </label>
							<input
								id="capacity-input"
								type="number"
								min="1"
								step="any"
								bind:value={inputs.capacity}
								class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100 focus:border-amber-400 focus:outline-none"
							/>
						</div>
					</div>

					<div>
						<label for="time-method" class="block text-xs font-medium text-slate-400"> Time method </label>
						<select
							id="time-method"
							bind:value={inputs.timeMethod}
							class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-amber-400 focus:outline-none"
						>
							<option value="autopan">Autopan / Macro</option>
							<option value="sand">Sandshaking (Manuale)</option>
						</select>
					</div>

					<div class="grid gap-3 sm:grid-cols-2">
						<div>
							<label for="shake-speed-input" class="block text-xs font-medium text-slate-400"> Shake speed % </label>
							<input
								id="shake-speed-input"
								type="number"
								min="0"
								step="1"
								bind:value={inputs.shakeSpeedPct}
								class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100 focus:border-amber-400 focus:outline-none"
							/>
						</div>

						<div>
							<label for="shake-strength-input" class="block text-xs font-medium text-slate-400">
								s = Shake strength
							</label>
							<input
								id="shake-strength-input"
								type="number"
								min="0.01"
								step="0.01"
								bind:value={inputs.shakeStrength}
								class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100 focus:border-amber-400 focus:outline-none"
							/>
						</div>
					</div>

					{#if inputs.timeMethod === 'autopan'}
						<div class="grid gap-3 sm:grid-cols-2">
							<div>
								<label for="digs-input" class="block text-xs font-medium text-slate-400"> n = Digs to fill </label>
								<input
									id="digs-input"
									type="number"
									min="0"
									step="any"
									bind:value={inputs.digsToFill}
									class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100 focus:border-amber-400 focus:outline-none"
								/>
							</div>

							<div>
								<label for="dig-speed-input" class="block text-xs font-medium text-slate-400"> d = Dig speed % </label>
								<input
									id="dig-speed-input"
									type="number"
									min="0.01"
									step="0.01"
									bind:value={inputs.digSpeedPct}
									class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100 focus:border-amber-400 focus:outline-none"
								/>
							</div>
						</div>
					{/if}

					<!-- WEIGHT & MODIFIER FILTERS -->
					<div class="space-y-3 rounded-xl border border-slate-800 bg-slate-950/60 p-4">
						<div class="flex items-center justify-between gap-2">
							<h3 class="text-xs font-semibold tracking-wider text-slate-300 uppercase">
								Filtri Peso &amp; Modificatore
							</h3>
							{#if inputs.minWeightKg || inputs.targetModifierId}
								<button
									type="button"
									onclick={() => {
										inputs.minWeightKg = null;
										inputs.targetModifierId = null;
									}}
									class="text-[11px] text-slate-400 hover:text-amber-300"
								>
									Pulisci filtri
								</button>
							{/if}
						</div>

						<div>
							<div class="flex items-center justify-between gap-2">
								<label for="min-weight-input" class="text-xs font-medium text-slate-400"> Peso minimo (kg) </label>
								<div class="flex flex-wrap gap-1">
									{#each WEIGHT_PRESETS as preset}
										<button
											type="button"
											onclick={() => (inputs.minWeightKg = preset)}
											class={`rounded border px-1.5 py-0.5 text-[10px] font-medium transition ${
												inputs.minWeightKg === preset
													? 'border-amber-400 bg-amber-500/20 text-amber-300'
													: 'border-slate-700 text-slate-400 hover:border-slate-500'
											}`}
										>
											{preset === null ? 'Off' : `${preset}kg`}
										</button>
									{/each}
								</div>
							</div>
							<input
								id="min-weight-input"
								type="number"
								min="0"
								step="0.5"
								placeholder="Es. 40 (lascia vuoto per tutti i pesi)"
								value={inputs.minWeightKg ?? ''}
								oninput={handleMinWeightInput}
								class="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-sm text-slate-100 placeholder:text-slate-500 focus:border-amber-400 focus:outline-none"
							/>
						</div>

						<div>
							<label for="target-modifier-select" class="block text-xs font-medium text-slate-400">
								Modificatore richiesto
							</label>
							<select
								id="target-modifier-select"
								value={inputs.targetModifierId ?? ''}
								onchange={handleTargetModifierChange}
								class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-amber-400 focus:outline-none"
							>
								<option value="">— Nessun filtro modificatore —</option>
								<option value="any">Qualsiasi Modificatore</option>
								{#each MODIFIERS as mod}
									<option value={mod.id}>
										{mod.name} ({mod.sellMultiplier}×{mod.notes ? ` • ${mod.notes}` : ''})
									</option>
								{/each}
							</select>
						</div>

						<div class="grid gap-3 sm:grid-cols-2">
							<div>
								<label for="size-boost-input" class="block text-xs font-medium text-slate-400"> Size Boost % </label>
								<input
									id="size-boost-input"
									type="number"
									min="0"
									step="1"
									bind:value={inputs.sizeBoostPct}
									class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 font-mono text-sm text-slate-100 focus:border-amber-400 focus:outline-none"
								/>
							</div>

							<div>
								<label for="modifier-boost-input" class="block text-xs font-medium text-slate-400">
									Modifier Boost %
								</label>
								<input
									id="modifier-boost-input"
									type="number"
									min="0"
									step="1"
									bind:value={inputs.modifierBoostPct}
									class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 font-mono text-sm text-slate-100 focus:border-amber-400 focus:outline-none"
								/>
							</div>
						</div>

						<div class="flex flex-wrap gap-1.5 pt-1">
							<button
								type="button"
								onclick={() => (inputs.solarMagnifier = !inputs.solarMagnifier)}
								class={`rounded-lg border px-2 py-1 text-[11px] font-medium transition ${
									inputs.solarMagnifier
										? 'border-amber-400 bg-amber-500/20 text-amber-200'
										: 'border-slate-700 bg-slate-900 text-slate-400 hover:border-slate-600'
								}`}
							>
								Solar Magnifier
							</button>
							<button
								type="button"
								onclick={() => (inputs.volcanicEruption = !inputs.volcanicEruption)}
								class={`rounded-lg border px-2 py-1 text-[11px] font-medium transition ${
									inputs.volcanicEruption
										? 'border-orange-400 bg-orange-500/20 text-orange-200'
										: 'border-slate-700 bg-slate-900 text-slate-400 hover:border-slate-600'
								}`}
							>
								Eruption (1.5×)
							</button>
							<button
								type="button"
								onclick={() => (inputs.modifierSurge = !inputs.modifierSurge)}
								class={`rounded-lg border px-2 py-1 text-[11px] font-medium transition ${
									inputs.modifierSurge
										? 'border-emerald-400 bg-emerald-500/20 text-emerald-200'
										: 'border-slate-700 bg-slate-900 text-slate-400 hover:border-slate-600'
								}`}
							>
								Modifier Surge
							</button>
							<button
								type="button"
								onclick={() => (inputs.isNight = !inputs.isNight)}
								class={`rounded-lg border px-2 py-1 text-[11px] font-medium transition ${
									inputs.isNight
										? 'border-indigo-400 bg-indigo-500/20 text-indigo-200'
										: 'border-slate-700 bg-slate-900 text-slate-400 hover:border-slate-600'
								}`}
							>
								Notte (Lunar)
							</button>
							<button
								type="button"
								onclick={() => (inputs.hasCrystalTouch = !inputs.hasCrystalTouch)}
								class={`rounded-lg border px-2 py-1 text-[11px] font-medium transition ${
									inputs.hasCrystalTouch
										? 'border-sky-400 bg-sky-500/20 text-sky-200'
										: 'border-slate-700 bg-slate-900 text-slate-400 hover:border-slate-600'
								}`}
							>
								Crystal Touch
							</button>
							<button
								type="button"
								onclick={() => (inputs.hasVoidTouched = !inputs.hasVoidTouched)}
								class={`rounded-lg border px-2 py-1 text-[11px] font-medium transition ${
									inputs.hasVoidTouched
										? 'border-purple-400 bg-purple-500/20 text-purple-200'
										: 'border-slate-700 bg-slate-900 text-slate-400 hover:border-slate-600'
								}`}
							>
								Void Touched
							</button>
							<button
								type="button"
								onclick={() => (inputs.hasPurityRune = !inputs.hasPurityRune)}
								class={`rounded-lg border px-2 py-1 text-[11px] font-medium transition ${
									inputs.hasPurityRune
										? 'border-rose-400 bg-rose-500/20 text-rose-200'
										: 'border-slate-700 bg-slate-900 text-slate-400 hover:border-slate-600'
								}`}
							>
								Purity Rune
							</button>
							<button
								type="button"
								onclick={() => (inputs.hasAlchemistsCrucible = !inputs.hasAlchemistsCrucible)}
								class={`rounded-lg border px-2 py-1 text-[11px] font-medium transition ${
									inputs.hasAlchemistsCrucible
										? 'border-cyan-400 bg-cyan-500/20 text-cyan-200'
										: 'border-slate-700 bg-slate-900 text-slate-400 hover:border-slate-600'
								}`}
							>
								Alchemist's Crucible (+10% Tier)
							</button>
						</div>
					</div>

					{#if summary}
						<div
							class="rounded-lg border border-slate-800 bg-slate-950/70 p-3 text-[11px] leading-relaxed text-slate-400"
						>
							<div>
								<span class="text-slate-300">Effective rolls / pan:</span>
								<span class="font-mono text-amber-300">{summary.rollsPerPan.toFixed(2)}</span>
								<span>(Luck {inputs.luck} × √{inputs.capacity})</span>
							</div>
							<div class="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 font-mono">
								<span>Shakes/s: {summary.shakesPerSecond.toFixed(2)}</span>
								<span>
									Cycle: {Number.isFinite(summary.cycleSeconds) ? `${summary.cycleSeconds.toFixed(2)}s` : '∞'}
								</span>
								<span>Pans/min: {summary.pansPerMinute.toFixed(2)}</span>
								<span>Rolls/s: {summary.rollsPerSecond.toFixed(2)}</span>
							</div>
						</div>
					{/if}
				</div>
			{/if}
		</section>

		<!-- RIGHT COLUMN: SUMMARY + LOCATIONS TABLE -->
		<div class="space-y-6 xl:col-span-8">
			{#if selectedMineral && summary}
				<section class="rounded-xl border border-slate-800 bg-slate-900/70 p-5">
					<div class="flex flex-wrap items-center justify-between gap-3">
						<div class="flex flex-wrap items-center gap-2">
							<div
								class="inline-flex flex-wrap items-center gap-2 rounded-full border border-slate-700/80 bg-slate-950/70 px-3.5 py-1.5 text-sm"
							>
								<span class={`h-2.5 w-2.5 rounded-full ${rarityClasses.dotClass}`}></span>
								<span class="font-semibold text-white">{selectedMineral.mineral}</span>
								<span
									class={`rounded-full border px-2 py-0.5 text-[11px] font-semibold capitalize ${rarityClasses.pillClass}`}
								>
									{selectedMineral.rarity}
								</span>
							</div>

							{#if summary.weightInfo.active && inputs.minWeightKg}
								<span
									class="rounded-full border border-amber-500/40 bg-amber-500/15 px-3 py-1 text-xs font-semibold text-amber-200"
								>
									≥ {inputs.minWeightKg} kg
								</span>
							{/if}

							{#if summary.modifierInfo.active && summary.modifierInfo.label}
								<span
									class="inline-flex items-center gap-1.5 rounded-full border border-fuchsia-500/40 bg-fuchsia-500/15 px-3 py-1 text-xs font-semibold text-fuchsia-200"
								>
									{#if selectedTargetModifier}
										<span class="h-2 w-2 rounded-full" style={`background:${selectedTargetModifier.color}`}></span>
									{/if}
									{summary.modifierInfo.label}
									{#if selectedTargetModifier}
										({selectedTargetModifier.sellMultiplier}×)
									{/if}
								</span>
							{/if}
						</div>

						<div
							class="inline-flex items-center gap-2 rounded-full border border-slate-700/80 bg-slate-950/70 px-3.5 py-1.5 text-xs text-slate-300"
						>
							<span>{summary.isChestOnly ? 'Chest:' : 'Best location:'}</span>
							<strong class="text-amber-300">
								{summary.bestLocationLabel} (~1 in {fmtOneIn(summary.pAttempt)})
							</strong>
						</div>
					</div>

					<div class="mt-4 grid gap-4 sm:grid-cols-3">
						<div class="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
							<div class="text-[11px] font-semibold tracking-wider text-slate-400 uppercase">Chance per attempt</div>
							<div class="mt-2 font-mono text-2xl font-bold text-white">
								{fmtPct(summary.pAttempt, 5)}
							</div>
							<div class="mt-1 text-xs text-slate-400">
								~1 in {fmtOneIn(summary.pAttempt)} ({summary.isChestOnly ? 'chest' : 'pan'})
							</div>
						</div>

						<div class="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
							<div class="text-[11px] font-semibold tracking-wider text-slate-400 uppercase">Expected finds</div>
							<div class="mt-2 font-mono text-2xl font-bold text-amber-300">
								{summary.expectedFinds.toFixed(summary.isChestOnly ? 6 : 4)}
							</div>
							<div class="mt-1 text-xs text-slate-400">
								Per {summary.isChestOnly ? 'chest' : 'pan'} · 99% {summary.isChestOnly ? 'chests' : 'pans'}:
								{formatAttempts(summary.a99)}
							</div>
						</div>

						<div class="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
							<div class="text-[11px] font-semibold tracking-wider text-slate-400 uppercase">At least one</div>
							<div class="mt-2 font-mono text-2xl font-bold text-emerald-300">
								{fmtPct(summary.pAttempt, 2)}
							</div>
							<div class="mt-1 text-xs text-slate-400">
								{summary.isChestOnly
									? `99% chests: ${formatAttempts(summary.a99)}`
									: `Chance ≥1 / pan · 99% time: ${fmtDuration(summary.t99)}`}
							</div>
						</div>
					</div>

					{#if summary.weightInfo.active || summary.modifierInfo.active}
						<div class="mt-4 space-y-2 rounded-xl border border-slate-800 bg-slate-950/60 p-3.5 text-xs">
							<div class="flex flex-wrap items-center justify-between gap-2">
								<span class="font-semibold text-slate-200">Dettaglio Filtri Applicati</span>
								<span class="font-mono text-emerald-300">
									Probabilità condizione / ore: {fmtPct(summary.combinedConditionChance, 4)}
								</span>
							</div>

							<div class="grid gap-2 sm:grid-cols-2">
								{#if summary.weightInfo.active}
									<div class="rounded-lg border border-slate-800/80 bg-slate-900/60 p-2.5">
										<div class="flex items-center justify-between text-slate-300">
											<span>Peso ≥ {inputs.minWeightKg} kg</span>
											<strong class="font-mono text-amber-300">
												{fmtPct(summary.weightInfo.probability, 2)}
											</strong>
										</div>
										<p class="mt-1 text-[11px] text-slate-400">
											Moltiplicatore peso: <span class="font-mono text-slate-200"
												>{summary.weightInfo.weightMultiplier.toFixed(2)}×</span
											>
											(base richiesta: <span class="font-mono">{summary.weightInfo.requiredBaseKg.toFixed(2)} kg</span>)
										</p>
										{#if summary.weightInfo.minSizeBoostNeededPct !== null}
											<p class="mt-1 text-[11px] font-medium text-rose-300">
												Impossibile con il Size Boost attuale: serve almeno +{summary.weightInfo.minSizeBoostNeededPct}%
												Size Boost.
											</p>
										{/if}
									</div>
								{/if}

								{#if summary.modifierInfo.active}
									<div class="rounded-lg border border-slate-800/80 bg-slate-900/60 p-2.5">
										<div class="flex items-center justify-between text-slate-300">
											<span>Modificatore: {summary.modifierInfo.label}</span>
											<strong class="font-mono text-fuchsia-300">
												{fmtPct(summary.modifierInfo.probability, 4)}
											</strong>
										</div>
										<p class="mt-1 text-[11px] text-slate-400">
											Any Mod: <span class="font-mono">{fmtPct(summary.modifierInfo.anyModifierChance, 1)}</span>
											· Share: <span class="font-mono">{fmtPct(summary.modifierInfo.conditionalShare, 3)}</span>
											· Mod Luck: <span class="font-mono">{summary.modifierInfo.modifierLuck.toFixed(1)}</span>
										</p>
										{#if summary.modifierInfo.warning}
											<p class="mt-1 text-[11px] font-medium text-amber-300">
												⚠ {summary.modifierInfo.warning}
											</p>
										{/if}
									</div>
								{/if}
							</div>

							<p class="text-[11px] text-slate-500">
								Le probabilità di peso e modificatore sono stimate secondo le leggi empiriche della Stat Systems Guide
								sulla wiki Miraheze (split 25/25/50 su Capacity/Modifier Luck e cap Job 1 al 99.4%).
							</p>
						</div>
					{/if}
				</section>

				<section class="rounded-xl border border-slate-800 bg-slate-900/70 p-5">
					<div class="flex flex-wrap items-center justify-between gap-3">
						<div>
							<h2 class="text-base font-semibold text-white">All Locations Overview</h2>
							<p class="text-xs text-slate-400">
								"Attempt" = 1 pan completo. Il filtro sotto filtra solo la tabella (i box sopra mostrano sempre la
								location migliore).
							</p>
						</div>

						<div class="w-full sm:w-64">
							<select
								aria-label="Filtra tabella location"
								bind:value={locationFilter}
								class="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-100 focus:border-amber-400 focus:outline-none"
							>
								<option value="all">Tutte le location ({summary.rows.length})</option>
								{#each allLocationNames as locName}
									<option value={locName}>{locName}</option>
								{/each}
							</select>
						</div>
					</div>

					<!-- Desktop: 6 compact stacked-metric columns, zero horizontal scroll -->
					<div class="mt-4 hidden rounded-xl border border-slate-800 bg-slate-950/60 md:block">
						<table class="w-full table-auto border-collapse text-right text-xs">
							<thead>
								<tr
									class="border-b border-slate-800 bg-slate-900/90 text-[11px] tracking-wider text-slate-400 uppercase"
								>
									<th class="px-3.5 py-3 text-left">Location</th>
									<th class="px-3 py-3">Base (Roll)</th>
									<th class="px-3 py-3">Per Attempt</th>
									<th class="px-3 py-3">50%</th>
									<th class="px-3 py-3">90%</th>
									<th class="px-3.5 py-3">99%</th>
								</tr>
							</thead>
							<tbody class="divide-y divide-slate-800/70">
								{#if visibleRows.length === 0}
									<tr>
										<td colspan="6" class="px-4 py-6 text-center text-slate-500">
											Nessuna location corrispondente al filtro selezionato per questo minerale.
										</td>
									</tr>
								{:else}
									{#each visibleRows as row}
										<tr class={`transition hover:bg-slate-900/70 ${row.isBest ? 'bg-amber-500/10' : ''}`}>
											<td class="px-3.5 py-2.5 text-left font-medium text-white">
												<div class="flex flex-wrap items-center gap-1.5">
													<span>{row.sourceName}</span>
													{#if row.isBest}
														<span
															class="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300"
														>
															BEST
														</span>
													{/if}
												</div>
											</td>
											<td class="px-3 py-2.5 font-mono">
												<div class="text-slate-200">{row.basePercent.toFixed(8)}%</div>
												<div class="text-[11px] text-slate-400">~1 in {row.baseOneIn}</div>
											</td>
											<td class="px-3 py-2.5 font-mono">
												<div class="font-semibold text-emerald-300">{fmtPct(row.pAttempt, 5)}</div>
												<div class="text-[11px] text-slate-300">~1 in {row.attemptOneIn}</div>
											</td>
											<td class="px-3 py-2.5 font-mono">
												<div class="text-slate-200">{formatAttempts(row.a50)} pan</div>
												<div class="text-[11px] text-slate-400">{fmtDuration(row.t50)}</div>
											</td>
											<td class="px-3 py-2.5 font-mono">
												<div class="text-slate-200">{formatAttempts(row.a90)} pan</div>
												<div class="text-[11px] text-slate-400">{fmtDuration(row.t90)}</div>
											</td>
											<td class="px-3.5 py-2.5 font-mono">
												<div class="text-slate-200">{formatAttempts(row.a99)} pan</div>
												<div class="text-[11px] text-amber-300">{fmtDuration(row.t99)}</div>
											</td>
										</tr>
									{/each}
								{/if}
							</tbody>
						</table>
					</div>

					<!-- Mobile: stacked cards, zero horizontal scroll -->
					<div class="mt-4 space-y-3 md:hidden">
						{#if visibleRows.length === 0}
							<p
								class="rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-6 text-center text-xs text-slate-500"
							>
								Nessuna location corrispondente al filtro selezionato per questo minerale.
							</p>
						{:else}
							{#each visibleRows as row}
								<div
									class={`rounded-xl border p-3.5 text-xs ${
										row.isBest ? 'border-amber-500/40 bg-amber-500/10' : 'border-slate-800 bg-slate-950/60'
									}`}
								>
									<div class="flex flex-wrap items-center justify-between gap-2">
										<span class="font-semibold text-white">{row.sourceName}</span>
										{#if row.isBest}
											<span class="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">
												BEST
											</span>
										{/if}
									</div>

									<div class="mt-2.5 grid grid-cols-2 gap-2 font-mono">
										<div class="rounded-lg bg-slate-900/70 p-2">
											<div class="font-sans text-[10px] text-slate-400 uppercase">Base (Roll)</div>
											<div class="mt-0.5 text-slate-200">{row.basePercent.toFixed(6)}%</div>
											<div class="text-[11px] text-slate-400">~1 in {row.baseOneIn}</div>
										</div>
										<div class="rounded-lg bg-slate-900/70 p-2">
											<div class="font-sans text-[10px] text-slate-400 uppercase">Per Attempt</div>
											<div class="mt-0.5 font-semibold text-emerald-300">
												{fmtPct(row.pAttempt, 5)}
											</div>
											<div class="text-[11px] text-slate-300">~1 in {row.attemptOneIn}</div>
										</div>
									</div>

									<div class="mt-2 grid grid-cols-3 gap-2 font-mono">
										<div class="rounded-lg bg-slate-900/70 p-2 text-center">
											<div class="font-sans text-[10px] text-slate-400">50%</div>
											<div class="mt-0.5 text-slate-200">{formatAttempts(row.a50)}</div>
											<div class="text-[11px] text-slate-400">{fmtDuration(row.t50)}</div>
										</div>
										<div class="rounded-lg bg-slate-900/70 p-2 text-center">
											<div class="font-sans text-[10px] text-slate-400">90%</div>
											<div class="mt-0.5 text-slate-200">{formatAttempts(row.a90)}</div>
											<div class="text-[11px] text-slate-400">{fmtDuration(row.t90)}</div>
										</div>
										<div class="rounded-lg bg-slate-900/70 p-2 text-center">
											<div class="font-sans text-[10px] text-slate-400">99%</div>
											<div class="mt-0.5 text-slate-200">{formatAttempts(row.a99)}</div>
											<div class="text-[11px] text-amber-300">{fmtDuration(row.t99)}</div>
										</div>
									</div>
								</div>
							{/each}
						{/if}
					</div>
				</section>
			{/if}
		</div>
	</div>
</main>
