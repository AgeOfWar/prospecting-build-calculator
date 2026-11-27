/**
 * Realistic Money model: expected sell value ($) earned per second while panning.
 *
 * Uses the wiki Stat Systems Guide mechanics:
 * - Average ores per pan = sqrt(Capacity) * (1.08 at 100% dig quality) * (1.5 during Volcanic Eruption),
 *   capped at 20 ores when Mass Reactor is equipped (excess ores are destroyed).
 * - Ore rarity distribution uses the 25% (Luck=1) / 25% (Luck/2) / 50% (Luck) order-statistics roll split
 *   over each location's normalized drop table (chests excluded).
 * - Duplicator (+10%) and Mythical Shovel Enchant (+10%) duplicate Mythic and Exotic ores.
 * - Expected weight (kg) and expected modifier sell multiplier use the exact same models as Chance.
 * - Optional Sell Boost multiplier applies (1 + SellBoost) when selling with the active build.
 */
import { MINERALS, MODIFIERS } from '#lib/data/index.ts';
import { BASE_MAX_KG, BASE_MIN_KG, type ChanceInputs, getCycleSeconds } from '#lib/engine/chance.ts';
import type { CalculatedStats, SavedBuild } from '#lib/types/prospecting.ts';

export type MoneyModelInputs = Pick<
	ChanceInputs,
	| 'luck'
	| 'capacity'
	| 'sizeBoostPct'
	| 'modifierBoostPct'
	| 'solarMagnifier'
	| 'volcanicEruption'
	| 'modifierSurge'
	| 'isNight'
	| 'hasCrystalTouch'
	| 'hasVoidTouched'
	| 'hasPurityRune'
	| 'hasAlchemistsCrucible'
> & {
	sellBoostPct: number;
	includeSellBoost: boolean;
	hasMassReactor: boolean;
	hasDuplicator: boolean;
	hasMythicalEnchant: boolean;
	hasFullDigQuality: boolean;
	cycleSeconds: number;
};

export interface LocationDropOre {
	mineral: string;
	rarity: string;
	pricePerKg: number;
	isMythicOrExotic: boolean;
}

export interface LocationDropTable {
	location: string;
	/** Sorted rarest-first (ascending chance_percent). */
	ores: LocationDropOre[];
	/** Length n + 1, cumulative normalized probability [0..1]. */
	edges: Float64Array;
	/** Math.log1p(-edges[i]) for 0 < edges[i] < 1. */
	logTerms: Float64Array;
	prices: Float64Array;
	isMythicOrExotic: Uint8Array;
	/** Precomputed 25% Luck=1 contribution for non-Mythic/Exotic ores. */
	baseLowNormal: number;
	/** Precomputed 25% Luck=1 contribution for Mythic/Exotic ores. */
	baseLowMythicExotic: number;
	/** Lazy 256-point log-spaced LUTs for O(1) optimizer inner-loop evaluation. */
	lutNormal?: Float64Array;
	lutME?: Float64Array;
}

let locationTablesCache: LocationDropTable[] | null = null;
let locationTableMapCache: Map<string, LocationDropTable> | null = null;

