<script lang="ts">
	import {
		BOOST_SOURCES,
		ENCHANTS,
		EQUIPMENT,
		MINERALS,
		MODIFIERS,
		MUSEUM_ORES,
		MUTATIONS,
		PANS,
		RUNES,
		SHOVELS,
		TRINKETS
	} from '#lib/data/index.ts';
	import {
		BASE_MAX_KG,
		calculateMineralChances,
		extractChanceInputsFromBuild,
		fmtDuration,
		fmtOneIn,
		fmtPct,
		getBuildDigCritChance,
		getCycleSeconds,
		getDigQualityMultipliers
	} from '#lib/engine/chance.ts';
	import {
		calculateMoneyAtLocation,
		expectedWeightKg,
		extractMoneyInputsFromBuild,
		getLocationDropTableByName
	} from '#lib/engine/money.ts';
	import {
		isUniqueOnlyEquipment,
		resolveEquipmentModifiers,
		resolveSavedBuild
	} from '#lib/engine/loadout.ts';
	import {
		MUSEUM_RARITIES_DESC,
		MUSEUM_RIDERS_BY_ID,
		MUSEUM_RARITY_LABELS,
		MUSEUM_ORES_BY_ID
	} from '#lib/engine/museum.ts';
	import {
		DEFAULT_OPTIMIZER_OPTIONS,
		type OptimizerBans,
		type OptimizerOptions,
		type OptimizerTargetMode,
		createEmptyOptimizerBans,
		optimizeBuildAndMuseum
	} from '#lib/engine/optimizer.ts';
	import { ALL_STAT_KEYS, STAT_LABELS, calculateBuildStats, isBoostOnlyStat } from '#lib/engine/stats.ts';
	import { loadSavedBuilds, upsertSavedBuild } from '#lib/storage/builds.ts';
	import { loadSavedMuseums, upsertSavedMuseum } from '#lib/storage/museums.ts';
	import {
		type OptimizerSearchConfig,
		type SavedOptimizerSearch,
		deleteSavedOptimizerSearch,
		loadOptimizerDraft,
		loadSavedOptimizerSearches,
		saveOptimizerDraft,
		upsertSavedOptimizerSearch
	} from '#lib/storage/searches.ts';
	import type {
		EquipmentItem,
		EquipmentMutation,
		EquippedJewelrySelection,
		MineralEntry,
		MineralRarity,
		SavedBuild,
		SavedMuseum,
		StatKey
	} from '#lib/types/prospecting.ts';

	const RARITY_ORDER: Record<string, number> = {
		exotic: 6,
		mythic: 5,
		legendary: 4,
		epic: 3,
		rare: 2,
		uncommon: 1,
		common: 0
	};

	const RARITY_OPTIONS: Array<{ value: 'all' | MineralRarity; label: string }> = [
		{ value: 'all', label: 'All rarities' },
		{ value: 'exotic', label: 'Exotic' },
		{ value: 'mythic', label: 'Mythic' },
		{ value: 'legendary', label: 'Legendary' },
		{ value: 'epic', label: 'Epic' },
		{ value: 'rare', label: 'Rare' },
		{ value: 'uncommon', label: 'Uncommon' },
		{ value: 'common', label: 'Common' }
	];

	const MUSEUM_RARITY_STYLE: Record<string, { badge: string; border: string }> = {
		exotic: {
			badge: 'border-fuchsia-500/40 bg-fuchsia-500/15 text-fuchsia-300',
			border: 'border-fuchsia-500/25'
		},
		mythic: {
			badge: 'border-rose-500/40 bg-rose-500/15 text-rose-300',
			border: 'border-rose-500/25'
		},
		legendary: {
			badge: 'border-amber-500/40 bg-amber-500/15 text-amber-300',
			border: 'border-amber-500/25'
		},
		epic: {
			badge: 'border-violet-500/40 bg-violet-500/15 text-violet-300',
			border: 'border-violet-500/25'
		},
		rare: {
			badge: 'border-sky-500/40 bg-sky-500/15 text-sky-300',
			border: 'border-sky-500/25'
		},
		uncommon: {
			badge: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300',
			border: 'border-emerald-500/25'
		},
		common: {
			badge: 'border-slate-500/40 bg-slate-500/15 text-slate-300',
			border: 'border-slate-700/80'
		}
	};

	const DISPLAY_STAT_KEYS: readonly StatKey[] = [
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
		'sellBoost'
	] as const;

	const PERCENT_DISPLAY_KEYS = new Set<StatKey>([
		'shakeSpeed',
		'digSpeed',
		'sizeBoost',
		'modifierBoost',
		'sellBoost'
	]);

	const PANS_BY_ID = new Map(PANS.map((p) => [p.id, p]));
	const SHOVELS_BY_ID = new Map(SHOVELS.map((s) => [s.id, s]));
	const ENCHANTS_BY_ID = new Map(ENCHANTS.map((e) => [e.id, e]));
	const EQUIPMENT_BY_ID = new Map(EQUIPMENT.map((e) => [e.id, e]));
	const MUTATIONS_BY_ID = new Map(MUTATIONS.map((m) => [m.id, m]));
	const RUNES_BY_ID = new Map(RUNES.map((r) => [r.id, r]));
	const BOOSTS_BY_ID = new Map(BOOST_SOURCES.map((b) => [b.id, b]));
	const TRINKETS_BY_ID = new Map(TRINKETS.map((t) => [t.id, t]));
	const MUSEUM_ORE_BY_NAME = new Map(MUSEUM_ORES.map((o) => [o.name.toLowerCase(), o]));
	const shovelEnchants = ENCHANTS.filter((e) => e.target === 'shovel');
	const optimizerTrinkets = TRINKETS.filter((t) => t.modeled && t.id !== 'embalmers-salt');

	const sortedAllMinerals = [...MINERALS].sort((a, b) => {
		const rDiff = (RARITY_ORDER[b.rarity.toLowerCase()] ?? -1) - (RARITY_ORDER[a.rarity.toLowerCase()] ?? -1);
		if (rDiff !== 0) return rDiff;
		return a.mineral.localeCompare(b.mineral);
	});

	let options = $state<OptimizerOptions>({
		...DEFAULT_OPTIMIZER_OPTIONS,
		targetMode: 'rare_generic',
		mineralName: 'Singularium'
	});

	let mineralSearch = $state('');
	let rarityFilter = $state<'all' | MineralRarity>('all');
	let selectedSavedMuseumId = $state<string>('');
	let compareBuildId = $state<string>('');

	let savedBuilds = $state<SavedBuild[]>([]);
	let savedMuseums = $state<SavedMuseum[]>([]);
	let savedSearches = $state<SavedOptimizerSearch[]>([]);
	let hydrated = $state(false);
	let searchSaveName = $state('');
	let bans = $state<OptimizerBans>(createEmptyOptimizerBans());

	let customBuildName = $state('');
	let customMuseumName = $state('');
	let savedNotice = $state<{
		message: string;
		buildId: string | null;
		museumId: string | null;
	} | null>(null);

	let standardMinToughness = $state(DEFAULT_OPTIMIZER_OPTIONS.minToughness);
	let moneyMinToughness = $state(0);

	function setTargetMode(nextMode: OptimizerTargetMode): void {
		if (options.targetMode === nextMode) return;
		const wasMoney = options.targetMode === 'money';
		const isMoney = nextMode === 'money';
		if (wasMoney) {
			moneyMinToughness = options.minToughness;
		} else {
			standardMinToughness = options.minToughness;
		}
		options.targetMode = nextMode;
		if (wasMoney !== isMoney) {
			options.minToughness = isMoney ? moneyMinToughness : standardMinToughness;
		}
	}

	function applySearchConfig(cfg: OptimizerSearchConfig, museumsList: SavedMuseum[], buildsList: SavedBuild[]): void {
		const {
			selectedSavedMuseumId: savedMId,
			compareBuildId: compBId,
			rarityFilter: rFilter,
			...optRest
		} = cfg;
		moneyMinToughness = cfg.targetMode === 'money' ? cfg.minToughness : 0;
		standardMinToughness =
			cfg.targetMode === 'money' ? DEFAULT_OPTIMIZER_OPTIONS.minToughness : cfg.minToughness;
		options = {
			...DEFAULT_OPTIMIZER_OPTIONS,
			...optRest,
			fixedMuseum: null
		};
		mineralSearch = '';
		rarityFilter = rFilter;
		selectedSavedMuseumId =
			savedMId && museumsList.some((m) => m.id === savedMId) ? savedMId : '';
		compareBuildId = compBId && buildsList.some((b) => b.id === compBId) ? compBId : '';
	}

	function snapshotSearchConfig(): OptimizerSearchConfig {
		const { fixedMuseum: _unused, ...optSnapshot } = $state.snapshot(options);
		return {
			...optSnapshot,
			selectedSavedMuseumId,
			compareBuildId,
			rarityFilter
		};
	}

	$effect(() => {
		if (hydrated) return;
		const loadedBuilds = loadSavedBuilds();
		const loadedMuseums = loadSavedMuseums();
		savedBuilds = loadedBuilds;
		savedMuseums = loadedMuseums;
		savedSearches = loadSavedOptimizerSearches();

		const draft = loadOptimizerDraft();
		if (draft) {
			applySearchConfig(draft, loadedMuseums, loadedBuilds);
		}
		hydrated = true;
	});

	$effect(() => {
		if (!hydrated) return;
		saveOptimizerDraft(snapshotSearchConfig());
	});

	const savedMuseumsById = $derived(new Map(savedMuseums.map((m) => [m.id, m])));
	const savedBuildsById = $derived(new Map(savedBuilds.map((b) => [b.id, b])));

	const filteredMinerals = $derived.by(() => {
		const q = mineralSearch.trim().toLowerCase();
		return sortedAllMinerals.filter((m) => {
			if (rarityFilter !== 'all' && m.rarity.toLowerCase() !== rarityFilter) return false;
			if (!q) return true;
			const locMatch = (m.locations ?? []).some((l) => l.location.toLowerCase().includes(q));
			return m.mineral.toLowerCase().includes(q) || locMatch;
		});
	});

	$effect(() => {
		if (options.targetMode !== 'specific' || filteredMinerals.length === 0) return;
		const exists = filteredMinerals.some((m) => m.mineral === options.mineralName);
		if (!exists) {
			options.mineralName = filteredMinerals[0].mineral;
			options.locationName = null;
		}
	});

	const selectedMineral = $derived<MineralEntry | null>(
		options.targetMode === 'specific'
			? (sortedAllMinerals.find((m) => m.mineral === options.mineralName) ?? null)
			: null
	);

	const availablePanningLocations = $derived(
		[...(selectedMineral?.locations ?? [])]
			.filter((l) => Number.isFinite(Number(l.chance_percent)) && Number(l.chance_percent) > 0)
			.sort((a, b) => b.chance_percent - a.chance_percent)
	);

	const selectedMineralMuseumOre = $derived(
		selectedMineral ? (MUSEUM_ORE_BY_NAME.get(selectedMineral.mineral.toLowerCase()) ?? null) : null
	);

	const effectiveOptions = $derived<OptimizerOptions>({
		...options,
		fixedMuseum:
			options.museumMode === 'saved' && selectedSavedMuseumId
				? (savedMuseumsById.get(selectedSavedMuseumId) ?? null)
				: null,
		bans: $state.snapshot(bans)
	});

	const bannedChips = $derived.by(() => {
		const chips: Array<{
			category: keyof OptimizerBans;
			id: string;
			categoryLabel: string;
			name: string;
		}> = [];
		const pushList = (
			category: keyof OptimizerBans,
			categoryLabel: string,
			ids: string[],
			resolveName: (id: string) => string | undefined
		) => {
			for (const id of ids) {
				chips.push({ category, id, categoryLabel, name: resolveName(id) ?? id });
			}
		};
		pushList('panIds', 'Pan', bans.panIds, (id) => PANS_BY_ID.get(id)?.name);
		pushList('panEnchantIds', 'Pan Enchant', bans.panEnchantIds, (id) => ENCHANTS_BY_ID.get(id)?.name);
		pushList('trinketIds', 'Trinket', bans.trinketIds, (id) => TRINKETS_BY_ID.get(id)?.name);
		pushList('shovelIds', 'Shovel', bans.shovelIds, (id) => SHOVELS_BY_ID.get(id)?.name);
		pushList(
			'shovelEnchantIds',
			'Shovel Enchant',
			bans.shovelEnchantIds,
			(id) => ENCHANTS_BY_ID.get(id)?.name
		);
		pushList('equipmentIds', 'Equipment', bans.equipmentIds, (id) => EQUIPMENT_BY_ID.get(id)?.name);
		pushList('mutationIds', 'Mutation', bans.mutationIds, (id) => MUTATIONS_BY_ID.get(id)?.name);
		pushList('runeIds', 'Rune', bans.runeIds, (id) => RUNES_BY_ID.get(id)?.name);
		pushList('boostIds', 'Boost', bans.boostIds, (id) => BOOSTS_BY_ID.get(id)?.name);
		pushList('museumOreIds', 'Museum Ore', bans.museumOreIds, (id) => MUSEUM_ORES_BY_ID.get(id)?.name);
		pushList(
			'museumRiderIds',
			'Museum Mod',
			bans.museumRiderIds,
			(id) => MUSEUM_RIDERS_BY_ID.get(id)?.name
		);
		pushList('locationNames', 'Location', bans.locationNames, (id) => id);
		return chips;
	});

	const result = $derived(optimizeBuildAndMuseum(effectiveOptions));

	const selectedPan = $derived(result.build.panId ? (PANS_BY_ID.get(result.build.panId) ?? null) : null);
	const selectedPanEnchant = $derived(
		result.build.panEnchantId ? (ENCHANTS_BY_ID.get(result.build.panEnchantId) ?? null) : null
	);
	const selectedPanTrinket = $derived(
		result.build.panTrinketId ? (TRINKETS_BY_ID.get(result.build.panTrinketId) ?? null) : null
	);
	const selectedShovel = $derived(
		result.build.shovelId ? (SHOVELS_BY_ID.get(result.build.shovelId) ?? null) : null
	);
	const selectedShovelEnchant = $derived(
		result.build.shovelEnchantId ? (ENCHANTS_BY_ID.get(result.build.shovelEnchantId) ?? null) : null
	);
	const activeDigCritChance = $derived(
		getBuildDigCritChance(result.build.shovelEnchantId, result.build.runeIds)
	);
	const activeQuality = $derived(
		getDigQualityMultipliers(
			result.chanceInputs.timeMethod,
			result.build.shovelEnchantId === 'shovel-mastered'
		)
	);

	const selectedNecklace = $derived(resolveEquipmentMeta(result.build.necklace));
	const selectedCharm = $derived(resolveEquipmentMeta(result.build.charm));
	const groupedRings = $derived.by(() => {
		const groups = new Map<
			string,
			{
				count: number;
				item: EquipmentItem;
				tier: 'base' | '6star';
				mutation: EquipmentMutation | null;
				isUnique: boolean;
				statBadges: EquipmentStatBadge[];
			}
		>();
		for (const sel of result.build.rings) {
			if (!sel) continue;
			const item = EQUIPMENT_BY_ID.get(sel.itemId);
			if (!item) continue;
			const mutation = sel.mutationId ? (MUTATIONS_BY_ID.get(sel.mutationId) ?? null) : null;
			const key = `${item.id}:${sel.tier}:${sel.rollQuality}:${mutation?.id ?? 'none'}`;
			const prev = groups.get(key);
			if (prev) {
				prev.count += 1;
			} else {
				groups.set(key, {
					count: 1,
					item,
					tier: sel.tier,
					mutation,
					isUnique: isUniqueOnlyEquipment(item),
					statBadges: formatResolvedEquipmentStats(item, sel.tier, sel.rollQuality, mutation)
				});
			}
		}
		return Array.from(groups.values());
	});

	const activeRunes = $derived(
		result.build.runeIds.map((id) => RUNES_BY_ID.get(id)).filter((r): r is NonNullable<typeof r> => Boolean(r))
	);
	const activeBoosts = $derived(
		result.build.boostIds
			.map((id) => BOOSTS_BY_ID.get(id))
			.filter((b): b is NonNullable<typeof b> => Boolean(b))
	);

	const compareStatsSummary = $derived.by(() => {
		if (!compareBuildId) return null;
		const compBuild = savedBuildsById.get(compareBuildId);
		if (!compBuild) return null;
		const compMuseum = compBuild.museumId ? (savedMuseumsById.get(compBuild.museumId) ?? null) : null;
		const compInputs = extractChanceInputsFromBuild(
			compBuild,
			{
				timeMethod: options.timeMethod,
				minWeightKg: options.minWeightKg,
				targetModifierId: options.targetModifierId,
				solarMagnifier: options.solarMagnifier,
				volcanicEruption: options.volcanicEruption,
				modifierSurge: options.modifierSurge,
				isNight: options.isNight
			},
			compMuseum
		);
		const compTarget: MineralEntry =
			selectedMineral && !result.isChestOnly && availablePanningLocations.length > 0
				? {
						...selectedMineral,
						locations: [
							availablePanningLocations.find((l) => l.location === result.selectedLocationName) ??
								availablePanningLocations[0]
						]
					}
				: (selectedMineral ?? {
						mineral: 'Generic Rare Roll',
						rarity: 'exotic',
						locations: [{ location: 'Generic', chance_percent: 1 }]
					});
		const compSummary = calculateMineralChances(compTarget, compInputs);
		let compMoneyPerSecond: number | null = null;
		if (options.targetMode === 'money' && result.money) {
			const bestTable = getLocationDropTableByName(result.money.bestLocation);
			if (bestTable) {
				const compStats = calculateBuildStats(resolveSavedBuild(compBuild, compMuseum), {
					isNight: options.isNight,
					solarMagnifier: options.solarMagnifier,
					modifierSurge: options.modifierSurge
				});
				const compMoneyInputs = extractMoneyInputsFromBuild(
					compBuild,
					compStats,
					compInputs,
					options.includeSellBoost !== false
				);
				compMoneyPerSecond = calculateMoneyAtLocation(bestTable, compMoneyInputs).perSecond;
			}
		}
		const compRollsPerSec =
			compSummary.rollsPerSecond *
			compSummary.weightInfo.probability *
			compSummary.modifierInfo.probability;
		const compSizeBoostPct = compInputs.sizeBoostPct;
		const compWeightMult = 1 + compSizeBoostPct / 100;
		const speedup =
			options.targetMode === 'size_boost'
				? compWeightMult > 0
					? (1 + result.chanceInputs.sizeBoostPct / 100) / compWeightMult
					: null
				: compMoneyPerSecond !== null && result.money
					? compMoneyPerSecond > 0 && result.money.perSecond > 0
						? result.money.perSecond / compMoneyPerSecond
						: null
					: compRollsPerSec > 0 && result.effectiveRollsPerSecond > 0
						? result.effectiveRollsPerSecond / compRollsPerSec
						: null;
		const compExpected =
			!compSummary.isChestOnly && compSummary.pAttempt > 0 && Number.isFinite(compSummary.cycleSeconds)
				? compSummary.cycleSeconds / compSummary.pAttempt
				: null;
		return {
			name: compBuild.name,
			summary: compSummary,
			compRollsPerSec,
			compMoneyPerSecond,
			compSizeBoostPct,
			compExpected,
			speedup
		};
	});

	const sizeModeWeights = $derived.by(() => {
		const avgKg = expectedWeightKg(
			result.chanceInputs.capacity,
			result.chanceInputs.sizeBoostPct,
			result.chanceInputs.solarMagnifier,
			result.chanceInputs.volcanicEruption
		);
		const maxKg = BASE_MAX_KG * result.weightInfo.weightMultiplier;
		return { avgKg, maxKg };
	});

	const moneyFormatter = new Intl.NumberFormat('en-US', {
		notation: 'compact',
		maximumFractionDigits: 2
	});
	function fmtMoney(val: number): string {
		if (!Number.isFinite(val)) return '—';
		return `$${moneyFormatter.format(val)}`;
	}

	interface EquipmentStatBadge {
		text: string;
		negative: boolean;
	}

	function formatShortNum(val: number): string {
		const rounded = Math.round(val * 100) / 100;
		return Number.isInteger(rounded) ? rounded.toLocaleString('en-US') : rounded.toString();
	}

	function formatResolvedEquipmentStats(
		item: EquipmentItem,
		tier: 'base' | '6star',
		rollQuality: number,
		mutation: EquipmentMutation | null
	): EquipmentStatBadge[] {
		const mods = resolveEquipmentModifiers(item, tier, rollQuality, mutation);
		const badges: EquipmentStatBadge[] = [];
		for (const key of ALL_STAT_KEYS) {
			const flatVal = (mods.base?.[key] ?? 0) + (mods.flats?.[key] ?? 0);
			if (Math.abs(flatVal) > 1e-6) {
				if (isBoostOnlyStat(key)) {
					const pct = flatVal * 100;
					badges.push({
						text: `${pct > 0 ? '+' : ''}${formatShortNum(pct)}% ${STAT_LABELS[key]}`,
						negative: pct < 0
					});
				} else {
					badges.push({
						text: `${flatVal > 0 ? '+' : ''}${formatShortNum(flatVal)} ${STAT_LABELS[key]}`,
						negative: flatVal < 0
					});
				}
			}
			const boostVal = mods.boosts?.[key] ?? 0;
			if (Math.abs(boostVal) > 1e-6) {
				const pct = boostVal * 100;
				badges.push({
					text: `${pct > 0 ? '+' : ''}${formatShortNum(pct)}% ${STAT_LABELS[key]}`,
					negative: pct < 0
				});
			}
		}
		return badges;
	}

	function resolveEquipmentMeta(sel: EquippedJewelrySelection | null): {
		item: EquipmentItem;
		tier: 'base' | '6star';
		mutation: EquipmentMutation | null;
		statBadges: EquipmentStatBadge[];
	} | null {
		if (!sel) return null;
		const item = EQUIPMENT_BY_ID.get(sel.itemId);
		if (!item) return null;
		const mutation = sel.mutationId ? (MUTATIONS_BY_ID.get(sel.mutationId) ?? null) : null;
		return {
			item,
			tier: sel.tier,
			mutation,
			statBadges: formatResolvedEquipmentStats(item, sel.tier, sel.rollQuality, mutation)
		};
	}

	function handleMinWeightInput(event: Event): void {
		const raw = (event.currentTarget as HTMLInputElement).value.trim();
		if (!raw) {
			options.minWeightKg = null;
			return;
		}
		const n = Number(raw);
		options.minWeightKg = Number.isFinite(n) && n > 0 ? n : null;
	}

	function handleSaveAll(saveMuseumToo: boolean): void {
		let savedMuseumId: string | null = null;

		if (saveMuseumToo && options.museumMode === 'optimize' && result.museum) {
			const mName = customMuseumName.trim() || result.museum.name;
			const museumToSave: SavedMuseum = {
				...structuredClone(result.museum),
				id: '',
				name: mName,
				updatedAt: new Date().toISOString()
			};
			savedMuseums = upsertSavedMuseum(museumToSave);
			savedMuseumId = savedMuseums[0]?.id ?? null;
		} else if (options.museumMode === 'saved' && effectiveOptions.fixedMuseum) {
			savedMuseumId = effectiveOptions.fixedMuseum.id;
		}

		const bName = customBuildName.trim() || result.build.name;
		const buildToSave: SavedBuild = {
			...structuredClone(result.build),
			id: '',
			name: bName,
			museumId: savedMuseumId,
			updatedAt: new Date().toISOString()
		};
		savedBuilds = upsertSavedBuild(buildToSave);
		const createdBuildId = savedBuilds[0]?.id ?? null;

		savedNotice = {
			message:
				savedMuseumId && saveMuseumToo && options.museumMode === 'optimize'
					? `Saved build "${bName}" and linked museum!`
					: `Build "${bName}" saved!`,
			buildId: createdBuildId,
			museumId: savedMuseumId
		};
	}

	function formatStatValue(key: StatKey, val: number): string {
		if (PERCENT_DISPLAY_KEYS.has(key)) {
			const pct = val * 100;
			return `${pct >= 0 ? '+' : ''}${Math.round(pct)}%`;
		}
		return Number.isInteger(val) ? val.toLocaleString('en-US') : val.toFixed(2);
	}

	function formatSlotWeight(kg: number): string {
		return Number.isInteger(kg) ? `${kg} kg` : `${kg.toFixed(1)} kg`;
	}

	function formatBoostPriceHint(price?: string): string | null {
		if (!price) return null;
		if (price.includes('$') || /shard/i.test(price)) return price;
		return `${price} Shards`;
	}

	function formatCompact(val: number): string {
		return Number.isInteger(val) ? val.toLocaleString('en-US') : val.toFixed(1);
	}

	function buildDefaultSearchName(): string {
		if (options.targetMode === 'money') {
			return options.includeSellBoost === false ? 'Max Money / s • No Sell Boost' : 'Max Money / s';
		}
		if (options.targetMode === 'size_boost') {
			return 'Max Size Boost';
		}
		const base =
			options.targetMode === 'specific'
				? (options.mineralName ?? 'Mineral')
				: 'Rare Minerals';
		const parts = [base];
		if (options.minWeightKg) parts.push(`>= ${options.minWeightKg}kg`);
		if (options.targetModifierId === 'any') {
			parts.push('Any Mod');
		} else if (options.targetModifierId) {
			const mod = MODIFIERS.find((m) => m.id === options.targetModifierId);
			if (mod) parts.push(mod.name);
		}
		if (options.shovelEnchantMode === 'mastered' || options.shovelEnchantMode === 'shovel-mastered') {
			parts.push('AFK');
		}
		return parts.join(' • ');
	}

	function summarizeSavedSearch(cfg: OptimizerSearchConfig): string {
		const bits: string[] = [];
		bits.push(
			cfg.targetMode === 'specific'
				? (cfg.mineralName ?? 'Mineral')
				: cfg.targetMode === 'money'
					? 'Max $/s'
					: cfg.targetMode === 'size_boost'
						? 'Max Size'
						: 'Rare'
		);
		if (cfg.targetMode !== 'money' && cfg.targetMode !== 'size_boost') {
			if (cfg.minWeightKg) bits.push(`>=${cfg.minWeightKg}kg`);
			if (cfg.targetModifierId === 'any') bits.push('Any Mod');
			else if (cfg.targetModifierId) bits.push(cfg.targetModifierId);
		} else if (cfg.targetMode === 'money' && cfg.includeSellBoost === false) {
			bits.push('No Sell Boost');
		}
		if (cfg.shovelEnchantMode === 'mastered' || cfg.shovelEnchantMode === 'shovel-mastered') {
			bits.push('Mastered');
		}
		return bits.join(' • ');
	}

	function handleSaveSearch(): void {
		const name = searchSaveName.trim() || buildDefaultSearchName();
		savedSearches = upsertSavedOptimizerSearch({
			id: '',
			name,
			updatedAt: new Date().toISOString(),
			config: snapshotSearchConfig()
		});
		searchSaveName = '';
	}

	function handleLoadSavedSearch(entry: SavedOptimizerSearch): void {
		bans = createEmptyOptimizerBans();
		applySearchConfig(entry.config, savedMuseums, savedBuilds);
	}

	function banItem(category: keyof OptimizerBans, id: string): void {
		if (!id || bans[category].includes(id)) return;
		bans = { ...bans, [category]: [...bans[category], id] };
	}

	function unbanItem(category: keyof OptimizerBans, id: string): void {
		bans = { ...bans, [category]: bans[category].filter((item) => item !== id) };
	}

	function clearAllBans(): void {
		bans = createEmptyOptimizerBans();
	}

	function handleDeleteSavedSearch(id: string): void {
		savedSearches = deleteSavedOptimizerSearch(id);
	}
