<script lang="ts">
	import { MUTATIONS } from '#lib/data/index.ts';
	import { hasValidSixStarData, isUniqueOnlyEquipment, resolveEquipmentModifiers } from '#lib/engine/loadout.ts';
	import { ALL_STAT_KEYS, STAT_LABELS } from '#lib/engine/stats.ts';
	import type {
		EquipmentItem,
		EquipmentMutation,
		EquipmentSlot,
		EquipmentTier,
		EquippedJewelrySelection,
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
	const hasRanges = $derived(
		selectedItem
			? Boolean(
					(value?.tier === '6star' && canSixStar ? selectedItem.sixStarStatRanges : selectedItem.statRanges) &&
						Object.keys(
							(value?.tier === '6star' && canSixStar ? selectedItem.sixStarStatRanges : selectedItem.statRanges) ?? {},
						).length > 0,
				)
			: false,
	);

	const resolvedStats = $derived.by(() => {
		if (!selectedItem || !value) return [];
		const mods = resolveEquipmentModifiers(selectedItem, value.tier, value.rollQuality, selectedMutation);
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
		if (!value) return;
		onchange({ ...value, tier });
	}

	function setRollQuality(rollQuality: number): void {
		if (!value) return;
		onchange({ ...value, rollQuality: Math.min(1, Math.max(0, rollQuality)) });
	}
</script>

<div
	class={`rounded-xl border p-3.5 transition ${
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
				title="Rimuovi {slot}"
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
		<option value="">— Vuoto —</option>
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
					<option value="">— Nessuna Mutation —</option>
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
						<div class="flex items-center gap-1 text-[11px]">
							<button
								type="button"
								onclick={() => setRollQuality(0)}
								class="rounded border border-slate-700 px-1.5 py-0.5 text-slate-300 hover:border-slate-500"
							>
								Min
							</button>
							<button
								type="button"
								onclick={() => setRollQuality(0.5)}
								class="rounded border border-slate-700 px-1.5 py-0.5 text-slate-300 hover:border-slate-500"
							>
								50%
							</button>
							<button
								type="button"
								onclick={() => setRollQuality(1)}
								class="rounded border border-slate-700 px-1.5 py-0.5 text-slate-300 hover:border-slate-500"
							>
								Max
							</button>
						</div>
					{/if}
				</div>
			{/if}

			{#if hasRanges}
				<div class="space-y-1">
					<div class="flex items-center justify-between text-[11px] text-slate-400">
						<span>Roll stat</span>
						<span class="font-mono text-slate-200">{Math.round(value.rollQuality * 100)}%</span>
					</div>
					<input
						type="range"
						min="0"
						max="1"
						step="0.01"
						value={value.rollQuality}
						oninput={(e) => setRollQuality(Number((e.currentTarget as HTMLInputElement).value))}
						class="h-1.5 w-full cursor-pointer accent-amber-400"
					/>
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
					Attenzione: ONLY ONE CAN BE WORN — rimuovi i duplicati.
				</p>
			{:else if isUniqueOnlyEquipment(selectedItem)}
				<p class="text-[11px] text-slate-400">Unico: se ne può indossare solo 1.</p>
			{/if}
		</div>
	{/if}
</div>