/** Builds and caches normalized panning drop tables per location (excludes chest-only drops). */
export function getLocationDropTables(): LocationDropTable[] {
	if (locationTablesCache) return locationTablesCache;

	const rawByLoc = new Map<
		string,
		Array<{ mineral: string; rarity: string; chancePercent: number; pricePerKg: number }>
	>();

	for (const m of MINERALS) {
		const price = Number(m.pricePerKg);
		if (!Number.isFinite(price) || price <= 0) continue;
		for (const loc of m.locations ?? []) {
			const pct = Number(loc.chance_percent);
			if (!Number.isFinite(pct) || pct <= 0) continue;
			const list = rawByLoc.get(loc.location) ?? [];
			list.push({
				mineral: m.mineral,
				rarity: String(m.rarity || '').toLowerCase(),
				chancePercent: pct,
				pricePerKg: price
			});
			rawByLoc.set(loc.location, list);
		}
	}

	const tables: LocationDropTable[] = [];
	const byName = new Map<string, LocationDropTable>();

	for (const [location, list] of rawByLoc) {
		list.sort((a, b) => a.chancePercent - b.chancePercent);
		const totalPct = list.reduce((s, e) => s + e.chancePercent, 0);
		if (totalPct <= 0) continue;

		const n = list.length;
		const ores: LocationDropOre[] = [];
		const edges = new Float64Array(n + 1);
		const logTerms = new Float64Array(n + 1);
		const prices = new Float64Array(n);
		const isMythicOrExotic = new Uint8Array(n);

		let cum = 0;
		let baseLowNormal = 0;
		let baseLowMythicExotic = 0;

		for (let i = 0; i < n; i++) {
			const entry = list[i];
			const w = entry.chancePercent / totalPct;
			const isME = entry.rarity === 'mythic' || entry.rarity === 'exotic';
			ores.push({
				mineral: entry.mineral,
				rarity: entry.rarity,
				pricePerKg: entry.pricePerKg,
				isMythicOrExotic: isME
			});
			prices[i] = entry.pricePerKg;
			isMythicOrExotic[i] = isME ? 1 : 0;

			if (isME) {
				baseLowMythicExotic += 0.25 * w * entry.pricePerKg;
			} else {
				baseLowNormal += 0.25 * w * entry.pricePerKg;
			}

			cum = Math.min(1, cum + w);
			edges[i + 1] = i === n - 1 ? 1 : cum;
		}

		for (let i = 0; i <= n; i++) {
			const e = edges[i];
			logTerms[i] = e > 0 && e < 1 ? Math.log1p(-e) : 0;
		}

		const table: LocationDropTable = {
			location,
			ores,
			edges,
			logTerms,
			prices,
			isMythicOrExotic,
			baseLowNormal,
			baseLowMythicExotic
		};
		tables.push(table);
		byName.set(location, table);
	}

	locationTablesCache = tables;
	locationTableMapCache = byName;
	return tables;
}

/** Looks up a panning location drop table by exact name. */
export function getLocationDropTableByName(name: string): LocationDropTable | null {
	if (!locationTableMapCache) getLocationDropTables();
	return locationTableMapCache?.get(name) ?? null;
}

function expectedValueAtRolls(table: LocationDropTable, rolls: number, dupMult: number): number {
	const { edges, logTerms, prices, isMythicOrExotic } = table;
	const n = prices.length;
	let prevC = 0;
	let total = 0;
	for (let i = 0; i < n; i++) {
		const edgeHi = edges[i + 1];
		const hi = edgeHi >= 1 ? 1 : -Math.expm1(rolls * logTerms[i + 1]);
		const prob = hi - prevC;
		if (prob > 0) {
			total += prob * prices[i] * (isMythicOrExotic[i] ? dupMult : 1);
		}
		prevC = hi;
		if (1 - prevC < 1e-12) break;
	}
	return total;
}

/**
 * Expected base sell value ($/kg) per panned ore using the 25% (L=1) / 25% (L/2) / 50% (L)
 * Luck order-statistics model.
 */
export function expectedValuePerKg(table: LocationDropTable, luck: number, dupMult = 1): number {
	const effLuck = Math.max(1, Number(luck) || 1);
	const low = table.baseLowNormal + table.baseLowMythicExotic * dupMult;
	const mid = 0.25 * expectedValueAtRolls(table, Math.max(1, effLuck / 2), dupMult);
	const high = 0.5 * expectedValueAtRolls(table, effLuck, dupMult);
	return low + mid + high;
}

const VALUE_LUT_SIZE = 256;
const VALUE_LUT_MAX_LUCK = 2_000_000;
const VALUE_LN_MAX = Math.log(VALUE_LUT_MAX_LUCK);
const VALUE_LUT_STEP = VALUE_LN_MAX / (VALUE_LUT_SIZE - 1);