</script>

<svelte:head>
	<title>Build + Museum Optimizer • Prospecting! Build Calculator</title>
</svelte:head>

<main class="mx-auto max-w-[1520px] space-y-6 px-4 py-6 sm:px-6 sm:py-8">
	<section class="flex flex-wrap items-end justify-between gap-4">
		<div>
			<p class="text-xs font-semibold tracking-wider text-amber-400 uppercase">
				Optimal Farming Loadout + Museum
			</p>
			<h1 class="text-2xl font-bold tracking-tight text-white">
				Build + Museum Optimizer
			</h1>
			<p class="mt-1 text-sm text-slate-400">
				Find the Pan, Shovel, Equipment (+ Mutations), Runes, and Museum combination that minimizes time to obtain
				rare minerals, including minimum weight and modifier filters.
			</p>
		</div>
		<span class="rounded-lg border border-slate-800 bg-slate-900/70 px-3 py-1.5 font-mono text-xs text-slate-300">
			Computed in {result.computeTimeMs} ms
		</span>
	</section>

	<div class="grid items-start gap-6 xl:grid-cols-12">
		<!-- LEFT COLUMN: TARGET & CONSTRAINTS -->
		<section class="min-w-0 space-y-5 rounded-xl border border-slate-800 bg-slate-900/70 p-5 xl:col-span-4">
			<!-- Saved Searches -->
			<div class="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5">
				<div class="flex items-center justify-between gap-2">
					<h2 class="text-xs font-semibold tracking-wider text-slate-300 uppercase">
						Saved Searches ({savedSearches.length})
					</h2>
					<span class="text-[10px] text-emerald-300/90">Auto-saved draft</span>
				</div>

				<div class="mt-2 flex gap-1.5">
					<input
						type="text"
						bind:value={searchSaveName}
						placeholder={buildDefaultSearchName()}
						class="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-amber-400 focus:outline-none"
					/>
					<button
						type="button"
						onclick={handleSaveSearch}
						class="shrink-0 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-slate-950 transition hover:bg-amber-400"
					>
						Save
					</button>
				</div>

				{#if savedSearches.length > 0}
					<div class="mt-2.5 max-h-40 space-y-1.5 overflow-y-auto pr-0.5">
						{#each savedSearches as entry (entry.id)}
							<div class="flex items-center justify-between gap-1.5 rounded-lg border border-slate-800 bg-slate-900/70 px-2.5 py-1.5">
								<button
									type="button"
									onclick={() => handleLoadSavedSearch(entry)}
									class="min-w-0 flex-1 text-left"
								>
									<p class="truncate text-xs font-semibold text-slate-100 hover:text-amber-300">
										{entry.name}
									</p>
									<p class="truncate text-[10px] text-slate-400">
										{summarizeSavedSearch(entry.config)}
									</p>
								</button>
								<button
									type="button"
									aria-label={`Delete search ${entry.name}`}
									onclick={() => handleDeleteSavedSearch(entry.id)}
									class="shrink-0 rounded px-1.5 py-0.5 text-xs text-slate-500 transition hover:bg-rose-500/15 hover:text-rose-300"
								>
									×
								</button>
							</div>
						{/each}
					</div>
				{/if}
			</div>

			<!-- Target Mode -->
			<div class="border-t border-slate-800/80 pt-4">
				<h2 class="text-xs font-semibold tracking-wider text-slate-400 uppercase">
					Search Target
				</h2>
				<div class="mt-2 grid grid-cols-2 gap-1.5 rounded-lg bg-slate-950 p-1">
					<button
						type="button"
						onclick={() => setTargetMode('specific')}
						class={`rounded-md px-3 py-2 text-xs font-semibold transition ${
							options.targetMode === 'specific'
								? 'bg-amber-500 text-slate-950'
								: 'text-slate-300 hover:text-white'
						}`}
					>
						Specific Mineral
					</button>
					<button
						type="button"
						onclick={() => setTargetMode('rare_generic')}
						class={`rounded-md px-3 py-2 text-xs font-semibold transition ${
							options.targetMode === 'rare_generic'
								? 'bg-amber-500 text-slate-950'
								: 'text-slate-300 hover:text-white'
						}`}
					>
						Rare Minerals (Generic)
					</button>
					<button
						type="button"
						onclick={() => setTargetMode('money')}
						class={`rounded-md px-3 py-2 text-xs font-semibold transition ${
							options.targetMode === 'money'
								? 'bg-amber-500 text-slate-950'
								: 'text-slate-300 hover:text-white'
						}`}
					>
						Max Money / s
					</button>
					<button
						type="button"
						onclick={() => setTargetMode('size_boost')}
						class={`rounded-md px-3 py-2 text-xs font-semibold transition ${
							options.targetMode === 'size_boost'
								? 'bg-amber-500 text-slate-950'
								: 'text-slate-300 hover:text-white'
						}`}
					>
						Max Size Boost
					</button>
				</div>
				{#if options.targetMode === 'money'}
					<div class="mt-2.5 space-y-2.5 rounded-lg border border-slate-800 bg-slate-950/60 p-3">
						<p class="text-[11px] leading-relaxed text-slate-400">
							Maximizes expected $ / second across all unbanned locations using √Capacity ×
							1.08 ores/pan (capped at 20 with Mass Reactor), 25/25/50 Luck order-statistics,
							Weight, Modifiers, and Sell Boost.
						</p>
						<label class="flex items-start gap-2 text-xs text-slate-200">
							<input
								type="checkbox"
								checked={options.includeSellBoost !== false}
								onchange={(e) =>
									(options.includeSellBoost = (e.currentTarget as HTMLInputElement).checked)}
								class="mt-0.5 accent-amber-400"
							/>
							<span>
								Apply Sell Boost (sell with this build)
								<span class="block text-[11px] text-slate-400">
									Turn off if you swap to a separate Sell loadout before selling.
								</span>
							</span>
						</label>
					</div>
				{:else if options.targetMode === 'size_boost'}
					<p class="mt-2 text-[11px] leading-relaxed text-slate-400">
						Maximizes total Size Boost % across Pan Enchant, Equipment, Mutations, Museum, and
						optional Potions/Totems (tie-breaks by panning speed &amp; luck).
					</p>
				{/if}
			</div>

			{#if options.targetMode === 'specific'}
				<div class="space-y-3 border-t border-slate-800/80 pt-4">
					<div>
						<label for="opt-mineral-search" class="block text-xs font-medium text-slate-400">
							Search mineral
						</label>
						<input
							id="opt-mineral-search"
							type="search"
							bind:value={mineralSearch}
							placeholder="e.g. Singularium, Celestium, Feather..."
							class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-amber-400 focus:outline-none"
						/>
					</div>

					<div class="grid gap-3 sm:grid-cols-2">
						<div>
							<label for="opt-rarity-filter" class="block text-xs font-medium text-slate-400">
								Rarity
							</label>
							<select
								id="opt-rarity-filter"
								bind:value={rarityFilter}
								class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-amber-400 focus:outline-none"
							>
								{#each RARITY_OPTIONS as r}
									<option value={r.value}>{r.label}</option>
								{/each}
							</select>
						</div>

						<div>
							<label for="opt-mineral-select" class="block text-xs font-medium text-slate-400">
								Mineral ({filteredMinerals.length})
							</label>
							<select
								id="opt-mineral-select"
								value={options.mineralName ?? ''}
								onchange={(e) => {
									options.mineralName = (e.currentTarget as HTMLSelectElement).value || null;
									options.locationName = null;
								}}
								class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-amber-400 focus:outline-none"
							>
								{#each filteredMinerals as m (m.mineral)}
									<option value={m.mineral}>{m.mineral}</option>
								{/each}
							</select>
						</div>
					</div>

					{#if availablePanningLocations.length > 0}
						<div>
							<label for="opt-location-select" class="block text-xs font-medium text-slate-400">
								Location (default: best)
							</label>
							<select
								id="opt-location-select"
								value={options.locationName ?? ''}
								onchange={(e) => {
									options.locationName = (e.currentTarget as HTMLSelectElement).value || null;
								}}
								class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-amber-400 focus:outline-none"
							>
								<option value="">
									Best: {availablePanningLocations[0].location} ({availablePanningLocations[0].chance_percent}%)
								</option>
								{#each availablePanningLocations as loc (loc.location)}
									<option value={loc.location}>
										{loc.location} ({loc.chance_percent}%)
									</option>
								{/each}
							</select>
						</div>
					{/if}
				</div>
			{/if}

			<!-- Weight & Modifier Filters -->
			{#if options.targetMode !== 'money' && options.targetMode !== 'size_boost'}
			<div class="space-y-3 border-t border-slate-800/80 pt-4">
				<h3 class="text-xs font-semibold tracking-wider text-slate-400 uppercase">
					Weight &amp; Modifier Constraints
				</h3>

				<div>
					<div class="flex flex-wrap items-center justify-between gap-2">
						<label for="opt-min-kg" class="block text-xs font-medium text-slate-400">
							Minimum weight (kg)
						</label>
						<div class="flex flex-wrap gap-1.5">
							{#if selectedMineralMuseumOre}
								<button
									type="button"
									onclick={() => (options.minWeightKg = selectedMineralMuseumOre.minKg)}
									class="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-300 transition hover:bg-amber-500/20"
								>
									Museum Min Kg ({selectedMineralMuseumOre.minKg} kg)
								</button>
							{/if}
							{#if options.minWeightKg !== null}
								<button
									type="button"
									onclick={() => (options.minWeightKg = null)}
									class="rounded border border-slate-700 bg-slate-800 px-2 py-0.5 text-[11px] text-slate-300 hover:text-white"
								>
									Reset
								</button>
							{/if}
						</div>
					</div>
					<input
						id="opt-min-kg"
						type="number"
						min="0"
						step="any"
						value={options.minWeightKg ?? ''}
						oninput={handleMinWeightInput}
						placeholder="No minimum (any weight)"
						class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100 placeholder:text-slate-500 focus:border-amber-400 focus:outline-none"
					/>
				</div>

				<div>
					<label for="opt-target-mod" class="block text-xs font-medium text-slate-400">
						Target modifier
					</label>
					<select
						id="opt-target-mod"
						value={options.targetModifierId ?? ''}
						onchange={(e) => {
							const v = (e.currentTarget as HTMLSelectElement).value;
							options.targetModifierId = v || null;
						}}
						class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-amber-400 focus:outline-none"
					>
						<option value="">Any (no constraint)</option>
						<option value="any">Any Modifier (non-normal)</option>
						{#each MODIFIERS as mod (mod.id)}
							<option value={mod.id}>
								{mod.name} ({mod.sellMultiplier}×{mod.notes ? ` • ${mod.notes}` : ''})
							</option>
						{/each}
					</select>
				</div>
			</div>
			{/if}

			<!-- Equipment Options -->
			<div class="space-y-3 border-t border-slate-800/80 pt-4">
				<h3 class="text-xs font-semibold tracking-wider text-slate-400 uppercase">
					Loadout &amp; Museum
				</h3>

				<div class="grid gap-3 sm:grid-cols-2">
					<div>
						<label for="opt-time-method" class="block text-xs font-medium text-slate-400">
							Panning Method
						</label>
						<select
							id="opt-time-method"
							bind:value={options.timeMethod}
							class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-amber-400 focus:outline-none"
						>
							<option value="autopan">Autopan / Macro</option>
							<option value="sand">Sandshaking (Manual)</option>
						</select>
					</div>

					<div>
						<label for="opt-tier" class="block text-xs font-medium text-slate-400">
							Equipment Stars
						</label>
						<select
							id="opt-tier"
							bind:value={options.jewelryTier}
							class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-amber-400 focus:outline-none"
						>
							<option value="6star">6★ (Max Forge)</option>
							<option value="base">Base (0★–5★)</option>
						</select>
					</div>
				</div>

				<!-- Pan Trinket -->
				<div>
					<label for="opt-pan-trinket" class="block text-xs font-medium text-slate-400">
						Pan Trinket
					</label>
					<select
						id="opt-pan-trinket"
						bind:value={options.trinketMode}
						class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-cyan-400 focus:outline-none"
					>
						<option value="auto">Auto-optimize</option>
						<option value="none">No Trinket</option>
						{#each optimizerTrinkets as t (t.id)}
							<option value={t.id}>Only: {t.name}</option>
						{/each}
					</select>
				</div>

				<!-- Shovel Enchant -->
				<div>
					<label for="opt-shovel-enchant" class="block text-xs font-medium text-slate-400">
						Shovel Enchant
					</label>
					<select
						id="opt-shovel-enchant"
						value={options.shovelEnchantMode === 'shovel-mastered'
							? 'mastered'
							: options.shovelEnchantMode}
						onchange={(e) => {
							options.shovelEnchantMode = (e.currentTarget as HTMLSelectElement).value;
						}}
						class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-amber-400 focus:outline-none"
					>
						<option value="auto">Auto-optimize</option>
						<option value="mastered">Lock: Mastered (100% Autopan Quality)</option>
						<option value="none">No enchant</option>
						{#each shovelEnchants.filter((e) => e.id !== 'shovel-mastered') as enc (enc.id)}
							<option value={enc.id}>Only: {enc.name}</option>
						{/each}
					</select>
					<p class="mt-1 text-[11px] text-slate-500">
						Autopan without <em>Mastered</em> digs at 51% quality (⅔ Luck, no 1.5× Dig).
					</p>
				</div>

				<div>
					<div class="flex items-center justify-between text-xs">
						<label for="opt-roll-quality" class="font-medium text-slate-400">
							Equipment Roll Quality
						</label>
						<span class="font-mono text-amber-300">{Math.round(options.rollQuality * 100)}%</span>
					</div>
					<input
						id="opt-roll-quality"
						type="range"
						min="0"
						max="1"
						step="0.05"
						bind:value={options.rollQuality}
						class="mt-1.5 w-full accent-amber-400"
					/>
				</div>

				<div>
					<label for="opt-mutation-mode" class="block text-xs font-medium text-slate-400">
						Equipment Mutations
					</label>
					<select
						id="opt-mutation-mode"
						bind:value={options.mutationMode}
						class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-amber-400 focus:outline-none"
					>
						<option value="auto">Auto-optimize (All)</option>
						<option value="none">No Mutation</option>
						{#each MUTATIONS as mut (mut.id)}
							<option value={mut.id}>Only {mut.name} ({mut.rawEffects?.[0] ?? `${mut.statMultiplier}×`})</option>
						{/each}
					</select>
				</div>

				<div>
					<label for="opt-museum-mode" class="block text-xs font-medium text-slate-400">
						Museum Mode
					</label>
					<select
						id="opt-museum-mode"
						value={options.museumMode === 'saved' ? `saved:${selectedSavedMuseumId}` : options.museumMode}
						onchange={(e) => {
							const v = (e.currentTarget as HTMLSelectElement).value;
							if (v === 'optimize' || v === 'none') {
								options.museumMode = v;
							} else if (v.startsWith('saved:')) {
								options.museumMode = 'saved';
								selectedSavedMuseumId = v.slice('saved:'.length);
							}
						}}
						class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-amber-400 focus:outline-none"
					>
						<option value="optimize">Optimize ideal Museum (18 slots)</option>
						<option value="none">No Museum</option>
						{#each savedMuseums as m (m.id)}
							<option value={`saved:${m.id}`}>Use saved Museum: {m.name}</option>
						{/each}
					</select>
				</div>

				{#if options.museumMode === 'optimize'}
					<div class="space-y-3 rounded-lg border border-slate-800 bg-slate-950/60 p-3">
						<div>
							<div class="flex items-center justify-between text-xs">
								<label for="opt-museum-pct" class="font-medium text-slate-300">
									Museum Mineral Weight (% Min Kg)
								</label>
								<span class="font-mono text-emerald-300">{options.museumWeightPct}%</span>
							</div>
							<input
								id="opt-museum-pct"
								type="range"
								min="10"
								max="100"
								step="5"
								bind:value={options.museumWeightPct}
								class="mt-1.5 w-full accent-emerald-400"
							/>
						</div>

						<div>
							<label for="opt-museum-rider" class="block text-xs font-medium text-slate-300">
								Modifiers on Museum Displays
							</label>
							<select
								id="opt-museum-rider"
								bind:value={options.museumRiderMode}
								class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-100 focus:border-amber-400 focus:outline-none"
							>
								<option value="all">All (incl. Treasured / Entombed)</option>
								<option value="panning_only">Panning Modifiers only</option>
								<option value="none">No Modifiers on displays</option>
							</select>
							<p class="mt-1 text-[11px] text-slate-500">
								Treasured (8 Treasure Chest zones) and Entombed (Pharaoh's Tomb) are only assigned to eligible minerals.
							</p>
						</div>
					</div>
				{/if}
			</div>

			<!-- Runes, Consumables & Toughness -->
			<div class="space-y-2.5 border-t border-slate-800/80 pt-4">
				<h3 class="text-xs font-semibold tracking-wider text-slate-400 uppercase">
					Runes, Consumables &amp; Constraints
				</h3>

				<div class="flex items-center justify-between gap-2">
					<span class="text-xs text-slate-200" title="Unlocked Ring slots (some are unlocked with Meteor Shards or the More Ring Slots gamepass)">
						Ring slots
					</span>
					<select
						aria-label="Unlocked Ring slots"
						bind:value={options.ringSlots}
						class="rounded border border-slate-700 bg-slate-950 px-2 py-0.5 font-mono text-xs text-slate-100 focus:border-amber-400 focus:outline-none"
					>
						{#each [1, 2, 3, 4, 5, 6, 7, 8] as n}
							<option value={n}>{n}</option>
						{/each}
					</select>
				</div>

				<div class="flex items-center justify-between gap-2">
					<label class="flex items-center gap-2 text-xs text-slate-200">
						<input type="checkbox" bind:checked={options.optimizeRunes} class="accent-amber-400" />
						<span>Optimize Runes</span>
					</label>
					{#if options.optimizeRunes}
						<label class="flex items-center gap-1.5 text-[11px] text-slate-400">
							<span>Max slots</span>
							<select
								aria-label="Max Rune slots"
								bind:value={options.maxRunes}
								class="rounded border border-slate-700 bg-slate-950 px-2 py-0.5 font-mono text-xs text-slate-100 focus:border-amber-400 focus:outline-none"
							>
								{#each [1, 2, 3, 4, 5] as n}
									<option value={n}>{n}</option>
								{/each}
							</select>
						</label>
					{/if}
				</div>

				{#if options.optimizeRunes}
					<label
						class={`ml-5 flex items-center gap-2 text-xs ${
							options.targetMode !== 'money' &&
							options.targetMode !== 'size_boost' &&
							options.targetModifierId !== null
								? 'text-slate-500'
								: 'text-slate-300'
						}`}
					>
						<input
							type="checkbox"
							bind:checked={options.allowPurityRune}
							disabled={options.targetMode !== 'money' &&
								options.targetMode !== 'size_boost' &&
								options.targetModifierId !== null}
							class="accent-amber-400"
						/>
						<span>
							Allow Purity Rune
							{#if options.targetMode !== 'money' && options.targetMode !== 'size_boost' && options.targetModifierId !== null}
								<span class="text-[11px] text-amber-300/90">(disabled for target modifier)</span>
							{/if}
						</span>
					</label>
				{/if}

				<label class="flex items-center gap-2 text-xs text-slate-200">
					<input type="checkbox" bind:checked={options.includeTotems} class="accent-amber-400" />
					<span>Include Totems (Luck / Strength / Luminant)</span>
				</label>

				<div class="pt-0.5">
					<label for="opt-potion-mode" class="block text-xs font-medium text-slate-300">
						Potions
					</label>
					<select
						id="opt-potion-mode"
						bind:value={options.potionMode}
						class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100 focus:border-amber-400 focus:outline-none"
					>
						<option value="none">No potions</option>
						<option value="shop_cash">Shop cash ($) only (no Shard, no Merchant)</option>
						<option value="cash_all">All cash ($) (incl. Merchant: Instability / Quake / Blitz)</option>
						<option value="all">All potions (incl. Shards)</option>
					</select>
				</div>

				<div class="flex items-center justify-between gap-3 pt-1">
					<label for="opt-toughness" class="text-xs font-medium text-slate-300">
						Min Shovel Toughness
					</label>
					<input
						id="opt-toughness"
						type="number"
						min="0"
						max="13"
						step="1"
						bind:value={options.minToughness}
						class="w-20 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1 text-right font-mono text-xs text-slate-100 focus:border-amber-400 focus:outline-none"
					/>
				</div>
			</div>

			<!-- Events & Time -->
			<div class="space-y-2 border-t border-slate-800/80 pt-4">
				<h3 class="text-xs font-semibold tracking-wider text-slate-400 uppercase">
					Time &amp; Active Events
				</h3>
				<div class="grid grid-cols-1 gap-2 text-xs text-slate-200 sm:grid-cols-2">
					<label class="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/60 px-2.5 py-2">
						<input type="checkbox" bind:checked={options.isNight} class="accent-amber-400" />
						<span>Night</span>
					</label>
					<label class="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/60 px-2.5 py-2">
						<input type="checkbox" bind:checked={options.solarMagnifier} class="accent-amber-400" />
						<span>Solar Magnifier</span>
					</label>
					<label class="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/60 px-2.5 py-2">
						<input type="checkbox" bind:checked={options.volcanicEruption} class="accent-amber-400" />
						<span>Volcanic Eruption</span>
					</label>
					<label class="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/60 px-2.5 py-2">
						<input type="checkbox" bind:checked={options.modifierSurge} class="accent-amber-400" />
						<span>Modifier Surge</span>
					</label>
				</div>
			</div>

			<!-- Compare with saved build -->
			{#if savedBuilds.length > 0}
				<div class="border-t border-slate-800/80 pt-4">
					<label for="opt-compare" class="block text-xs font-semibold tracking-wider text-slate-400 uppercase">
						Compare with Your Build
					</label>
					<select
						id="opt-compare"
						bind:value={compareBuildId}
						class="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-amber-400 focus:outline-none"
					>
						<option value="">— No comparison —</option>
						{#each savedBuilds as b (b.id)}
							<option value={b.id}>{b.name}</option>
						{/each}
					</select>
				</div>
			{/if}
		</section>

		<!-- RIGHT COLUMN: RESULTS -->
		<section class="min-w-0 space-y-5 xl:col-span-8">
			<!-- Warnings Banner -->
			{#if result.warnings.length > 0}
				<div class="space-y-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-xs text-amber-200">
					{#each result.warnings as w}
						<p>⚠ {w}</p>
					{/each}
					{#if options.shovelEnchantMode !== 'auto' && (options.targetModifierId === 'crystalline' || options.targetModifierId === 'voidtorn')}
						<button
							type="button"
							onclick={() => (options.shovelEnchantMode = 'auto')}
							class="mt-1 mr-2 rounded-lg bg-amber-400 px-3 py-1 text-xs font-semibold text-slate-950 transition hover:bg-amber-300"
						>
							Unlock Shovel Enchant (Auto)
						</button>
					{/if}
					{#if options.targetModifierId === 'lunar' && !options.isNight}
						<button
							type="button"
							onclick={() => (options.isNight = true)}
							class="mt-1 rounded-lg bg-amber-400 px-3 py-1 text-xs font-semibold text-slate-950 transition hover:bg-amber-300"
						>
							Enable Night
						</button>
					{/if}
					{#if result.weightInfo.active && result.weightInfo.probability <= 0}
						<div class="mt-1 flex flex-wrap gap-2">
							{#if !options.solarMagnifier}
								<button
									type="button"
									onclick={() => (options.solarMagnifier = true)}
									class="rounded-lg border border-amber-400/50 bg-slate-950/60 px-2.5 py-1 text-xs font-medium text-amber-200 hover:bg-slate-900"
								>
									+ Enable Solar Magnifier (1.5× Weight)
								</button>
							{/if}
							{#if !options.volcanicEruption}
								<button
									type="button"
									onclick={() => (options.volcanicEruption = true)}
									class="rounded-lg border border-amber-400/50 bg-slate-950/60 px-2.5 py-1 text-xs font-medium text-amber-200 hover:bg-slate-900"
								>
									+ Enable Volcanic Eruption (1.5× Weight)
								</button>
							{/if}
						</div>
					{/if}
				</div>
			{/if}

			<!-- Hero KPI Strip -->
			{#if options.targetMode === 'money'}
				{#if result.money}
				<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
					<div class="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4">
						<p class="text-[11px] font-semibold tracking-wider text-emerald-300 uppercase">
							Money / second
						</p>
						<p class="mt-1 font-mono text-xl font-bold text-white">
							{fmtMoney(result.money.perSecond)} / s
						</p>
						<p class="mt-0.5 text-[11px] text-emerald-200/80">
							{fmtMoney(result.money.perMinute)} / min • {fmtMoney(result.money.perHour)} / hour
						</p>
					</div>
					<div class="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
						<div class="flex items-center justify-between gap-2">
							<p class="text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
								Best Location
							</p>
							<button
								type="button"
								title={`Ban location ${result.money.bestLocation}`}
								onclick={() => banItem('locationNames', result.money!.bestLocation)}
								class="rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 text-[10px] font-medium text-slate-400 transition hover:border-rose-500/40 hover:bg-rose-500/10 hover:text-rose-300"
							>
								Ban
							</button>
						</div>
						<p class="mt-1 truncate font-mono text-lg font-bold text-amber-300">
							{result.money.bestLocation}
						</p>
						{#if result.money.destroyedByMassReactor > 0}
							<p class="mt-0.5 text-[11px] text-amber-300">
								Mass Reactor: {result.money.keptOresPerPan.toFixed(0)} / {result.money.rawOresPerPan.toFixed(1)} ores kept • Avg {fmtMoney(result.money.avgValuePerKg)}/kg
							</p>
						{:else}
							<p class="mt-0.5 text-[11px] text-slate-400">
								Avg {fmtMoney(result.money.avgValuePerKg)}/kg • {result.money.keptOresPerPan.toFixed(1)} ores/pan
							</p>
						{/if}
					</div>
					<div class="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
						<p class="text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
							Per Pan
						</p>
						<p class="mt-1 font-mono text-lg font-bold text-white">
							{fmtMoney(result.money.perPan)}
						</p>
						<p class="mt-0.5 text-[11px] text-slate-400">
							{result.chanceInputs.timeMethod === 'autopan' ? 'Autopan' : 'Sand'}:
							{#if Number.isFinite(result.money.cycleSeconds) && result.money.cycleSeconds > 0}
								{result.money.cycleSeconds.toFixed(2)}s • {(60 / result.money.cycleSeconds).toFixed(1)} pan/min • {result.money.oresPerSecond.toFixed(1)} ores/s
							{:else}
								—
							{/if}
						</p>
					</div>
					<div class="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
						<p class="text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
							Value Multipliers
						</p>
						<p class="mt-1 font-mono text-lg font-bold text-sky-300">
							{result.money.expectedWeightKg.toFixed(2)} kg · {result.money.expectedModifierMultiplier.toFixed(2)}× Mod{#if options.includeSellBoost !== false} · {result.money.sellMultiplier.toFixed(2)}× Sell{/if}
						</p>
						<p class="mt-0.5 text-[11px] text-slate-400">
							Size +{result.chanceInputs.sizeBoostPct}% • Mod +{result.chanceInputs.modifierBoostPct}%{#if options.includeSellBoost !== false} • Sell +{Math.round(result.stats.sellBoost.final * 100)}%{/if}
						</p>
					</div>
				</div>

				<div class="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
					<h3 class="text-xs font-semibold tracking-wider text-slate-400 uppercase">
						Best Locations for this Build
					</h3>
					<div class="mt-2 overflow-x-auto">
						<table class="w-full min-w-[34rem] text-left text-xs">
							<thead class="text-slate-500">
								<tr>
									<th class="py-1 pr-3 font-medium">Location</th>
									<th class="py-1 pr-3 text-right font-medium">$ / sec</th>
									<th class="py-1 pr-3 text-right font-medium">Avg $ / kg</th>
									<th class="py-1 pr-3 font-medium">Main Income</th>
									<th class="py-1 text-right font-medium">Filter</th>
								</tr>
							</thead>
							<tbody>
								{#each result.money.locations as loc, i}
									<tr class="border-t border-slate-800/70">
										<td class="py-1.5 pr-3 text-slate-200">
											{loc.location}
											{#if i === 0}
												<span class="ml-1 rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] text-emerald-300">best</span>
											{/if}
										</td>
										<td class="py-1.5 pr-3 text-right font-mono text-amber-300">
											{fmtMoney(loc.perSecond)}
										</td>
										<td class="py-1.5 pr-3 text-right font-mono text-slate-300">
											{fmtMoney(loc.avgValuePerKg)}
										</td>
										<td class="py-1.5 pr-3 text-slate-400">
											{loc.topMinerals.map((m) => `${m.mineral} ${m.sharePct.toFixed(0)}%`).join(', ')}
										</td>
										<td class="py-1.5 text-right">
											<button
												type="button"
												onclick={() => banItem('locationNames', loc.location)}
												class="rounded border border-slate-700 bg-slate-950 px-2 py-0.5 text-[11px] text-slate-400 transition hover:border-rose-500/40 hover:bg-rose-500/10 hover:text-rose-300"
											>
												Ban
											</button>
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				</div>
				{:else}
					<div class="rounded-xl border border-slate-800 bg-slate-900/70 p-4 text-xs text-slate-400">
						No unbanned panning locations available. Remove a Location ban above to calculate money / second.
					</div>
				{/if}
			{:else if options.targetMode === 'size_boost'}
				<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
					<div class="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4">
						<p class="text-[11px] font-semibold tracking-wider text-emerald-300 uppercase">
							Total Size Boost
						</p>
						<p class="mt-1 font-mono text-xl font-bold text-white">
							+{result.chanceInputs.sizeBoostPct.toLocaleString('en-US')}%
						</p>
						<p class="mt-0.5 text-[11px] text-emerald-200/80">
							Weight mult: {result.weightInfo.weightMultiplier.toFixed(2)}×
						</p>
					</div>

					<div class="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
						<p class="text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
							Average Ore Weight
						</p>
						<p class="mt-1 font-mono text-lg font-bold text-amber-300">
							{sizeModeWeights.avgKg.toFixed(2)} kg
						</p>
						<p class="mt-0.5 text-[11px] text-slate-400">
							Max possible: {sizeModeWeights.maxKg.toFixed(1)} kg (2.8 kg base)
						</p>
					</div>

					<div class="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
						<p class="text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
							Rolls &amp; Pan Cycle
						</p>
						<p class="mt-1 font-mono text-lg font-bold text-white">
							{result.chanceInputs.timeMethod === 'autopan' ? 'Autopan' : 'Sand'}:
							{getCycleSeconds(result.chanceInputs).toFixed(2)}s
						</p>
						<p class="mt-0.5 text-[11px] text-slate-400">
							Luck {Math.round(result.chanceInputs.luck).toLocaleString('en-US')} • Cap
							{Math.round(result.chanceInputs.capacity).toLocaleString('en-US')}
						</p>
					</div>

					<div class="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
						<p class="text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
							Effective Rolls / sec
						</p>
						<p class="mt-1 font-mono text-lg font-bold text-sky-300">
							{result.effectiveRollsPerSecond.toFixed(1)} / s
						</p>
						<p class="mt-0.5 text-[11px] text-slate-400">
							Best panning speed at max Size Boost
						</p>
					</div>
				</div>
			{:else}
			<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
				<div class="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4">
					<p class="text-[11px] font-semibold tracking-wider text-emerald-300 uppercase">
						{options.targetMode === 'specific'
							? result.isChestOnly
								? 'Chest Drop Odds'
								: 'Time 50% / Expected'
							: 'Effective Rolls / sec'}
					</p>
					<p class="mt-1 font-mono text-xl font-bold text-white">
						{#if options.targetMode === 'specific'}
							{#if result.isChestOnly}
								{result.mineralSummary ? `1 in ${fmtOneIn(result.mineralSummary.pAttempt)}` : '—'}
							{:else}
								{fmtDuration(result.t50Seconds)}
							{/if}
						{:else}
							{result.effectiveRollsPerSecond.toFixed(1)} / s
						{/if}
					</p>
					<p class="mt-0.5 text-[11px] text-emerald-200/80">
						{#if options.targetMode === 'specific' && !result.isChestOnly}
							Expected avg: {fmtDuration(result.expectedTimeSeconds)}
						{:else if options.targetMode === 'rare_generic'}
							{result.mineralSummary === null
								? `${Math.round(result.chanceInputs.luck * Math.sqrt(result.chanceInputs.capacity)).toLocaleString('en-US')} rolls/pan`
								: ''}
						{:else}
							{result.selectedLocationName ?? 'Chest'}
						{/if}
					</p>
				</div>

				<div class="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
					<p class="text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
						{options.targetMode === 'specific' && !result.isChestOnly
							? 'Time 90% / 99%'
							: 'Rolls & Pan Cycle'}
					</p>
					<p class="mt-1 font-mono text-lg font-bold text-white">
						{#if options.targetMode === 'specific' && !result.isChestOnly}
							{fmtDuration(result.t90Seconds)} / {fmtDuration(result.t99Seconds)}
						{:else}
							{result.chanceInputs.timeMethod === 'autopan' ? 'Autopan' : 'Sand'}:
							{getCycleSeconds(result.chanceInputs).toFixed(2)}s
						{/if}
					</p>
					<p class="mt-0.5 text-[11px] text-slate-400">
						{#if result.mineralSummary && !result.isChestOnly}
							{result.mineralSummary.cycleSeconds.toFixed(2)}s/pan •
							{result.mineralSummary.pansPerMinute.toFixed(1)} pan/min
						{:else if options.targetMode === 'rare_generic'}
							Luck {Math.round(result.chanceInputs.luck).toLocaleString('en-US')} • Cap
							{Math.round(result.chanceInputs.capacity).toLocaleString('en-US')}
						{:else}
							Chest openings only
						{/if}
					</p>
				</div>

				<div class="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
					<p class="text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
						{options.targetMode === 'specific' ? 'Location & Chance/Pan' : 'Panning Efficiency'}
					</p>
					<p class="mt-1 truncate font-mono text-lg font-bold text-amber-300">
						{#if result.mineralSummary}
							{fmtPct(result.mineralSummary.pAttempt, 4)}
						{:else}
							+{(result.effectiveRollsPerSecond * 60).toFixed(0)} / min
						{/if}
					</p>
					<p class="mt-0.5 truncate text-[11px] text-slate-400">
						{#if result.mineralSummary}
							{result.selectedLocationName ?? '—'} (1 in {fmtOneIn(result.mineralSummary.pAttempt)})
						{:else}
							Digs: {result.chanceInputs.digsToFill} • Shakes:
							{Math.round(result.chanceInputs.capacity / result.chanceInputs.shakeStrength)}
						{/if}
					</p>
				</div>

				<div class="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
					<p class="text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
						Weight / Modifier Filter
					</p>
					<p class="mt-1 font-mono text-lg font-bold text-sky-300">
						{fmtPct(result.weightInfo.probability * result.modifierInfo.probability, 3)}
					</p>
					<p class="mt-0.5 text-[11px] text-slate-400">
						Weight: {result.weightInfo.active ? fmtPct(result.weightInfo.probability, 1) : '100%'} •
						Mod: {result.modifierInfo.active ? fmtPct(result.modifierInfo.probability, 2) : '100%'}
					</p>
				</div>
			</div>
			{/if}

			<!-- Comparison Banner -->
			{#if compareStatsSummary}
				<div class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-sky-500/30 bg-sky-500/10 p-4 text-xs">
					<div>
						<span class="font-semibold text-sky-200">
							Comparison vs "{compareStatsSummary.name}":
						</span>
						<span class="ml-1 text-slate-300">
							{#if options.targetMode === 'specific' && !result.isChestOnly}
								T50 {fmtDuration(compareStatsSummary.summary.t50)} → {fmtDuration(result.t50Seconds)}
								(Expected {fmtDuration(compareStatsSummary.compExpected)} →
								{fmtDuration(result.expectedTimeSeconds)})
							{:else if options.targetMode === 'money' && result.money && compareStatsSummary.compMoneyPerSecond !== null}
								{fmtMoney(compareStatsSummary.compMoneyPerSecond)}/s →
								{fmtMoney(result.money.perSecond)}/s
							{:else if options.targetMode === 'size_boost'}
								+{compareStatsSummary.compSizeBoostPct.toLocaleString('en-US')}% →
								+{result.chanceInputs.sizeBoostPct.toLocaleString('en-US')}%
							{:else}
								{compareStatsSummary.compRollsPerSec.toFixed(1)}/s →
								{result.effectiveRollsPerSecond.toFixed(1)}/s
							{/if}
						</span>
					</div>
					{#if compareStatsSummary.speedup !== null && Number.isFinite(compareStatsSummary.speedup)}
						<span
							class={`rounded-md px-2.5 py-1 font-mono font-semibold ${
								compareStatsSummary.speedup >= 1
									? 'bg-emerald-500/20 text-emerald-300'
									: 'bg-rose-500/20 text-rose-300'
							}`}
						>
							{#if options.targetMode === 'size_boost'}
								{compareStatsSummary.speedup >= 1
									? `${compareStatsSummary.speedup.toFixed(2)}× heavier`
									: `${(1 / compareStatsSummary.speedup).toFixed(2)}× smaller`}
							{:else}
								{compareStatsSummary.speedup >= 1
									? `${compareStatsSummary.speedup.toFixed(2)}× faster`
									: `${(1 / compareStatsSummary.speedup).toFixed(2)}× slower`}
							{/if}
						</span>
					{/if}
				</div>
			{/if}

			<!-- Save & Quick Open Bar -->
			<div class="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
				<div class="grid gap-3 md:grid-cols-12 md:items-end">
					<div class={options.museumMode === 'optimize' ? 'md:col-span-4' : 'md:col-span-7'}>
						<label for="save-build-name" class="block text-xs font-medium text-slate-400">
							Build name to save
						</label>
						<input
							id="save-build-name"
							type="text"
							bind:value={customBuildName}
							placeholder={result.build.name}
							class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-amber-400 focus:outline-none"
						/>
					</div>

					{#if options.museumMode === 'optimize' && result.museum}
						<div class="md:col-span-4">
							<label for="save-museum-name" class="block text-xs font-medium text-slate-400">
								Museum name to link
							</label>
							<input
								id="save-museum-name"
								type="text"
								bind:value={customMuseumName}
								placeholder={result.museum.name}
								class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-amber-400 focus:outline-none"
							/>
						</div>
					{/if}

					<div class={`flex flex-wrap gap-2 ${options.museumMode === 'optimize' ? 'md:col-span-4' : 'md:col-span-5'}`}>
						<button
							type="button"
							onclick={() => handleSaveAll(options.museumMode === 'optimize')}
							class="flex-1 rounded-lg bg-amber-500 px-3.5 py-2 text-xs font-semibold text-slate-950 transition hover:bg-amber-400"
						>
							{options.museumMode === 'optimize' ? 'Save Build + Museum' : 'Save Build'}
						</button>
						{#if options.museumMode === 'optimize'}
							<button
								type="button"
								onclick={() => handleSaveAll(false)}
								class="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-medium text-slate-200 transition hover:border-amber-400/50 hover:text-white"
							>
								Build Only
							</button>
						{/if}
					</div>
				</div>

				{#if savedNotice}
					<div class="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
						<span>✓ {savedNotice.message}</span>
						<div class="flex flex-wrap gap-3 font-medium">
							{#if savedNotice.buildId}
								<a
									href={`/builder?load=${encodeURIComponent(savedNotice.buildId)}`}
									class="text-amber-300 hover:underline"
								>
									Open in Build Builder ↗
								</a>
								<a
									href={`/chance?build=${encodeURIComponent(savedNotice.buildId)}`}
									class="text-emerald-300 hover:underline"
								>
									Open in Drop Chances ↗
								</a>
							{/if}
							{#if savedNotice.museumId}
								<a
									href={`/museum?load=${encodeURIComponent(savedNotice.museumId)}`}
									class="text-fuchsia-300 hover:underline"
								>
									Open in Museum ↗
								</a>
							{/if}
						</div>
					</div>
				{/if}
			</div>

			<!-- Active Bans Section (Current Search Only) -->
			{#if bannedChips.length > 0}
				<div class="rounded-xl border border-rose-500/35 bg-rose-500/10 p-4">
					<div class="flex flex-wrap items-center justify-between gap-2">
						<div class="flex flex-wrap items-center gap-2">
							<h2 class="text-xs font-semibold tracking-wider text-rose-200 uppercase">
								Banned Items ({bannedChips.length})
							</h2>
							<span class="rounded bg-rose-500/20 px-2 py-0.5 text-[10px] font-medium text-rose-200/90">
								Current search only
							</span>
						</div>
						<button
							type="button"
							onclick={clearAllBans}
							class="rounded-lg border border-rose-400/40 bg-slate-950/60 px-2.5 py-1 text-xs font-medium text-rose-200 transition hover:bg-rose-500/20 hover:text-white"
						>
							Reset all
						</button>
					</div>
					<div class="mt-2.5 flex flex-wrap gap-1.5">
						{#each bannedChips as chip (`${chip.category}:${chip.id}`)}
							<button
								type="button"
								onclick={() => unbanItem(chip.category, chip.id)}
								title="Click to restore"
								class="inline-flex items-center gap-1.5 rounded-md border border-rose-500/30 bg-slate-950/70 px-2.5 py-1 text-xs text-rose-200 transition hover:border-emerald-400/50 hover:text-emerald-200"
							>
								<span class="text-[10px] text-rose-300/75 uppercase">{chip.categoryLabel}:</span>
								<span class="font-medium">{chip.name}</span>
								<span class="text-[11px] text-slate-400">↺</span>
							</button>
						{/each}
					</div>
				</div>
			{/if}

			<!-- Recommended Equipment Card -->
			<div class="rounded-xl border border-slate-800 bg-slate-900/70 p-5">
				<div class="flex flex-wrap items-center justify-between gap-2">
					<h2 class="text-base font-semibold text-white">Recommended Loadout</h2>
					<span class="text-xs text-slate-400">
						{options.jewelryTier === '6star' ? '6★' : 'Base'} • Roll
						{Math.round(options.rollQuality * 100)}%
					</span>
				</div>

				<!-- Tools -->
				<div class="mt-4 grid gap-3 sm:grid-cols-2">
					<div class="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5">
						<div class="flex flex-wrap items-center justify-between gap-2">
							<span class="text-[11px] font-semibold tracking-wider text-amber-400 uppercase">Pan</span>
							<div class="flex flex-wrap items-center gap-1.5">
								{#if selectedPanEnchant}
									<span class="inline-flex items-center gap-1 rounded border border-amber-500/30 bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-300">
										<span>Enchant: {selectedPanEnchant.name}</span>
										<button
											type="button"
											title={`Ban enchant ${selectedPanEnchant.name}`}
											aria-label={`Ban enchant ${selectedPanEnchant.name}`}
											onclick={() => banItem('panEnchantIds', selectedPanEnchant.id)}
											class="ml-0.5 rounded px-1 text-amber-200/70 transition hover:bg-rose-500/30 hover:text-rose-200"
										>
											×
										</button>
									</span>
								{/if}
								{#if selectedPanTrinket}
									<span class="inline-flex items-center gap-1 rounded border border-cyan-500/30 bg-cyan-500/15 px-2 py-0.5 text-[11px] font-medium text-cyan-300">
										<span>Trinket: {selectedPanTrinket.name}</span>
										<button
											type="button"
											title={`Ban trinket ${selectedPanTrinket.name}`}
											aria-label={`Ban trinket ${selectedPanTrinket.name}`}
											onclick={() => banItem('trinketIds', selectedPanTrinket.id)}
											class="ml-0.5 rounded px-1 text-cyan-200/70 transition hover:bg-rose-500/30 hover:text-rose-200"
										>
											×
										</button>
									</span>
								{/if}
							</div>
						</div>
						<div class="mt-1 flex items-center justify-between gap-2">
							<p class="text-sm font-semibold text-white">{selectedPan?.name ?? 'None'}</p>
							{#if selectedPan}
								<button
									type="button"
									onclick={() => banItem('panIds', selectedPan.id)}
									class="rounded border border-slate-700/80 bg-slate-900 px-1.5 py-0.5 text-[10px] text-slate-400 transition hover:border-rose-500/50 hover:bg-rose-500/15 hover:text-rose-200"
								>
									Ban
								</button>
							{/if}
						</div>
						{#if selectedPan}
							<p class="mt-1 font-mono text-[11px] text-slate-400">
								Luck {selectedPan.stats.luck} • Cap {selectedPan.stats.capacity} • Str
								{selectedPan.stats.shakeStrength} • Spd {selectedPan.stats.shakeSpeed}
							</p>
							{#if selectedPan.passive}
								<p class="mt-1 text-[11px] text-slate-400">{selectedPan.passive}</p>
							{/if}
							{#if selectedPanEnchant?.rawEffects?.length}
								<p class="mt-1.5 rounded border border-amber-500/20 bg-amber-500/5 px-2 py-1 text-[11px] text-amber-200">
									<strong>Enchant {selectedPanEnchant.name}:</strong>
									{selectedPanEnchant.rawEffects.join(' • ')}
								</p>
							{/if}
							{#if selectedPanTrinket}
								<div class="mt-1.5 rounded border border-cyan-500/20 bg-cyan-500/5 px-2 py-1 text-[11px] text-cyan-200">
									<p>
										<strong>Trinket {selectedPanTrinket.name}:</strong>
										{selectedPanTrinket.effect}
									</p>
									{#if selectedPanTrinket.modelNote}
										<p class="mt-0.5 text-cyan-300/80">{selectedPanTrinket.modelNote}</p>
									{/if}
								</div>
							{/if}
						{/if}
					</div>

					<div class="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5">
						<div class="flex items-center justify-between gap-2">
							<span class="text-[11px] font-semibold tracking-wider text-sky-400 uppercase">Shovel</span>
							{#if selectedShovelEnchant}
								<span class="inline-flex items-center gap-1 rounded border border-sky-500/30 bg-sky-500/15 px-2 py-0.5 text-[11px] font-medium text-sky-300">
									<span>Enchant: {selectedShovelEnchant.name}</span>
									<button
										type="button"
										title={`Ban enchant ${selectedShovelEnchant.name}`}
										aria-label={`Ban enchant ${selectedShovelEnchant.name}`}
										onclick={() => banItem('shovelEnchantIds', selectedShovelEnchant.id)}
										class="ml-0.5 rounded px-1 text-sky-200/70 transition hover:bg-rose-500/30 hover:text-rose-200"
									>
										×
									</button>
								</span>
							{/if}
						</div>
						<div class="mt-1 flex items-center justify-between gap-2">
							<p class="text-sm font-semibold text-white">{selectedShovel?.name ?? 'None'}</p>
							{#if selectedShovel}
								<button
									type="button"
									onclick={() => banItem('shovelIds', selectedShovel.id)}
									class="rounded border border-slate-700/80 bg-slate-900 px-1.5 py-0.5 text-[10px] text-slate-400 transition hover:border-rose-500/50 hover:bg-rose-500/15 hover:text-rose-200"
								>
									Ban
								</button>
							{/if}
						</div>
						{#if selectedShovel}
							<p class="mt-1 font-mono text-[11px] text-slate-400">
								Dig Str {selectedShovel.stats.digStrength} • Dig Spd {selectedShovel.stats.digSpeed}
								• Toughness {Math.round(result.stats.toughness.final)}
							</p>
							<p class="mt-1 font-mono text-[11px] text-slate-400">
								Avg digs: {result.chanceInputs.digsToFill}
								{#if activeDigCritChance > 0}
									<span class="text-sky-300">
										• {Math.round(activeDigCritChance * 100)}% crit 2×
									</span>
								{/if}
								•
								<span
									class={activeQuality.qualityPct === 51 ? 'text-amber-300' : 'text-emerald-300'}
								>
									{activeQuality.qualityPct}% quality
									{activeQuality.qualityPct === 51 ? '(⅔ Luck)' : '(1.5× Dig)'}
								</span>
							</p>
							{#if selectedShovelEnchant?.rawEffects?.length}
								<p class="mt-1.5 rounded border border-sky-500/20 bg-sky-500/5 px-2 py-1 text-[11px] text-sky-200">
									<strong>Enchant {selectedShovelEnchant.name}:</strong>
									{selectedShovelEnchant.rawEffects.join(' • ')}
								</p>
							{/if}
						{/if}
					</div>
				</div>

				<!-- Necklace & Charm -->
				<div class="mt-3 grid gap-3 sm:grid-cols-2">
					{#each [
						{ label: 'Necklace', meta: selectedNecklace },
						{ label: 'Charm', meta: selectedCharm }
					] as slot}
						<div class="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5">
							<div class="flex items-center justify-between gap-2">
								<span class="text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
									{slot.label}
								</span>
								{#if slot.meta?.mutation}
									{@const mut = slot.meta.mutation}
									<span class="inline-flex items-center gap-1 rounded border border-fuchsia-500/30 bg-fuchsia-500/15 px-2 py-0.5 text-[11px] font-medium text-fuchsia-300">
										<span>{mut.name}</span>
										<button
											type="button"
											title={`Ban mutation ${mut.name}`}
											aria-label={`Ban mutation ${mut.name}`}
											onclick={() => banItem('mutationIds', mut.id)}
											class="ml-0.5 rounded px-1 text-fuchsia-200/70 transition hover:bg-rose-500/30 hover:text-rose-200"
										>
											×
										</button>
									</span>
								{/if}
							</div>
							{#if slot.meta}
								{@const itemMeta = slot.meta}
								<div class="mt-1 flex items-center justify-between gap-2">
									<p class="text-sm font-semibold text-white">
										{itemMeta.item.name}
										<span class="ml-1 text-xs font-normal text-slate-400">
											({itemMeta.tier === '6star' ? '6★' : 'Base'})
										</span>
									</p>
									<button
										type="button"
										onclick={() => banItem('equipmentIds', itemMeta.item.id)}
										class="shrink-0 rounded border border-slate-700/80 bg-slate-900 px-1.5 py-0.5 text-[10px] text-slate-400 transition hover:border-rose-500/50 hover:bg-rose-500/15 hover:text-rose-200"
									>
										Ban
									</button>
								</div>
								{#if slot.meta.item.location}
									<p class="mt-0.5 text-[11px] text-slate-500">{slot.meta.item.location}</p>
								{/if}
								{#if slot.meta.statBadges.length > 0}
									<div class="mt-2 flex flex-wrap gap-1">
										{#each slot.meta.statBadges as sb}
											<span
												class={`rounded px-1.5 py-0.5 font-mono text-[10px] ${
													sb.negative
														? 'bg-rose-500/10 text-rose-300 ring-1 ring-rose-500/20'
														: 'bg-slate-900 text-slate-300 ring-1 ring-slate-800'
												}`}
											>
												{sb.text}
											</span>
										{/each}
									</div>
								{/if}
							{:else}
								<p class="mt-1 text-sm text-slate-500">Empty slot</p>
							{/if}
						</div>
					{/each}
				</div>

				<!-- Rings (grouped) -->
				<div class="mt-3 rounded-xl border border-slate-800 bg-slate-950/60 p-3.5">
					<div class="flex flex-wrap items-center justify-between gap-1">
						<span class="text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
							{result.build.rings.filter(Boolean).length} Rings
						</span>
						<span class="text-[11px] text-slate-500">
							Rings with "ONLY ONE CAN BE WORN" appear max 1×
						</span>
					</div>
					<div class="mt-2.5 grid gap-2 sm:grid-cols-2">
						{#each groupedRings as g}
							<div class="rounded-lg border border-slate-800/90 bg-slate-900/70 px-3 py-2.5">
								<div class="flex items-start justify-between gap-2">
									<div class="min-w-0">
										<p class="truncate text-xs font-semibold text-white">
											<span class="font-mono text-amber-300">{g.count}×</span>
											{g.item.name}
										</p>
										<p class="text-[10px] text-slate-400">
											{g.tier === '6star' ? '6★' : 'Base'}
											{#if g.isUnique}
												• <span class="text-sky-300">Unique</span>
											{/if}
											{#if g.count > 1}
												• <span class="text-slate-500">stats per individual ring</span>
											{/if}
										</p>
									</div>
									<div class="flex items-center gap-1.5">
										{#if g.mutation}
											{@const gMut = g.mutation}
											<span class="inline-flex shrink-0 items-center gap-1 rounded border border-fuchsia-500/30 bg-fuchsia-500/15 px-2 py-0.5 text-[10px] font-medium text-fuchsia-300">
												<span>{gMut.name}</span>
												<button
													type="button"
													title={`Ban mutation ${gMut.name}`}
													aria-label={`Ban mutation ${gMut.name}`}
													onclick={() => banItem('mutationIds', gMut.id)}
													class="rounded px-0.5 text-fuchsia-200/70 transition hover:bg-rose-500/30 hover:text-rose-200"
												>
													×
												</button>
											</span>
										{/if}
										<button
											type="button"
											title={`Ban ${g.item.name}`}
											onclick={() => banItem('equipmentIds', g.item.id)}
											class="shrink-0 rounded border border-slate-700/80 bg-slate-950 px-1.5 py-0.5 text-[10px] text-slate-400 transition hover:border-rose-500/50 hover:bg-rose-500/15 hover:text-rose-200"
										>
											Ban
										</button>
									</div>
								</div>
								{#if g.statBadges.length > 0}
									<div class="mt-2 flex flex-wrap gap-1">
										{#each g.statBadges as sb}
											<span
												class={`rounded px-1.5 py-0.5 font-mono text-[10px] ${
													sb.negative
														? 'bg-rose-500/10 text-rose-300 ring-1 ring-rose-500/20'
														: 'bg-slate-950/80 text-slate-300 ring-1 ring-slate-800'
												}`}
											>
												{sb.text}
											</span>
										{/each}
									</div>
								{/if}
							</div>
						{/each}
					</div>
				</div>

				<!-- Runes & Boosts -->
				{#if activeRunes.length > 0 || activeBoosts.length > 0}
					<div class="mt-3 grid gap-3 sm:grid-cols-2">
						<div class="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5">
							<span class="text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
								Runes ({activeRunes.length}/{options.maxRunes})
							</span>
							{#if activeRunes.length === 0}
								<p class="mt-1 text-xs text-slate-500">No active runes</p>
							{:else}
								<div class="mt-2 flex flex-wrap gap-1.5">
									{#each activeRunes as rune (rune.id)}
										<span class="inline-flex items-center gap-1 rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-200">
											<span>{rune.name}</span>
											<button
												type="button"
												title={`Ban rune ${rune.name}`}
												aria-label={`Ban rune ${rune.name}`}
												onclick={() => banItem('runeIds', rune.id)}
												class="rounded px-0.5 text-emerald-200/70 transition hover:bg-rose-500/30 hover:text-rose-200"
											>
												×
											</button>
										</span>
									{/each}
								</div>
							{/if}
						</div>

						<div class="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5">
							<span class="text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
								Totems &amp; Potions ({activeBoosts.length})
							</span>
							{#if activeBoosts.length === 0}
								<p class="mt-1 text-xs text-slate-500">Disabled</p>
							{:else}
								<div class="mt-2 flex flex-wrap gap-1.5">
									{#each activeBoosts as boost (boost.id)}
										{@const priceHint = formatBoostPriceHint(boost.price)}
										<span class="inline-flex items-center gap-1 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-xs text-amber-200">
											<span>
												{boost.name}
												{#if priceHint}
													<span class="ml-1 text-[10px] text-amber-300/75">({priceHint})</span>
												{/if}
											</span>
											<button
												type="button"
												title={`Ban ${boost.name}`}
												aria-label={`Ban ${boost.name}`}
												onclick={() => banItem('boostIds', boost.id)}
												class="rounded px-0.5 text-amber-200/70 transition hover:bg-rose-500/30 hover:text-rose-200"
											>
												×
											</button>
										</span>
									{/each}
								</div>
							{/if}
						</div>
					</div>
				{/if}
			</div>

			<!-- Recommended Museum Card -->
			{#if result.museum && result.museumSummary}
				<div class="rounded-xl border border-slate-800 bg-slate-900/70 p-5">
					<div class="flex flex-wrap items-center justify-between gap-2">
						<div>
							<h2 class="text-base font-semibold text-white">
								{options.museumMode === 'saved'
									? `Linked Museum: ${result.museum.name}`
									: 'Recommended Museum (18 Displays)'}
							</h2>
							<p class="text-xs text-slate-400">
								{result.museumSummary.filledSlots}/{result.museumSummary.totalSlots} displays filled •
								Target weight {options.museumWeightPct}% of Min Kg
							</p>
						</div>
					</div>

					<!-- Total museum boost pills -->
					<div class="mt-3 flex flex-wrap gap-1.5">
						{#each ALL_STAT_KEYS as key}
							{@const val = result.museumSummary.totalBoosts[key]}
							{#if Math.abs(val) > 1e-6}
								{@const pct = Math.round(val * 10000) / 100}
								<span
									class={`rounded-md px-2 py-0.5 font-mono text-[11px] font-medium ${
										pct < 0
											? 'bg-rose-500/10 text-rose-300 ring-1 ring-rose-500/20'
											: 'bg-emerald-500/10 text-emerald-300 ring-1 ring-emerald-500/20'
									}`}
								>
									{pct > 0 ? '+' : ''}{Number.isInteger(pct) ? pct : pct.toFixed(2)}%
									{STAT_LABELS[key]}
								</span>
							{/if}
						{/each}
					</div>

					<div class="mt-4 grid gap-3 md:grid-cols-2">
						{#each MUSEUM_RARITIES_DESC as rarity}
							{@const slots = result.museum.slots[rarity]}
							{@const rStyle = MUSEUM_RARITY_STYLE[rarity]}
							<div class={`rounded-xl border bg-slate-950/50 p-3 ${rStyle.border}`}>
								<div class="flex items-center justify-between">
									<span class={`rounded border px-2 py-0.5 text-[11px] font-semibold ${rStyle.badge}`}>
										{MUSEUM_RARITY_LABELS[rarity]}
									</span>
									<span class="text-[11px] text-slate-500">{slots.length} slots</span>
								</div>

								<div class="mt-2 space-y-1.5">
									{#each slots as slot, idx}
										{@const ore = slot ? MUSEUM_ORES_BY_ID.get(slot.oreId) : null}
										{@const rider = slot?.modifierId ? MUSEUM_RIDERS_BY_ID.get(slot.modifierId) : null}
										<div class="flex items-center justify-between gap-2 rounded-lg border border-slate-800/80 bg-slate-900/60 px-2.5 py-1.5 text-xs">
											{#if ore && slot}
												<div class="flex min-w-0 items-center gap-1.5">
													<span class="truncate font-medium text-white">{ore.name}</span>
													<span class="shrink-0 font-mono text-[11px] text-slate-400">
														{formatSlotWeight(slot.weightKg)}
													</span>
													{#if options.museumMode === 'optimize'}
														<button
															type="button"
															title={`Ban ${ore.name} from Museum`}
															aria-label={`Ban ${ore.name} from Museum`}
															onclick={() => banItem('museumOreIds', ore.id)}
															class="shrink-0 rounded px-1 text-[11px] text-slate-500 transition hover:bg-rose-500/20 hover:text-rose-200"
														>
															×
														</button>
													{/if}
												</div>
												{#if rider}
													<span
														class="inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold"
														style={`color: ${rider.color}; border-color: ${rider.color}55; background-color: ${rider.color}15`}
													>
														<span>{rider.name}</span>
														{#if options.museumMode === 'optimize'}
															<button
																type="button"
																title={`Ban modifier ${rider.name}`}
																aria-label={`Ban modifier ${rider.name}`}
																onclick={() => banItem('museumRiderIds', rider.id)}
																class="rounded px-0.5 opacity-75 transition hover:bg-rose-500/30 hover:text-rose-200 hover:opacity-100"
															>
																×
															</button>
														{/if}
													</span>
												{:else}
													<span class="text-[10px] text-slate-500">No mod</span>
												{/if}
											{:else}
												<span class="text-slate-500">Slot #{idx + 1} empty</span>
											{/if}
										</div>
									{/each}
								</div>
							</div>
						{/each}
					</div>
				</div>
			{/if}

			<!-- Final Stats Summary -->
			<div class="rounded-xl border border-slate-800 bg-slate-900/70 p-5">
				<h2 class="text-base font-semibold text-white">Final Stats Reached</h2>
				<div class="mt-3 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
					{#each DISPLAY_STAT_KEYS as key (key)}
						{@const bd = result.stats[key]}
						<div class="rounded-lg border border-slate-800/90 bg-slate-950/60 px-3 py-2.5">
							<p class="text-[11px] font-medium text-slate-400">{STAT_LABELS[key]}</p>
							<p class="mt-0.5 font-mono text-base font-bold text-white">
								{formatStatValue(key, bd.final)}
							</p>
							<p class="mt-0.5 font-mono text-[10px] text-slate-500">
								Base {formatCompact(bd.base)} • +{Math.round(bd.boosts * 100)}%
							</p>
						</div>
					{/each}
				</div>
			</div>
		</section>
	</div>
</main>
