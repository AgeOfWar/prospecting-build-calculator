<script lang="ts">
	import { MUTATIONS } from '#lib/data/index.ts';
	import {
		type EquipmentRangedStatEntry,
		computeAverageRollQuality,
		getEquipmentRangedStats,
		hasValidSixStarData,
		isUniqueOnlyEquipment,
		resolveEquipmentModifiers,
	} from '#lib/engine/loadout.ts';
	import { ALL_STAT_KEYS, STAT_LABELS } from '#lib/engine/stats.ts';
	import type {
		EquipmentItem,
		EquipmentMutation,
		EquipmentSlot,
		EquipmentTier,
		EquippedJewelrySelection,
		StatKey,
	} from '#lib/types/prospecting.ts';

	interface Props {
		label: string;
		slot: EquipmentSlot;
		items: EquipmentItem[];
		value: EquippedJewelrySelection | null;
		onchange: (next: EquippedJewelrySelection | null) => void;
		duplicateWarning?: boolean;
		mutations?: EquipmentMutation[];
	}

	const RARITY_ORDER = [
		'Ascended',
		'Exotic',
		'Mythic',
		'Legendary',
		'Epic',
		'Rare',
		'Uncommon',
		'Common',
		'Limited-Time',
	];

	let { label, slot, items, value, onchange, duplicateWarning = false, mutations = MUTATIONS }: Props = $props();

	const itemsById = $derived(new Map(items.map((item) => [item.id, item])));
	const mutationsById = $derived(new Map(mutations.map((m) => [m.id, m])));

	const groupedItems = $derived.by(() => {
		const groups = new Map<string, EquipmentItem[]>();
		for (const rarity of RARITY_ORDER) groups.set(rarity, []);
		for (const item of items) {
			const key = item.rarity ?? 'Other';
			if (!groups.has(key)) groups.set(key, []);
			groups.get(key)!.push(item);
		}
		return Array.from(groups.entries()).filter(([, list]) => list.length > 0);
	});

	const selectedItem = $derived(value ? (itemsById.get(value.itemId) ?? null) : null);
	const selectedMutation = $derived(value?.mutationId ? (mutationsById.get(value.mutationId) ?? null) : null);
	const canSixStar = $derived(selectedItem ? hasValidSixStarData(selectedItem) : false);

	const rangedStats = $derived(
		selectedItem && value
			? getEquipmentRangedStats(
					selectedItem,
					value.tier,
					selectedMutation,
					value.rollQuality,
					value.statRollQualities,
				)
			: [],
	);
	const hasRanges = $derived(rangedStats.length > 0);
	const globalRollQuality = $derived(
		selectedItem && value
			? computeAverageRollQuality(selectedItem, value.tier, value.rollQuality, value.statRollQualities)
			: 1,
	);

	const resolvedStats = $derived.by(() => {
		if (!selectedItem || !value) return [];
		const mods = resolveEquipmentModifiers(
			selectedItem,
			value.tier,
			value.rollQuality,
			selectedMutation,
			value.statRollQualities,
		);
		const badges: Array<{ label: string; formatted: string; negative: boolean }> = [];

		for (const key of ALL_STAT_KEYS) {
			const boostVal = mods.boosts?.[key];
			if (boostVal !== undefined && Math.abs(boostVal) > 1e-6) {
				const pct = boostVal * 100;
				const sign = pct > 0 ? '+' : '';
				badges.push({
					label: STAT_LABELS[key],
					formatted: `${sign}${Number.isInteger(pct) ? pct : pct.toFixed(1)}%`,
					negative: pct < 0,
				});
			}
			const numericVal = (mods.base?.[key] ?? 0) + (mods.flats?.[key] ?? 0);
			if (Math.abs(numericVal) > 1e-6) {
				const sign = numericVal > 0 ? '+' : '';
				badges.push({
					label: STAT_LABELS[key],
					formatted: `${sign}${Number.isInteger(numericVal) ? numericVal : numericVal.toFixed(1)}`,
					negative: numericVal < 0,
				});
			}
		}

		return badges;
	});

	function clamp01(val: number): number {
		if (!Number.isFinite(val)) return 1;
		return Math.min(1, Math.max(0, val));
	}

	function fmtInputNum(val: number): string {
		const rounded = Math.round(val * 100) / 100;
		return Object.is(rounded, -0) ? '0' : String(rounded);
	}

	function fmtGlobalPct(roll: number): string {
		const pct = Math.round(clamp01(roll) * 1000) / 10;
		return `${Number.isInteger(pct) ? pct : pct.toFixed(1)}%`;
	}

	function formatMutationOption(mutation: EquipmentMutation): string {
		const hasBonus = Boolean(mutation.bonusModifiers);
		return hasBonus
			? `${mutation.name} (${mutation.statMultiplier}× + bonus)`
			: `${mutation.name} (${mutation.statMultiplier}×)`;
	}

	function handleSelectChange(event: Event): void {
		const target = event.currentTarget as HTMLSelectElement;
		const itemId = target.value;
		if (!itemId) {
			onchange(null);
			return;
		}
		const item = itemsById.get(itemId);
		const keepTier: EquipmentTier = value?.tier === '6star' && item && hasValidSixStarData(item) ? '6star' : 'base';
		onchange({
			itemId,
			tier: keepTier,
			rollQuality: value?.rollQuality ?? 1,
			mutationId: value?.mutationId ?? null,
		});
	}

	function handleMutationChange(event: Event): void {
		if (!value) return;
		const target = event.currentTarget as HTMLSelectElement;
		onchange({
			...value,
			mutationId: target.value || null,
		});
	}

	function setTier(tier: EquipmentTier): void {
		if (!value || !selectedItem) return;
		const nextEntries = getEquipmentRangedStats(
			selectedItem,
			tier,
			selectedMutation,
			value.rollQuality,
			value.statRollQualities,
		);
		let nextMap: Partial<Record<StatKey, number>> | undefined;
		if (value.statRollQualities && nextEntries.length > 0) {
			nextMap = {};
			for (const entry of nextEntries) {
				nextMap[entry.key] = entry.rollQuality;
			}
		}
		const avg = computeAverageRollQuality(selectedItem, tier, value.rollQuality, nextMap);
		onchange({
			...value,
			tier,
			rollQuality: avg,
			statRollQualities: nextMap,
		});
	}

	function setAllRolls(rollQuality: number): void {
		if (!value) return;
		onchange({
			itemId: value.itemId,
			tier: value.tier,
			rollQuality: clamp01(rollQuality),
			mutationId: value.mutationId ?? null,
		});
	}

	function setStatRoll(key: StatKey, nextRoll: number): void {
		if (!value || !selectedItem) return;
		const nextMap: Partial<Record<StatKey, number>> = {};
		let sum = 0;
		for (const entry of rangedStats) {
			const r = entry.key === key ? clamp01(nextRoll) : entry.rollQuality;
			nextMap[entry.key] = r;
			sum += r;
		}
		const avg = rangedStats.length > 0 ? clamp01(sum / rangedStats.length) : clamp01(nextRoll);
		onchange({
			...value,
			rollQuality: avg,
			statRollQualities: nextMap,
		});
	}

	function handleStatValueInput(entry: EquipmentRangedStatEntry, inputEl: HTMLInputElement, commit: boolean): void {
		const raw = inputEl.value.trim();
		const scale = (entry.isPercent ? 100 : 1) * entry.mutMultiplier;
		const dMin = entry.min * scale;
		const dMax = entry.max * scale;
		const span = dMax - dMin;
		if (Math.abs(span) < 1e-12) return;

		if (!commit) {
			if (raw === '' || raw === '-' || raw.endsWith('.') || /\.\d*0$/.test(raw)) return;
			const parsed = Number(raw);
			if (!Number.isFinite(parsed) || parsed < dMin - 1e-9 || parsed > dMax + 1e-9) return;
			setStatRoll(entry.key, (parsed - dMin) / span);
			return;
		}

		const parsed = Number(raw);
		const targetVal = Number.isFinite(parsed) ? Math.min(dMax, Math.max(dMin, parsed)) : entry.value * (entry.isPercent ? 100 : 1);
		const nextRoll = clamp01((targetVal - dMin) / span);
		setStatRoll(entry.key, nextRoll);
		inputEl.value = fmtInputNum(dMin + span * nextRoll);
	}