function ensureValueLut(table: LocationDropTable): { lutNormal: Float64Array; lutME: Float64Array } {
	if (table.lutNormal && table.lutME) {
		return { lutNormal: table.lutNormal, lutME: table.lutME };
	}
	const lutNormal = new Float64Array(VALUE_LUT_SIZE);
	const lutME = new Float64Array(VALUE_LUT_SIZE);
	const { edges, logTerms, prices, isMythicOrExotic } = table;
	const n = prices.length;

	for (let k = 0; k < VALUE_LUT_SIZE; k++) {
		const rolls = Math.exp(k * VALUE_LUT_STEP);
		let prevC = 0;
		let normalSum = 0;
		let meSum = 0;
		for (let i = 0; i < n; i++) {
			const edgeHi = edges[i + 1];
			const hi = edgeHi >= 1 ? 1 : -Math.expm1(rolls * logTerms[i + 1]);
			const prob = hi - prevC;
			if (prob > 0) {
				const v = prob * prices[i];
				if (isMythicOrExotic[i]) meSum += v;
				else normalSum += v;
			}
			prevC = hi;
			if (1 - prevC < 1e-12) break;
		}
		lutNormal[k] = normalSum;
		lutME[k] = meSum;
	}
	table.lutNormal = lutNormal;
	table.lutME = lutME;
	return { lutNormal, lutME };
}

/**
 * Fast O(1) log-linear LUT approximation of {@link expectedValuePerKg} for the optimizer inner loop.
 * Falls back to exact calculation above 2,000,000 Luck.
 */
export function expectedValuePerKgFast(
	table: LocationDropTable,
	luck: number,
	dupMult = 1
): number {
	const effLuck = Math.max(1, Number(luck) || 1);
	if (effLuck > VALUE_LUT_MAX_LUCK) {
		return expectedValuePerKg(table, effLuck, dupMult);
	}
	const { lutNormal, lutME } = ensureValueLut(table);
	const lnHigh = Math.log(effLuck);
	const lnMid = lnHigh > Math.LN2 ? lnHigh - Math.LN2 : 0;

	const posH = lnHigh / VALUE_LUT_STEP;
	const idxH = Math.min(VALUE_LUT_SIZE - 2, posH | 0);
	const fracH = posH - idxH;
	const nH = lutNormal[idxH] + (lutNormal[idxH + 1] - lutNormal[idxH]) * fracH;
	const meH = lutME[idxH] + (lutME[idxH + 1] - lutME[idxH]) * fracH;

	const posM = lnMid / VALUE_LUT_STEP;
	const idxM = Math.min(VALUE_LUT_SIZE - 2, posM | 0);
	const fracM = posM - idxM;
	const nM = lutNormal[idxM] + (lutNormal[idxM + 1] - lutNormal[idxM]) * fracM;
	const meM = lutME[idxM] + (lutME[idxM + 1] - lutME[idxM]) * fracM;

	const low = table.baseLowNormal + table.baseLowMythicExotic * dupMult;
	return low + 0.25 * (nM + meM * dupMult) + 0.5 * (nH + meH * dupMult);
}

/**
 * Returns the upper-envelope panning locations (top 1 winner at any Luck in 10..1,000,000
 * for dupMult = 1 and 1.2) so dominated locations do not slow down optimization.
 */
export function selectFrontierLocations(tables: LocationDropTable[]): LocationDropTable[] {
	if (tables.length <= 1) return [...tables];
	const picked = new Set<LocationDropTable>();
	const steps = 24;
	for (let s = 0; s < steps; s++) {
		const L = 10 * Math.pow(100_000, s / (steps - 1));
		for (const dup of [1, 1.2]) {
			let bestTable: LocationDropTable | null = null;
			let bestVal = -1;
			for (let i = 0; i < tables.length; i++) {
				const v = expectedValuePerKg(tables[i], L, dup);
				if (v > bestVal) {
					bestVal = v;
					bestTable = tables[i];
				}
			}
			if (bestTable) picked.add(bestTable);
		}
	}
	return Array.from(picked);
}

