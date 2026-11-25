import {
	MUSEUM_MODIFIER_RIDERS,
	MUSEUM_ORES,
	MUSEUM_RARITY_MULTIPLIERS,
	MUSEUM_SLOT_COUNTS
} from '#lib/data/index.ts';
import { ALL_STAT_KEYS } from '#lib/engine/stats.ts';
import type {
	BoostSource,
	MuseumModifierRider,
	MuseumOreEntry,
	MuseumRarity,
	MuseumSlotSelection,
	SavedMuseum,
	StatKey,
	StatMap
} from '#lib/types/prospecting.ts';

export const MUSEUM_RARITIES_DESC: readonly MuseumRarity[] = [
	'exotic',
	'mythic',
	'legendary',
	'epic',
	'rare',
	'uncommon',
	'common'
] as const;

export const MUSEUM_RARITY_LABELS: Record<MuseumRarity, string> = {
	exotic: 'Exotic',
	mythic: 'Mythic',
	legendary: 'Legendary',
	epic: 'Epic',
	rare: 'Rare',
	uncommon: 'Uncommon',
	common: 'Common'
};

export const MUSEUM_ORES_BY_ID = new Map<string, MuseumOreEntry>(
	MUSEUM_ORES.map((o) => [o.id, o])
);

export const MUSEUM_RIDERS_BY_ID = new Map<string, MuseumModifierRider>(
	MUSEUM_MODIFIER_RIDERS.map((r) => [r.id, r])
);

export interface MuseumSlotBreakdown {
	ore: MuseumOreEntry | null;
	rider: MuseumModifierRider | null;
	weightRatio: number;
	isMaxWeight: boolean;
	oreBoosts: StatMap;
	riderBoosts: StatMap;
	totalBoosts: StatMap;
}

export interface MuseumSummary {
	filledSlots: number;
	totalSlots: number;
	oreBoosts: Record<StatKey, number>;
	riderBoosts: Record<StatKey, number>;
	totalBoosts: Record<StatKey, number>;
	duplicateWarnings: string[];
	modifierWarnings: string[];
}

export function isMuseumModifierAllowedForOre(
	ore: MuseumOreEntry,
	modifierId: string | null
): boolean {
	if (!modifierId) return true;
	if (modifierId === 'treasured') return Boolean(ore.canBeTreasured);
	if (modifierId === 'entombed') return Boolean(ore.canBeEntombed);
	return !ore.chestOnly;
}

export function getMuseumModifierIneligibilityReason(
	ore: MuseumOreEntry,
	modifierId: string | null
): string | null {
	if (!modifierId || isMuseumModifierAllowedForOre(ore, modifierId)) return null;
	if (modifierId === 'treasured') {
		return `${ore.name} non si trova nelle 8 zone con Treasure Chest: non può avere il modifier Treasured.`;
	}
	if (modifierId === 'entombed') {
		return `${ore.name} non si trova nella Pharaoh's Tomb: non può avere il modifier Entombed.`;
	}
	if (ore.chestOnly) {
		return `${ore.name} si ottiene solo da chest nella Pharaoh's Tomb: non può avere modifier da panning.`;
	}
	return `${ore.name} non è compatibile con il modifier selezionato.`;
}

function createZeroStatRecord(): Record<StatKey, number> {
	return {
		luck: 0,
		nightLuck: 0,
		capacity: 0,
		inventorySize: 0,
		shakeStrength: 0,
		shakeSpeed: 0,
		digStrength: 0,
		digSpeed: 0,
		toughness: 0,
		sellBoost: 0,
		sizeBoost: 0,
		modifierBoost: 0,
		walkSpeed: 0,
		jumpPower: 0
	};
}

export function createDefaultSavedMuseum(name = 'Il mio Museo'): SavedMuseum {
	return {
		id: '',
		name,
		updatedAt: new Date().toISOString(),
		slots: {
			exotic: Array.from({ length: MUSEUM_SLOT_COUNTS.exotic }, () => null),
			mythic: Array.from({ length: MUSEUM_SLOT_COUNTS.mythic }, () => null),
			legendary: Array.from({ length: MUSEUM_SLOT_COUNTS.legendary }, () => null),
			epic: Array.from({ length: MUSEUM_SLOT_COUNTS.epic }, () => null),
			rare: Array.from({ length: MUSEUM_SLOT_COUNTS.rare }, () => null),
			uncommon: Array.from({ length: MUSEUM_SLOT_COUNTS.uncommon }, () => null),
			common: Array.from({ length: MUSEUM_SLOT_COUNTS.common }, () => null)
		}
	};
}

/**
 * Computes boosts for a single Museum display slot:
 * - Ore boost scales linearly with min(1, weightKg / ore.minKg)
 * - Modifier rider adds rarityMultiplier * factor to each rider stat regardless of weight
 */
