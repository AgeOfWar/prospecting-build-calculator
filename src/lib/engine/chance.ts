import { MODIFIERS } from '#lib/data/index.ts';
import { resolveSavedBuild } from '#lib/engine/loadout.ts';
import { calculateBuildStats } from '#lib/engine/stats.ts';
import type {
	CalculatedStats,
	MineralEntry,
	MineralModifier,
	SavedBuild,
	SavedMuseum
} from '#lib/types/prospecting.ts';

export type TimeMethod = 'sand' | 'autopan';

export interface ChanceInputs {
	luck: number;
	capacity: number;
	timeMethod: TimeMethod;
	shakeSpeedPct: number;
	shakeStrength: number;
	digsToFill: number;
	digSpeedPct: number;
	sizeBoostPct: number;
	modifierBoostPct: number;
	minWeightKg: number | null;
	targetModifierId: string | null;
	solarMagnifier: boolean;
	volcanicEruption: boolean;
	modifierSurge: boolean;
	isNight: boolean;
	hasCrystalTouch: boolean;
	hasVoidTouched: boolean;
	hasPurityRune: boolean;
	hasAlchemistsCrucible?: boolean;
}

export interface WeightChanceInfo {
	active: boolean;
	probability: number;
	weightMultiplier: number;
	requiredBaseKg: number;
	minSizeBoostNeededPct: number | null;
}

export interface ModifierChanceInfo {
	active: boolean;
	probability: number;
	anyModifierChance: number;
	conditionalShare: number;
	modifierLuck: number;
	warning: string | null;
	label: string | null;
}

export interface LocationChanceRow {
	sourceName: string;
	locationName: string;
	isChest: boolean;
	isBest: boolean;
	basePercent: number;
	baseOneIn: string;
	effectiveRollProb: number;
	pAttempt: number;
	attemptOneIn: string;
	a50: number;
	a90: number;
	a99: number;
	t50: number | null;
	t90: number | null;
	t99: number | null;
}

export interface MineralChanceSummary {
	isChestOnly: boolean;
	bestSourceName: string;
	bestLocationLabel: string;
	bestBasePercent: number;
	rollsPerPan: number;
	shakesPerSecond: number;
	totalShakes: number;
	cycleSeconds: number;
	rollsPerSecond: number;
	pansPerMinute: number;
	pAttempt: number;
	expectedFinds: number;
	a50: number;
	a90: number;
	a99: number;
	t50: number | null;
	t90: number | null;
	t99: number | null;
	weightInfo: WeightChanceInfo;
	modifierInfo: ModifierChanceInfo;
	combinedConditionChance: number;
	rows: LocationChanceRow[];
}

export const DEFAULT_CHANCE_INPUTS: ChanceInputs = {
	luck: 10,
	capacity: 50,
	timeMethod: 'autopan',
	shakeSpeedPct: 500,
	shakeStrength: 1,
	digsToFill: 3,
	digSpeedPct: 100,
	sizeBoostPct: 0,
	modifierBoostPct: 0,
	minWeightKg: null,
	targetModifierId: null,
	solarMagnifier: false,
	volcanicEruption: false,
	modifierSurge: false,
	isNight: false,
	hasCrystalTouch: false,
	hasVoidTouched: false,
	hasPurityRune: false,
	hasAlchemistsCrucible: false
};

const MODIFIERS_BY_ID = new Map<string, MineralModifier>(MODIFIERS.map((m) => [m.id, m]));

export const BASE_MIN_KG = 0.1;
export const BASE_MAX_KG = 2.8;

/** Empirical Shake Speed % -> Shakes/second table from the reference calculator. */
export const SHAKE_SPEED_DATA: ReadonlyArray<readonly [number, number]> = [
	[304, 6.43776824],
	[353, 5.244755245],
	[399, 5.752636625],
	[449, 8.462623413],
	[501, 7.067137809],
	[554, 6.802721088],
	[600, 9.360374415],
	[650, 9.009009009],
	[700, 7.761966365],
	[752, 8.287292818],
	[804, 7.947019868],
	[847, 8.053691275],
	[901, 10.657193606],
	[952, 11.152416357],
	[999, 10.733452594],
	[1046, 10],
	[1104, 9.493670886],
	[1148, 9.433962264],
	[1203, 10.23890785],
	[1249, 10.221465077],
	[1303, 9.868421053],
	[1346, 10.204081633],
	[1397, 10.291595197],
	[1449, 10.23890785],
	[1498, 10.434782609],
	[1553, 10.050251256],
	[1597, 10.327022375],
	[1650, 10.526315789],
	[1702, 10.676156584],
	[1751, 12.631578947],
	[1803, 12.345679012],
	[1849, 12.422360248],
	[1899, 12.875536481],
	[1951, 12.195121951],
	[2000, 12.345679012]
];

