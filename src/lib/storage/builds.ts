import { MAX_RING_SLOTS } from '#lib/engine/stats.ts';
import type {
	EquippedJewelrySelection,
	SavedBuild
} from '#lib/types/prospecting.ts';

const SAVED_BUILDS_KEY = 'prospecting-calculator:saved-builds:v1';
const DRAFT_BUILD_KEY = 'prospecting-calculator:draft-build:v1';

function isBrowser(): boolean {
	return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

export function generateBuildId(): string {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return crypto.randomUUID();
	}
	return `build-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function normalizeJewelrySelection(raw: unknown): EquippedJewelrySelection | null {
	if (!raw || typeof raw !== 'object') return null;
	const candidate = raw as Record<string, unknown>;
	if (typeof candidate.itemId !== 'string' || !candidate.itemId) return null;
	const tier = candidate.tier === '6star' ? '6star' : 'base';
	const rawRoll = typeof candidate.rollQuality === 'number' ? candidate.rollQuality : 1;
	const rollQuality = Number.isFinite(rawRoll) ? Math.min(1, Math.max(0, rawRoll)) : 1;
	const mutationId = normalizeStringOrNull(candidate.mutationId);
	return {
		itemId: candidate.itemId,
		tier,
		rollQuality,
		mutationId
	};
}

function normalizeStringOrNull(val: unknown): string | null {
	return typeof val === 'string' && val.length > 0 ? val : null;
}

function normalizeStringArray(val: unknown): string[] {
	if (!Array.isArray(val)) return [];
	return val.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
}

/** Validates and normalizes untrusted JSON into a well-formed SavedBuild. */
export function normalizeSavedBuild(raw: unknown): SavedBuild | null {
	if (!raw || typeof raw !== 'object') return null;
	const obj = raw as Record<string, unknown>;

	const name = typeof obj.name === 'string' && obj.name.trim() ? obj.name.trim() : 'Build Senza Nome';
	const id = typeof obj.id === 'string' ? obj.id : '';
	const updatedAt =
		typeof obj.updatedAt === 'string' && obj.updatedAt ? obj.updatedAt : new Date().toISOString();

	const rawRings = Array.isArray(obj.rings) ? obj.rings : [];
	const rings = Array.from({ length: MAX_RING_SLOTS }, (_, idx) =>
		normalizeJewelrySelection(rawRings[idx])
	);

	return {
		id,
		name,
		updatedAt,
		panId: normalizeStringOrNull(obj.panId),
		panEnchantId: normalizeStringOrNull(obj.panEnchantId),
		panTrinketId: normalizeStringOrNull(obj.panTrinketId),
		shovelId: normalizeStringOrNull(obj.shovelId),
		shovelEnchantId: normalizeStringOrNull(obj.shovelEnchantId),
		necklace: normalizeJewelrySelection(obj.necklace),
		charm: normalizeJewelrySelection(obj.charm),
		rings,
		runeIds: normalizeStringArray(obj.runeIds),
		boostIds: normalizeStringArray(obj.boostIds),
		museumId: normalizeStringOrNull(obj.museumId)
	};
}

export function loadSavedBuilds(): SavedBuild[] {
	if (!isBrowser()) return [];
	try {
		const raw = window.localStorage.getItem(SAVED_BUILDS_KEY);
		if (!raw) return [];
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return parsed
			.map((entry) => normalizeSavedBuild(entry))
			.filter((b): b is SavedBuild => b !== null && b.id.length > 0);
	} catch {
		return [];
	}
}

export function saveSavedBuilds(builds: SavedBuild[]): void {
	if (!isBrowser()) return;
	try {
		window.localStorage.setItem(SAVED_BUILDS_KEY, JSON.stringify(builds));
	} catch {
		// Ignore quota/storage errors
	}
}

export function upsertSavedBuild(build: SavedBuild): SavedBuild[] {
	const existing = loadSavedBuilds();
	const now = new Date().toISOString();
	const id = build.id || generateBuildId();
	const normalized: SavedBuild = {
		...build,
		id,
		name: build.name.trim() || 'Build Senza Nome',
		updatedAt: now
	};

	const idx = existing.findIndex((item) => item.id === id);
	const next =
		idx === -1
			? [normalized, ...existing]
			: [normalized, ...existing.filter((item) => item.id !== id)];

	saveSavedBuilds(next);
	return next;
}

export function deleteSavedBuild(id: string): SavedBuild[] {
	const next = loadSavedBuilds().filter((item) => item.id !== id);
	saveSavedBuilds(next);
	return next;
}

export function loadDraftBuild(): SavedBuild | null {
	if (!isBrowser()) return null;
	try {
		const raw = window.localStorage.getItem(DRAFT_BUILD_KEY);
		if (!raw) return null;
		return normalizeSavedBuild(JSON.parse(raw));
	} catch {
		return null;
	}
}

export function saveDraftBuild(build: SavedBuild): void {
	if (!isBrowser()) return;
	try {
		window.localStorage.setItem(DRAFT_BUILD_KEY, JSON.stringify(build));
	} catch {
		// Ignore quota/storage errors
	}
}
