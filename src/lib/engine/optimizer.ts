import {
	BOOST_SOURCES,
	ENCHANTS,
	EQUIPMENT,
	MINERALS,
	MODIFIERS,
	MUSEUM_MODIFIER_RIDERS,
	MUSEUM_ORES,
	MUSEUM_RARITY_MULTIPLIERS,
	MUSEUM_SLOT_COUNTS,
	MUTATIONS,
	PANS,
	RUNES,
	SHOVELS,
	TRINKETS
} from '#lib/data/index.ts';
import {
	type ChanceInputs,
	type MineralChanceSummary,
	type ModifierChanceInfo,
	type TimeMethod,
	type WeightChanceInfo,
	calculateMineralChances,
	expectedDigsToFill,
	extractChanceInputsFromBuild,
	getDigQualityMultipliers,
	shakeSpeedToR
} from '#lib/engine/chance.ts';
import {
	isUniqueOnlyEquipment,
	resolveEquipmentModifiers,
	resolveSavedBuild
} from '#lib/engine/loadout.ts';
import {
	MUSEUM_RARITIES_DESC,
	type MuseumSummary,
	calculateMuseumSummary,
	createDefaultSavedMuseum,
	isMuseumModifierAllowedForOre
} from '#lib/engine/museum.ts';
import { MAX_RING_SLOTS, calculateBuildStats } from '#lib/engine/stats.ts';
import type {
	BoostSource,
	CalculatedStats,
	Enchant,
	EquipmentItem,
	EquipmentMutation,
	EquipmentTier,
	EquippedJewelrySelection,
	MineralEntry,
	MineralModifier,
	MuseumModifierRider,
	MuseumOreEntry,
	MuseumRarity,
	Pan,
	PanTrinket,
	Rune,
	SavedBuild,
	SavedMuseum,
	Shovel,
	StatKey,
	StatMap,
	StatModifiers
} from '#lib/types/prospecting.ts';

export type OptimizerTargetMode = 'specific' | 'rare_generic';
export type OptimizerMuseumMode = 'optimize' | 'saved' | 'none';
export type OptimizerMuseumRiderMode = 'all' | 'panning_only' | 'none';
export type OptimizerMutationMode = 'auto' | 'none' | string;
export type OptimizerTrinketMode = 'auto' | 'none' | string;
export type OptimizerShovelEnchantMode = 'auto' | 'mastered' | 'none' | string;
export type OptimizerPotionMode = 'none' | 'shop_cash' | 'cash_all' | 'all';

export function isCashPurchasablePotion(boost: BoostSource): boolean {
	return boost.category === 'potion' && Boolean(boost.price && boost.price.includes('$'));
}

export function isShopCashPotion(boost: BoostSource): boolean {
	return isCashPurchasablePotion(boost) && !boost.price!.includes('/');
}

export interface OptimizerBans {
	panIds: string[];
	panEnchantIds: string[];
	trinketIds: string[];
	shovelIds: string[];
	shovelEnchantIds: string[];
	equipmentIds: string[];
	mutationIds: string[];
	runeIds: string[];
	boostIds: string[];
	museumOreIds: string[];
	museumRiderIds: string[];
}

export function createEmptyOptimizerBans(): OptimizerBans {
	return {
		panIds: [],
		panEnchantIds: [],
		trinketIds: [],
		shovelIds: [],
		shovelEnchantIds: [],
		equipmentIds: [],
		mutationIds: [],
		runeIds: [],
		boostIds: [],
		museumOreIds: [],
		museumRiderIds: []
	};
}

export interface OptimizerOptions {
	targetMode: OptimizerTargetMode;
	mineralName: string | null;
	locationName: string | null;
	minWeightKg: number | null;
	targetModifierId: string | null;
	timeMethod: TimeMethod;
	trinketMode: OptimizerTrinketMode;
	shovelEnchantMode: OptimizerShovelEnchantMode;
	jewelryTier: EquipmentTier;
	rollQuality: number;
	mutationMode: OptimizerMutationMode;
	museumMode: OptimizerMuseumMode;
	fixedMuseum: SavedMuseum | null;
	museumWeightPct: number;
	museumRiderMode: OptimizerMuseumRiderMode;
	optimizeRunes: boolean;
	maxRunes: number;
	allowPurityRune: boolean;
	includeTotems: boolean;
	potionMode: OptimizerPotionMode;
	minToughness: number;
	solarMagnifier: boolean;
	volcanicEruption: boolean;
	modifierSurge: boolean;
	isNight: boolean;
	bans?: Partial<OptimizerBans>;
}

export interface OptimizerResult {
	build: SavedBuild;
	museum: SavedMuseum | null;
	stats: CalculatedStats;
	chanceInputs: ChanceInputs;
	mineralSummary: MineralChanceSummary | null;
	selectedLocationName: string | null;
	selectedBasePercent: number | null;
	isChestOnly: boolean;
	feasible: boolean;
	effectiveRollsPerSecond: number;
	expectedTimeSeconds: number | null;
	t50Seconds: number | null;
	t90Seconds: number | null;
	t99Seconds: number | null;
	weightInfo: WeightChanceInfo;
	modifierInfo: ModifierChanceInfo;
	museumSummary: MuseumSummary | null;
	warnings: string[];
	computeTimeMs: number;
}

export const DEFAULT_OPTIMIZER_OPTIONS: OptimizerOptions = {
	targetMode: 'rare_generic',
	mineralName: 'Singularium',
	locationName: null,
	minWeightKg: null,
	targetModifierId: null,
	timeMethod: 'autopan',
	trinketMode: 'auto',
	shovelEnchantMode: 'auto',
	jewelryTier: '6star',
	rollQuality: 1,
	mutationMode: 'auto',
	museumMode: 'optimize',
	fixedMuseum: null,
	museumWeightPct: 100,
	museumRiderMode: 'all',
	optimizeRunes: true,
	maxRunes: 5,
	allowPurityRune: true,
	includeTotems: false,
	potionMode: 'none',
	minToughness: 0,
	solarMagnifier: false,
	volcanicEruption: false,
	modifierSurge: false,
	isNight: false
};

// Tracked stat indices in compact flat evaluator arrays:
// 0: luck, 1: nightLuck, 2: capacity, 3: shakeStrength, 4: shakeSpeed,
// 5: digStrength, 6: digSpeed, 7: toughness, 8: sizeBoost, 9: modifierBoost,
// 10: walkSpeed, 11: jumpPower
const S_LUCK = 0;
const S_NIGHT_LUCK = 1;
const S_CAPACITY = 2;
const S_SHAKE_STR = 3;
const S_SHAKE_SPD = 4;
const S_DIG_STR = 5;
const S_DIG_SPD = 6;
const S_TOUGHNESS = 7;
const S_SIZE_BOOST = 8;
const S_MOD_BOOST = 9;
const S_WALK_SPEED = 10;
const S_JUMP_POWER = 11;
const STAT_COUNT = 12;

const OPT_STAT_KEYS: readonly StatKey[] = [
	'luck',
	'nightLuck',
	'capacity',
	'shakeStrength',
	'shakeSpeed',
	'digStrength',
	'digSpeed',
	'toughness',
	'sizeBoost',
	'modifierBoost',
	'walkSpeed',
	'jumpPower'
] as const;

const STAT_INDEX_BY_KEY = new Map<StatKey, number>(
	OPT_STAT_KEYS.map((key, idx) => [key, idx])
);

const BASE_MIN_KG = 0.1;
const BASE_MAX_KG = 2.8;

interface StatVector {
	base: Float64Array;
	flat: Float64Array;
	boost: Float64Array;
	mult: Float64Array;
}

function createEmptyVector(): StatVector {
	const mult = new Float64Array(STAT_COUNT);
	mult.fill(1);
	return {
		base: new Float64Array(STAT_COUNT),
		flat: new Float64Array(STAT_COUNT),
		boost: new Float64Array(STAT_COUNT),
		mult
	};
}

function addStatMapToArr(target: Float64Array, map?: StatMap): void {
	if (!map) return;
	for (let i = 0; i < STAT_COUNT; i++) {
		const val = map[OPT_STAT_KEYS[i]];
		if (val !== undefined) target[i] += val;
	}
}

function vectorFromStatModifiers(mods?: StatModifiers): StatVector {
	const vec = createEmptyVector();
	if (!mods) return vec;
	addStatMapToArr(vec.base, mods.base);
	addStatMapToArr(vec.flat, mods.flats);
	addStatMapToArr(vec.boost, mods.boosts);
	if (mods.multipliers) {
		for (let i = 0; i < STAT_COUNT; i++) {
			const factor = mods.multipliers[OPT_STAT_KEYS[i]];
			if (factor !== undefined) vec.mult[i] *= factor;
		}
	}
	return vec;
}

function addVectorInPlace(acc: StatVector, vec: StatVector, sign: 1 | -1): void {
	for (let i = 0; i < STAT_COUNT; i++) {
		acc.base[i] += sign * vec.base[i];
		acc.flat[i] += sign * vec.flat[i];
		acc.boost[i] += sign * vec.boost[i];
		if (vec.mult[i] !== 1) {
			if (sign === 1) {
				acc.mult[i] *= vec.mult[i];
			} else {
				acc.mult[i] /= vec.mult[i];
			}
		}
	}
}

function addBoostMapInPlace(acc: StatVector, map: StatMap | undefined, sign: 1 | -1): void {
	if (!map) return;
	for (let i = 0; i < STAT_COUNT; i++) {
		const val = map[OPT_STAT_KEYS[i]];
		if (val !== undefined) acc.boost[i] += sign * val;
	}
}

interface EvalScore {
	rate: number;
	weightProb: number;
	sizeBoostPct: number;
	rollsPerSecond: number;
	toughness: number;
}