export function shakeSpeedToR(shakeSpeedPct: number): number {
	const value = Number(shakeSpeedPct);
	if (!Number.isFinite(value) || value < 0) return 0;

	const first = SHAKE_SPEED_DATA[0];
	const last = SHAKE_SPEED_DATA[SHAKE_SPEED_DATA.length - 1];

	if (value <= first[0]) return first[1];
	if (value >= last[0]) return last[1];

	for (let i = 0; i < SHAKE_SPEED_DATA.length - 1; i++) {
		const [speedA, shakesA] = SHAKE_SPEED_DATA[i];
		const [speedB, shakesB] = SHAKE_SPEED_DATA[i + 1];
		if (value >= speedA && value <= speedB) {
			const t = (value - speedA) / (speedB - speedA);
			return shakesA + (shakesB - shakesA) * t;
		}
	}

	return 0;
}

export function getCycleSeconds(inputs: ChanceInputs): number {
	const capacity = Math.max(1, Number(inputs.capacity) || 1);
	const shakeSpeed = Math.max(0, Number(inputs.shakeSpeedPct) || 0);
	const strength = Math.max(0.0001, Number(inputs.shakeStrength) || 0.0001);
	const totalDigs = Math.max(0, Number(inputs.digsToFill) || 0);
	const digSpeed = Math.max(0.0001, Number(inputs.digSpeedPct) || 0.0001);

	const shakesPerSecond = shakeSpeedToR(shakeSpeed);
	if (shakesPerSecond <= 0) return Infinity;

	const totalShakes = capacity / strength;
	const shakeDuration = totalShakes / shakesPerSecond;
	const digDuration = 143.9 * Math.pow(digSpeed, -0.9324);

	if (inputs.timeMethod === 'autopan') {
		return shakeDuration + 1.15 + totalDigs * digDuration;
	}

	return shakeDuration + 0.75 + Math.max(0, totalDigs - 1) * digDuration;
}

/**
 * Estimates P(ore weight >= targetKg) using the wiki's Size Boost formula and
 * 25% / 25% / 50% Capacity distribution across [0.1 kg, 2.8 kg] base weights.
 */
export function calculateWeightChance(inputs: ChanceInputs): WeightChanceInfo {
	const eventWeightMult =
		(inputs.solarMagnifier ? 1.5 : 1) * (inputs.volcanicEruption ? 1.5 : 1);
	const weightMultiplier = (1 + Math.max(0, Number(inputs.sizeBoostPct) || 0) / 100) * eventWeightMult;
	const targetKg = Number(inputs.minWeightKg);

	if (!Number.isFinite(targetKg) || targetKg <= 0) {
		return {
			active: false,
			probability: 1,
			weightMultiplier,
			requiredBaseKg: 0,
			minSizeBoostNeededPct: null
		};
	}

	const requiredBaseKg = targetKg / weightMultiplier;
	if (requiredBaseKg <= BASE_MIN_KG) {
		return {
			active: true,
			probability: 1,
			weightMultiplier,
			requiredBaseKg,
			minSizeBoostNeededPct: null
		};
	}

	if (requiredBaseKg >= BASE_MAX_KG) {
		const minSizeBoostNeededPct = Math.max(
			0,
			Math.ceil((targetKg / (BASE_MAX_KG * eventWeightMult) - 1) * 100)
		);
		return {
			active: true,
			probability: 0,
			weightMultiplier,
			requiredBaseKg,
			minSizeBoostNeededPct
		};
	}

	const u = (requiredBaseKg - BASE_MIN_KG) / (BASE_MAX_KG - BASE_MIN_KG);
	const capacity = Math.max(5, Number(inputs.capacity) || 5);
	const tailProbAtCap = (c: number): number => {
		const k = 0.24 + 4.3 * (1 - Math.exp(-c / 3500));
		return 1 - Math.pow(u, k);
	};

	const probability =
		0.25 * tailProbAtCap(5) +
		0.25 * tailProbAtCap(Math.max(5, capacity / 2)) +
		0.5 * tailProbAtCap(capacity);

	return {
		active: true,
		probability: Math.min(1, Math.max(0, probability)),
		weightMultiplier,
		requiredBaseKg,
		minSizeBoostNeededPct: null
	};
}