/** Computes the top contributing minerals and their % shares at a given Luck and dupMult. */
export function getLocationTopMinerals(
	table: LocationDropTable,
	luck: number,
	dupMult = 1,
	topN = 3
): Array<{ mineral: string; sharePct: number }> {
	const effLuck = Math.max(1, Number(luck) || 1);
	const halfLuck = Math.max(1, effLuck / 2);
	const { ores, edges, logTerms, prices, isMythicOrExotic } = table;
	const n = ores.length;

	let prev1 = 0;
	let prev2 = 0;
	let prev3 = 0;
	const contribs: Array<{ mineral: string; val: number }> = [];
	let total = 0;

	for (let i = 0; i < n; i++) {
		const e = edges[i + 1];
		const hi1 = e;
		const hi2 = e >= 1 ? 1 : -Math.expm1(halfLuck * logTerms[i + 1]);
		const hi3 = e >= 1 ? 1 : -Math.expm1(effLuck * logTerms[i + 1]);

		const p =
			0.25 * Math.max(0, hi1 - prev1) +
			0.25 * Math.max(0, hi2 - prev2) +
			0.5 * Math.max(0, hi3 - prev3);
		prev1 = hi1;
		prev2 = hi2;
		prev3 = hi3;

		const val = p * prices[i] * (isMythicOrExotic[i] ? dupMult : 1);
		if (val > 0) {
			contribs.push({ mineral: ores[i].mineral, val });
			total += val;
		}
	}

	contribs.sort((a, b) => b.val - a.val);
	return contribs.slice(0, topN).map((c) => ({
		mineral: c.mineral,
		sharePct: total > 0 ? (c.val / total) * 100 : 0
	}));
}

/**
 * Expected number of ores obtained per pan (`sqrt(Capacity) * 1.08 * VolcanicEruption`),
 * capped at 20 ores when Mass Reactor is equipped (excess ores are destroyed).
 */
export function expectedOresPerPan(
	capacity: number,
	hasFullDigQuality: boolean,
	volcanicEruption: boolean,
	hasMassReactor: boolean
): { rawOresPerPan: number; keptOresPerPan: number; destroyedByMassReactor: number } {
	const cap = Math.max(1, Number(capacity) || 1);
	const qualityMult = hasFullDigQuality ? 1.08 : 1.0;
	const eventMult = volcanicEruption ? 1.5 : 1.0;
	const rawOresPerPan = Math.sqrt(cap) * qualityMult * eventMult;
	const keptOresPerPan = hasMassReactor ? Math.min(20, rawOresPerPan) : rawOresPerPan;
	const destroyedByMassReactor = Math.max(0, rawOresPerPan - keptOresPerPan);
	return { rawOresPerPan, keptOresPerPan, destroyedByMassReactor };
}

function weightExponent(capacity: number): number {
	return 0.24 + 4.3 * (1 - Math.exp(-capacity / 3500));
}

/**
 * Expected mineral weight (kg) using the same 25/25/50 Capacity split and weight tail
 * as {@link calculateWeightChance}: P(base ≥ x) = 1 − u^k with u = (x − min) / (max − min),
 * so E[u] = k / (k + 1).
 */
export function expectedWeightKg(
	capacity: number,
	sizeBoostPct: number,
	solarMagnifier: boolean,
	volcanicEruption: boolean
): number {
	const cap = Math.max(5, Number(capacity) || 5);
	const meanU = (c: number): number => {
		const k = weightExponent(c);
		return k / (k + 1);
	};
	const u = 0.25 * meanU(5) + 0.25 * meanU(Math.max(5, cap / 2)) + 0.5 * meanU(cap);
	const baseKg = BASE_MIN_KG + (BASE_MAX_KG - BASE_MIN_KG) * u;
	const eventMult = (solarMagnifier ? 1.5 : 1) * (volcanicEruption ? 1.5 : 1);
	return baseKg * (1 + Math.max(0, Number(sizeBoostPct) || 0) / 100) * eventMult;
}

interface ModifierSellPool {
	/** Cumulative probability edges: edges[i]..edges[i+1] is modifier i's slice (rarest first). */
	logTerms: Float64Array; // log1p(-edge) per edge (edges strictly between 0 and 1)
	edges: Float64Array;
	/** sellMultiplier − 1 per modifier. */
	bonus: Float64Array;
	count: number;
}

const poolCache = new Map<boolean, ModifierSellPool>();

function getSellPool(isNight: boolean): ModifierSellPool {
	const cached = poolCache.get(isNight);
	if (cached) return cached;
	const pool = MODIFIERS.filter(
		(m) => m.source === 'panning' || (m.source === 'night' && isNight)
	);
	const total = pool.reduce((s, m) => s + m.baseChancePercent, 0);
	const edges = new Float64Array(pool.length + 1);
	const logTerms = new Float64Array(pool.length + 1);
	const bonus = new Float64Array(pool.length);
	let cum = 0;
	for (let i = 0; i < pool.length; i++) {
		bonus[i] = pool[i].sellMultiplier - 1;
		cum = Math.min(1, cum + pool[i].baseChancePercent / total);
		edges[i + 1] = cum;
	}
	for (let i = 0; i <= pool.length; i++) {
		const e = edges[i];
		logTerms[i] = e > 0 && e < 1 ? Math.log1p(-e) : 0;
	}
	const built: ModifierSellPool = { edges, logTerms, bonus, count: pool.length };
	poolCache.set(isNight, built);
	return built;
}

