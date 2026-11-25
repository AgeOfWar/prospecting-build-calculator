import type {
	BuildLoadout,
	CalculatedStats,
	StatBreakdown,
	StatKey,
	StatMap,
	StatModifiers
} from '#lib/types/prospecting.ts';

export const MAX_RING_SLOTS = 8;

export const BOOST_ONLY_STAT_KEYS: ReadonlySet<StatKey> = new Set([
	'sellBoost',
	'sizeBoost',
	'modifierBoost'
]);

export function isBoostOnlyStat(key: StatKey): boolean {
	return BOOST_ONLY_STAT_KEYS.has(key);
}

export const ALL_STAT_KEYS: readonly StatKey[] = [
	'luck',
	'nightLuck',
	'capacity',
	'inventorySize',
	'shakeStrength',
	'shakeSpeed',
	'digStrength',
	'digSpeed',
	'toughness',
	'sellBoost',
	'sizeBoost',
	'modifierBoost',
	'walkSpeed',
	'jumpPower'
] as const;

export const STAT_LABELS: Record<StatKey, string> = {
	luck: 'Luck',
	nightLuck: 'Night Luck',
	capacity: 'Capacity',
	inventorySize: 'Inventory Size',
	shakeStrength: 'Shake Strength',
	shakeSpeed: 'Shake Speed',
	digStrength: 'Dig Strength',
	digSpeed: 'Dig Speed',
	toughness: 'Toughness',
	sellBoost: 'Sell Boost',
	sizeBoost: 'Size Boost',
	modifierBoost: 'Modifier Boost',
	walkSpeed: 'WalkSpeed',
	jumpPower: 'Jump Power'
};

/**
 * Computes a single Prospecting! stat using the wiki formula:
 * Final Stat = (Base + Flats) * (1 + Boosts)
 */
export function calculateFinalStat(base: number, flats: number, boosts: number): number {
	return (base + flats) * (1 + boosts);
}

function addStatMap(target: Record<StatKey, number>, source?: StatMap): void {
	if (!source) return;
	for (const key of ALL_STAT_KEYS) {
		const value = source[key];
		if (value !== undefined) {
			target[key] += value;
		}
	}
}

function applyModifiers(
	bases: Record<StatKey, number>,
	flats: Record<StatKey, number>,
	boosts: Record<StatKey, number>,
	multipliers: Record<StatKey, number>,
	modifiers?: StatModifiers
): void {
	if (!modifiers) return;
	addStatMap(bases, modifiers.base);
	addStatMap(flats, modifiers.flats);
	addStatMap(boosts, modifiers.boosts);
	if (modifiers.multipliers) {
		for (const key of ALL_STAT_KEYS) {
			const factor = modifiers.multipliers[key];
			if (factor !== undefined) {
				multipliers[key] *= factor;
			}
		}
	}
}

function createFilledMap(value: number): Record<StatKey, number> {
	return {
		luck: value,
		nightLuck: value,
		capacity: value,
		inventorySize: value,
		shakeStrength: value,
		shakeSpeed: value,
		digStrength: value,
		digSpeed: value,
		toughness: value,
		sellBoost: value,
		sizeBoost: value,
		modifierBoost: value,
		walkSpeed: value,
		jumpPower: value
	};
}

function createZeroMap(): Record<StatKey, number> {
	return createFilledMap(0);
}

/** Creates an empty loadout with 8 empty ring slots. */
export function createEmptyLoadout(): BuildLoadout {
	return {
		pan: null,
		panEnchant: null,
		panTrinket: null,
		shovel: null,
		shovelEnchant: null,
		necklace: null,
		charm: null,
		rings: Array.from({ length: MAX_RING_SLOTS }, () => null),
		runes: [],
		extraSources: []
	};
}

export interface CalculateBuildStatsOptions {
	isNight?: boolean;
	solarMagnifier?: boolean;
	modifierSurge?: boolean;
}