function probAtLeastRank(cumProb: number, luckRolls: number): number {
	if (cumProb <= 0) return 0;
	if (cumProb >= 1) return 1;
	return 1 - Math.exp(luckRolls * Math.log1p(-cumProb));
}

/**
 * Estimates P(ore has target modifier) using the wiki's two-job Modifier Boost model:
 * Job 1 (% of ores modified, capping at 99.4% around 1,900 effective MB) and
 * Job 2 (which modifier via Modifier Luck with 25/25/50 roll split).
 */
export function calculateModifierChance(
	inputs: ChanceInputs,
	isChestOnly: boolean
): ModifierChanceInfo {
	const targetId = inputs.targetModifierId;
	if (!targetId) {
		return {
			active: false,
			probability: 1,
			anyModifierChance: 0,
			conditionalShare: 1,
			modifierLuck: 1,
			warning: null,
			label: null
		};
	}

	const panelMB = 100 + Math.max(0, Number(inputs.modifierBoostPct) || 0);
	const effMB1 =
		panelMB * (inputs.solarMagnifier ? 2 : 1) * (inputs.modifierSurge ? 2 : 1);
	const effMB2 = panelMB * (inputs.modifierSurge ? 2 : 1);
	const luck = Math.max(0, Number(inputs.luck) || 0);
	const modifierLuck = 1 + Math.min(50, luck / 1000) + effMB2 / 10;
	const anyModifierChance = Math.min(0.994, (effMB1 / 1680) * 0.994);

	if (inputs.hasPurityRune) {
		return {
			active: true,
			probability: 0,
			anyModifierChance: 0,
			conditionalShare: 0,
			modifierLuck,
			warning: 'Purity Rune prevents obtaining modifiers.',
			label: targetId === 'any' ? 'Any Modifier' : (MODIFIERS_BY_ID.get(targetId)?.name ?? targetId)
		};
	}

	if (targetId === 'any') {
		return {
			active: true,
			probability: isChestOnly ? 1 : anyModifierChance,
			anyModifierChance: isChestOnly ? 1 : anyModifierChance,
			conditionalShare: 1,
			modifierLuck,
			warning: null,
			label: 'Any Modifier'
		};
	}

	const mod = MODIFIERS_BY_ID.get(targetId);
	if (!mod) {
		return {
			active: false,
			probability: 1,
			anyModifierChance,
			conditionalShare: 1,
			modifierLuck,
			warning: null,
			label: null
		};
	}

	if (mod.id === 'treasured') {
		return {
			active: true,
			probability: isChestOnly ? 1 : 0,
			anyModifierChance: isChestOnly ? 1 : anyModifierChance,
			conditionalShare: isChestOnly ? 1 : 0,
			modifierLuck,
			warning: isChestOnly ? null : 'Treasured can only be obtained from Treasure Chests (0% from panning).',
			label: mod.name
		};
	}

	if (isChestOnly) {
		return {
			active: true,
			probability: 0,
			anyModifierChance: 1,
			conditionalShare: 0,
			modifierLuck,
			warning: 'Chests always drop Treasured (0% for other modifiers).',
			label: mod.name
		};
	}

	if (mod.id === 'crystalline') {
		return {
			active: true,
			probability: inputs.hasCrystalTouch ? 0.1 : 0,
			anyModifierChance,
			conditionalShare: inputs.hasCrystalTouch ? 0.1 : 0,
			modifierLuck,
			warning: inputs.hasCrystalTouch
				? null
				: 'Enable the Crystal Touch enchant (fixed 10%) to obtain Crystalline.',
			label: mod.name
		};
	}

	if (mod.id === 'voidtorn') {
		return {
			active: true,
			probability: inputs.hasVoidTouched ? 0.05 : 0,
			anyModifierChance,
			conditionalShare: inputs.hasVoidTouched ? 0.05 : 0,
			modifierLuck,
			warning: inputs.hasVoidTouched
				? null
				: 'Enable Void Touched / Galactic tools (5%) to obtain Voidtorn.',
			label: mod.name
		};
	}

	if (mod.source === 'night' && !inputs.isNight) {
		return {
			active: true,
			probability: 0,
			anyModifierChance,
			conditionalShare: 0,
			modifierLuck,
			warning: 'Lunar can only be obtained at night — enable the Night toggle.',
			label: mod.name
		};
	}

	const pool = MODIFIERS.filter(
		(m) => m.source === 'panning' || (m.source === 'night' && inputs.isNight)
	);
	const totalPoolWeight = pool.reduce((sum, m) => sum + m.baseChancePercent, 0);

	let prevCum = 0;
	let currCum = 0;
	let lowerCum = 0;
	let isTopTier = false;
	for (let i = 0; i < pool.length; i++) {
		const entry = pool[i];
		const nextCum = prevCum + entry.baseChancePercent / totalPoolWeight;
		if (entry.id === mod.id) {
			currCum = Math.min(1, nextCum);
			isTopTier = i === 0;
			const nextLower = pool[i + 1];
			lowerCum = nextLower
				? Math.min(1, currCum + nextLower.baseChancePercent / totalPoolWeight)
				: currCum;
			break;
		}
		prevCum = nextCum;
	}

	const shareRangeAt = (lo: number, hi: number, L: number): number =>
		Math.max(0, probAtLeastRank(hi, L) - probAtLeastRank(lo, L));

	const baseConditionalShare =
		0.25 * shareRangeAt(prevCum, currCum, 1) +
		0.25 * shareRangeAt(prevCum, currCum, Math.max(1, modifierLuck / 2)) +
		0.5 * shareRangeAt(prevCum, currCum, modifierLuck);

	let conditionalShare = baseConditionalShare;
	if (inputs.hasAlchemistsCrucible) {
		const lowerConditionalShare =
			lowerCum > currCum
				? 0.25 * shareRangeAt(currCum, lowerCum, 1) +
					0.25 * shareRangeAt(currCum, lowerCum, Math.max(1, modifierLuck / 2)) +
					0.5 * shareRangeAt(currCum, lowerCum, modifierLuck)
				: 0;
		conditionalShare = (isTopTier ? 1 : 0.9) * baseConditionalShare + 0.1 * lowerConditionalShare;
	}

	return {
		active: true,
		probability: Math.min(1, Math.max(0, anyModifierChance * conditionalShare)),
		anyModifierChance,
		conditionalShare,
		modifierLuck,
		warning: null,
		label: mod.name
	};
}