function compareScores(a: EvalScore, b: EvalScore): number {
	// Strictly feasible beats infeasible, and higher rate always wins
	const aPos = a.rate > 0;
	const bPos = b.rate > 0;
	if (aPos !== bPos) return aPos ? 1 : -1;

	if (aPos && bPos) {
		const relTol = Math.max(a.rate, b.rate) * 1e-12;
		if (Math.abs(a.rate - b.rate) > relTol) {
			return a.rate > b.rate ? 1 : -1;
		}
		if (Math.abs(a.toughness - b.toughness) > 1e-9) {
			return a.toughness > b.toughness ? 1 : -1;
		}
		return 0;
	}

	// Both infeasible (rate === 0): climb sizeBoost if weight is the blocker
	if (a.weightProb === 0 || b.weightProb === 0) {
		if (Math.abs(a.sizeBoostPct - b.sizeBoostPct) > 1e-9) {
			return a.sizeBoostPct > b.sizeBoostPct ? 1 : -1;
		}
	}
	if (Math.abs(a.rollsPerSecond - b.rollsPerSecond) > 1e-12) {
		return a.rollsPerSecond > b.rollsPerSecond ? 1 : -1;
	}
	if (Math.abs(a.toughness - b.toughness) > 1e-9) {
		return a.toughness > b.toughness ? 1 : -1;
	}
	return 0;
}

interface ModifierPrecomp {
	active: boolean;
	mode: 'none' | 'any' | 'treasured' | 'crystalline' | 'voidtorn' | 'impossible' | 'pool';
	prevCum: number;
	currCum: number;
	lowerCum: number;
	isTopTier: boolean;
	eventMult1: number;
	eventMult2: number;
}

const MODIFIERS_BY_ID = new Map<string, MineralModifier>(MODIFIERS.map((m) => [m.id, m]));
const MINERALS_BY_NAME = new Map<string, MineralEntry>(
	MINERALS.map((m) => [m.mineral.toLowerCase(), m])
);

