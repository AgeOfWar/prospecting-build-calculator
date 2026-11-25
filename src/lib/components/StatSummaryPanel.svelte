<script lang="ts">
	import {
		calculateBuildEfficiency,
		fmtCompactRate,
		type TimeMethod
	} from '#lib/engine/chance.ts';
	import type { ActivePassiveEntry } from '#lib/engine/loadout.ts';
	import { STAT_LABELS, isBoostOnlyStat } from '#lib/engine/stats.ts';
	import type { CalculatedStats, StatBreakdown, StatKey } from '#lib/types/prospecting.ts';

	interface Props {
		stats: CalculatedStats;
		passives: ActivePassiveEntry[];
		warnings?: string[];
		hasPurityRune?: boolean;
		hasMastered?: boolean;
		digCritChance?: number;
		isNight?: boolean;
		hasDayNightRune?: boolean;
	}

	const STAT_GROUPS: Array<{ title: string; keys: StatKey[] }> = [
		{
			title: 'Panning & Digging',
			keys: [
				'luck',
				'nightLuck',
				'capacity',
				'shakeStrength',
				'shakeSpeed',
				'digStrength',
				'digSpeed',
				'toughness'
			]
		},
		{
			title: 'Boosts & Utility',
			keys: ['sellBoost', 'sizeBoost', 'modifierBoost', 'inventorySize', 'walkSpeed', 'jumpPower']
		}
	];

	let {
		stats,
		passives,
		warnings = [],
		hasPurityRune = false,
		hasMastered = false,
		digCritChance = 0,
		isNight = $bindable(false),
		hasDayNightRune = false
	}: Props = $props();
	let onlyActive = $state(false);
	let timeMethod = $state<TimeMethod>('autopan');

	const hasNightLuck = $derived(stats.nightLuck.final > 1e-6);
	const efficiency = $derived(
		calculateBuildEfficiency(stats, {
			timeMethod,
			isNight,
			hasPurityRune,
			hasMastered,
			digCritChance
		})
	);

	function formatValue(num: number): string {
		if (Math.abs(num) < 1e-6) return '0';
		const rounded = Math.round(num * 100) / 100;
		return Number.isInteger(rounded) ? rounded.toString() : rounded.toFixed(2);
	}

	function formatFinalStat(key: StatKey, breakdown: StatBreakdown): string {
		if (isBoostOnlyStat(key)) {
			const pct = breakdown.final * 100;
			const sign = pct > 0 ? '+' : '';
			return `${sign}${formatValue(pct)}%`;
		}
		return formatValue(breakdown.final);
	}

	function isNonZero(breakdown: StatBreakdown): boolean {
		return (
			Math.abs(breakdown.final) > 1e-6 ||
			Math.abs(breakdown.base) > 1e-6 ||
			Math.abs(breakdown.flats) > 1e-6 ||
			Math.abs(breakdown.boosts) > 1e-6 ||
			Math.abs(breakdown.multiplier - 1) > 1e-6
		);
	}
</script>