/** Numerically stable computation of 1 - (1 - p)^rolls. */
export function calcAttemptProbability(baseProb: number, rollsPerPan: number): number {
	if (!Number.isFinite(baseProb) || !Number.isFinite(rollsPerPan)) return 0;
	if (baseProb <= 0 || rollsPerPan <= 0) return 0;
	if (baseProb >= 1) return 1;
	return -Math.expm1(rollsPerPan * Math.log1p(-baseProb));
}

export function attemptsForTarget(pAttempt: number, target: number): number {
	if (!Number.isFinite(pAttempt) || pAttempt <= 0) return Infinity;
	if (pAttempt >= 1) return 1;
	return Math.log(1 - target) / Math.log1p(-pAttempt);
}

export function fmtPct(prob: number, digits = 5): string {
	if (!Number.isFinite(prob)) return '—';
	return `${(prob * 100).toFixed(digits)}%`;
}

export function fmtOneIn(prob: number): string {
	if (!Number.isFinite(prob) || prob <= 0) return '∞';
	return Math.round(1 / prob).toLocaleString('en-US');
}

export function fmtCompactRate(val: number): string {
	if (!Number.isFinite(val)) return '—';
	if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(2)}M`;
	if (val >= 10_000) return `${(val / 1_000).toFixed(1)}k`;
	if (val >= 1_000) return Math.round(val).toLocaleString('en-US');
	if (val >= 100) return val.toFixed(1);
	return val.toFixed(2);
}

export function fmtDuration(seconds: number | null): string {
	if (seconds === null) return 'N/A';
	if (!Number.isFinite(seconds) || seconds < 0) return '—';
	if (seconds === Infinity) return '∞';

	const total = Math.round(seconds);
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const sec = total % 60;

	if (h > 0) return `${h}h ${m}m`;
	if (m > 0) return `${m}m ${sec}s`;
	return `${sec}s`;
}

export function getRarityBadgeClass(rarity: string): {
	dotClass: string;
	pillClass: string;
} {
	switch (rarity.toLowerCase()) {
		case 'common':
			return {
				dotClass: 'bg-slate-400',
				pillClass: 'border-slate-500/40 bg-slate-500/15 text-slate-200'
			};
		case 'uncommon':
			return {
				dotClass: 'bg-emerald-400',
				pillClass: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
			};
		case 'rare':
			return {
				dotClass: 'bg-sky-400',
				pillClass: 'border-sky-500/40 bg-sky-500/15 text-sky-300'
			};
		case 'epic':
			return {
				dotClass: 'bg-violet-400',
				pillClass: 'border-violet-500/40 bg-violet-500/15 text-violet-300'
			};
		case 'legendary':
			return {
				dotClass: 'bg-amber-400',
				pillClass: 'border-amber-500/40 bg-amber-500/15 text-amber-300'
			};
		case 'mythic':
			return {
				dotClass: 'bg-rose-400',
				pillClass: 'border-rose-500/40 bg-rose-500/15 text-rose-300'
			};
		case 'exotic':
			return {
				dotClass: 'bg-fuchsia-400',
				pillClass: 'border-fuchsia-500/40 bg-fuchsia-500/15 text-fuchsia-300'
			};
		default:
			return {
				dotClass: 'bg-slate-400',
				pillClass: 'border-slate-600 bg-slate-800 text-slate-300'
			};
	}
}

export function calculateMineralChances(
	mineral: MineralEntry,
	inputs: ChanceInputs
): MineralChanceSummary {
	const chests = mineral.chests ?? [];
	const locations = (mineral.locations ?? []).filter(
		(l) => Number.isFinite(Number(l.chance_percent)) && Number(l.chance_percent) > 0
	);

	const isChestOnly = locations.length === 0 && chests.length > 0;
	const weightInfo = calculateWeightChance(inputs);
	const modifierInfo = calculateModifierChance(inputs, isChestOnly);
	const combinedConditionChance = weightInfo.probability * modifierInfo.probability;

	if (isChestOnly) {
		const sortedChests = [...chests].sort((a, b) => b.chance_percent - a.chance_percent);
		const bestChest = sortedChests[0];

		const rows: LocationChanceRow[] = sortedChests.map((c, idx) => {
			const cp = Number(c.chance_percent) / 100;
			const effP = cp * combinedConditionChance;
			return {
				sourceName: `${c.location} - ${c.name}`,
				locationName: c.name,
				isChest: true,
				isBest: idx === 0,
				basePercent: Number(c.chance_percent),
				baseOneIn: fmtOneIn(cp),
				effectiveRollProb: effP,
				pAttempt: effP,
				attemptOneIn: fmtOneIn(effP),
				a50: effP > 0 ? Math.ceil(attemptsForTarget(effP, 0.5)) : Infinity,
				a90: effP > 0 ? Math.ceil(attemptsForTarget(effP, 0.9)) : Infinity,
				a99: effP > 0 ? Math.ceil(attemptsForTarget(effP, 0.99)) : Infinity,
				t50: null,
				t90: null,
				t99: null
			};
		});

		const bestRow = rows[0];
		return {
			isChestOnly: true,
			bestSourceName: bestChest.name,
			bestLocationLabel: `${bestChest.name} (${bestChest.location})`,
			bestBasePercent: Number(bestChest.chance_percent),
			rollsPerPan: 1,
			shakesPerSecond: 0,
			totalShakes: 0,
			cycleSeconds: Infinity,
			rollsPerSecond: 0,
			pansPerMinute: 0,
			pAttempt: bestRow.pAttempt,
			expectedFinds: bestRow.pAttempt,
			a50: bestRow.a50,
			a90: bestRow.a90,
			a99: bestRow.a99,
			t50: null,
			t90: null,
			t99: null,
			weightInfo,
			modifierInfo,
			combinedConditionChance,
			rows
		};
	}

	const luck = Math.max(0, Number(inputs.luck) || 0);
	const capacity = Math.max(1, Number(inputs.capacity) || 1);
	const strength = Math.max(0.0001, Number(inputs.shakeStrength) || 0.0001);
	const rollsPerPan = luck * Math.sqrt(capacity);
	const shakesPerSecond = shakeSpeedToR(inputs.shakeSpeedPct);
	const totalShakes = capacity / strength;
	const cycleSeconds = getCycleSeconds(inputs);
	const rollsPerSecond =
		Number.isFinite(cycleSeconds) && cycleSeconds > 0 ? rollsPerPan / cycleSeconds : 0;
	const pansPerMinute =
		Number.isFinite(cycleSeconds) && cycleSeconds > 0 ? 60 / cycleSeconds : 0;

	const sortedLocations = [...locations].sort((a, b) => b.chance_percent - a.chance_percent);
	const bestLoc = sortedLocations[0] ?? null;

	const rows: LocationChanceRow[] = sortedLocations.map((loc, idx) => {
		const bp = Number(loc.chance_percent) / 100;
		const effRollProb = bp * combinedConditionChance;
		const pAtt = calcAttemptProbability(effRollProb, rollsPerPan);
		const a50 = attemptsForTarget(pAtt, 0.5);
		const a90 = attemptsForTarget(pAtt, 0.9);
		const a99 = attemptsForTarget(pAtt, 0.99);

		return {
			sourceName: loc.location,
			locationName: loc.location,
			isChest: false,
			isBest: idx === 0,
			basePercent: Number(loc.chance_percent),
			baseOneIn: fmtOneIn(bp),
			effectiveRollProb: effRollProb,
			pAttempt: pAtt,
			attemptOneIn: fmtOneIn(pAtt),
			a50,
			a90,
			a99,
			t50: Number.isFinite(a50) && Number.isFinite(cycleSeconds) ? a50 * cycleSeconds : Infinity,
			t90: Number.isFinite(a90) && Number.isFinite(cycleSeconds) ? a90 * cycleSeconds : Infinity,
			t99: Number.isFinite(a99) && Number.isFinite(cycleSeconds) ? a99 * cycleSeconds : Infinity
		};
	});

	for (const chest of chests) {
		const cp = Number(chest.chance_percent) / 100;
		const chestModifierInfo = calculateModifierChance(inputs, true);
		const effP = cp * weightInfo.probability * chestModifierInfo.probability;
		rows.push({
			sourceName: `${chest.location} - ${chest.name}`,
			locationName: chest.name,
			isChest: true,
			isBest: false,
			basePercent: Number(chest.chance_percent),
			baseOneIn: fmtOneIn(cp),
			effectiveRollProb: effP,
			pAttempt: effP,
			attemptOneIn: fmtOneIn(effP),
			a50: effP > 0 ? Math.ceil(attemptsForTarget(effP, 0.5)) : Infinity,
			a90: effP > 0 ? Math.ceil(attemptsForTarget(effP, 0.9)) : Infinity,
			a99: effP > 0 ? Math.ceil(attemptsForTarget(effP, 0.99)) : Infinity,
			t50: null,
			t90: null,
			t99: null
		});
	}

	const bestRow = rows.find((r) => r.isBest) ?? null;
	const bestBasePct = bestLoc ? Number(bestLoc.chance_percent) : 0;

	return {
		isChestOnly: false,
		bestSourceName: bestLoc?.location ?? '—',
		bestLocationLabel: bestLoc?.location ?? '—',
		bestBasePercent: bestBasePct,
		rollsPerPan,
		shakesPerSecond,
		totalShakes,
		cycleSeconds,
		rollsPerSecond,
		pansPerMinute,
		pAttempt: bestRow?.pAttempt ?? 0,
		expectedFinds: rollsPerPan * (bestRow?.effectiveRollProb ?? 0),
		a50: bestRow?.a50 ?? Infinity,
		a90: bestRow?.a90 ?? Infinity,
		a99: bestRow?.a99 ?? Infinity,
		t50: bestRow?.t50 ?? Infinity,
		t90: bestRow?.t90 ?? Infinity,
		t99: bestRow?.t99 ?? Infinity,
		weightInfo,
		modifierInfo,
		combinedConditionChance,
		rows
	};
}

function round2(n: number): number {
	return Math.round(n * 100) / 100;
}

/**
 * Returns total critical dig chance (2× dig strength) from Shovel Enchant and Runes.
 */
export function getBuildDigCritChance(
	shovelEnchantId: string | null | undefined,
	runeIds: readonly string[] = []
): number {
	let chance = 0;
	if (shovelEnchantId === 'shovel-overdrive') chance += 0.6;
	if (runeIds.includes('critical-i')) chance += 0.2;
	if (runeIds.includes('critical-ii')) chance += 0.2;
	return Math.min(1, Math.max(0, chance));
}

/**
 * Exact expected number of digs to fill `capacity` when each dig deals `2× digStrength`
 * with probability `critChance` and `1× digStrength` otherwise.
 */
export function expectedDigsToFill(
	capacity: number,
	digStrength: number,
	critChance = 0
): number {
	if (!Number.isFinite(digStrength) || digStrength <= 0) return 3;
	const cap = Math.max(0, Number(capacity) || 0);
	const n = Math.max(1, Math.ceil(cap / digStrength));
	const p = Math.min(1, Math.max(0, Number(critChance) || 0));

	if (p <= 0 || n === 1) return n;
	if (p >= 1) return Math.ceil(n / 2);
	if (n > 200) {
		return n / (1 + p) + p / ((1 + p) * (1 + p));
	}

	let prev2 = 0;
	let prev1 = 1;
	for (let k = 2; k <= n; k++) {
		const cur = 1 + p * prev2 + (1 - p) * prev1;
		prev2 = prev1;
		prev1 = cur;
	}
	return prev1;
}

export interface DigQualityMultipliers {
	qualityPct: 51 | 100;
	luckMultiplier: number;
	digStrengthMultiplier: number;
}

/**
 * Official wiki Quality & Autopan mechanics:
 * - Manual digging (Sand) or Autopan with Mastered: 100% quality (full Luck, 1.5x Dig Strength).
 * - Autopan without Mastered: 51% quality (2/3 Luck, no 1.5x Dig Strength).
 */
export function getDigQualityMultipliers(
	timeMethod: TimeMethod,
	hasMastered: boolean
): DigQualityMultipliers {
	if (timeMethod === 'autopan' && !hasMastered) {
		return { qualityPct: 51, luckMultiplier: 2 / 3, digStrengthMultiplier: 1 };
	}
	return { qualityPct: 100, luckMultiplier: 1, digStrengthMultiplier: 1.5 };
}

function statsToChanceValues(
	stats: CalculatedStats,
	opts: {
		isNight: boolean;
		timeMethod: TimeMethod;
		hasMastered: boolean;
		digCritChance: number;
	}
) {
	const q = getDigQualityMultipliers(opts.timeMethod, opts.hasMastered);
	const rawEffectiveLuck = stats.luck.final + (opts.isNight ? stats.nightLuck.final : 0);
	const luck = Math.max(0, round2(rawEffectiveLuck * q.luckMultiplier));
	const capacity = Math.max(1, round2(stats.capacity.final));
	const shakeSpeedPct = stats.shakeSpeed.final > 0 ? Math.round(stats.shakeSpeed.final * 100) : 100;
	const shakeStrength = stats.shakeStrength.final > 0 ? round2(stats.shakeStrength.final) : 1;
	const effectiveDigStrength = stats.digStrength.final * q.digStrengthMultiplier;
	const digsToFill =
		effectiveDigStrength > 0
			? round2(expectedDigsToFill(capacity, effectiveDigStrength, opts.digCritChance))
			: 3;
	const digSpeedPct = stats.digSpeed.final > 0 ? Math.round(stats.digSpeed.final * 100) : 100;
	const sizeBoostPct = Math.max(0, Math.round(stats.sizeBoost.final * 100));
	const modifierBoostPct = Math.max(0, Math.round(stats.modifierBoost.final * 100));

	return {
		luck,
		capacity,
		shakeSpeedPct,
		shakeStrength,
		digsToFill,
		digSpeedPct,
		sizeBoostPct,
		modifierBoostPct,
		qualityPct: q.qualityPct
	};
}

export interface BuildEfficiencyMetrics {
	hasPanningStats: boolean;
	effectiveLuck: number;
	capacity: number;
	rollsPerPan: number;
	shakesPerSecond: number;
	totalShakes: number;
	digsToFill: number;
	digCritChance: number;
	qualityPct: 51 | 100;
	hasMastered: boolean;
	cycleSeconds: number;
	pansPerMinute: number;
	rollsPerSecond: number;
	maxOreWeightKg: number;
	anyModifierChance: number;
	modifierLuck: number;
	hasPurityRune: boolean;
}

/** Computes derived panning throughput and chance metrics directly from build stats. */
export function calculateBuildEfficiency(
	stats: CalculatedStats,
	opts?: {
		timeMethod?: TimeMethod;
		isNight?: boolean;
		hasPurityRune?: boolean;
		hasMastered?: boolean;
		digCritChance?: number;
	}
): BuildEfficiencyMetrics {
	const timeMethod = opts?.timeMethod ?? 'autopan';
	const isNight = opts?.isNight ?? false;
	const hasPurityRune = opts?.hasPurityRune ?? false;
	const hasMastered = opts?.hasMastered ?? false;
	const digCritChance = Math.min(1, Math.max(0, opts?.digCritChance ?? 0));

	const hasPanningStats = stats.luck.final > 0 && stats.capacity.final > 0;
	const base = statsToChanceValues(stats, { isNight, timeMethod, hasMastered, digCritChance });
	const inputs: ChanceInputs = {
		...DEFAULT_CHANCE_INPUTS,
		luck: base.luck,
		capacity: base.capacity,
		shakeSpeedPct: base.shakeSpeedPct,
		shakeStrength: base.shakeStrength,
		digsToFill: base.digsToFill,
		digSpeedPct: base.digSpeedPct,
		sizeBoostPct: base.sizeBoostPct,
		modifierBoostPct: base.modifierBoostPct,
		timeMethod,
		isNight,
		hasPurityRune
	};

	const rollsPerPan = hasPanningStats ? base.luck * Math.sqrt(base.capacity) : 0;
	const shakesPerSecond = shakeSpeedToR(base.shakeSpeedPct);
	const totalShakes = base.capacity / base.shakeStrength;
	const cycleSeconds = getCycleSeconds(inputs);
	const validCycle = Number.isFinite(cycleSeconds) && cycleSeconds > 0;
	const pansPerMinute = hasPanningStats && validCycle ? 60 / cycleSeconds : 0;
	const rollsPerSecond = hasPanningStats && validCycle ? rollsPerPan / cycleSeconds : 0;
	const maxOreWeightKg = BASE_MAX_KG * (1 + base.sizeBoostPct / 100);
	const panelMB = 100 + base.modifierBoostPct;
	const anyModifierChance = hasPurityRune ? 0 : Math.min(0.994, (panelMB / 1680) * 0.994);
	const modifierLuck = 1 + Math.min(50, base.luck / 1000) + panelMB / 10;

	return {
		hasPanningStats,
		effectiveLuck: base.luck,
		capacity: base.capacity,
		rollsPerPan,
		shakesPerSecond,
		totalShakes,
		digsToFill: base.digsToFill,
		digCritChance,
		qualityPct: base.qualityPct,
		hasMastered,
		cycleSeconds,
		pansPerMinute,
		rollsPerSecond,
		maxOreWeightKg,
		anyModifierChance,
		modifierLuck,
		hasPurityRune
	};
}

/** Extracts ChanceInputs from a saved build (and optional linked Museum) while preserving filter & event options. */
export function extractChanceInputsFromBuild(
	saved: SavedBuild,
	current?: TimeMethod | Partial<ChanceInputs>,
	museum?: SavedMuseum | null
): ChanceInputs {
	const resolved = resolveSavedBuild(saved, museum);
	const opts: Partial<ChanceInputs> =
		typeof current === 'string' ? { timeMethod: current } : (current ?? {});
	const stats = calculateBuildStats(resolved, {
		isNight: Boolean(opts.isNight),
		solarMagnifier: Boolean(opts.solarMagnifier),
		modifierSurge: Boolean(opts.modifierSurge)
	});
	const timeMethod = opts.timeMethod ?? 'autopan';
	const hasMastered = saved.shovelEnchantId === 'shovel-mastered';
	const digCritChance = getBuildDigCritChance(saved.shovelEnchantId, saved.runeIds);
	const base = statsToChanceValues(stats, {
		isNight: Boolean(opts.isNight),
		timeMethod,
		hasMastered,
		digCritChance
	});

	return {
		luck: base.luck,
		capacity: base.capacity,
		shakeSpeedPct: base.shakeSpeedPct,
		shakeStrength: base.shakeStrength,
		digsToFill: base.digsToFill,
		digSpeedPct: base.digSpeedPct,
		sizeBoostPct: base.sizeBoostPct,
		modifierBoostPct: base.modifierBoostPct,
		timeMethod,
		minWeightKg: opts.minWeightKg ?? null,
		targetModifierId: opts.targetModifierId ?? null,
		solarMagnifier: opts.solarMagnifier ?? false,
		volcanicEruption: opts.volcanicEruption ?? false,
		modifierSurge: opts.modifierSurge ?? false,
		isNight: opts.isNight ?? false,
		hasCrystalTouch: saved.shovelEnchantId === 'shovel-crystal-touch',
		hasVoidTouched: saved.shovelEnchantId === 'shovel-void-touched',
		hasPurityRune: saved.runeIds.includes('purity'),
		hasAlchemistsCrucible: Boolean(saved.panId && saved.panTrinketId === 'alchemists-crucible')
	};
}