/** Aggregates base, flat, and percentage boost contributions across all equipped slots. */
export function calculateBuildStats(
	loadout: BuildLoadout,
	options?: CalculateBuildStatsOptions
): CalculatedStats {
	const isNight = Boolean(options?.isNight);
	const bases = createZeroMap();
	const flats = createZeroMap();
	const boosts = createZeroMap();
	const multipliers = createFilledMap(1);

	if (loadout.pan) {
		const panMultipliers = loadout.panEnchant?.modifiers.multipliers;
		addStatMap(bases, {
			luck: loadout.pan.stats.luck * (panMultipliers?.luck ?? 1),
			capacity: loadout.pan.stats.capacity * (panMultipliers?.capacity ?? 1),
			shakeStrength: loadout.pan.stats.shakeStrength * (panMultipliers?.shakeStrength ?? 1),
			shakeSpeed: loadout.pan.stats.shakeSpeed * (panMultipliers?.shakeSpeed ?? 1)
		});
	}
	if (loadout.shovel) {
		addStatMap(bases, loadout.shovel.stats);
	}

	if (loadout.panEnchant) {
		applyModifiers(bases, flats, boosts, multipliers, {
			base: loadout.panEnchant.modifiers.base,
			flats: loadout.panEnchant.modifiers.flats,
			boosts: loadout.panEnchant.modifiers.boosts
		});
	}
	applyModifiers(bases, flats, boosts, multipliers, loadout.shovelEnchant?.modifiers);
	applyModifiers(bases, flats, boosts, multipliers, loadout.necklace?.modifiers);
	applyModifiers(bases, flats, boosts, multipliers, loadout.charm?.modifiers);

	for (const ring of loadout.rings.slice(0, MAX_RING_SLOTS)) {
		applyModifiers(bases, flats, boosts, multipliers, ring?.modifiers);
	}

	let hasSummitSeeker = false;
	let hasBunny = false;
	let hasEqualizer = false;
	let hasPurityRune = false;

	for (const rune of loadout.runes) {
		if (rune.id === 'purity') {
			hasPurityRune = true;
		}
		if (rune.id === 'summit-seeker') {
			hasSummitSeeker = true;
		} else if (rune.id === 'bunny') {
			hasBunny = true;
		} else if (rune.id === 'equalizer') {
			hasEqualizer = true;
		} else if (rune.id === 'sunblessed') {
			if (!isNight) applyModifiers(bases, flats, boosts, multipliers, rune.modifiers);
		} else if (rune.id === 'abyssal') {
			if (isNight) boosts.luck += 0.2;
		} else {
			applyModifiers(bases, flats, boosts, multipliers, rune.modifiers);
		}
	}

	for (const source of loadout.extraSources) {
		applyModifiers(bases, flats, boosts, multipliers, source.modifiers);
	}

	addStatMap(flats, loadout.extraFlats);
	addStatMap(boosts, loadout.extraBoosts);

	if (hasSummitSeeker) {
		const walkSpeedFinal =
			calculateFinalStat(bases.walkSpeed, flats.walkSpeed, boosts.walkSpeed) *
			multipliers.walkSpeed;
		const summitBonus = Math.max(0, walkSpeedFinal) * 0.05;
		boosts.digSpeed += summitBonus;
		boosts.shakeSpeed += summitBonus;
	}

	if (hasBunny) {
		const jumpPowerFinal =
			calculateFinalStat(bases.jumpPower, flats.jumpPower, boosts.jumpPower) *
			multipliers.jumpPower;
		const bunnyBonus = Math.max(0, jumpPowerFinal) * 0.05;
		boosts.modifierBoost += bunnyBonus;
	}

	const trinketId = loadout.pan ? (loadout.panTrinket?.id ?? null) : null;
	if (trinketId === 'nomads-compass') {
		boosts.luck += 0.15;
	} else if (trinketId === 'embalmers-salt') {
		boosts.sellBoost += 1.0;
	} else if (trinketId === 'senet-die') {
		// 6-sided die on final Luck: (0.5 + 0.75 + 1 + 1.25 + 1.5 + 3) / 6 = 4/3 expected multiplier
		multipliers.luck *= 4 / 3;
		multipliers.nightLuck *= 4 / 3;
	} else if (trinketId === 'mass-reactor' || (trinketId === 'beach-umbrella' && !hasPurityRune)) {
		const capacityFinal = Math.max(
			0,
			calculateFinalStat(bases.capacity, flats.capacity, boosts.capacity) * multipliers.capacity
		);
		if (capacityFinal > 0) {
			if (trinketId === 'mass-reactor') {
				bases.luck += 25 * Math.max(0, Math.sqrt(capacityFinal) - 20);
			} else {
				const rawModBoost =
					(boosts.modifierBoost + bases.modifierBoost + flats.modifierBoost) *
					multipliers.modifierBoost;
				const modifierBoostPct = Math.max(0, Math.round(rawModBoost * 100));
				const effMB1 =
					(100 + modifierBoostPct) *
					(options?.solarMagnifier ? 2 : 1) *
					(options?.modifierSurge ? 2 : 1);
				const anyModChance = Math.min(0.994, (effMB1 / 1680) * 0.994);
				bases.luck += 25 * Math.sqrt(capacityFinal) * anyModChance;
			}
		}
	}

	const result = {} as CalculatedStats;
	for (const key of ALL_STAT_KEYS) {
		const rawFinal = isBoostOnlyStat(key)
			? boosts[key] + bases[key] + flats[key]
			: calculateFinalStat(bases[key], flats[key], boosts[key]);
		const breakdown: StatBreakdown = {
			base: bases[key],
			flats: flats[key],
			boosts: boosts[key],
			multiplier: multipliers[key],
			final: rawFinal * multipliers[key]
		};
		result[key] = breakdown;
	}

	if (hasEqualizer) {
		const avgSpeed = (result.digSpeed.final + result.shakeSpeed.final) / 2;
		result.digSpeed = { ...result.digSpeed, final: avgSpeed };
		result.shakeSpeed = { ...result.shakeSpeed, final: avgSpeed };
	}

	return result;
}