const SPECIAL_MULTIPLIER = {
	crystalline: MODIFIERS.find((m) => m.id === 'crystalline')?.sellMultiplier ?? 1,
	voidtorn: MODIFIERS.find((m) => m.id === 'voidtorn')?.sellMultiplier ?? 1
};

const SHARE_SCRATCH = new Float64Array(64);

function atLeastRank(pool: ModifierSellPool, edgeIdx: number, luckRolls: number): number {
	const e = pool.edges[edgeIdx];
	if (e <= 0) return 0;
	if (e >= 1) return 1;
	return 1 - Math.exp(luckRolls * pool.logTerms[edgeIdx]);
}

/**
 * Expected sell-price multiplier of one mined ore given the build's Modifier Boost and Luck
 * (same two-job model as {@link calculateModifierChance}).
 */
export function expectedModifierMultiplier(
	inputs: Pick<
		MoneyModelInputs,
		| 'luck'
		| 'modifierBoostPct'
		| 'solarMagnifier'
		| 'modifierSurge'
		| 'isNight'
		| 'hasCrystalTouch'
		| 'hasVoidTouched'
		| 'hasPurityRune'
		| 'hasAlchemistsCrucible'
	>
): number {
	if (inputs.hasPurityRune) return 1;

	const panelMB = 100 + Math.max(0, Number(inputs.modifierBoostPct) || 0);
	const effMB1 = panelMB * (inputs.solarMagnifier ? 2 : 1) * (inputs.modifierSurge ? 2 : 1);
	const effMB2 = panelMB * (inputs.modifierSurge ? 2 : 1);
	const luck = Math.max(0, Number(inputs.luck) || 0);
	const modifierLuck = 1 + Math.min(50, luck / 1000) + effMB2 / 10;
	const anyChance = Math.min(0.994, (effMB1 / 1680) * 0.994);

	const pool = getSellPool(inputs.isNight);
	const n = pool.count;
	const halfLuck = Math.max(1, modifierLuck / 2);
	const useCrucible = Boolean(inputs.hasAlchemistsCrucible);

	const shares = SHARE_SCRATCH;
	for (let i = 0; i < n; i++) {
		const lo1 = i === 0 ? 0 : atLeastRank(pool, i, 1);
		const hi1 = atLeastRank(pool, i + 1, 1);
		const lo2 = i === 0 ? 0 : atLeastRank(pool, i, halfLuck);
		const hi2 = atLeastRank(pool, i + 1, halfLuck);
		const lo3 = i === 0 ? 0 : atLeastRank(pool, i, modifierLuck);
		const hi3 = atLeastRank(pool, i + 1, modifierLuck);
		shares[i] =
			0.25 * Math.max(0, hi1 - lo1) + 0.25 * Math.max(0, hi2 - lo2) + 0.5 * Math.max(0, hi3 - lo3);
	}

	let expectedBonus = 0;
	for (let i = 0; i < n; i++) {
		let share = shares[i];
		if (useCrucible) {
			const lower = i + 1 < n ? shares[i + 1] : 0;
			share = (i === 0 ? 1 : 0.9) * shares[i] + 0.1 * lower;
		}
		expectedBonus += share * pool.bonus[i];
	}
	const poolMultiplier = 1 + anyChance * expectedBonus;

	let specialProb = 0;
	let specialValue = 0;
	if (inputs.hasCrystalTouch) {
		specialProb += 0.1;
		specialValue += 0.1 * SPECIAL_MULTIPLIER.crystalline;
	}
	if (inputs.hasVoidTouched) {
		specialProb += 0.05;
		specialValue += 0.05 * SPECIAL_MULTIPLIER.voidtorn;
	}
	return specialValue + (1 - specialProb) * poolMultiplier;
}

