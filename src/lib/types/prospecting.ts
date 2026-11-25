/** Core stat keys used across pans, shovels, equipment, and boosts in Prospecting! */
export type StatKey =
	| 'luck'
	| 'nightLuck'
	| 'capacity'
	| 'inventorySize'
	| 'shakeStrength'
	| 'shakeSpeed'
	| 'digStrength'
	| 'digSpeed'
	| 'toughness'
	| 'sellBoost'
	| 'sizeBoost'
	| 'modifierBoost'
	| 'walkSpeed'
	| 'jumpPower';

export type StatMap = Partial<Record<StatKey, number>>;

/**
 * Additive base/flat values, percentage boosts (expressed as decimals, e.g. 0.25 = +25%),
 * and multiplicative factors (e.g. 1.1 = 1.1x).
 */
export interface StatModifiers {
	base?: StatMap;
	flats?: StatMap;
	boosts?: StatMap;
	multipliers?: StatMap;
}

export interface Pan {
	id: string;
	name: string;
	stats: {
		luck: number;
		capacity: number;
		shakeStrength: number;
		shakeSpeed: number;
	};
	price?: string;
	location?: string;
	passive?: string;
	wikiUrl?: string;
}

export interface Shovel {
	id: string;
	name: string;
	stats: {
		digStrength: number;
		digSpeed: number;
		toughness: number;
	};
	price?: string;
	location?: string;
	passive?: string;
	wikiUrl?: string;
}

export interface PanTrinket {
	id: string;
	name: string;
	effect: string;
	location?: string;
	obtainment?: string;
	price?: string;
	modeled: boolean;
	modelNote?: string;
	wikiUrl?: string;
}

export type EnchantTarget = 'pan' | 'shovel';

export interface Enchant {
	id: string;
	name: string;
	target: EnchantTarget;
	modifiers: StatModifiers;
	rawEffects?: string[];
	notes?: string;
}

export type EquipmentSlot = 'necklace' | 'charm' | 'ring';

export interface EquipmentItem {
	id: string;
	name: string;
	slot: EquipmentSlot;
	stars?: number;
	rarity?: string;
	price?: string;
	location?: string;
	rawStats?: string;
	modifiers: StatModifiers;
	minModifiers?: StatModifiers;
	statRanges?: Partial<Record<StatKey, [number, number]>>;
	sixStarModifiers?: StatModifiers;
	sixStarMinModifiers?: StatModifiers;
	sixStarStatRanges?: Partial<Record<StatKey, [number, number]>>;
	passive?: string;
	wikiUrl?: string;
}

export interface Rune {
	id: string;
	name: string;
	location?: string;
	modifiers: StatModifiers;
	rawEffects?: string[];
	notes?: string;
	wikiUrl?: string;
}

export interface BoostSource {
	id: string;
	name: string;
	category: 'museum' | 'totem' | 'potion' | 'mastery' | 'other';
	price?: string;
	duration?: string;
	modifiers: StatModifiers;
	rawEffects?: string[];
	wikiUrl?: string;
}

export interface BuildLoadout {
	pan: Pan | null;
	panEnchant: Enchant | null;
	panTrinket?: PanTrinket | null;
	shovel: Shovel | null;
	shovelEnchant: Enchant | null;
	necklace: EquipmentItem | null;
	charm: EquipmentItem | null;
	/** Up to 8 equipped ring slots. */
	rings: Array<EquipmentItem | null>;
	runes: Rune[];
	extraSources: BoostSource[];
	extraFlats?: StatMap;
	extraBoosts?: StatMap;
}

export type EquipmentTier = 'base' | '6star';

export interface EquipmentMutation {
	id: string;
	name: string;
	/** Universal multiplier applied to positive stats of the mutated equipment item (e.g. 1.6 for Prismatic). */
	statMultiplier: number;
	/** Additional additive bonuses granted by the mutation (e.g. Sunforged +300 Luck, +30% Sell Boost). */
	bonusModifiers?: StatModifiers;
	rawEffects?: string[];
	notes?: string;
	wikiUrl?: string;
}

export interface EquippedJewelrySelection {
	itemId: string;
	tier: EquipmentTier;
	/** Normalized roll quality from 0 (min) to 1 (max), representing the global/average quality. Defaults to 1. */
	rollQuality: number;
	/** Optional per-stat roll qualities in [0, 1] for items with ranged stats. */
	statRollQualities?: Partial<Record<StatKey, number>>;
	mutationId?: string | null;
}

export interface SavedBuild {
	id: string;
	name: string;
	updatedAt: string;
	panId: string | null;
	panEnchantId: string | null;
	panTrinketId?: string | null;
	shovelId: string | null;
	shovelEnchantId: string | null;
	necklace: EquippedJewelrySelection | null;
	charm: EquippedJewelrySelection | null;
	rings: Array<EquippedJewelrySelection | null>;
	runeIds: string[];
	boostIds: string[];
	museumId?: string | null;
}

export interface StatBreakdown {
	base: number;
	flats: number;
	boosts: number;
	multiplier: number;
	final: number;
}

export type CalculatedStats = Record<StatKey, StatBreakdown>;

export type OptimizationGoal =
	| 'luck'
	| 'money'
	| 'capacity'
	| 'dig_speed'
	| 'shake_speed'
	| 'balanced';

export type MineralRarity =
	| 'common'
	| 'uncommon'
	| 'rare'
	| 'epic'
	| 'legendary'
	| 'mythic'
	| 'exotic';

export interface GameLocation {
	id: string;
	name: string;
	region: string;
}

export interface MineralLocationChance {
	location: string;
	chance_percent: number;
}

export interface MineralChestDrop {
	name: string;
	location: string;
	chance_percent: number;
}

export interface MineralEntry {
	mineral: string;
	rarity: MineralRarity | string;
	locations: MineralLocationChance[];
	chests?: MineralChestDrop[];
}

export interface MineralCatalog {
	meta: {
		game: string;
		version: string;
		lastUpdated: string;
		source: string;
	};
	locations: GameLocation[];
	minerals: MineralEntry[];
}

export interface MineralModifier {
	id: string;
	name: string;
	sellMultiplier: number;
	/** Base conditional chance (%) among modified ores during regular panning, or 0 for special-source modifiers. */
	baseChancePercent: number;
	color: string;
	source: 'panning' | 'night' | 'crystal_touch' | 'void_touched' | 'chest' | 'purity';
	museumBonus?: string;
	notes?: string;
}

export type MuseumRarity =
	| 'common'
	| 'uncommon'
	| 'rare'
	| 'epic'
	| 'legendary'
	| 'mythic'
	| 'exotic';

export interface MuseumOreEntry {
	id: string;
	name: string;
	rarity: MuseumRarity;
	minKg: number;
	maxBoosts: StatMap;
	canBeTreasured?: boolean;
	canBeEntombed?: boolean;
	chestOnly?: boolean;
}

export interface MuseumModifierRider {
	id: string;
	name: string;
	color: string;
	stats: StatKey[];
	/** 2 for Treasured / Entombed, 1 for all other modifiers with a museum bonus. */
	multiplierFactor: number;
}

export interface MuseumCatalog {
	slotCounts: Record<MuseumRarity, number>;
	rarityMultipliers: Record<MuseumRarity, number>;
	ores: MuseumOreEntry[];
	modifierRiders: MuseumModifierRider[];
}

export interface MuseumSlotSelection {
	oreId: string;
	weightKg: number;
	modifierId: string | null;
}

export interface SavedMuseum {
	id: string;
	name: string;
	updatedAt: string;
	slots: Record<MuseumRarity, Array<MuseumSlotSelection | null>>;
}