function buildModifierPrecomp(
	targetModifierId: string | null,
	isChestOnly: boolean,
	isNight: boolean,
	solarMagnifier: boolean,
	modifierSurge: boolean
): ModifierPrecomp {
	const eventMult1 = (solarMagnifier ? 2 : 1) * (modifierSurge ? 2 : 1);
	const eventMult2 = modifierSurge ? 2 : 1;

	if (!targetModifierId) {
		return {
			active: false,
			mode: 'none',
			prevCum: 0,
			currCum: 0,
			lowerCum: 0,
			isTopTier: false,
			eventMult1,
			eventMult2
		};
	}
	if (targetModifierId === 'any') {
		return {
			active: true,
			mode: 'any',
			prevCum: 0,
			currCum: 1,
			lowerCum: 1,
			isTopTier: false,
			eventMult1,
			eventMult2
		};
	}

	const mod = MODIFIERS_BY_ID.get(targetModifierId);
	if (!mod) {
		return {
			active: false,
			mode: 'none',
			prevCum: 0,
			currCum: 0,
			lowerCum: 0,
			isTopTier: false,
			eventMult1,
			eventMult2
		};
	}
	if (mod.id === 'treasured') {
		return {
			active: true,
			mode: isChestOnly ? 'treasured' : 'impossible',
			prevCum: 0,
			currCum: 1,
			lowerCum: 1,
			isTopTier: false,
			eventMult1,
			eventMult2
		};
	}
	if (isChestOnly) {
		return {
			active: true,
			mode: 'impossible',
			prevCum: 0,
			currCum: 0,
			lowerCum: 0,
			isTopTier: false,
			eventMult1,
			eventMult2
		};
	}
	if (mod.id === 'crystalline') {
		return {
			active: true,
			mode: 'crystalline',
			prevCum: 0,
			currCum: 0.1,
			lowerCum: 0.1,
			isTopTier: false,
			eventMult1,
			eventMult2
		};
	}
	if (mod.id === 'voidtorn') {
		return {
			active: true,
			mode: 'voidtorn',
			prevCum: 0,
			currCum: 0.05,
			lowerCum: 0.05,
			isTopTier: false,
			eventMult1,
			eventMult2
		};
	}
	if (mod.source === 'night' && !isNight) {
		return {
			active: true,
			mode: 'impossible',
			prevCum: 0,
			currCum: 0,
			lowerCum: 0,
			isTopTier: false,
			eventMult1,
			eventMult2
		};
	}

	const pool = MODIFIERS.filter(
		(m) => m.source === 'panning' || (m.source === 'night' && isNight)
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

	return { active: true, mode: 'pool', prevCum, currCum, lowerCum, isTopTier, eventMult1, eventMult2 };
}

function probAtLeastRank(cumProb: number, luckRolls: number): number {
	if (cumProb <= 0) return 0;
	if (cumProb >= 1) return 1;
	return 1 - Math.exp(luckRolls * Math.log1p(-cumProb));
}

function round2(n: number): number {
	return Math.round(n * 100) / 100;
}

function evalScoreFromAcc(
	acc: StatVector,
	options: OptimizerOptions,
	baseRollProb: number | null,
	isChestOnly: boolean,
	modPrecomp: ModifierPrecomp,
	hasPan: boolean,
	trinketId: string | null,
	hasPurityRune: boolean,
	hasSummitSeeker: boolean,
	hasBunny: boolean,
	hasEqualizer: boolean,
	hasCrystalTouch: boolean,
	hasVoidTouched: boolean,
	hasMastered: boolean,
	digCritChance: number
): EvalScore {
	const q = getDigQualityMultipliers(options.timeMethod, hasMastered);

	const rawCap =
		(acc.base[S_CAPACITY] + acc.flat[S_CAPACITY]) *
		(1 + acc.boost[S_CAPACITY]) *
		acc.mult[S_CAPACITY];
	const capacity = Math.max(1, round2(rawCap));
	const capacityFinal = Math.max(0, rawCap);

	const walkSpeedFinal =
		(acc.base[S_WALK_SPEED] + acc.flat[S_WALK_SPEED]) *
		(1 + acc.boost[S_WALK_SPEED]) *
		acc.mult[S_WALK_SPEED];
	const summitBonus = hasSummitSeeker ? Math.max(0, walkSpeedFinal) * 0.05 : 0;

	const jumpPowerFinal =
		(acc.base[S_JUMP_POWER] + acc.flat[S_JUMP_POWER]) *
		(1 + acc.boost[S_JUMP_POWER]) *
		acc.mult[S_JUMP_POWER];
	const bunnyBonus = hasBunny ? Math.max(0, jumpPowerFinal) * 0.05 : 0;

	const rawModBoost =
		(acc.boost[S_MOD_BOOST] + bunnyBonus + acc.base[S_MOD_BOOST] + acc.flat[S_MOD_BOOST]) *
		acc.mult[S_MOD_BOOST];
	const modifierBoostPct = Math.max(0, Math.round(rawModBoost * 100));

	// Pan Trinket luck adjustments (only when a Pan is equipped)
	const activeTrinketId = hasPan ? trinketId : null;
	let trinketBaseLuck = 0;
	let trinketLuckBoost = 0;
	const trinketLuckMult = activeTrinketId === 'senet-die' ? 4 / 3 : 1;
	if (activeTrinketId === 'nomads-compass') {
		trinketLuckBoost = 0.15;
	} else if (activeTrinketId === 'mass-reactor' && capacityFinal > 0) {
		trinketBaseLuck = 25 * Math.max(0, Math.sqrt(capacityFinal) - 20);
	} else if (activeTrinketId === 'beach-umbrella' && capacityFinal > 0 && !hasPurityRune) {
		const effMB1Trinket = (100 + modifierBoostPct) * modPrecomp.eventMult1;
		const anyModTrinket = Math.min(0.994, (effMB1Trinket / 1680) * 0.994);
		trinketBaseLuck = 25 * Math.sqrt(capacityFinal) * anyModTrinket;
	}

	const rawLuck =
		(acc.base[S_LUCK] + trinketBaseLuck + acc.flat[S_LUCK]) *
		(1 + acc.boost[S_LUCK] + trinketLuckBoost) *
		(acc.mult[S_LUCK] * trinketLuckMult);
	const rawNightLuck =
		options.isNight
			? (acc.base[S_NIGHT_LUCK] + acc.flat[S_NIGHT_LUCK]) *
				(1 + acc.boost[S_NIGHT_LUCK]) *
				(acc.mult[S_NIGHT_LUCK] * trinketLuckMult)
			: 0;
	const luck = Math.max(0, round2((rawLuck + rawNightLuck) * q.luckMultiplier));

	const rawShakeStr =
		(acc.base[S_SHAKE_STR] + acc.flat[S_SHAKE_STR]) *
		(1 + acc.boost[S_SHAKE_STR]) *
		acc.mult[S_SHAKE_STR];
	const shakeStrength = rawShakeStr > 0 ? round2(rawShakeStr) : 1;

	let rawShakeSpd =
		(acc.base[S_SHAKE_SPD] + acc.flat[S_SHAKE_SPD]) *
		(1 + acc.boost[S_SHAKE_SPD] + summitBonus) *
		acc.mult[S_SHAKE_SPD];
	let rawDigSpd =
		(acc.base[S_DIG_SPD] + acc.flat[S_DIG_SPD]) *
		(1 + acc.boost[S_DIG_SPD] + summitBonus) *
		acc.mult[S_DIG_SPD];
	if (hasEqualizer) {
		const avgSpd = (rawDigSpd + rawShakeSpd) / 2;
		rawDigSpd = avgSpd;
		rawShakeSpd = avgSpd;
	}
	const shakeSpeedPct = rawShakeSpd > 0 ? Math.round(rawShakeSpd * 100) : 100;

	const rawDigStr =
		(acc.base[S_DIG_STR] + acc.flat[S_DIG_STR]) * (1 + acc.boost[S_DIG_STR]) * acc.mult[S_DIG_STR];
	const effectiveDigStr = rawDigStr * q.digStrengthMultiplier;
	const digsToFill =
		effectiveDigStr > 0 ? round2(expectedDigsToFill(capacity, effectiveDigStr, digCritChance)) : 3;

	const digSpeedPct = rawDigSpd > 0 ? Math.round(rawDigSpd * 100) : 100;

	const toughness =
		(acc.base[S_TOUGHNESS] + acc.flat[S_TOUGHNESS]) *
		(1 + acc.boost[S_TOUGHNESS]) *
		acc.mult[S_TOUGHNESS];

	const rawSizeBoost =
		(acc.boost[S_SIZE_BOOST] + acc.base[S_SIZE_BOOST] + acc.flat[S_SIZE_BOOST]) *
		acc.mult[S_SIZE_BOOST];
	const sizeBoostPct = Math.max(0, Math.round(rawSizeBoost * 100));

	// Cycle time & rolls per pan
	const shakesPerSecond = shakeSpeedToR(shakeSpeedPct);
	let cycleSeconds = Infinity;
	if (shakesPerSecond > 0) {
		const shakeDuration = capacity / Math.max(0.0001, shakeStrength) / shakesPerSecond;
		const digDuration = 143.9 * Math.pow(Math.max(0.0001, digSpeedPct), -0.9324);
		cycleSeconds =
			options.timeMethod === 'autopan'
				? shakeDuration + 1.15 + digsToFill * digDuration
				: shakeDuration + 0.75 + Math.max(0, digsToFill - 1) * digDuration;
	}
	const rollsPerPan = luck * Math.sqrt(capacity);
	const rollsPerSecond =
		Number.isFinite(cycleSeconds) && cycleSeconds > 0 ? rollsPerPan / cycleSeconds : 0;

	// Weight probability
	let weightProb = 1;
	const targetKg = Number(options.minWeightKg);
	if (Number.isFinite(targetKg) && targetKg > 0) {
		const eventWeightMult =
			(options.solarMagnifier ? 1.5 : 1) * (options.volcanicEruption ? 1.5 : 1);
		const weightMultiplier = (1 + sizeBoostPct / 100) * eventWeightMult;
		const requiredBaseKg = targetKg / weightMultiplier;
		if (requiredBaseKg <= BASE_MIN_KG) {
			weightProb = 1;
		} else if (requiredBaseKg >= BASE_MAX_KG) {
			weightProb = 0;
		} else {
			const u = (requiredBaseKg - BASE_MIN_KG) / (BASE_MAX_KG - BASE_MIN_KG);
			const capC = Math.max(5, capacity);
			const tailAt = (c: number): number => 1 - Math.pow(u, 0.24 + 4.3 * (1 - Math.exp(-c / 3500)));
			weightProb = Math.min(
				1,
				Math.max(0, 0.25 * tailAt(5) + 0.25 * tailAt(Math.max(5, capC / 2)) + 0.5 * tailAt(capC))
			);
		}
	}

	// Modifier probability
	let modifierProb = 1;
	if (modPrecomp.active) {
		if (hasPurityRune || modPrecomp.mode === 'impossible') {
			modifierProb = 0;
		} else if (modPrecomp.mode === 'treasured') {
			modifierProb = 1;
		} else if (modPrecomp.mode === 'crystalline') {
			modifierProb = hasCrystalTouch ? 0.1 : 0;
		} else if (modPrecomp.mode === 'voidtorn') {
			modifierProb = hasVoidTouched ? 0.05 : 0;
		} else {
			const panelMB = 100 + modifierBoostPct;
			const effMB1 = panelMB * modPrecomp.eventMult1;
			const anyModifierChance = Math.min(0.994, (effMB1 / 1680) * 0.994);
			if (modPrecomp.mode === 'any') {
				modifierProb = isChestOnly ? 1 : anyModifierChance;
			} else {
				const effMB2 = panelMB * modPrecomp.eventMult2;
				const modifierLuck = 1 + Math.min(50, luck / 1000) + effMB2 / 10;
				const shareRangeAt = (lo: number, hi: number, L: number): number =>
					Math.max(0, probAtLeastRank(hi, L) - probAtLeastRank(lo, L));
				const baseConditionalShare =
					0.25 * shareRangeAt(modPrecomp.prevCum, modPrecomp.currCum, 1) +
					0.25 * shareRangeAt(modPrecomp.prevCum, modPrecomp.currCum, Math.max(1, modifierLuck / 2)) +
					0.5 * shareRangeAt(modPrecomp.prevCum, modPrecomp.currCum, modifierLuck);
				let conditionalShare = baseConditionalShare;
				if (activeTrinketId === 'alchemists-crucible') {
					const lowerConditionalShare =
						modPrecomp.lowerCum > modPrecomp.currCum
							? 0.25 * shareRangeAt(modPrecomp.currCum, modPrecomp.lowerCum, 1) +
								0.25 * shareRangeAt(modPrecomp.currCum, modPrecomp.lowerCum, Math.max(1, modifierLuck / 2)) +
								0.5 * shareRangeAt(modPrecomp.currCum, modPrecomp.lowerCum, modifierLuck)
							: 0;
					conditionalShare =
						(modPrecomp.isTopTier ? 1 : 0.9) * baseConditionalShare + 0.1 * lowerConditionalShare;
				}
				modifierProb = Math.min(1, Math.max(0, anyModifierChance * conditionalShare));
			}
		}
	}

	const combinedCond = weightProb * modifierProb;

	if (isChestOnly) {
		const bp = baseRollProb ?? 0;
		return {
			rate: bp * combinedCond,
			weightProb,
			sizeBoostPct,
			rollsPerSecond,
			toughness
		};
	}

	if (baseRollProb !== null && baseRollProb > 0) {
		const effRollProb = Math.min(0.999999999, baseRollProb * combinedCond);
		const rate =
			effRollProb > 0 && Number.isFinite(cycleSeconds) && cycleSeconds > 0
				? (-Math.log1p(-effRollProb) * rollsPerPan) / cycleSeconds
				: 0;
		return {
			rate,
			weightProb,
			sizeBoostPct,
			rollsPerSecond,
			toughness
		};
	}

	const rate = rollsPerSecond * combinedCond;
	return {
		rate,
		weightProb,
		sizeBoostPct,
		rollsPerSecond,
		toughness
	};
}

interface PanPairCandidate {
	pan: Pan | null;
	enchant: Enchant | null;
	vec: StatVector;
}

interface ShovelPairCandidate {
	shovel: Shovel | null;
	enchant: Enchant | null;
	vec: StatVector;
	hasCrystalTouch: boolean;
	hasVoidTouched: boolean;
	hasMastered: boolean;
	digCritChance: number;
}

interface JewelryCandidate {
	selection: EquippedJewelrySelection;
	item: EquipmentItem;
	isUnique: boolean;
	vec: StatVector;
}

interface MuseumOreCandidate {
	ore: MuseumOreEntry;
	weightKg: number;
	boosts: StatMap;
}

interface MuseumRiderCandidate {
	rider: MuseumModifierRider | null;
	boosts: StatMap;
}

interface RuneSubsetCandidate {
	runeIds: string[];
	hasPurity: boolean;
	hasSummitSeeker: boolean;
	hasBunny: boolean;
	hasEqualizer: boolean;
	digCritChance: number;
	vec: StatVector;
}

interface BoostCandidate {
	boost: BoostSource;
	vec: StatVector;
}

function buildPanPairCandidates(
	bannedPanIds: ReadonlySet<string>,
	bannedPanEnchantIds: ReadonlySet<string>
): { candidates: PanPairCandidate[]; allPansBannedWarning: string | null } {
	const panEnchants: Array<Enchant | null> = [
		null,
		...ENCHANTS.filter((e) => e.target === 'pan' && !bannedPanEnchantIds.has(e.id))
	];
	const allowedPans = PANS.filter((p) => !bannedPanIds.has(p.id));
	if (allowedPans.length === 0) {
		return {
			candidates: [{ pan: null, enchant: null, vec: createEmptyVector() }],
			allPansBannedWarning: 'All Pans have been banned for this search.'
		};
	}

	const list: PanPairCandidate[] = [];
	for (const pan of allowedPans) {
		for (const enchant of panEnchants) {
			const vec = createEmptyVector();
			const mult = enchant?.modifiers.multipliers;
			vec.base[S_LUCK] = pan.stats.luck * (mult?.luck ?? 1);
			vec.base[S_CAPACITY] = pan.stats.capacity * (mult?.capacity ?? 1);
			vec.base[S_SHAKE_STR] = pan.stats.shakeStrength * (mult?.shakeStrength ?? 1);
			vec.base[S_SHAKE_SPD] = pan.stats.shakeSpeed * (mult?.shakeSpeed ?? 1);
			if (enchant) {
				addStatMapToArr(vec.base, enchant.modifiers.base);
				addStatMapToArr(vec.flat, enchant.modifiers.flats);
				addStatMapToArr(vec.boost, enchant.modifiers.boosts);
			}
			list.push({ pan, enchant, vec });
		}
	}
	return { candidates: list, allPansBannedWarning: null };
}

function buildShovelPairCandidates(
	targetModifierId: string | null,
	minToughness: number,
	shovelEnchantMode: OptimizerShovelEnchantMode,
	bannedShovelIds: ReadonlySet<string>,
	bannedShovelEnchantIds: ReadonlySet<string>
): {
	candidates: ShovelPairCandidate[];
	toughnessFallbackWarning: string | null;
	shovelConflictWarning: string | null;
} {
	const requiredEnchantId =
		targetModifierId === 'crystalline'
			? 'shovel-crystal-touch'
			: targetModifierId === 'voidtorn'
				? 'shovel-void-touched'
				: null;

	const normalizedModeId =
		shovelEnchantMode === 'mastered' ? 'shovel-mastered' : shovelEnchantMode;

	let allowedEnchants: Array<Enchant | null>;
	let shovelConflictWarning: string | null = null;

	const defaultAutoEnchants: Array<Enchant | null> = [
		null,
		...ENCHANTS.filter(
			(e) =>
				e.target === 'shovel' &&
				(e.id === 'shovel-overdrive' ||
					e.id === 'shovel-toughened' ||
					e.id === 'shovel-mastered')
		)
	];

	if (normalizedModeId === 'none') {
		allowedEnchants = [null];
	} else if (normalizedModeId !== 'auto') {
		const locked = ENCHANTS.find((e) => e.target === 'shovel' && e.id === normalizedModeId);
		if (locked) {
			allowedEnchants = [locked];
			if (requiredEnchantId && locked.id !== requiredEnchantId) {
				const reqName =
					requiredEnchantId === 'shovel-crystal-touch' ? 'Crystal Touch' : 'Void Touched';
				const modName = targetModifierId === 'crystalline' ? 'Crystalline' : 'Voidtorn';
				shovelConflictWarning = `${modName} requires the ${reqName} Shovel Enchant, but ${locked.name} is locked (max 1 enchant per Shovel).`;
			}
		} else {
			allowedEnchants = requiredEnchantId
				? ENCHANTS.filter((e) => e.id === requiredEnchantId)
				: defaultAutoEnchants;
		}
	} else {
		allowedEnchants = requiredEnchantId
			? ENCHANTS.filter((e) => e.id === requiredEnchantId)
			: defaultAutoEnchants;
	}

	if (normalizedModeId === 'none' && requiredEnchantId) {
		const reqName =
			requiredEnchantId === 'shovel-crystal-touch' ? 'Crystal Touch' : 'Void Touched';
		const modName = targetModifierId === 'crystalline' ? 'Crystalline' : 'Voidtorn';
		shovelConflictWarning = `${modName} requires the ${reqName} Shovel Enchant, but Shovel Enchant is set to none.`;
	}

	allowedEnchants = allowedEnchants.filter((e) => e === null || !bannedShovelEnchantIds.has(e.id));
	if (allowedEnchants.length === 0) {
		allowedEnchants = [null];
		if (requiredEnchantId && bannedShovelEnchantIds.has(requiredEnchantId) && !shovelConflictWarning) {
			const reqName =
				requiredEnchantId === 'shovel-crystal-touch' ? 'Crystal Touch' : 'Void Touched';
			const modName = targetModifierId === 'crystalline' ? 'Crystalline' : 'Voidtorn';
			shovelConflictWarning = `${modName} requires the ${reqName} enchant, which has been banned for this search.`;
		}
	}

	const allowedShovels = SHOVELS.filter((s) => !bannedShovelIds.has(s.id));
	if (allowedShovels.length === 0) {
		return {
			candidates: [
				{
					shovel: null,
					enchant: null,
					vec: createEmptyVector(),
					hasCrystalTouch: false,
					hasVoidTouched: false,
					hasMastered: false,
					digCritChance: 0
				}
			],
			toughnessFallbackWarning: 'All Shovels have been banned for this search.',
			shovelConflictWarning
		};
	}

	const allPairs: ShovelPairCandidate[] = [];
	for (const shovel of allowedShovels) {
		for (const enchant of allowedEnchants) {
			const vec = createEmptyVector();
			vec.base[S_DIG_STR] = shovel.stats.digStrength;
			vec.base[S_DIG_SPD] = shovel.stats.digSpeed;
			vec.base[S_TOUGHNESS] = shovel.stats.toughness;
			if (enchant) {
				const ev = vectorFromStatModifiers(enchant.modifiers);
				addVectorInPlace(vec, ev, 1);
			}
			allPairs.push({
				shovel,
				enchant,
				vec,
				hasCrystalTouch: enchant?.id === 'shovel-crystal-touch',
				hasVoidTouched: enchant?.id === 'shovel-void-touched',
				hasMastered: enchant?.id === 'shovel-mastered',
				digCritChance: enchant?.id === 'shovel-overdrive' ? 0.6 : 0
			});
		}
	}

	if (minToughness <= 0) {
		return { candidates: allPairs, toughnessFallbackWarning: null, shovelConflictWarning };
	}

	const filtered = allPairs.filter((p) => p.vec.base[S_TOUGHNESS] + p.vec.flat[S_TOUGHNESS] >= minToughness);
	if (filtered.length > 0) {
		return { candidates: filtered, toughnessFallbackWarning: null, shovelConflictWarning };
	}

	// Find maximum achievable toughness among allowed shovel pairs
	let maxT = 0;
	for (const p of allPairs) {
		const t = p.vec.base[S_TOUGHNESS] + p.vec.flat[S_TOUGHNESS];
		if (t > maxT) maxT = t;
	}
	return {
		candidates: allPairs.filter((p) => p.vec.base[S_TOUGHNESS] + p.vec.flat[S_TOUGHNESS] >= maxT),
		toughnessFallbackWarning: `Minimum Toughness required (${minToughness}) exceeds the highest available (${maxT}); using the highest available.`,
		shovelConflictWarning
	};
}

function buildTrinketCandidates(
	trinketMode: OptimizerTrinketMode,
	targetUsesModifierPool: boolean,
	bannedTrinketIds: ReadonlySet<string>
): Array<PanTrinket | null> {
	if (trinketMode === 'none') return [null];
	if (trinketMode !== 'auto') {
		const locked = TRINKETS.find((t) => t.id === trinketMode);
		if (locked && !bannedTrinketIds.has(locked.id)) {
			return [locked];
		}
		return [null];
	}
	const relevantIds = new Set<string>(['senet-die', 'beach-umbrella', 'mass-reactor', 'nomads-compass']);
	if (targetUsesModifierPool) {
		relevantIds.add('alchemists-crucible');
	}
	return [null, ...TRINKETS.filter((t) => relevantIds.has(t.id) && !bannedTrinketIds.has(t.id))];
}

function buildMutationPool(
	mutationMode: OptimizerMutationMode,
	bannedMutationIds: ReadonlySet<string>
): Array<EquipmentMutation | null> {
	if (mutationMode === 'none') return [null];
	if (mutationMode === 'auto') {
		return [...MUTATIONS.filter((m) => !bannedMutationIds.has(m.id)), null];
	}
	const exists = MUTATIONS.find((m) => m.id === mutationMode);
	if (exists) {
		return bannedMutationIds.has(exists.id) ? [null] : [exists];
	}
	return [...MUTATIONS.filter((m) => !bannedMutationIds.has(m.id)), null];
}

function buildJewelryCandidates(
	slot: 'necklace' | 'charm' | 'ring',
	tier: EquipmentTier,
	rollQuality: number,
	mutationPool: Array<EquipmentMutation | null>,
	bannedEquipmentIds: ReadonlySet<string>
): JewelryCandidate[] {
	const items = EQUIPMENT.filter((e) => e.slot === slot && !bannedEquipmentIds.has(e.id));
	const list: JewelryCandidate[] = [];
	for (const item of items) {
		const isUnique = isUniqueOnlyEquipment(item);
		for (const mut of mutationPool) {
			const mods = resolveEquipmentModifiers(item, tier, rollQuality, mut);
			list.push({
				selection: {
					itemId: item.id,
					tier,
					rollQuality,
					mutationId: mut?.id ?? null
				},
				item,
				isUnique,
				vec: vectorFromStatModifiers(mods)
			});
		}
	}
	return list;
}

function buildRuneSubsets(
	optimizeRunes: boolean,
	maxRunes: number,
	allowPurity: boolean,
	isNight: boolean,
	targetUsesModifierBoost: boolean,
	bannedRuneIds: ReadonlySet<string>
): RuneSubsetCandidate[] {
	if (!optimizeRunes || maxRunes <= 0) {
		return [
			{
				runeIds: [],
				hasPurity: false,
				hasSummitSeeker: false,
				hasBunny: false,
				hasEqualizer: false,
				digCritChance: 0,
				vec: createEmptyVector()
			}
		];
	}
	const relevantRunes: Rune[] = RUNES.filter((r) => {
		if (bannedRuneIds.has(r.id)) return false;
		if (r.id === 'purity') return allowPurity;
		if (r.id === 'sunblessed') return !isNight;
		if (r.id === 'abyssal') return isNight;
		if (
			r.id === 'critical-i' ||
			r.id === 'critical-ii' ||
			r.id === 'summit-seeker' ||
			r.id === 'equalizer' ||
			r.id === 'mountain-climber' ||
			r.id === 'speed-i'
		) {
			return true;
		}
		if (r.id === 'bunny') return targetUsesModifierBoost;
		const mods = r.modifiers;
		const keys = [
			...Object.keys(mods.base ?? {}),
			...Object.keys(mods.flats ?? {}),
			...Object.keys(mods.boosts ?? {})
		] as StatKey[];
		return keys.some((k) => STAT_INDEX_BY_KEY.has(k));
	});

	const subsets: RuneSubsetCandidate[] = [
		{
			runeIds: [],
			hasPurity: false,
			hasSummitSeeker: false,
			hasBunny: false,
			hasEqualizer: false,
			digCritChance: 0,
			vec: createEmptyVector()
		}
	];
	const n = relevantRunes.length;
	const cap = Math.min(maxRunes, n);
	for (let mask = 1; mask < 1 << n; mask++) {
		const picked: Rune[] = [];
		for (let i = 0; i < n; i++) {
			if (mask & (1 << i)) picked.push(relevantRunes[i]);
		}
		if (picked.length > cap) continue;

		let hasSummitSeeker = false;
		let hasWalkSpeedRune = false;
		for (const r of picked) {
			if (r.id === 'summit-seeker') hasSummitSeeker = true;
			if (r.id === 'mountain-climber' || r.id === 'speed-i') hasWalkSpeedRune = true;
		}
		// WalkSpeed-only runes contribute zero panning speed without Summit Seeker
		if (hasWalkSpeedRune && !hasSummitSeeker) continue;

		const vec = createEmptyVector();
		let digCritChance = 0;
		let hasPurity = false;
		let hasBunny = false;
		let hasEqualizer = false;
		for (const r of picked) {
			if (r.id === 'abyssal') {
				if (isNight) vec.boost[S_LUCK] += 0.2;
			} else if (r.id === 'sunblessed') {
				if (!isNight) addVectorInPlace(vec, vectorFromStatModifiers(r.modifiers), 1);
			} else {
				addVectorInPlace(vec, vectorFromStatModifiers(r.modifiers), 1);
			}
			if (r.id === 'purity') hasPurity = true;
			if (r.id === 'bunny') hasBunny = true;
			if (r.id === 'equalizer') hasEqualizer = true;
			if (r.id === 'critical-i' || r.id === 'critical-ii') digCritChance += 0.2;
		}
		subsets.push({
			runeIds: picked.map((r) => r.id),
			hasPurity,
			hasSummitSeeker,
			hasBunny,
			hasEqualizer,
			digCritChance: Math.min(1, digCritChance),
			vec
		});
	}
	return subsets;
}

function buildMuseumCandidates(
	weightPct: number,
	riderMode: OptimizerMuseumRiderMode,
	bannedOreIds: ReadonlySet<string>,
	bannedRiderIds: ReadonlySet<string>
): {
	oresByRarity: Record<MuseumRarity, MuseumOreCandidate[]>;
	ridersByRarity: Record<MuseumRarity, MuseumRiderCandidate[]>;
} {
	const ratio = Math.min(1, Math.max(0, weightPct / 100));
	const oresByRarity = {} as Record<MuseumRarity, MuseumOreCandidate[]>;
	const ridersByRarity = {} as Record<MuseumRarity, MuseumRiderCandidate[]>;

	const baseRiders: Array<MuseumModifierRider | null> =
		riderMode === 'none'
			? [null]
			: riderMode === 'panning_only'
				? [
						...MUSEUM_MODIFIER_RIDERS.filter((r) => r.id !== 'treasured' && r.id !== 'entombed'),
						null
					]
				: [...MUSEUM_MODIFIER_RIDERS, null];

	const allowedRiders = baseRiders.filter((r) => r === null || !bannedRiderIds.has(r.id));

	for (const rarity of MUSEUM_RARITIES_DESC) {
		oresByRarity[rarity] = MUSEUM_ORES.filter(
			(o) => o.rarity === rarity && !bannedOreIds.has(o.id)
		).map((ore) => {
			const boosts: StatMap = {};
			for (const key of OPT_STAT_KEYS) {
				const maxVal = ore.maxBoosts[key];
				if (maxVal !== undefined) boosts[key] = maxVal * ratio;
			}
			return {
				ore,
				weightKg: Math.round(ore.minKg * ratio * 100) / 100,
				boosts
			};
		});

		const rm = MUSEUM_RARITY_MULTIPLIERS[rarity];
		ridersByRarity[rarity] = allowedRiders
			.map((rider) => {
				if (!rider) return { rider: null, boosts: {} };
				const boosts: StatMap = {};
				const step = rm * rider.multiplierFactor;
				for (const stat of rider.stats) {
					if (STAT_INDEX_BY_KEY.has(stat)) {
						boosts[stat] = (boosts[stat] ?? 0) + step;
					}
				}
				return { rider, boosts };
			})
			.filter((rc) => rc.rider === null || Object.keys(rc.boosts).length > 0);
	}

	return { oresByRarity, ridersByRarity };
}

function buildBoostCandidates(
	includeTotems: boolean,
	potionMode: OptimizerPotionMode,
	bannedBoostIds: ReadonlySet<string>
): BoostCandidate[] {
	const list: BoostCandidate[] = [];
	for (const boost of BOOST_SOURCES) {
		if (bannedBoostIds.has(boost.id)) continue;
		if (boost.category === 'totem' && !includeTotems) continue;
		if (boost.category === 'potion') {
			if (potionMode === 'none') continue;
			if (potionMode === 'shop_cash' && !isShopCashPotion(boost)) continue;
			if (potionMode === 'cash_all' && !isCashPurchasablePotion(boost)) continue;
		}
		if (boost.category !== 'totem' && boost.category !== 'potion') continue;
		const vec = vectorFromStatModifiers(boost.modifiers);
		// Include only boosts that touch at least one tracked panning/digging stat
		let touches = false;
		for (let i = 0; i < STAT_COUNT; i++) {
			if (vec.base[i] !== 0 || vec.flat[i] !== 0 || vec.boost[i] !== 0 || vec.mult[i] !== 1) {
				touches = true;
				break;
			}
		}
		if (touches) list.push({ boost, vec });
	}
	return list;
}

type SeedStrategy = 'luck' | 'size' | 'modifier' | 'speed';

function scoreCandidateForSeed(vec: StatVector, strategy: SeedStrategy): number {
	if (strategy === 'size') {
		return (
			(vec.boost[S_SIZE_BOOST] + vec.base[S_SIZE_BOOST]) * 5000 +
			vec.base[S_CAPACITY] * 2 +
			vec.flat[S_LUCK] +
			vec.base[S_LUCK] * 0.5
		);
	}
	if (strategy === 'modifier') {
		return (
			(vec.boost[S_MOD_BOOST] + vec.base[S_MOD_BOOST]) * 5000 +
			(vec.base[S_JUMP_POWER] + vec.flat[S_JUMP_POWER]) * 120 +
			vec.flat[S_LUCK] +
			vec.base[S_LUCK] * 0.5 +
			vec.boost[S_SHAKE_SPD] * 500
		);
	}
	if (strategy === 'speed') {
		return (
			vec.base[S_CAPACITY] * 3 +
			vec.base[S_SHAKE_STR] * 40 +
			(vec.boost[S_SHAKE_SPD] + vec.base[S_SHAKE_SPD]) * 1200 +
			(vec.boost[S_DIG_SPD] + vec.base[S_DIG_SPD]) * 800 +
			(vec.base[S_WALK_SPEED] + vec.flat[S_WALK_SPEED]) * 40 +
			vec.boost[S_WALK_SPEED] * 150 +
			vec.base[S_DIG_STR] * 8 +
			vec.base[S_LUCK]
		);
	}
	return (
		(vec.base[S_LUCK] + vec.flat[S_LUCK]) * 2 +
		vec.boost[S_LUCK] * 4000 +
		(vec.mult[S_LUCK] - 1) * 3000 +
		vec.base[S_CAPACITY] * 0.5
	);
}

function scoreBoostMapForSeed(map: StatMap, strategy: SeedStrategy): number {
	if (strategy === 'size') {
		return (map.sizeBoost ?? 0) * 100 + (map.capacity ?? 0) * 5 + (map.luck ?? 0);
	}
	if (strategy === 'modifier') {
		return (map.modifierBoost ?? 0) * 100 + (map.luck ?? 0) + (map.shakeSpeed ?? 0) * 2;
	}
	if (strategy === 'speed') {
		return (
			(map.capacity ?? 0) * 10 +
			(map.shakeSpeed ?? 0) * 10 +
			(map.digSpeed ?? 0) * 8 +
			(map.shakeStrength ?? 0) * 6 +
			(map.digStrength ?? 0) * 4 +
			(map.luck ?? 0)
		);
	}
	return (map.luck ?? 0) * 100 + (map.capacity ?? 0) * 5 + (map.shakeSpeed ?? 0) * 2;
}

interface InternalState {
	panIdx: number;
	trinketIdx: number;
	shovelIdx: number;
	necklaceIdx: number | null;
	charmIdx: number | null;
	ringIdx: Array<number | null>;
	runeIdx: number;
	boostActive: boolean[];
	museumOreIdx: Record<MuseumRarity, Array<number | null>>;
	museumRiderIdx: Record<MuseumRarity, Array<number | null>>;
}

function cloneState(s: InternalState): InternalState {
	const museumOreIdx = {} as Record<MuseumRarity, Array<number | null>>;
	const museumRiderIdx = {} as Record<MuseumRarity, Array<number | null>>;
	for (const r of MUSEUM_RARITIES_DESC) {
		museumOreIdx[r] = [...s.museumOreIdx[r]];
		museumRiderIdx[r] = [...s.museumRiderIdx[r]];
	}
	return {
		panIdx: s.panIdx,
		trinketIdx: s.trinketIdx,
		shovelIdx: s.shovelIdx,
		necklaceIdx: s.necklaceIdx,
		charmIdx: s.charmIdx,
		ringIdx: [...s.ringIdx],
		runeIdx: s.runeIdx,
		boostActive: [...s.boostActive],
		museumOreIdx,
		museumRiderIdx
	};
}

function pickBestIndex<T>(items: T[], scoreFn: (item: T) => number): number {
	let bestIdx = 0;
	let bestVal = -Infinity;
	for (let i = 0; i < items.length; i++) {
		const val = scoreFn(items[i]);
		if (val > bestVal) {
			bestVal = val;
			bestIdx = i;
		}
	}
	return bestIdx;
}

/**
 * Jointly optimizes Tools, Enchants, Jewelry (+ Mutations), Runes, optional Boosts, and Museum
 * to minimize farming time for a rare mineral (or generic rare rolls/s).
 */
export function optimizeBuildAndMuseum(rawOptions: OptimizerOptions): OptimizerResult {
	const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
	const options: OptimizerOptions = {
		...DEFAULT_OPTIMIZER_OPTIONS,
		...rawOptions,
		rollQuality: Math.min(1, Math.max(0, Number(rawOptions.rollQuality) || 0)),
		museumWeightPct: Math.min(100, Math.max(0, Number(rawOptions.museumWeightPct) || 0)),
		maxRunes: Math.min(5, Math.max(0, Math.floor(rawOptions.maxRunes ?? 5))),
		minToughness: Math.max(0, Number(rawOptions.minToughness) || 0)
	};

	// Resolve target mineral & location
	const targetMineral: MineralEntry | null =
		options.targetMode === 'specific' && options.mineralName
			? (MINERALS_BY_NAME.get(options.mineralName.toLowerCase()) ?? null)
			: null;

	const panningLocations = (targetMineral?.locations ?? [])
		.filter((l) => Number.isFinite(Number(l.chance_percent)) && Number(l.chance_percent) > 0)
		.sort((a, b) => b.chance_percent - a.chance_percent);
	const chests = [...(targetMineral?.chests ?? [])].sort(
		(a, b) => b.chance_percent - a.chance_percent
	);
	const isChestOnly = Boolean(targetMineral && panningLocations.length === 0 && chests.length > 0);

	const chosenLoc =
		panningLocations.length > 0
			? (panningLocations.find((l) => l.location === options.locationName) ?? panningLocations[0])
			: null;

	const selectedLocationName = isChestOnly
		? `${chests[0].name} (${chests[0].location})`
		: (chosenLoc?.location ?? null);
	const selectedBasePercent = isChestOnly
		? Number(chests[0].chance_percent)
		: chosenLoc
			? Number(chosenLoc.chance_percent)
			: null;
	const baseRollProb = selectedBasePercent !== null ? selectedBasePercent / 100 : null;

	const effectiveAllowPurity = options.allowPurityRune && options.targetModifierId === null;
	const modPrecomp = buildModifierPrecomp(
		options.targetModifierId,
		isChestOnly,
		options.isNight,
		options.solarMagnifier,
		options.modifierSurge
	);

	const bannedPanIds = new Set(options.bans?.panIds ?? []);
	const bannedPanEnchantIds = new Set(options.bans?.panEnchantIds ?? []);
	const bannedTrinketIds = new Set(options.bans?.trinketIds ?? []);
	const bannedShovelIds = new Set(options.bans?.shovelIds ?? []);
	const bannedShovelEnchantIds = new Set(options.bans?.shovelEnchantIds ?? []);
	const bannedEquipmentIds = new Set(options.bans?.equipmentIds ?? []);
	const bannedMutationIds = new Set(options.bans?.mutationIds ?? []);
	const bannedRuneIds = new Set(options.bans?.runeIds ?? []);
	const bannedBoostIds = new Set(options.bans?.boostIds ?? []);
	const bannedMuseumOreIds = new Set(options.bans?.museumOreIds ?? []);
	const bannedMuseumRiderIds = new Set(options.bans?.museumRiderIds ?? []);

	// Precompute candidate pools
	const { candidates: panPairs, allPansBannedWarning } = buildPanPairCandidates(
		bannedPanIds,
		bannedPanEnchantIds
	);
	const {
		candidates: shovelPairs,
		toughnessFallbackWarning,
		shovelConflictWarning
	} = buildShovelPairCandidates(
		options.targetModifierId,
		options.minToughness,
		options.shovelEnchantMode,
		bannedShovelIds,
		bannedShovelEnchantIds
	);
	const mutationPool = buildMutationPool(options.mutationMode, bannedMutationIds);
	const necklaces = buildJewelryCandidates(
		'necklace',
		options.jewelryTier,
		options.rollQuality,
		mutationPool,
		bannedEquipmentIds
	);
	const charms = buildJewelryCandidates(
		'charm',
		options.jewelryTier,
		options.rollQuality,
		mutationPool,
		bannedEquipmentIds
	);
	const rings = buildJewelryCandidates(
		'ring',
		options.jewelryTier,
		options.rollQuality,
		mutationPool,
		bannedEquipmentIds
	);
	const targetUsesModifierBoost = modPrecomp.mode === 'any' || modPrecomp.mode === 'pool';
	const targetUsesModifierPool = modPrecomp.mode === 'pool';
	const trinkets = buildTrinketCandidates(
		options.trinketMode,
		targetUsesModifierPool,
		bannedTrinketIds
	);
	const runeSubsets = buildRuneSubsets(
		options.optimizeRunes,
		options.maxRunes,
		effectiveAllowPurity,
		options.isNight,
		targetUsesModifierBoost,
		bannedRuneIds
	);
	const boostPool = buildBoostCandidates(
		options.includeTotems,
		options.potionMode,
		bannedBoostIds
	);
	const { oresByRarity, ridersByRarity } = buildMuseumCandidates(
		options.museumWeightPct,
		options.museumRiderMode,
		bannedMuseumOreIds,
		bannedMuseumRiderIds
	);

	// Fixed museum boost source vector (when museumMode === 'saved')
	const fixedMuseumVec = createEmptyVector();
	if (options.museumMode === 'saved' && options.fixedMuseum) {
		const mSum = calculateMuseumSummary(options.fixedMuseum);
		addBoostMapInPlace(fixedMuseumVec, mSum.totalBoosts, 1);
	}

	function buildAccumulator(state: InternalState): StatVector {
		const acc = createEmptyVector();
		addVectorInPlace(acc, panPairs[state.panIdx].vec, 1);
		addVectorInPlace(acc, shovelPairs[state.shovelIdx].vec, 1);
		if (state.necklaceIdx !== null) addVectorInPlace(acc, necklaces[state.necklaceIdx].vec, 1);
		if (state.charmIdx !== null) addVectorInPlace(acc, charms[state.charmIdx].vec, 1);
		for (let i = 0; i < MAX_RING_SLOTS; i++) {
			const ri = state.ringIdx[i];
			if (ri !== null) addVectorInPlace(acc, rings[ri].vec, 1);
		}
		addVectorInPlace(acc, runeSubsets[state.runeIdx].vec, 1);
		for (let i = 0; i < boostPool.length; i++) {
			if (state.boostActive[i]) addVectorInPlace(acc, boostPool[i].vec, 1);
		}
		if (options.museumMode === 'saved') {
			addVectorInPlace(acc, fixedMuseumVec, 1);
		} else if (options.museumMode === 'optimize') {
			for (const r of MUSEUM_RARITIES_DESC) {
				const count = MUSEUM_SLOT_COUNTS[r];
				for (let slotIdx = 0; slotIdx < count; slotIdx++) {
					const oreIdx = state.museumOreIdx[r][slotIdx];
					if (oreIdx !== null) addBoostMapInPlace(acc, oresByRarity[r][oreIdx].boosts, 1);
					const riderIdx = state.museumRiderIdx[r][slotIdx];
					if (riderIdx !== null) addBoostMapInPlace(acc, ridersByRarity[r][riderIdx].boosts, 1);
				}
			}
		}
		return acc;
	}

	function evalState(acc: StatVector, state: InternalState): EvalScore {
		const sh = shovelPairs[state.shovelIdx];
		const rs = runeSubsets[state.runeIdx];
		const hasPan = panPairs[state.panIdx].pan !== null;
		const trinketId = trinkets[state.trinketIdx]?.id ?? null;
		return evalScoreFromAcc(
			acc,
			options,
			baseRollProb,
			isChestOnly,
			modPrecomp,
			hasPan,
			trinketId,
			rs.hasPurity,
			rs.hasSummitSeeker,
			rs.hasBunny,
			rs.hasEqualizer,
			sh.hasCrystalTouch,
			sh.hasVoidTouched,
			sh.hasMastered,
			Math.min(1, sh.digCritChance + rs.digCritChance)
		);
	}

	function makeSeed(strategy: SeedStrategy): InternalState {
		const panIdx = pickBestIndex(panPairs, (c) => scoreCandidateForSeed(c.vec, strategy));
		const preferredTrinketIds =
			strategy === 'modifier'
				? ['alchemists-crucible', 'senet-die', 'beach-umbrella', 'mass-reactor', 'nomads-compass']
				: strategy === 'speed'
					? ['senet-die', 'beach-umbrella', 'mass-reactor', 'nomads-compass']
					: ['senet-die', 'mass-reactor', 'beach-umbrella', 'nomads-compass'];
		let trinketIdx = 0;
		for (const prefId of preferredTrinketIds) {
			const hit = trinkets.findIndex((t) => t?.id === prefId);
			if (hit !== -1) {
				trinketIdx = hit;
				break;
			}
		}
		const shovelIdx = pickBestIndex(shovelPairs, (c) => scoreCandidateForSeed(c.vec, strategy));
		const necklaceIdx =
			necklaces.length > 0 ? pickBestIndex(necklaces, (c) => scoreCandidateForSeed(c.vec, strategy)) : null;
		const charmIdx =
			charms.length > 0 ? pickBestIndex(charms, (c) => scoreCandidateForSeed(c.vec, strategy)) : null;
		const runeIdx = pickBestIndex(runeSubsets, (c) => scoreCandidateForSeed(c.vec, strategy));

		// Pick top 8 legal rings for the seed strategy
		const sortedRingIndices = rings
			.map((c, idx) => ({ idx, c, s: scoreCandidateForSeed(c.vec, strategy) }))
			.sort((a, b) => b.s - a.s);
		const ringIdx: Array<number | null> = Array.from({ length: MAX_RING_SLOTS }, () => null);
		const usedUnique = new Set<string>();
		let slotCursor = 0;
		for (const entry of sortedRingIndices) {
			if (slotCursor >= MAX_RING_SLOTS) break;
			if (entry.c.isUnique) {
				if (usedUnique.has(entry.c.item.id)) continue;
				usedUnique.add(entry.c.item.id);
				ringIdx[slotCursor++] = entry.idx;
			} else {
				// Fill remaining slots with best stackable ring if still open, after allowing better unique rings too
				while (slotCursor < MAX_RING_SLOTS) {
					ringIdx[slotCursor++] = entry.idx;
				}
				break;
			}
		}

		const museumOreIdx = {} as Record<MuseumRarity, Array<number | null>>;
		const museumRiderIdx = {} as Record<MuseumRarity, Array<number | null>>;
		for (const r of MUSEUM_RARITIES_DESC) {
			const count = MUSEUM_SLOT_COUNTS[r];
			const rOres = oresByRarity[r];
			const rRiders = ridersByRarity[r];
			const scoredPairs = rOres
				.map((o, idx) => {
					let bestRiderIdx: number | null = null;
					let bestRiderScore = -Infinity;
					for (let ri = 0; ri < rRiders.length; ri++) {
						const riderId = rRiders[ri].rider?.id ?? null;
						if (!isMuseumModifierAllowedForOre(o.ore, riderId)) continue;
						const rs = scoreBoostMapForSeed(rRiders[ri].boosts, strategy);
						if (rs > bestRiderScore) {
							bestRiderScore = rs;
							bestRiderIdx = ri;
						}
					}
					const totalScore =
						scoreBoostMapForSeed(o.boosts, strategy) +
						(Number.isFinite(bestRiderScore) ? bestRiderScore : 0);
					return { idx, bestRiderIdx, s: totalScore };
				})
				.sort((a, b) => b.s - a.s);
			museumOreIdx[r] = Array.from({ length: count }, (_, k) =>
				k < scoredPairs.length ? scoredPairs[k].idx : null
			);
			museumRiderIdx[r] = Array.from({ length: count }, (_, k) =>
				k < scoredPairs.length ? scoredPairs[k].bestRiderIdx : null
			);
		}

		return {
			panIdx,
			trinketIdx,
			shovelIdx,
			necklaceIdx,
			charmIdx,
			ringIdx,
			runeIdx,
			boostActive: boostPool.map(() => true),
			museumOreIdx,
			museumRiderIdx
		};
	}

	const strategies: SeedStrategy[] = ['luck', 'size', 'modifier', 'speed'];
	let globalBestState: InternalState | null = null;
	let globalBestScore: EvalScore = {
		rate: -1,
		weightProb: 0,
		sizeBoostPct: -1,
		rollsPerSecond: -1,
		toughness: -1
	};

	const MAX_OUTER_PASSES = 8;

	for (const strategy of strategies) {
		const state = makeSeed(strategy);
		const acc = buildAccumulator(state);
		let currentScore = evalState(acc, state);

		for (let pass = 0; pass < MAX_OUTER_PASSES; pass++) {
			let improved = false;

			// 1. Pan + Pan Enchant
			{
				const origIdx = state.panIdx;
				let bestIdx = origIdx;
				let bestScore = currentScore;
				addVectorInPlace(acc, panPairs[origIdx].vec, -1);
				for (let i = 0; i < panPairs.length; i++) {
					const cand = panPairs[i];
					addVectorInPlace(acc, cand.vec, 1);
					state.panIdx = i;
					const s = evalState(acc, state);
					if (compareScores(s, bestScore) > 0) {
						bestScore = s;
						bestIdx = i;
					}
					addVectorInPlace(acc, cand.vec, -1);
				}
				state.panIdx = bestIdx;
				addVectorInPlace(acc, panPairs[bestIdx].vec, 1);
				if (bestIdx !== origIdx) {
					currentScore = bestScore;
					improved = true;
				}
			}

			// 1b. Pan Trinket
			if (trinkets.length > 1) {
				const origIdx = state.trinketIdx;
				let bestIdx = origIdx;
				let bestScore = currentScore;
				for (let i = 0; i < trinkets.length; i++) {
					state.trinketIdx = i;
					const s = evalState(acc, state);
					if (compareScores(s, bestScore) > 0) {
						bestScore = s;
						bestIdx = i;
					}
				}
				state.trinketIdx = bestIdx;
				if (bestIdx !== origIdx) {
					currentScore = bestScore;
					improved = true;
				}
			}

			// 2. Shovel + Shovel Enchant
			{
				const origIdx = state.shovelIdx;
				let bestIdx = origIdx;
				let bestScore = currentScore;
				addVectorInPlace(acc, shovelPairs[origIdx].vec, -1);
				for (let i = 0; i < shovelPairs.length; i++) {
					const cand = shovelPairs[i];
					addVectorInPlace(acc, cand.vec, 1);
					state.shovelIdx = i;
					const s = evalState(acc, state);
					if (compareScores(s, bestScore) > 0) {
						bestScore = s;
						bestIdx = i;
					}
					addVectorInPlace(acc, cand.vec, -1);
				}
				state.shovelIdx = bestIdx;
				addVectorInPlace(acc, shovelPairs[bestIdx].vec, 1);
				if (bestIdx !== origIdx) {
					currentScore = bestScore;
					improved = true;
				}
			}

			// 3. Necklace
			{
				const origIdx = state.necklaceIdx;
				let bestIdx = origIdx;
				let bestScore = currentScore;
				if (origIdx !== null) addVectorInPlace(acc, necklaces[origIdx].vec, -1);
				// Also evaluate null (empty slot)
				state.necklaceIdx = null;
				const emptyScore = evalState(acc, state);
				if (compareScores(emptyScore, bestScore) > 0) {
					bestScore = emptyScore;
					bestIdx = null;
				}
				for (let i = 0; i < necklaces.length; i++) {
					const cand = necklaces[i];
					addVectorInPlace(acc, cand.vec, 1);
					state.necklaceIdx = i;
					const s = evalState(acc, state);
					if (compareScores(s, bestScore) > 0) {
						bestScore = s;
						bestIdx = i;
					}
					addVectorInPlace(acc, cand.vec, -1);
				}
				state.necklaceIdx = bestIdx;
				if (bestIdx !== null) addVectorInPlace(acc, necklaces[bestIdx].vec, 1);
				if (bestIdx !== origIdx) {
					currentScore = bestScore;
					improved = true;
				}
			}

			// 4. Charm
			{
				const origIdx = state.charmIdx;
				let bestIdx = origIdx;
				let bestScore = currentScore;
				if (origIdx !== null) addVectorInPlace(acc, charms[origIdx].vec, -1);
				state.charmIdx = null;
				const emptyScore = evalState(acc, state);
				if (compareScores(emptyScore, bestScore) > 0) {
					bestScore = emptyScore;
					bestIdx = null;
				}
				for (let i = 0; i < charms.length; i++) {
					const cand = charms[i];
					addVectorInPlace(acc, cand.vec, 1);
					state.charmIdx = i;
					const s = evalState(acc, state);
					if (compareScores(s, bestScore) > 0) {
						bestScore = s;
						bestIdx = i;
					}
					addVectorInPlace(acc, cand.vec, -1);
				}
				state.charmIdx = bestIdx;
				if (bestIdx !== null) addVectorInPlace(acc, charms[bestIdx].vec, 1);
				if (bestIdx !== origIdx) {
					currentScore = bestScore;
					improved = true;
				}
			}

			// 5. Rings (2 inner sweeps for unique-ring interactions)
			for (let ringPass = 0; ringPass < 2; ringPass++) {
				let ringImproved = false;
				for (let slotIdx = 0; slotIdx < MAX_RING_SLOTS; slotIdx++) {
					const origIdx = state.ringIdx[slotIdx];
					let bestIdx = origIdx;
					let bestScore = currentScore;

					const usedUniqueOther = new Set<string>();
					for (let j = 0; j < MAX_RING_SLOTS; j++) {
						if (j === slotIdx) continue;
						const rj = state.ringIdx[j];
						if (rj !== null && rings[rj].isUnique) {
							usedUniqueOther.add(rings[rj].item.id);
						}
					}

					if (origIdx !== null) addVectorInPlace(acc, rings[origIdx].vec, -1);
					state.ringIdx[slotIdx] = null;
					const emptyScore = evalState(acc, state);
					if (compareScores(emptyScore, bestScore) > 0) {
						bestScore = emptyScore;
						bestIdx = null;
					}

					for (let i = 0; i < rings.length; i++) {
						const cand = rings[i];
						if (cand.isUnique && usedUniqueOther.has(cand.item.id)) continue;
						addVectorInPlace(acc, cand.vec, 1);
						state.ringIdx[slotIdx] = i;
						const s = evalState(acc, state);
						if (compareScores(s, bestScore) > 0) {
							bestScore = s;
							bestIdx = i;
						}
						addVectorInPlace(acc, cand.vec, -1);
					}

					state.ringIdx[slotIdx] = bestIdx;
					if (bestIdx !== null) addVectorInPlace(acc, rings[bestIdx].vec, 1);
					if (bestIdx !== origIdx) {
						currentScore = bestScore;
						ringImproved = true;
						improved = true;
					}
				}
				if (!ringImproved) break;
			}

			// 6. Runes subset (+ Pan Trinket jointly so Purity vs Beach Umbrella flips atomically)
			if (runeSubsets.length > 1) {
				const origRuneIdx = state.runeIdx;
				const origTrinketIdx = state.trinketIdx;
				let bestRuneIdx = origRuneIdx;
				let bestTrinketIdx = origTrinketIdx;
				let bestScore = currentScore;
				addVectorInPlace(acc, runeSubsets[origRuneIdx].vec, -1);
				for (let i = 0; i < runeSubsets.length; i++) {
					addVectorInPlace(acc, runeSubsets[i].vec, 1);
					state.runeIdx = i;
					for (let ti = 0; ti < trinkets.length; ti++) {
						state.trinketIdx = ti;
						const s = evalState(acc, state);
						if (compareScores(s, bestScore) > 0) {
							bestScore = s;
							bestRuneIdx = i;
							bestTrinketIdx = ti;
						}
					}
					addVectorInPlace(acc, runeSubsets[i].vec, -1);
				}
				state.runeIdx = bestRuneIdx;
				state.trinketIdx = bestTrinketIdx;
				addVectorInPlace(acc, runeSubsets[bestRuneIdx].vec, 1);
				if (bestRuneIdx !== origRuneIdx || bestTrinketIdx !== origTrinketIdx) {
					currentScore = bestScore;
					improved = true;
				}
			}

			// 7. Totems / Potions toggle
			for (let i = 0; i < boostPool.length; i++) {
				const wasActive = state.boostActive[i];
				addVectorInPlace(acc, boostPool[i].vec, wasActive ? -1 : 1);
				state.boostActive[i] = !wasActive;
				const toggledScore = evalState(acc, state);
				if (compareScores(toggledScore, currentScore) > 0) {
					currentScore = toggledScore;
					improved = true;
				} else {
					addVectorInPlace(acc, boostPool[i].vec, wasActive ? 1 : -1);
					state.boostActive[i] = wasActive;
				}
			}

			// 8. Museum slots (2 inner sweeps for ore + rider synergy)
			if (options.museumMode === 'optimize') {
				for (let mPass = 0; mPass < 2; mPass++) {
					let mImproved = false;
					for (const r of MUSEUM_RARITIES_DESC) {
						const count = MUSEUM_SLOT_COUNTS[r];
						const rOres = oresByRarity[r];
						const rRiders = ridersByRarity[r];

						for (let slotIdx = 0; slotIdx < count; slotIdx++) {
							const usedOresOther = new Set<number>();
							for (let j = 0; j < count; j++) {
								if (j !== slotIdx && state.museumOreIdx[r][j] !== null) {
									usedOresOther.add(state.museumOreIdx[r][j]!);
								}
							}

							const origOreIdx = state.museumOreIdx[r][slotIdx];
							const origRiderIdx = state.museumRiderIdx[r][slotIdx];
							let bestOreIdx = origOreIdx;
							let bestRiderIdx = origRiderIdx;
							let bestScore = currentScore;

							if (origOreIdx !== null) addBoostMapInPlace(acc, rOres[origOreIdx].boosts, -1);
							if (origRiderIdx !== null) addBoostMapInPlace(acc, rRiders[origRiderIdx].boosts, -1);

							// Test leaving slot empty
							state.museumOreIdx[r][slotIdx] = null;
							state.museumRiderIdx[r][slotIdx] = null;
							const emptySlotScore = evalState(acc, state);
							if (compareScores(emptySlotScore, bestScore) > 0) {
								bestScore = emptySlotScore;
								bestOreIdx = null;
								bestRiderIdx = null;
							}

							// Evaluate every unused ore × legal rider pair for that ore
							for (let oi = 0; oi < rOres.length; oi++) {
								if (usedOresOther.has(oi)) continue;
								const oreEntry = rOres[oi].ore;
								addBoostMapInPlace(acc, rOres[oi].boosts, 1);
								state.museumOreIdx[r][slotIdx] = oi;

								for (let ri = 0; ri < rRiders.length; ri++) {
									if (!isMuseumModifierAllowedForOre(oreEntry, rRiders[ri].rider?.id ?? null)) {
										continue;
									}
									addBoostMapInPlace(acc, rRiders[ri].boosts, 1);
									state.museumRiderIdx[r][slotIdx] = ri;
									const s = evalState(acc, state);
									if (compareScores(s, bestScore) > 0) {
										bestScore = s;
										bestOreIdx = oi;
										bestRiderIdx = ri;
									}
									addBoostMapInPlace(acc, rRiders[ri].boosts, -1);
								}

								addBoostMapInPlace(acc, rOres[oi].boosts, -1);
							}

							state.museumOreIdx[r][slotIdx] = bestOreIdx;
							state.museumRiderIdx[r][slotIdx] = bestRiderIdx;
							if (bestOreIdx !== null) addBoostMapInPlace(acc, rOres[bestOreIdx].boosts, 1);
							if (bestRiderIdx !== null) addBoostMapInPlace(acc, rRiders[bestRiderIdx].boosts, 1);

							if (bestOreIdx !== origOreIdx || bestRiderIdx !== origRiderIdx) {
								currentScore = bestScore;
								mImproved = true;
								improved = true;
							}
						}
					}
					if (!mImproved) break;
				}
			}

			if (!improved) break;
		}

		if (globalBestState === null || compareScores(currentScore, globalBestScore) > 0) {
			globalBestScore = currentScore;
			globalBestState = cloneState(state);
		}
	}

	const best = globalBestState!;

	// Canonical sorting of rings (unique rings first, then grouped by itemId + mutationId)
	const resolvedRings = best.ringIdx
		.map((idx) => (idx !== null ? rings[idx] : null))
		.sort((a, b) => {
			if (!a && !b) return 0;
			if (!a) return 1;
			if (!b) return -1;
			if (a.isUnique !== b.isUnique) return a.isUnique ? -1 : 1;
			const nameCmp = a.item.name.localeCompare(b.item.name);
			if (nameCmp !== 0) return nameCmp;
			return (a.selection.mutationId ?? '').localeCompare(b.selection.mutationId ?? '');
		})
		.map((c) => (c ? { ...c.selection } : null));

	// Construct SavedMuseum if optimize or saved
	let finalMuseum: SavedMuseum | null = null;
	if (options.museumMode === 'saved' && options.fixedMuseum) {
		finalMuseum = options.fixedMuseum;
	} else if (options.museumMode === 'optimize') {
		const targetLabel =
			targetMineral?.mineral ?? 'Rare Minerals';
		const museumDoc = createDefaultSavedMuseum(`Optimal Museum: ${targetLabel}`);
		for (const r of MUSEUM_RARITIES_DESC) {
			const count = MUSEUM_SLOT_COUNTS[r];
			const slotPairs: Array<{ oreIdx: number; riderIdx: number | null }> = [];
			for (let s = 0; s < count; s++) {
				const oi = best.museumOreIdx[r][s];
				if (oi !== null) {
					slotPairs.push({ oreIdx: oi, riderIdx: best.museumRiderIdx[r][s] });
				}
			}
			slotPairs.sort((a, b) =>
				oresByRarity[r][a.oreIdx].ore.name.localeCompare(oresByRarity[r][b.oreIdx].ore.name)
			);
			museumDoc.slots[r] = Array.from({ length: count }, (_, idx) => {
				const p = slotPairs[idx];
				if (!p) return null;
				const oreCand = oresByRarity[r][p.oreIdx];
				const riderCand = p.riderIdx !== null ? ridersByRarity[r][p.riderIdx] : null;
				return {
					oreId: oreCand.ore.id,
					weightKg: oreCand.weightKg,
					modifierId: riderCand?.rider?.id ?? null
				};
			});
		}
		finalMuseum = museumDoc;
	}

	const selectedBoostIds = boostPool
		.filter((_, idx) => best.boostActive[idx])
		.map((b) => b.boost.id);

	const targetTitle = targetMineral?.mineral ?? 'Rare Minerals';
	const finalPanId = panPairs[best.panIdx].pan?.id ?? null;
	const finalBuild: SavedBuild = {
		id: '',
		name: `Optimal: ${targetTitle}`,
		updatedAt: new Date().toISOString(),
		panId: finalPanId,
		panEnchantId: panPairs[best.panIdx].enchant?.id ?? null,
		panTrinketId: finalPanId ? (trinkets[best.trinketIdx]?.id ?? null) : null,
		shovelId: shovelPairs[best.shovelIdx].shovel?.id ?? null,
		shovelEnchantId: shovelPairs[best.shovelIdx].enchant?.id ?? null,
		necklace: best.necklaceIdx !== null ? { ...necklaces[best.necklaceIdx].selection } : null,
		charm: best.charmIdx !== null ? { ...charms[best.charmIdx].selection } : null,
		rings: resolvedRings,
		runeIds: [...runeSubsets[best.runeIdx].runeIds],
		boostIds: selectedBoostIds,
		museumId: finalMuseum?.id || null
	};

	// Canonical final calculation using the exact production engine functions
	const resolvedLoadout = resolveSavedBuild(finalBuild, finalMuseum);
	const stats = calculateBuildStats(resolvedLoadout, {
		isNight: options.isNight,
		solarMagnifier: options.solarMagnifier,
		modifierSurge: options.modifierSurge
	});
	const museumSummary = finalMuseum ? calculateMuseumSummary(finalMuseum) : null;
	const chanceInputs = extractChanceInputsFromBuild(
		finalBuild,
		{
			timeMethod: options.timeMethod,
			minWeightKg: options.minWeightKg,
			targetModifierId: options.targetModifierId,
			solarMagnifier: options.solarMagnifier,
			volcanicEruption: options.volcanicEruption,
			modifierSurge: options.modifierSurge,
			isNight: options.isNight
		},
		finalMuseum
	);

	// Use selected location if specific mineral, otherwise evaluate generic against synthetic 100% chance
	let mineralSummary: MineralChanceSummary | null = null;
	if (targetMineral) {
		const summaryTarget: MineralEntry =
			chosenLoc && !isChestOnly
				? {
						...targetMineral,
						locations: [chosenLoc]
					}
				: targetMineral;
		mineralSummary = calculateMineralChances(summaryTarget, chanceInputs);
	}

	const syntheticMineral: MineralEntry = {
		mineral: 'Generic Rare Roll',
		rarity: 'exotic',
		locations: [{ location: 'Generic', chance_percent: 1 }]
	};
	const genericSummary = calculateMineralChances(syntheticMineral, chanceInputs);

	const weightInfo = mineralSummary ? mineralSummary.weightInfo : genericSummary.weightInfo;
	const modifierInfo = mineralSummary ? mineralSummary.modifierInfo : genericSummary.modifierInfo;

	const rollsPerPan =
		mineralSummary !== null ? mineralSummary.rollsPerPan : genericSummary.rollsPerPan;
	const cycleSeconds =
		mineralSummary !== null ? mineralSummary.cycleSeconds : genericSummary.cycleSeconds;
	const rollsPerSecond =
		Number.isFinite(cycleSeconds) && cycleSeconds > 0 ? rollsPerPan / cycleSeconds : 0;
	const effectiveRollsPerSecond =
		rollsPerSecond * weightInfo.probability * modifierInfo.probability;

	const expectedTimeSeconds =
		mineralSummary && !mineralSummary.isChestOnly && mineralSummary.pAttempt > 0 && Number.isFinite(cycleSeconds)
			? cycleSeconds / mineralSummary.pAttempt
			: null;

	const warnings: string[] = [];
	if (allPansBannedWarning) warnings.push(allPansBannedWarning);
	if (toughnessFallbackWarning) warnings.push(toughnessFallbackWarning);
	if (shovelConflictWarning) warnings.push(shovelConflictWarning);
	if (isChestOnly) {
		warnings.push(
			`${targetMineral?.mineral} only drops from Treasure Chests: completion time does not depend on panning speed.`
		);
	}
	if (weightInfo.active && weightInfo.probability <= 0 && weightInfo.minSizeBoostNeededPct !== null) {
		const currentSB = chanceInputs.sizeBoostPct;
		warnings.push(
			`Weight >= ${options.minWeightKg} kg is unreachable under current conditions: requires at least +${weightInfo.minSizeBoostNeededPct}% Size Boost (highest reached +${currentSB}%). Try enabling Size Boost events (Solar Magnifier / Volcanic Eruption) or Potions.`
		);
	}
	if (modifierInfo.warning) {
		warnings.push(modifierInfo.warning);
	}

	const feasible = isChestOnly
		? Boolean(mineralSummary && mineralSummary.pAttempt > 0)
		: mineralSummary
			? Boolean(mineralSummary.pAttempt > 0 && Number.isFinite(mineralSummary.t50 ?? Infinity))
			: effectiveRollsPerSecond > 0;

	const finishedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();

	return {
		build: finalBuild,
		museum: finalMuseum,
		stats,
		chanceInputs,
		mineralSummary,
		selectedLocationName,
		selectedBasePercent,
		isChestOnly,
		feasible,
		effectiveRollsPerSecond,
		expectedTimeSeconds,
		t50Seconds: mineralSummary ? mineralSummary.t50 : null,
		t90Seconds: mineralSummary ? mineralSummary.t90 : null,
		t99Seconds: mineralSummary ? mineralSummary.t99 : null,
		weightInfo,
		modifierInfo,
		museumSummary,
		warnings,
		computeTimeMs: Math.max(0, Math.round((finishedAt - startedAt) * 10) / 10)
	};
}
