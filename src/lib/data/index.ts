import type {
	BoostSource,
	Enchant,
	EquipmentItem,
	EquipmentMutation,
	GameLocation,
	MineralCatalog,
	MineralEntry,
	MineralModifier,
	MuseumCatalog,
	MuseumModifierRider,
	MuseumOreEntry,
	MuseumRarity,
	Pan,
	PanTrinket,
	Rune,
	Shovel
} from '#lib/types/prospecting.ts';

import boostsData from './boosts.json' with { type: 'json' };
import enchantsData from './enchants.json' with { type: 'json' };
import equipmentData from './equipment.json' with { type: 'json' };
import mineralsData from './minerals.json' with { type: 'json' };
import modifiersData from './modifiers.json' with { type: 'json' };
import museumData from './museum.json' with { type: 'json' };
import mutationsData from './mutations.json' with { type: 'json' };
import pansData from './pans.json' with { type: 'json' };
import runesData from './runes.json' with { type: 'json' };
import shovelsData from './shovels.json' with { type: 'json' };
import trinketsData from './trinkets.json' with { type: 'json' };

export const WIKI_BASE_URL = 'https://prospecting.miraheze.org/wiki/Main_Page';

/** Catalogs synced from the official Prospecting! Miraheze wiki via `npm run sync:data`. */
export const PANS = pansData as Pan[];
export const SHOVELS = shovelsData as Shovel[];
export const ENCHANTS = enchantsData as Enchant[];
export const TRINKETS = trinketsData as PanTrinket[];
export const EQUIPMENT = equipmentData as EquipmentItem[];
export const MUTATIONS = mutationsData as EquipmentMutation[];
export const RUNES = runesData as Rune[];
export const BOOST_SOURCES = boostsData as BoostSource[];

export const MINERAL_CATALOG = mineralsData as MineralCatalog;
export const LOCATIONS: GameLocation[] = MINERAL_CATALOG.locations;
export const MINERALS: MineralEntry[] = MINERAL_CATALOG.minerals;
export const MODIFIERS = modifiersData as MineralModifier[];

export const MUSEUM_CATALOG = museumData as MuseumCatalog;
export const MUSEUM_ORES: MuseumOreEntry[] = MUSEUM_CATALOG.ores;
export const MUSEUM_MODIFIER_RIDERS: MuseumModifierRider[] = MUSEUM_CATALOG.modifierRiders;
export const MUSEUM_SLOT_COUNTS: Record<MuseumRarity, number> = MUSEUM_CATALOG.slotCounts;
export const MUSEUM_RARITY_MULTIPLIERS: Record<MuseumRarity, number> =
	MUSEUM_CATALOG.rarityMultipliers;