<div class="space-y-4">
	<div class="rounded-xl border border-slate-800 bg-slate-900/70 p-5">
		<div class="flex flex-wrap items-center justify-between gap-2">
			<div>
				<h2 class="text-base font-semibold text-white">Panning Efficiency</h2>
				<p class="text-[11px] text-slate-400">Real-time derived stats</p>
			</div>

			<div class="flex flex-wrap items-center gap-1.5">
				{#if hasNightLuck || hasDayNightRune}
					<button
						type="button"
						onclick={() => (isNight = !isNight)}
						class={`rounded-md border px-2 py-1 text-[11px] font-medium transition ${
							isNight
								? 'border-indigo-400/50 bg-indigo-500/20 text-indigo-200'
								: 'border-slate-700 bg-slate-950 text-slate-400 hover:text-slate-200'
						}`}
					>
						Night
					</button>
				{/if}
				<div class="inline-flex rounded-lg border border-slate-700 bg-slate-950 p-0.5 text-[11px]">
					<button
						type="button"
						onclick={() => (timeMethod = 'autopan')}
						class={`rounded-md px-2 py-1 font-medium transition ${
							timeMethod === 'autopan'
								? 'bg-emerald-500/20 text-emerald-300'
								: 'text-slate-400 hover:text-slate-200'
						}`}
					>
						Autopan
					</button>
					<button
						type="button"
						onclick={() => (timeMethod = 'sand')}
						class={`rounded-md px-2 py-1 font-medium transition ${
							timeMethod === 'sand'
								? 'bg-emerald-500/20 text-emerald-300'
								: 'text-slate-400 hover:text-slate-200'
						}`}
					>
						Sand
					</button>
				</div>
			</div>
		</div>

		{#if !efficiency.hasPanningStats}
			<p class="mt-3 rounded-lg border border-dashed border-slate-800 bg-slate-950/40 p-3 text-xs text-slate-400">
				Select a <strong class="text-slate-200">Pan</strong> to calculate Rolls/sec, cycle duration, and panning efficiency.
			</p>
		{:else}
			<div class="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2.5">
				<div class="flex items-baseline justify-between gap-2">
					<span class="text-xs font-medium text-emerald-200">Effective Rolls / sec</span>
					<span class="font-mono text-lg font-bold text-white">
						{fmtCompactRate(efficiency.rollsPerSecond)} / s
					</span>
				</div>
				<div class="mt-0.5 flex items-center justify-between text-[11px] text-emerald-200/80">
					<span>Rolls / Pan (Luck × √Cap)</span>
					<span class="font-mono">{fmtCompactRate(efficiency.rollsPerPan)}</span>
				</div>
				<p
					class={`mt-1.5 border-t border-emerald-500/20 pt-1 text-[10px] font-medium ${
						efficiency.qualityPct === 51 ? 'text-amber-300' : 'text-emerald-200/90'
					}`}
				>
					{#if efficiency.qualityPct === 51}
						⚠ Autopan 51% quality: ⅔ eff. Luck • no 1.5× Dig (requires Mastered)
					{:else if timeMethod === 'autopan'}
						✓ Autopan 100% quality (Mastered • 1.5× Dig Strength)
					{:else}
						Manual 100% quality (1.5× Dig Strength)
					{/if}
				</p>
			</div>

			<div class="mt-2.5 grid grid-cols-2 gap-2">
				<div class="rounded-lg border border-slate-800/80 bg-slate-950/50 px-3 py-2">
					<p class="text-[10px] font-medium text-slate-400 uppercase">Cycle Time</p>
					<p class="mt-0.5 font-mono text-sm font-semibold text-white">
						{efficiency.cycleSeconds.toFixed(2)}s
					</p>
					<p class="text-[10px] text-slate-500">{efficiency.pansPerMinute.toFixed(1)} pan/min</p>
				</div>

				<div class="rounded-lg border border-slate-800/80 bg-slate-950/50 px-3 py-2">
					<p class="text-[10px] font-medium text-slate-400 uppercase">Digs / Shakes</p>
					<p class="mt-0.5 font-mono text-sm font-semibold text-white">
						{Number.isInteger(efficiency.digsToFill)
							? efficiency.digsToFill
							: efficiency.digsToFill.toFixed(2)}d • {Math.ceil(efficiency.totalShakes)}s
					</p>
					<p class="text-[10px] text-slate-500">
						{efficiency.shakesPerSecond.toFixed(1)} shake/s{efficiency.digCritChance > 0
							? ` • ${Math.round(efficiency.digCritChance * 100)}% crit`
							: ''}
					</p>
				</div>

				<div class="rounded-lg border border-slate-800/80 bg-slate-950/50 px-3 py-2">
					<p class="text-[10px] font-medium text-slate-400 uppercase">Max Weight (no events)</p>
					<p class="mt-0.5 font-mono text-sm font-semibold text-sky-300">
						{efficiency.maxOreWeightKg.toFixed(1)} kg
					</p>
					<p class="text-[10px] text-slate-500">
						Size +{Math.round(stats.sizeBoost.final * 100)}%
					</p>
				</div>

				<div class="rounded-lg border border-slate-800/80 bg-slate-950/50 px-3 py-2">
					<p class="text-[10px] font-medium text-slate-400 uppercase">Modifier Chance</p>
					<p
						class={`mt-0.5 font-mono text-sm font-semibold ${
							efficiency.hasPurityRune ? 'text-rose-300' : 'text-fuchsia-300'
						}`}
					>
						{efficiency.hasPurityRune
							? '0%'
							: `${(efficiency.anyModifierChance * 100).toFixed(1)}%`}
					</p>
					<p class="text-[10px] text-slate-500">
						{efficiency.hasPurityRune
							? 'Blocked by Purity'
							: `Mod Luck ${efficiency.modifierLuck.toFixed(1)}×`}
					</p>
				</div>

				<div class="rounded-lg border border-slate-800/80 bg-slate-950/50 px-3 py-2">
					<p class="text-[10px] font-medium text-slate-400 uppercase">Rolls / Minute</p>
					<p class="mt-0.5 font-mono text-sm font-semibold text-amber-300">
						{fmtCompactRate(efficiency.rollsPerSecond * 60)}
					</p>
					<p class="text-[10px] text-slate-500">Continuous average</p>
				</div>

				<div class="rounded-lg border border-slate-800/80 bg-slate-950/50 px-3 py-2">
					<p class="text-[10px] font-medium text-slate-400 uppercase">Rolls / Pan</p>
					<p class="mt-0.5 font-mono text-sm font-semibold text-slate-100">
						{Math.round(efficiency.rollsPerPan).toLocaleString('en-US')}
					</p>
					<p class="text-[10px] text-slate-500">Per single pan</p>
				</div>
			</div>
		{/if}
	</div>

	<div class="rounded-xl border border-slate-800 bg-slate-900/70 p-5">
		<div class="flex flex-wrap items-center justify-between gap-2">
			<div>
				<h2 class="text-base font-semibold text-white">Stat Summary</h2>
				<p class="text-[11px] text-slate-400">Formula: (Base + Flats) × (1 + Boosts)</p>
			</div>

			<div class="inline-flex rounded-lg border border-slate-700 bg-slate-950 p-0.5 text-xs">
				<button
					type="button"
					onclick={() => (onlyActive = false)}
					class={`rounded-md px-2.5 py-1 font-medium transition ${
						!onlyActive ? 'bg-amber-500/20 text-amber-300' : 'text-slate-400 hover:text-slate-200'
					}`}
				>
					All stats
				</button>
				<button
					type="button"
					onclick={() => (onlyActive = true)}
					class={`rounded-md px-2.5 py-1 font-medium transition ${
						onlyActive ? 'bg-amber-500/20 text-amber-300' : 'text-slate-400 hover:text-slate-200'
					}`}
				>
					Active only
				</button>
			</div>
		</div>

		{#if warnings.length > 0}
			<div class="mt-4 space-y-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200">
				{#each warnings as warning}
					<p>⚠ {warning}</p>
				{/each}
			</div>
		{/if}

		<div class="mt-4 space-y-5">
			{#each STAT_GROUPS as group}
				{@const visibleKeys = onlyActive
					? group.keys.filter((key) => isNonZero(stats[key]))
					: group.keys}
				{#if visibleKeys.length > 0}
					<div>
						<h3 class="mb-2 text-xs font-semibold tracking-wider text-slate-400 uppercase">
							{group.title}
						</h3>
						<dl class="divide-y divide-slate-800/80 rounded-lg border border-slate-800/80 bg-slate-950/40">
							{#each visibleKeys as key}
								{@const stat = stats[key]}
								{@const active = isNonZero(stat)}
								<div class="px-3.5 py-2.5">
									<div class="flex items-center justify-between gap-2">
										<dt class={`text-sm ${active ? 'font-medium text-slate-100' : 'text-slate-500'}`}>
											{STAT_LABELS[key]}
										</dt>
										<dd
											class={`font-mono text-sm font-semibold ${
												!active
													? 'text-slate-600'
													: stat.final < 0
														? 'text-rose-300'
														: 'text-amber-300'
											}`}
										>
											{formatFinalStat(key, stat)}
										</dd>
									</div>

									{#if active}
										<div class="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[11px] text-slate-400">
											{#if Math.abs(stat.base) > 1e-6}
												<span>Base {formatValue(stat.base)}</span>
											{/if}
											{#if Math.abs(stat.flats) > 1e-6}
												<span>Flat {stat.flats > 0 ? '+' : ''}{formatValue(stat.flats)}</span>
											{/if}
											{#if Math.abs(stat.boosts) > 1e-6}
												<span>
													Boost {stat.boosts > 0 ? '+' : ''}{formatValue(stat.boosts * 100)}%
												</span>
											{/if}
											{#if Math.abs(stat.multiplier - 1) > 1e-6}
												<span class="text-cyan-300">×{formatValue(stat.multiplier)}</span>
											{/if}
										</div>
									{/if}
								</div>
							{/each}
						</dl>
					</div>
				{/if}
			{/each}
		</div>
	</div>

	<div class="rounded-xl border border-slate-800 bg-slate-900/70 p-5">
		<div class="flex items-center justify-between">
			<h2 class="text-base font-semibold text-white">Passive &amp; Special Effects</h2>
			<span class="rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-300">
				{passives.length}
			</span>
		</div>

		{#if passives.length === 0}
			<p class="mt-3 text-xs text-slate-500">
				No active passive effects. Select a Pan, Shovel, Enchant, Rune, or Boost to see them here.
			</p>
		{:else}
			<ul class="mt-3 space-y-2">
				{#each passives as entry}
					<li class="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-xs">
						<div class="flex items-center justify-between gap-2">
							<span class="font-semibold text-slate-200">{entry.source}</span>
							<span class="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400 uppercase">
								{entry.category}
							</span>
						</div>
						<p class="mt-1 text-slate-400">{entry.text}</p>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</div>
