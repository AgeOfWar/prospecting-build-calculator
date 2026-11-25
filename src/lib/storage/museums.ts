import { MUSEUM_SLOT_COUNTS } from '#lib/data/index.ts';
import { MUSEUM_RARITIES_DESC } from '#lib/engine/museum.ts';
import type {
	MuseumRarity,
	MuseumSlotSelection,
	SavedMuseum
} from '#lib/types/prospecting.ts';

const SAVED_MUSEUMS_KEY = 'prospecting-calculator:saved-museums:v1';
const DRAFT_MUSEUM_KEY = 'prospecting-calculator:draft-museum:v1';

function isBrowser(): boolean {
	return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

export function generateMuseumId(): string {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return crypto.randomUUID();
	}
	return `museum-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function normalizeSlotSelection(raw: unknown): MuseumSlotSelection | null {
	if (!raw || typeof raw !== 'object') return null;
	const obj = raw as Record<string, unknown>;
	if (typeof obj.oreId !== 'string' || !obj.oreId) return null;
	const rawWeight = typeof obj.weightKg === 'number' ? obj.weightKg : 0;
	const weightKg = Number.isFinite(rawWeight) ? Math.max(0, rawWeight) : 0;
	const modifierId =
		typeof obj.modifierId === 'string' && obj.modifierId.length > 0 ? obj.modifierId : null;
	return { oreId: obj.oreId, weightKg, modifierId };
}

export function normalizeSavedMuseum(raw: unknown): SavedMuseum | null {
	if (!raw || typeof raw !== 'object') return null;
	const obj = raw as Record<string, unknown>;

	const name =
		typeof obj.name === 'string' && obj.name.trim() ? obj.name.trim() : 'Museo Senza Nome';
	const id = typeof obj.id === 'string' ? obj.id : '';
	const updatedAt =
		typeof obj.updatedAt === 'string' && obj.updatedAt ? obj.updatedAt : new Date().toISOString();

	const rawSlots = (obj.slots && typeof obj.slots === 'object' ? obj.slots : {}) as Record<
		string,
		unknown
	>;

	const slots = {} as Record<MuseumRarity, Array<MuseumSlotSelection | null>>;
	for (const rarity of MUSEUM_RARITIES_DESC) {
		const count = MUSEUM_SLOT_COUNTS[rarity];
		const arr = Array.isArray(rawSlots[rarity]) ? (rawSlots[rarity] as unknown[]) : [];
		slots[rarity] = Array.from({ length: count }, (_, idx) => normalizeSlotSelection(arr[idx]));
	}

	return { id, name, updatedAt, slots };
}

export function loadSavedMuseums(): SavedMuseum[] {
	if (!isBrowser()) return [];
	try {
		const raw = window.localStorage.getItem(SAVED_MUSEUMS_KEY);
		if (!raw) return [];
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return parsed
			.map((entry) => normalizeSavedMuseum(entry))
			.filter((m): m is SavedMuseum => m !== null && m.id.length > 0);
	} catch {
		return [];
	}
}

export function saveSavedMuseums(museums: SavedMuseum[]): void {
	if (!isBrowser()) return;
	try {
		window.localStorage.setItem(SAVED_MUSEUMS_KEY, JSON.stringify(museums));
	} catch {
		// Ignore quota/storage errors
	}
}

export function upsertSavedMuseum(museum: SavedMuseum): SavedMuseum[] {
	const existing = loadSavedMuseums();
	const now = new Date().toISOString();
	const id = museum.id || generateMuseumId();
	const normalized: SavedMuseum = {
		...museum,
		id,
		name: museum.name.trim() || 'Museo Senza Nome',
		updatedAt: now
	};

	const idx = existing.findIndex((item) => item.id === id);
	const next =
		idx === -1
			? [normalized, ...existing]
			: [normalized, ...existing.filter((item) => item.id !== id)];

	saveSavedMuseums(next);
	return next;
}

export function deleteSavedMuseum(id: string): SavedMuseum[] {
	const next = loadSavedMuseums().filter((item) => item.id !== id);
	saveSavedMuseums(next);
	return next;
}

export function loadDraftMuseum(): SavedMuseum | null {
	if (!isBrowser()) return null;
	try {
		const raw = window.localStorage.getItem(DRAFT_MUSEUM_KEY);
		if (!raw) return null;
		return normalizeSavedMuseum(JSON.parse(raw));
	} catch {
		return null;
	}
}

export function saveDraftMuseum(museum: SavedMuseum): void {
	if (!isBrowser()) return;
	try {
		window.localStorage.setItem(DRAFT_MUSEUM_KEY, JSON.stringify(museum));
	} catch {
		// Ignore quota/storage errors
	}
}