const MOD_LUT_SIZE = 128;
const MOD_LUT_MAX_LUCK = 5_000;
const MOD_LN_MAX = Math.log(MOD_LUT_MAX_LUCK);
const MOD_LUT_STEP = MOD_LN_MAX / (MOD_LUT_SIZE - 1);
const modBonusLutCache = new Map<number, Float64Array>();

function getModBonusLut(isNight: boolean, useCrucible: boolean): Float64Array {
	const key = (isNight ? 2 : 0) | (useCrucible ? 1 : 0);
	const cached = modBonusLutCache.get(key);
	if (cached) return cached;

	const pool = getSellPool(isNight);
	const n = pool.count;
	const lut = new Float64Array(MOD_LUT_SIZE);
	const shares = SHARE_SCRATCH;

	for (let k = 0; k < MOD_LUT_SIZE; k++) {
		const modifierLuck = Math.exp(k * MOD_LUT_STEP);
		const halfLuck = Math.max(1, modifierLuck / 2);
		for (let i = 0; i < n; i++) {
			const lo1 = i === 0 ? 0 : atLeastRank(pool, i, 1);
			const hi1 = atLeastRank(pool, i + 1, 1);
			const lo2 = i === 0 ? 0 : atLeastRank(pool, i, halfLuck);
			const hi2 = atLeastRank(pool, i + 1, halfLuck);
			const lo3 = i === 0 ? 0 : atLeastRank(pool, i, modifierLuck);
			const hi3 = atLeastRank(pool, i + 1, modifierLuck);
			shares[i] =
				0.25 * Math.max(0, hi1 - lo1) + 0.25 * Math.max(0, hi2 - lo2) + 0.5 * Math.max(0, hi3 - lo3);
		}
		let expectedBonus = 0;
		for (let i = 0; i < n; i++) {
			let share = shares[i];
			if (useCrucible) {
				const lower = i + 1 < n ? shares[i + 1] : 0;
				share = (i === 0 ? 1 : 0.9) * shares[i] + 0.1 * lower;
			}
			expectedBonus += share * pool.bonus[i];
		}
		lut[k] = expectedBonus;
	}
	modBonusLutCache.set(key, lut);
	return lut;
}

/**
 * Fast O(1) log-linear LUT approximation of {@link expectedModifierMultiplier} for the optimizer inner loop.
 * Falls back to exact calculation above 5,000 Modifier Luck.
 */
export function expectedModifierMultiplierFast(
	inputs: Pick<
		MoneyModelInputs,
		| 'luck'
		| 'modifierBoostPct'
		| 'solarMagnifier'
		| 'modifierSurge'
		| 'isNight'
		| 'hasCrystalTouch'
		| 'hasVoidTouched'
		| 'hasPurityRune'
		| 'hasAlchemistsCrucible'
	>
): number {
	if (inputs.hasPurityRune) return 1;

	const panelMB = 100 + Math.max(0, Number(inputs.modifierBoostPct) || 0);
	const effMB1 = panelMB * (inputs.solarMagnifier ? 2 : 1) * (inputs.modifierSurge ? 2 : 1);
	const effMB2 = panelMB * (inputs.modifierSurge ? 2 : 1);
	const luck = Math.max(0, Number(inputs.luck) || 0);
	const modifierLuck = 1 + Math.min(50, luck / 1000) + effMB2 / 10;
	if (modifierLuck > MOD_LUT_MAX_LUCK) {
		return expectedModifierMultiplier(inputs);
	}
	const anyChance = Math.min(0.994, (effMB1 / 1680) * 0.994);
	const lut = getModBonusLut(inputs.isNight, Boolean(inputs.hasAlchemistsCrucible));
	const pos = Math.log(Math.max(1, modifierLuck)) / MOD_LUT_STEP;
	const idx = Math.min(MOD_LUT_SIZE - 2, pos | 0);
	const frac = pos - idx;
	const expectedBonus = lut[idx] + (lut[idx + 1] - lut[idx]) * frac;
	const poolMultiplier = 1 + anyChance * expectedBonus;

	let specialProb = 0;
	let specialValue = 0;
	if (inputs.hasCrystalTouch) {
		specialProb += 0.1;
		specialValue += 0.1 * SPECIAL_MULTIPLIER.crystalline;
	}
	if (inputs.hasVoidTouched) {
		specialProb += 0.05;
		specialValue += 0.05 * SPECIAL_MULTIPLIER.voidtorn;
	}
	return specialValue + (1 - specialProb) * poolMultiplier;
}

