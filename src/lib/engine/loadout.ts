import {
	BOOST_SOURCES,
	ENCHANTS,
	EQUIPMENT,
	MUTATIONS,
	PANS,
	RUNES,
	SHOVELS,
	TRINKETS
} from '#lib/data/index.ts';
import { calculateMuseumSummary, museumToBoostSource } from '#lib/engine/museum.ts';
import { ALL_STAT_KEYS, MAX_RING_SLOTS, STAT_LABELS, isBoostOnlyStat } from '#lib/engine/stats.ts';
import type {
	BoostSource,
	BuildLoadout,
	Enchant,
	EquipmentItem,
	EquipmentMutation,
	EquipmentTier,
	EquippedJewelrySelection,
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

export interface ActivePassiveEntry {
	source: string;
	category: string;
	text: string;
}

const PANS_BY_ID = new Map<string, Pan>(PANS.map((p) => [p.id, p]));
const SHOVELS_BY_ID = new Map<string, Shovel>(SHOVELS.map((s) => [s.id, s]));
const ENCHANTS_BY_ID = new Map<string, Enchant>(ENCHANTS.map((e) => [e.id, e]));
const EQUIPMENT_BY_ID = new Map<string, EquipmentItem>(EQUIPMENT.map((e) => [e.id, e]));
const MUTATIONS_BY_ID = new Map<string, EquipmentMutation>(MUTATIONS.map((m) => [m.id, m]));
const RUNES_BY_ID = new Map<string, Rune>(RUNES.map((r) => [r.id, r]));
const BOOSTS_BY_ID = new Map<string, BoostSource>(BOOST_SOURCES.map((b) => [b.id, b]));
const TRINKETS_BY_ID = new Map<string, PanTrinket>(TRINKETS.map((t) => [t.id, t]));

function clampRoll(rollQuality: number): number {
	if (!Number.isFinite(rollQuality)) return 1;
	return Math.min(1, Math.max(0, rollQuality));
}

function hasAnyKey(obj?: Record<string, unknown>): boolean {
	return Boolean(obj && Object.keys(obj).length > 0);
}

/**
 * Checks whether an equipment item has clean 6★ stat data (preferring valid ranges
 * and guarding against malformed boost keys placed in `base`).
 */
export function hasValidSixStarData(item: EquipmentItem): boolean {
	if (hasAnyKey(item.sixStarStatRanges)) return true;
	if (!item.sixStarModifiers) return false;

	const sixBase = item.sixStarModifiers.base;
	if (sixBase) {
		for (const key of Object.keys(sixBase) as StatKey[]) {
			if (isBoostOnlyStat(key)) return false;
			if (item.modifiers.boosts?.[key] !== undefined) return false;
		}
	}

	return (
		hasAnyKey(item.sixStarModifiers.base) ||
		hasAnyKey(item.sixStarModifiers.flats) ||
		hasAnyKey(item.sixStarModifiers.boosts) ||
		hasAnyKey(item.sixStarModifiers.multipliers)
	);
}

function isPercentStatForItem(key: StatKey, tierModifiers: StatModifiers, baseModifiers: StatModifiers): boolean {
	if (isBoostOnlyStat(key)) return true;
	return (
		tierModifiers.boosts?.[key] !== undefined ||
		baseModifiers.boosts?.[key] !== undefined
	);
}

function copyStatMap(target: StatMap, source?: StatMap): void {
	if (!source) return;
	for (const key of ALL_STAT_KEYS) {
		if (source[key] !== undefined && target[key] === undefined) {
			target[key] = source[key];
		}
	}
}

function scalePositiveStatMap(map: StatMap | undefined, factor: number): void {
	if (!map || factor === 1) return;
	for (const key of ALL_STAT_KEYS) {
		const val = map[key];
		if (val !== undefined && val > 0) {
			map[key] = val * factor;
		}
	}
}

function addStatMaps(target: StatMap, source?: StatMap): void {
	if (!source) return;
	for (const key of ALL_STAT_KEYS) {
		const val = source[key];
		if (val !== undefined) {
			target[key] = (target[key] ?? 0) + val;
		}
	}
}

/**
 * Resolves an equipment item's modifiers for a given star tier, roll quality in [0, 1],
 * and optional equipment mutation (scaling positive item stats and adding mutation bonuses).
 */
export function resolveEquipmentModifiers(
	item: EquipmentItem,
	tier: EquipmentTier,
	rollQuality: number,
	mutation?: EquipmentMutation | null
): StatModifiers {
	const roll = clampRoll(rollQuality);
	const useSixStar = tier === '6star' && hasValidSixStarData(item);

	const ranges = useSixStar ? item.sixStarStatRanges : item.statRanges;
	const tierModifiers = (useSixStar ? item.sixStarModifiers : item.modifiers) ?? item.modifiers;

	const resolved: StatModifiers = {
		base: {},
		flats: {},
		boosts: {},
		multipliers: {}
	};

	if (ranges) {
		for (const key of ALL_STAT_KEYS) {
			const range = ranges[key];
			if (!range) continue;
			const [minVal, maxVal] = range;
			const value = minVal + (maxVal - minVal) * roll;
			if (isPercentStatForItem(key, tierModifiers, item.modifiers)) {
				resolved.boosts![key] = value;
			} else {
				resolved.base![key] = value;
			}
		}
	}

	copyStatMap(resolved.base!, tierModifiers.base);
	copyStatMap(resolved.flats!, tierModifiers.flats);
	copyStatMap(resolved.boosts!, tierModifiers.boosts);
	copyStatMap(resolved.multipliers!, tierModifiers.multipliers);

	if (mutation) {
		scalePositiveStatMap(resolved.base, mutation.statMultiplier);
		scalePositiveStatMap(resolved.flats, mutation.statMultiplier);
		scalePositiveStatMap(resolved.boosts, mutation.statMultiplier);

		if (mutation.bonusModifiers) {
			addStatMaps(resolved.base!, mutation.bonusModifiers.base);
			addStatMaps(resolved.flats!, mutation.bonusModifiers.flats);
			addStatMaps(resolved.boosts!, mutation.bonusModifiers.boosts);
			if (mutation.bonusModifiers.multipliers) {
				for (const key of ALL_STAT_KEYS) {
					const factor = mutation.bonusModifiers.multipliers[key];
					if (factor !== undefined) {
						resolved.multipliers![key] = (resolved.multipliers![key] ?? 1) * factor;
					}
				}
			}
		}
	}

	return resolved;
}

function resolveJewelrySelection(selection: EquippedJewelrySelection | null): EquipmentItem | null {
	if (!selection) return null;
	const item = EQUIPMENT_BY_ID.get(selection.itemId);
	if (!item) return null;
	const mutation = selection.mutationId ? (MUTATIONS_BY_ID.get(selection.mutationId) ?? null) : null;
	const modifiers = resolveEquipmentModifiers(item, selection.tier, selection.rollQuality, mutation);
	return {
		...item,
		stars: selection.tier === '6star' && hasValidSixStarData(item) ? 6 : item.stars,
		modifiers
	};
}

/** Creates an empty saved build template with 8 empty ring slots. */
export function createDefaultSavedBuild(name = 'Nuova Build'): SavedBuild {
	return {
		id: '',
		name,
		updatedAt: new Date().toISOString(),
		panId: null,
		panEnchantId: null,
		panTrinketId: null,
		shovelId: null,
		shovelEnchantId: null,
		necklace: null,
		charm: null,
		rings: Array.from({ length: MAX_RING_SLOTS }, () => null),
		runeIds: [],
		boostIds: [],
		museumId: null
	};
}

/** Resolves a persisted SavedBuild (and optional linked Museum) into a full BuildLoadout ready for calculateBuildStats(). */
export function resolveSavedBuild(
	saved: SavedBuild,
	museum?: SavedMuseum | null
): BuildLoadout {
	const pan = saved.panId ? (PANS_BY_ID.get(saved.panId) ?? null) : null;
	const panEnchant = saved.panEnchantId ? (ENCHANTS_BY_ID.get(saved.panEnchantId) ?? null) : null;
	const panTrinket = saved.panTrinketId ? (TRINKETS_BY_ID.get(saved.panTrinketId) ?? null) : null;
	const shovel = saved.shovelId ? (SHOVELS_BY_ID.get(saved.shovelId) ?? null) : null;
	const shovelEnchant = saved.shovelEnchantId
		? (ENCHANTS_BY_ID.get(saved.shovelEnchantId) ?? null)
		: null;

	const necklace = resolveJewelrySelection(saved.necklace);
	const charm = resolveJewelrySelection(saved.charm);
	const rings = Array.from({ length: MAX_RING_SLOTS }, (_, index) =>
		resolveJewelrySelection(saved.rings[index] ?? null)
	);

	const runes: Rune[] = [];
	for (const id of saved.runeIds) {
		const rune = RUNES_BY_ID.get(id);
		if (rune) runes.push(rune);
	}

	const extraSources: BoostSource[] = [];
	for (const id of saved.boostIds) {
		const boost = BOOSTS_BY_ID.get(id);
		if (boost) extraSources.push(boost);
	}
	if (museum) {
		extraSources.push(museumToBoostSource(museum));
	}

	return {
		pan,
		panEnchant,
		panTrinket,
		shovel,
		shovelEnchant,
		necklace,
		charm,
		rings,
		runes,
		extraSources
	};
}

export function isUniqueOnlyEquipment(item: EquipmentItem): boolean {
	return Boolean(item.passive && /only one can be worn/i.test(item.passive));
}

/** Detects unique-only rings equipped in more than one slot. */
export function findUniqueRingWarnings(saved: SavedBuild): string[] {
	const counts = new Map<string, { name: string; count: number }>();
	for (const sel of saved.rings.slice(0, MAX_RING_SLOTS)) {
		if (!sel) continue;
		const item = EQUIPMENT_BY_ID.get(sel.itemId);
		if (!item || !isUniqueOnlyEquipment(item)) continue;
		const entry = counts.get(item.id) ?? { name: item.name, count: 0 };
		entry.count += 1;
		counts.set(item.id, entry);
	}

	const warnings: string[] = [];
	for (const { name, count } of counts.values()) {
		if (count > 1) {
			warnings.push(`${name} ha la restrizione "ONLY ONE CAN BE WORN" (equipaggiato ${count}×).`);
		}
	}
	return warnings;
}

/** Collects all non-numeric / descriptive passive effects from the equipped loadout. */
export function collectActivePassives(
	saved: SavedBuild,
	museum?: SavedMuseum | null
): ActivePassiveEntry[] {
	const entries: ActivePassiveEntry[] = [];

	if (museum) {
		const mSummary = calculateMuseumSummary(museum);
		entries.push({
			source: museum.name,
			category: 'Museum',
			text: `${mSummary.filledSlots}/${mSummary.totalSlots} display attivi`
		});
	}

	const pan = saved.panId ? PANS_BY_ID.get(saved.panId) : undefined;
	if (pan?.passive) entries.push({ source: pan.name, category: 'Pan', text: pan.passive });

	const panEnchant = saved.panEnchantId ? ENCHANTS_BY_ID.get(saved.panEnchantId) : undefined;
	if (panEnchant?.rawEffects?.length) {
		entries.push({
			source: panEnchant.name,
			category: 'Pan Enchant',
			text: panEnchant.rawEffects.join(' • ')
		});
	}

	const panTrinket = saved.panTrinketId ? TRINKETS_BY_ID.get(saved.panTrinketId) : undefined;
	if (panTrinket) {
		entries.push({
			source: panTrinket.name,
			category: 'Trinket',
			text: panTrinket.effect
		});
	}

	const shovel = saved.shovelId ? SHOVELS_BY_ID.get(saved.shovelId) : undefined;
	if (shovel?.passive) {
		entries.push({ source: shovel.name, category: 'Shovel', text: shovel.passive });
	}

	const shovelEnchant = saved.shovelEnchantId ? ENCHANTS_BY_ID.get(saved.shovelEnchantId) : undefined;
	if (shovelEnchant?.rawEffects?.length) {
		entries.push({
			source: shovelEnchant.name,
			category: 'Shovel Enchant',
			text: shovelEnchant.rawEffects.join(' • ')
		});
	}

	const jewelrySelections = [saved.necklace, saved.charm, ...saved.rings.slice(0, MAX_RING_SLOTS)];
	const seenJewelryPassives = new Set<string>();
	for (const sel of jewelrySelections) {
		if (!sel) continue;
		const item = EQUIPMENT_BY_ID.get(sel.itemId);
		if (item?.passive && !seenJewelryPassives.has(item.id)) {
			seenJewelryPassives.add(item.id);
			entries.push({ source: item.name, category: item.slot, text: item.passive });
		}
	}

	for (const id of saved.runeIds) {
		const rune = RUNES_BY_ID.get(id);
		if (rune?.rawEffects?.length) {
			entries.push({
				source: rune.name,
				category: 'Rune',
				text: rune.rawEffects.join(' • ')
			});
		}
	}

	for (const id of saved.boostIds) {
		const boost = BOOSTS_BY_ID.get(id);
		if (boost?.rawEffects?.length) {
			entries.push({
				source: boost.name,
				category: boost.category === 'totem' ? 'Totem' : 'Potion',
				text: boost.rawEffects.join(' • ')
			});
		}
	}

	return entries;
}

export interface ToolStatPreviewItem {
	key: StatKey;
	label: string;
	base: number;
	final: number;
	delta: number;
	changed: boolean;
}

export interface ToolExtraBonus {
	key: StatKey;
	label: string;
	value: number;
	isPercent: boolean;
}

export interface ToolPreview {
	stats: ToolStatPreviewItem[];
	extraBonuses: ToolExtraBonus[];
}

function collectExtraBonuses(
	enchant: Enchant | null,
	coreKeys: ReadonlySet<StatKey>
): ToolExtraBonus[] {
	if (!enchant) return [];
	const extras: ToolExtraBonus[] = [];
	const mods = enchant.modifiers;

	for (const key of ALL_STAT_KEYS) {
		if (coreKeys.has(key)) continue;
		const boostVal = mods.boosts?.[key];
		if (boostVal !== undefined && Math.abs(boostVal) > 1e-6) {
			extras.push({
				key,
				label: STAT_LABELS[key],
				value: boostVal,
				isPercent: true
			});
		}
		const flatVal = (mods.base?.[key] ?? 0) + (mods.flats?.[key] ?? 0);
		if (Math.abs(flatVal) > 1e-6) {
			extras.push({
				key,
				label: STAT_LABELS[key],
				value: flatVal,
				isPercent: false
			});
		}
	}

	return extras;
}

const PAN_CORE_KEYS = ['luck', 'capacity', 'shakeStrength', 'shakeSpeed'] as const;
const PAN_CORE_SET: ReadonlySet<StatKey> = new Set(PAN_CORE_KEYS);

/** Computes a Pan's stats after applying its Pan Enchant (multipliers, flats, boosts). */
export function computePanPreview(pan: Pan, enchant: Enchant | null): ToolPreview {
	const mods = enchant?.modifiers;
	const stats: ToolStatPreviewItem[] = PAN_CORE_KEYS.map((key) => {
		const base = pan.stats[key];
		const mult = mods?.multipliers?.[key] ?? 1;
		const flatDelta = (mods?.base?.[key] ?? 0) + (mods?.flats?.[key] ?? 0);
		const boostDelta = mods?.boosts?.[key] ?? 0;
		const final = (base * mult + flatDelta) * (1 + boostDelta);
		const delta = final - base;
		return {
			key,
			label: STAT_LABELS[key],
			base,
			final,
			delta,
			changed: Math.abs(delta) > 1e-6
		};
	});

	return {
		stats,
		extraBonuses: collectExtraBonuses(enchant, PAN_CORE_SET)
	};
}

const SHOVEL_CORE_KEYS = ['digStrength', 'digSpeed', 'toughness'] as const;
const SHOVEL_CORE_SET: ReadonlySet<StatKey> = new Set(SHOVEL_CORE_KEYS);

/** Computes a Shovel's static stats after applying non-conditional Shovel Enchant bonuses. */
export function computeShovelPreview(shovel: Shovel, enchant: Enchant | null): ToolPreview {
	const mods = enchant?.modifiers;
	const stats: ToolStatPreviewItem[] = SHOVEL_CORE_KEYS.map((key) => {
		const base = shovel.stats[key];
		const flatDelta = (mods?.base?.[key] ?? 0) + (mods?.flats?.[key] ?? 0);
		const boostDelta = mods?.boosts?.[key] ?? 0;
		const final = (base + flatDelta) * (1 + boostDelta);
		const delta = final - base;
		return {
			key,
			label: STAT_LABELS[key],
			base,
			final,
			delta,
			changed: Math.abs(delta) > 1e-6
		};
	});

	return {
		stats,
		extraBonuses: collectExtraBonuses(enchant, SHOVEL_CORE_SET)
	};
}