</script>

<div
	class={`min-w-0 rounded-xl border p-3.5 transition ${
		duplicateWarning
			? 'border-amber-500/60 bg-amber-950/20'
			: selectedItem
				? 'border-slate-700 bg-slate-900/80'
				: 'border-slate-800 bg-slate-950/50'
	}`}
>
	<div class="flex items-center justify-between gap-2">
		<div class="flex flex-wrap items-center gap-1.5">
			<span class="text-xs font-semibold tracking-wide text-slate-300 uppercase">{label}</span>
			{#if selectedItem?.rarity}
				<span class="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">
					{selectedItem.rarity}
				</span>
			{/if}
			{#if selectedMutation}
				<span
					class="rounded bg-fuchsia-500/15 px-1.5 py-0.5 text-[10px] font-medium text-fuchsia-300 ring-1 ring-fuchsia-500/30"
					title={selectedMutation.rawEffects?.join(' • ')}
				>
					{selectedMutation.name}
					{selectedMutation.statMultiplier}×
				</span>
			{/if}
		</div>

		{#if selectedItem}
			<button
				type="button"
				onclick={() => onchange(null)}
				class="rounded px-1.5 py-0.5 text-xs text-slate-400 transition hover:bg-slate-800 hover:text-rose-300"
				title={`Remove ${slot}`}
			>
				✕
			</button>
		{/if}
	</div>

	<select
		aria-label={label}
		value={value?.itemId ?? ''}
		onchange={handleSelectChange}
		class="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-sm text-slate-100 focus:border-amber-400 focus:outline-none"
	>
		<option value="">— Empty —</option>
		{#each groupedItems as [rarity, list]}
			<optgroup label={rarity}>
				{#each list as item}
					<option value={item.id}>{item.name}</option>
				{/each}
			</optgroup>
		{/each}
	</select>

	{#if selectedItem && value}
		<div class="mt-3 space-y-2.5">
			<div>
				<label for={`mutation-${slot}-${label}`} class="block text-[11px] font-medium text-slate-400">
					Mutation (Frozen Peak Forge)
				</label>
				<select
					id={`mutation-${slot}-${label}`}
					value={value.mutationId ?? ''}
					onchange={handleMutationChange}
					class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-100 focus:border-fuchsia-400 focus:outline-none"
				>
					<option value="">— No Mutation —</option>
					{#each mutations as mutation}
						<option value={mutation.id}>{formatMutationOption(mutation)}</option>
					{/each}
				</select>
			</div>

			{#if canSixStar || hasRanges}
				<div class="flex flex-wrap items-center justify-between gap-2">
					{#if canSixStar}
						<div class="inline-flex rounded-lg border border-slate-700 bg-slate-950 p-0.5 text-xs">
							<button
								type="button"
								onclick={() => setTier('base')}
								class={`rounded-md px-2 py-0.5 font-medium transition ${
									value.tier === 'base' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-slate-200'
								}`}
							>
								Base
							</button>
							<button
								type="button"
								onclick={() => setTier('6star')}
								class={`rounded-md px-2 py-0.5 font-medium transition ${
									value.tier === '6star' ? 'bg-amber-500/20 text-amber-300' : 'text-slate-400 hover:text-slate-200'
								}`}
							>
								6★
							</button>
						</div>
					{/if}

					{#if hasRanges}
						<div class="flex flex-wrap items-center gap-1 text-[11px]">
							<button
								type="button"
								onclick={() => setAllRolls(0)}
								class="rounded border border-slate-700 px-1.5 py-0.5 text-slate-300 hover:border-slate-500"
							>
								Min
							</button>
							<button
								type="button"
								onclick={() => setAllRolls(0.5)}
								class="rounded border border-slate-700 px-1.5 py-0.5 text-slate-300 hover:border-slate-500"
							>
								50%
							</button>
							<button
								type="button"
								onclick={() => setAllRolls(1)}
								class="rounded border border-slate-700 px-1.5 py-0.5 text-slate-300 hover:border-slate-500"
							>
								Max
							</button>
						</div>
					{/if}
				</div>
			{/if}

			{#if hasRanges}
				<div class="space-y-2 rounded-lg border border-slate-800/80 bg-slate-950/60 p-2.5">
					<div class="flex items-center justify-between gap-2 text-[11px]">
						<span class="font-medium text-slate-300">Overall quality (stat avg)</span>
						<span class="font-mono font-semibold text-amber-300">{fmtGlobalPct(globalRollQuality)}</span>
					</div>

					<div class="space-y-2 border-t border-slate-800/70 pt-2">
						{#each rangedStats as entry (entry.key)}
							{@const scale = (entry.isPercent ? 100 : 1) * entry.mutMultiplier}
							{@const dMin = entry.min * scale}
							{@const dMax = entry.max * scale}
							{@const dVal = entry.value * (entry.isPercent ? 100 : 1)}
							<div class="space-y-1">
								<div class="flex flex-wrap items-center justify-between gap-1.5 text-[11px]">
									<div class="min-w-0 truncate text-slate-300">
										<span>{entry.label}</span>
										<span class="ml-1 font-mono text-[10px] text-slate-500">
											({fmtInputNum(dMin)}–{fmtInputNum(dMax)}{entry.isPercent ? '%' : ''})
										</span>
									</div>
									<div class="flex shrink-0 items-center gap-1.5">
										<div class="inline-flex items-center rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5">
											<input
												type="number"
												aria-label={`${label} ${entry.label}`}
												min={fmtInputNum(dMin)}
												max={fmtInputNum(dMax)}
												step="any"
												value={fmtInputNum(dVal)}
												oninput={(e) => handleStatValueInput(entry, e.currentTarget as HTMLInputElement, false)}
												onchange={(e) => handleStatValueInput(entry, e.currentTarget as HTMLInputElement, true)}
												class="w-14 bg-transparent text-right font-mono text-[11px] text-slate-100 focus:outline-none"
											/>
											{#if entry.isPercent}
												<span class="ml-0.5 font-mono text-[10px] text-slate-400">%</span>
											{/if}
										</div>
										<span class="w-9 text-right font-mono text-[10px] text-amber-300">
											{Math.round(entry.rollQuality * 100)}%
										</span>
									</div>
								</div>
								<input
									type="range"
									aria-label={`Roll percentage ${entry.label}`}
									min="0"
									max="1"
									step="0.01"
									value={entry.rollQuality}
									oninput={(e) => setStatRoll(entry.key, Number((e.currentTarget as HTMLInputElement).value))}
									class="h-1.5 w-full cursor-pointer accent-amber-400"
								/>
							</div>
						{/each}
					</div>
				</div>
			{/if}

			{#if resolvedStats.length > 0}
				<div class="flex flex-wrap gap-1.5">
					{#each resolvedStats as badge}
						<span
							class={`rounded-md px-2 py-0.5 text-[11px] font-medium ${
								badge.negative
									? 'bg-rose-500/10 text-rose-300 ring-1 ring-rose-500/20'
									: 'bg-emerald-500/10 text-emerald-300 ring-1 ring-emerald-500/20'
							}`}
						>
							{badge.formatted}
							{badge.label}
						</span>
					{/each}
				</div>
			{/if}

			{#if duplicateWarning}
				<p class="rounded-md bg-amber-500/10 px-2 py-1 text-[11px] font-medium text-amber-300">
					Warning: ONLY ONE CAN BE WORN — remove duplicates.
				</p>
			{:else if isUniqueOnlyEquipment(selectedItem)}
				<p class="text-[11px] text-slate-400">Unique: only 1 can be worn.</p>
			{/if}
		</div>
	{/if}
</div>