export interface MoneyBreakdown {
	avgValuePerKg: number;
	expectedWeightKg: number;
	expectedModifierMultiplier: number;
	sellMultiplier: number;
	rawOresPerPan: number;
	keptOresPerPan: number;
	destroyedByMassReactor: number;
	cycleSeconds: number;
	oresPerSecond: number;
	valuePerOre: number;
	perPan: number;
	perSecond: number;
	perMinute: number;
	perHour: number;
}

/** Expected income for a build at a specific panning location drop table. */
export function calculateMoneyAtLocation(
	table: LocationDropTable,
	inputs: MoneyModelInputs
): MoneyBreakdown {
	const dupMult = 1 + (inputs.hasDuplicator ? 0.1 : 0) + (inputs.hasMythicalEnchant ? 0.1 : 0);
	const avgValuePerKg = expectedValuePerKg(table, inputs.luck, dupMult);
	const kg = expectedWeightKg(
		inputs.capacity,
		inputs.sizeBoostPct,
		inputs.solarMagnifier,
		inputs.volcanicEruption
	);
	const modMult = expectedModifierMultiplier(inputs);
	const sellMultiplier = inputs.includeSellBoost ? 1 + Math.max(0, inputs.sellBoostPct) / 100 : 1;
	const { rawOresPerPan, keptOresPerPan, destroyedByMassReactor } = expectedOresPerPan(
		inputs.capacity,
		inputs.hasFullDigQuality,
		inputs.volcanicEruption,
		inputs.hasMassReactor
	);

	const valuePerOre = avgValuePerKg * kg * modMult * sellMultiplier;
	const perPan = keptOresPerPan * valuePerOre;
	const cycleSeconds = inputs.cycleSeconds;
	const oresPerSecond =
		Number.isFinite(cycleSeconds) && cycleSeconds > 0 ? keptOresPerPan / cycleSeconds : 0;
	const perSecond = oresPerSecond * valuePerOre;

	return {
		avgValuePerKg,
		expectedWeightKg: kg,
		expectedModifierMultiplier: modMult,
		sellMultiplier,
		rawOresPerPan,
		keptOresPerPan,
		destroyedByMassReactor,
		cycleSeconds,
		oresPerSecond,
		valuePerOre,
		perPan,
		perSecond,
		perMinute: perSecond * 60,
		perHour: perSecond * 3600
	};
}

/** Extracts MoneyModelInputs directly from a build, resolved stats, and chanceInputs. */
export function extractMoneyInputsFromBuild(
	build: SavedBuild,
	stats: CalculatedStats,
	chanceInputs: ChanceInputs,
	includeSellBoost: boolean
): MoneyModelInputs {
	return {
		luck: chanceInputs.luck,
		capacity: chanceInputs.capacity,
		sizeBoostPct: chanceInputs.sizeBoostPct,
		modifierBoostPct: chanceInputs.modifierBoostPct,
		sellBoostPct: Math.max(0, Math.round(stats.sellBoost.final * 100)),
		includeSellBoost,
		solarMagnifier: chanceInputs.solarMagnifier,
		volcanicEruption: chanceInputs.volcanicEruption,
		modifierSurge: chanceInputs.modifierSurge,
		isNight: chanceInputs.isNight,
		hasCrystalTouch: chanceInputs.hasCrystalTouch,
		hasVoidTouched: chanceInputs.hasVoidTouched,
		hasPurityRune: chanceInputs.hasPurityRune,
		hasAlchemistsCrucible: Boolean(chanceInputs.hasAlchemistsCrucible),
		hasMassReactor: build.panId !== null && build.panTrinketId === 'mass-reactor',
		hasDuplicator: build.panId !== null && build.panTrinketId === 'duplicator',
		hasMythicalEnchant: build.shovelEnchantId === 'shovel-mythical',
		hasFullDigQuality:
			chanceInputs.timeMethod === 'sand' || build.shovelEnchantId === 'shovel-mastered',
		cycleSeconds: getCycleSeconds(chanceInputs)
	};
}
