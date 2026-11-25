import { DEFAULT_CHANCE_INPUTS, type ChanceInputs } from '#lib/engine/chance.ts';
import {
	DEFAULT_OPTIMIZER_OPTIONS,
	type OptimizerOptions,
	type OptimizerPotionMode
} from '#lib/engine/optimizer.ts';
import type { MineralRarity } from '#lib/types/prospecting.ts';

const DRAFT_OPTIMIZER_SEARCH_KEY = 'prospecting-calculator:draft-optimizer-search:v1';
const SAVED_OPTIMIZER_SEARCHES_KEY = 'prospecting-calculator:saved-optimizer-searches:v1';

const DRAFT_CHANCE_SEARCH_KEY = 'prospecting-calculator:draft-chance-search:v1';
const SAVED_CHANCE_SEARCHES_KEY = 'prospecting-calculator:saved-chance-searches:v1';

export type OptimizerSearchConfig = Omit<OptimizerOptions, 'fixedMuseum'> & {
	selectedSavedMuseumId: string;
	compareBuildId: string;
	rarityFilter: 'all' | MineralRarity;
};

export interface SavedOptimizerSearch {
	id: string;
	name: string;
	updatedAt: string;
	config: OptimizerSearchConfig;
}

export interface ChanceSearchState {
	selectedMineralName: string;
	rarityFilter: 'all' | MineralRarity;
	locationFilter: string;
	selectedBuildId: string;
	inputs: ChanceInputs;
}

export interface SavedChanceSearch {
	id: string;
	name: string;
	updatedAt: string;
	state: ChanceSearchState;
}

const VALID_RARITY_FILTERS = new Set<string>([
	'all',
	'common',
	'uncommon',
	'rare',
	'epic',
	'legendary',
	'mythic',
	'exotic'
]);