export function calculateMuseumSlotBoosts(
	rarity: MuseumRarity,
	slot: MuseumSlotSelection | null
): MuseumSlotBreakdown {
	const empty: MuseumSlotBreakdown = {
		ore: null,
		rider: null,
		weightRatio: 0,
		isMaxWeight: false,
		oreBoosts: {},
		riderBoosts: {},
		totalBoosts: {}
	};
	if (!slot) return empty;

	const ore = MUSEUM_ORES_BY_ID.get(slot.oreId) ?? null;
	if (!ore) return empty;

	const rider = slot.modifierId ? (MUSEUM_RIDERS_BY_ID.get(slot.modifierId) ?? null) : null;
	const weightKg = Number.isFinite(slot.weightKg) ? Math.max(0, slot.weightKg) : 0;
	const weightRatio = ore.minKg > 0 ? Math.min(1, weightKg / ore.minKg) : 1;
	const isMaxWeight = weightKg >= ore.minKg;

	const oreBoosts: StatMap = {};
	const riderBoosts: StatMap = {};
	const totalBoosts: StatMap = {};

	for (const key of ALL_STAT_KEYS) {
		const maxVal = ore.maxBoosts[key];
		if (maxVal !== undefined) {
			const val = maxVal * weightRatio;
			oreBoosts[key] = val;
			totalBoosts[key] = val;
		}
	}

	if (rider) {
		const riderStep = MUSEUM_RARITY_MULTIPLIERS[rarity] * rider.multiplierFactor;
		for (const key of rider.stats) {
			riderBoosts[key] = (riderBoosts[key] ?? 0) + riderStep;
			totalBoosts[key] = (totalBoosts[key] ?? 0) + riderStep;
		}
	}

	return {
		ore,
		rider,
		weightRatio,
		isMaxWeight,
		oreBoosts,
		riderBoosts,
		totalBoosts
	};
}

export function calculateMuseumSummary(museum: SavedMuseum): MuseumSummary {
	const oreBoosts = createZeroStatRecord();
	const riderBoosts = createZeroStatRecord();
	const totalBoosts = createZeroStatRecord();

	let filledSlots = 0;
	let totalSlots = 0;
	const oreCounts = new Map<string, { name: string; count: number }>();
	const modifierWarnings: string[] = [];

	for (const rarity of MUSEUM_RARITIES_DESC) {
		const maxSlots = MUSEUM_SLOT_COUNTS[rarity];
		totalSlots += maxSlots;
		const list = museum.slots[rarity] ?? [];

		for (let i = 0; i < maxSlots; i++) {
			const slot = list[i] ?? null;
			if (!slot) continue;
			const breakdown = calculateMuseumSlotBoosts(rarity, slot);
			if (!breakdown.ore) continue;

			filledSlots += 1;
			const modReason = getMuseumModifierIneligibilityReason(breakdown.ore, slot.modifierId);
			if (modReason) {
				modifierWarnings.push(modReason);
			}
			const oreTrack = oreCounts.get(breakdown.ore.id) ?? {
				name: breakdown.ore.name,
				count: 0
			};
			oreTrack.count += 1;
			oreCounts.set(breakdown.ore.id, oreTrack);

			for (const key of ALL_STAT_KEYS) {
				if (breakdown.oreBoosts[key] !== undefined) {
					oreBoosts[key] += breakdown.oreBoosts[key]!;
				}
				if (breakdown.riderBoosts[key] !== undefined) {
					riderBoosts[key] += breakdown.riderBoosts[key]!;
				}
				if (breakdown.totalBoosts[key] !== undefined) {
					totalBoosts[key] += breakdown.totalBoosts[key]!;
				}
			}
		}
	}

	const duplicateWarnings: string[] = [];
	for (const { name, count } of oreCounts.values()) {
		if (count > 1) {
			duplicateWarnings.push(
				`${name} è inserito in ${count} display (in gioco puoi esporre ogni minerale al massimo una volta).`
			);
		}
	}

	return {
		filledSlots,
		totalSlots,
		oreBoosts,
		riderBoosts,
		totalBoosts,
		duplicateWarnings,
		modifierWarnings
	};
}

export function museumToBoostSource(museum: SavedMuseum): BoostSource {
	const summary = calculateMuseumSummary(museum);
	const boosts: StatMap = {};
	for (const key of ALL_STAT_KEYS) {
		if (Math.abs(summary.totalBoosts[key]) > 1e-9) {
			boosts[key] = summary.totalBoosts[key];
		}
	}
	return {
		id: `museum-${museum.id || 'active'}`,
		name: museum.name,
		category: 'museum',
		modifiers: { boosts }
	};
}