function isBrowser(): boolean {
	return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

export function generateSearchId(prefix = 'search'): string {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return crypto.randomUUID();
	}
	return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function asStringOrNull(val: unknown): string | null {
	return typeof val === 'string' && val.length > 0 ? val : null;
}

function asStringOrEmpty(val: unknown, fallback = ''): string {
	return typeof val === 'string' ? val : fallback;
}

function asFiniteNumber(val: unknown, fallback: number): number {
	return typeof val === 'number' && Number.isFinite(val) ? val : fallback;
}

function asPositiveNumberOrNull(val: unknown): number | null {
	return typeof val === 'number' && Number.isFinite(val) && val > 0 ? val : null;
}

function asBoolean(val: unknown, fallback: boolean): boolean {
	return typeof val === 'boolean' ? val : fallback;
}

function normalizeRarityFilter(val: unknown): 'all' | MineralRarity {
	return typeof val === 'string' && VALID_RARITY_FILTERS.has(val)
		? (val as 'all' | MineralRarity)
		: 'all';
}

function normalizePotionMode(val: unknown): OptimizerPotionMode {
	if (val === 'none' || val === 'shop_cash' || val === 'cash_all' || val === 'all') {
		return val;
	}
	if (val === 'cash_only') return 'cash_all';
	return DEFAULT_OPTIMIZER_OPTIONS.potionMode;
}

export function normalizeOptimizerSearchConfig(raw: unknown): OptimizerSearchConfig | null {
	if (!raw || typeof raw !== 'object') return null;
	const obj = raw as Record<string, unknown>;

	return {
		targetMode: obj.targetMode === 'rare_generic' ? 'rare_generic' : 'specific',
		mineralName: asStringOrNull(obj.mineralName) ?? DEFAULT_OPTIMIZER_OPTIONS.mineralName,
		locationName: asStringOrNull(obj.locationName),
		minWeightKg: asPositiveNumberOrNull(obj.minWeightKg),
		targetModifierId: asStringOrNull(obj.targetModifierId),
		timeMethod: obj.timeMethod === 'sand' ? 'sand' : 'autopan',
		trinketMode:
			typeof obj.trinketMode === 'string' && obj.trinketMode.length > 0
				? obj.trinketMode
				: DEFAULT_OPTIMIZER_OPTIONS.trinketMode,
		shovelEnchantMode:
			typeof obj.shovelEnchantMode === 'string' && obj.shovelEnchantMode.length > 0
				? obj.shovelEnchantMode
				: DEFAULT_OPTIMIZER_OPTIONS.shovelEnchantMode,
		jewelryTier: obj.jewelryTier === 'base' ? 'base' : '6star',
		rollQuality: Math.min(1, Math.max(0, asFiniteNumber(obj.rollQuality, 1))),
		mutationMode:
			typeof obj.mutationMode === 'string' && obj.mutationMode.length > 0
				? obj.mutationMode
				: DEFAULT_OPTIMIZER_OPTIONS.mutationMode,
		museumMode:
			obj.museumMode === 'saved' || obj.museumMode === 'none' ? obj.museumMode : 'optimize',
		museumWeightPct: Math.min(100, Math.max(0, asFiniteNumber(obj.museumWeightPct, 100))),
		museumRiderMode:
			obj.museumRiderMode === 'panning_only' || obj.museumRiderMode === 'none'
				? obj.museumRiderMode
				: 'all',
		optimizeRunes: asBoolean(obj.optimizeRunes, DEFAULT_OPTIMIZER_OPTIONS.optimizeRunes),
		maxRunes: Math.min(5, Math.max(0, Math.floor(asFiniteNumber(obj.maxRunes, 5)))),
		ringSlots: Math.min(8, Math.max(1, Math.floor(asFiniteNumber(obj.ringSlots, 8)))),
		allowPurityRune: asBoolean(obj.allowPurityRune, DEFAULT_OPTIMIZER_OPTIONS.allowPurityRune),
		includeTotems: asBoolean(obj.includeTotems, DEFAULT_OPTIMIZER_OPTIONS.includeTotems),
		potionMode: normalizePotionMode(obj.potionMode),
		minToughness: Math.max(0, Math.floor(asFiniteNumber(obj.minToughness, 0))),
		solarMagnifier: asBoolean(obj.solarMagnifier, DEFAULT_OPTIMIZER_OPTIONS.solarMagnifier),
		volcanicEruption: asBoolean(obj.volcanicEruption, DEFAULT_OPTIMIZER_OPTIONS.volcanicEruption),
		modifierSurge: asBoolean(obj.modifierSurge, DEFAULT_OPTIMIZER_OPTIONS.modifierSurge),
		isNight: asBoolean(obj.isNight, DEFAULT_OPTIMIZER_OPTIONS.isNight),
		selectedSavedMuseumId: asStringOrEmpty(obj.selectedSavedMuseumId),
		compareBuildId: asStringOrEmpty(obj.compareBuildId),
		rarityFilter: normalizeRarityFilter(obj.rarityFilter)
	};
}

function normalizeSavedOptimizerSearch(raw: unknown): SavedOptimizerSearch | null {
	if (!raw || typeof raw !== 'object') return null;
	const obj = raw as Record<string, unknown>;
	const id = typeof obj.id === 'string' ? obj.id : '';
	const config = normalizeOptimizerSearchConfig(obj.config);
	if (!id || !config) return null;
	const name =
		typeof obj.name === 'string' && obj.name.trim() ? obj.name.trim() : 'Untitled Search';
	const updatedAt =
		typeof obj.updatedAt === 'string' && obj.updatedAt ? obj.updatedAt : new Date().toISOString();
	return { id, name, updatedAt, config };
}

export function loadOptimizerDraft(): OptimizerSearchConfig | null {
	if (!isBrowser()) return null;
	try {
		const raw = window.localStorage.getItem(DRAFT_OPTIMIZER_SEARCH_KEY);
		if (!raw) return null;
		return normalizeOptimizerSearchConfig(JSON.parse(raw));
	} catch {
		return null;
	}
}

export function saveOptimizerDraft(config: OptimizerSearchConfig): void {
	if (!isBrowser()) return;
	try {
		window.localStorage.setItem(DRAFT_OPTIMIZER_SEARCH_KEY, JSON.stringify(config));
	} catch {
		// Ignore quota/storage errors
	}
}

export function loadSavedOptimizerSearches(): SavedOptimizerSearch[] {
	if (!isBrowser()) return [];
	try {
		const raw = window.localStorage.getItem(SAVED_OPTIMIZER_SEARCHES_KEY);
		if (!raw) return [];
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return parsed
			.map((entry) => normalizeSavedOptimizerSearch(entry))
			.filter((entry): entry is SavedOptimizerSearch => entry !== null);
	} catch {
		return [];
	}
}

export function upsertSavedOptimizerSearch(search: SavedOptimizerSearch): SavedOptimizerSearch[] {
	const existing = loadSavedOptimizerSearches();
	const now = new Date().toISOString();
	const id = search.id || generateSearchId('opt');
	const normalized: SavedOptimizerSearch = {
		id,
		name: search.name.trim() || 'Optimizer Search',
		updatedAt: now,
		config: search.config
	};
	const next = [normalized, ...existing.filter((item) => item.id !== id)];
	if (isBrowser()) {
		try {
			window.localStorage.setItem(SAVED_OPTIMIZER_SEARCHES_KEY, JSON.stringify(next));
		} catch {
			// Ignore quota/storage errors
		}
	}
	return next;
}

export function deleteSavedOptimizerSearch(id: string): SavedOptimizerSearch[] {
	const next = loadSavedOptimizerSearches().filter((item) => item.id !== id);
	if (isBrowser()) {
		try {
			window.localStorage.setItem(SAVED_OPTIMIZER_SEARCHES_KEY, JSON.stringify(next));
		} catch {
			// Ignore quota/storage errors
		}
	}
	return next;
}

function normalizeChanceInputs(raw: unknown): ChanceInputs {
	const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
	return {
		luck: Math.max(0, asFiniteNumber(obj.luck, DEFAULT_CHANCE_INPUTS.luck)),
		capacity: Math.max(1, asFiniteNumber(obj.capacity, DEFAULT_CHANCE_INPUTS.capacity)),
		timeMethod: obj.timeMethod === 'sand' ? 'sand' : 'autopan',
		shakeSpeedPct: Math.max(
			0,
			asFiniteNumber(obj.shakeSpeedPct, DEFAULT_CHANCE_INPUTS.shakeSpeedPct)
		),
		shakeStrength: Math.max(
			0.01,
			asFiniteNumber(obj.shakeStrength, DEFAULT_CHANCE_INPUTS.shakeStrength)
		),
		digsToFill: Math.max(0, asFiniteNumber(obj.digsToFill, DEFAULT_CHANCE_INPUTS.digsToFill)),
		digSpeedPct: Math.max(0.01, asFiniteNumber(obj.digSpeedPct, DEFAULT_CHANCE_INPUTS.digSpeedPct)),
		sizeBoostPct: Math.max(0, asFiniteNumber(obj.sizeBoostPct, DEFAULT_CHANCE_INPUTS.sizeBoostPct)),
		modifierBoostPct: Math.max(
			0,
			asFiniteNumber(obj.modifierBoostPct, DEFAULT_CHANCE_INPUTS.modifierBoostPct)
		),
		minWeightKg: asPositiveNumberOrNull(obj.minWeightKg),
		targetModifierId: asStringOrNull(obj.targetModifierId),
		solarMagnifier: asBoolean(obj.solarMagnifier, DEFAULT_CHANCE_INPUTS.solarMagnifier),
		volcanicEruption: asBoolean(obj.volcanicEruption, DEFAULT_CHANCE_INPUTS.volcanicEruption),
		modifierSurge: asBoolean(obj.modifierSurge, DEFAULT_CHANCE_INPUTS.modifierSurge),
		isNight: asBoolean(obj.isNight, DEFAULT_CHANCE_INPUTS.isNight),
		hasCrystalTouch: asBoolean(obj.hasCrystalTouch, DEFAULT_CHANCE_INPUTS.hasCrystalTouch),
		hasVoidTouched: asBoolean(obj.hasVoidTouched, DEFAULT_CHANCE_INPUTS.hasVoidTouched),
		hasPurityRune: asBoolean(obj.hasPurityRune, DEFAULT_CHANCE_INPUTS.hasPurityRune),
		hasAlchemistsCrucible: asBoolean(
			obj.hasAlchemistsCrucible,
			Boolean(DEFAULT_CHANCE_INPUTS.hasAlchemistsCrucible)
		)
	};
}

export function normalizeChanceSearchState(raw: unknown): ChanceSearchState | null {
	if (!raw || typeof raw !== 'object') return null;
	const obj = raw as Record<string, unknown>;
	return {
		selectedMineralName: asStringOrEmpty(obj.selectedMineralName),
		rarityFilter: normalizeRarityFilter(obj.rarityFilter),
		locationFilter: asStringOrEmpty(obj.locationFilter, 'all') || 'all',
		selectedBuildId: asStringOrEmpty(obj.selectedBuildId),
		inputs: normalizeChanceInputs(obj.inputs)
	};
}

function normalizeSavedChanceSearch(raw: unknown): SavedChanceSearch | null {
	if (!raw || typeof raw !== 'object') return null;
	const obj = raw as Record<string, unknown>;
	const id = typeof obj.id === 'string' ? obj.id : '';
	const state = normalizeChanceSearchState(obj.state);
	if (!id || !state) return null;
	const name =
		typeof obj.name === 'string' && obj.name.trim() ? obj.name.trim() : 'Untitled Search';
	const updatedAt =
		typeof obj.updatedAt === 'string' && obj.updatedAt ? obj.updatedAt : new Date().toISOString();
	return { id, name, updatedAt, state };
}

export function loadChanceDraft(): ChanceSearchState | null {
	if (!isBrowser()) return null;
	try {
		const raw = window.localStorage.getItem(DRAFT_CHANCE_SEARCH_KEY);
		if (!raw) return null;
		return normalizeChanceSearchState(JSON.parse(raw));
	} catch {
		return null;
	}
}

export function saveChanceDraft(state: ChanceSearchState): void {
	if (!isBrowser()) return;
	try {
		window.localStorage.setItem(DRAFT_CHANCE_SEARCH_KEY, JSON.stringify(state));
	} catch {
		// Ignore quota/storage errors
	}
}

export function loadSavedChanceSearches(): SavedChanceSearch[] {
	if (!isBrowser()) return [];
	try {
		const raw = window.localStorage.getItem(SAVED_CHANCE_SEARCHES_KEY);
		if (!raw) return [];
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return parsed
			.map((entry) => normalizeSavedChanceSearch(entry))
			.filter((entry): entry is SavedChanceSearch => entry !== null);
	} catch {
		return [];
	}
}

export function upsertSavedChanceSearch(search: SavedChanceSearch): SavedChanceSearch[] {
	const existing = loadSavedChanceSearches();
	const now = new Date().toISOString();
	const id = search.id || generateSearchId('chance');
	const normalized: SavedChanceSearch = {
		id,
		name: search.name.trim() || 'Drop Chance Search',
		updatedAt: now,
		state: search.state
	};
	const next = [normalized, ...existing.filter((item) => item.id !== id)];
	if (isBrowser()) {
		try {
			window.localStorage.setItem(SAVED_CHANCE_SEARCHES_KEY, JSON.stringify(next));
		} catch {
			// Ignore quota/storage errors
		}
	}
	return next;
}

export function deleteSavedChanceSearch(id: string): SavedChanceSearch[] {
	const next = loadSavedChanceSearches().filter((item) => item.id !== id);
	if (isBrowser()) {
		try {
			window.localStorage.setItem(SAVED_CHANCE_SEARCHES_KEY, JSON.stringify(next));
		} catch {
			// Ignore quota/storage errors
		}
	}
	return next;
}
