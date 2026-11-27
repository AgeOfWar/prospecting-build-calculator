import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const WIKI_ORIGIN = 'https://prospecting.miraheze.org';
const WIKI_API = `${WIKI_ORIGIN}/w/api.php`;
const USER_AGENT = 'ProspectingBuildCalculator/0.1 (local sync script)';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, '../src/lib/data');

const RARITY_NAMES = new Set([
	'Common',
	'Uncommon',
	'Rare',
	'Epic',
	'Legendary',
	'Mythic',
	'Exotic',
	'Ascended'
]);

const RARITY_LIST = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Mythic', 'Exotic'];

function decodeHtmlEntities(input) {
	return input
		.replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
		.replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
		.replace(/&nbsp;/gi, ' ')
		.replace(/&amp;/gi, '&')
		.replace(/&lt;/gi, '<')
		.replace(/&gt;/gi, '>')
		.replace(/&quot;/gi, '"')
		.replace(/&#39;|&apos;/gi, "'")
		.replace(/&times;/gi, '×')
		.replace(/&ndash;/gi, '–')
		.replace(/&mdash;/gi, '—')
		.replace(/&minus;/gi, '−');
}

function cleanCellHtml(html) {
	let text = html
		.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
		.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
		.replace(/<sup\b[^>]*>[\s\S]*?<\/sup>/gi, '')
		.replace(/<header\b[^>]*class="[^"]*tabber__header[^"]*"[^>]*>[\s\S]*?<\/header>/gi, ' ')
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<\/(?:p|div|li|tr|article)>/gi, '\n')
		.replace(/<[^>]+>/g, ' ');
	text = decodeHtmlEntities(text);
	return text
		.split('\n')
		.map((line) => line.replace(/\s+/g, ' ').trim())
		.filter(Boolean)
		.join('\n');
}

function extractLinks(html) {
	const links = [];
	const linkRe = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
	let match;
	while ((match = linkRe.exec(html)) !== null) {
		const href = match[1];
		const label = cleanCellHtml(match[2]);
		if (href.startsWith('/wiki/') && !href.includes('redlink=1') && label) {
			links.push({ href: `${WIKI_ORIGIN}${href}`, title: decodeURIComponent(href.slice(6)), label });
		}
	}
	return links;
}

function extractTabberPanels(html) {
	const panels = [];
	const articleRe = /<article\b([^>]*class="[^"]*tabber__panel[^"]*"[^>]*)>([\s\S]*?)<\/article>/gi;
	let match;
	while ((match = articleRe.exec(html)) !== null) {
		const attrs = match[1];
		const idMatch = attrs.match(/id="tabber-([^"]+)"/i) ?? attrs.match(/aria-labelledby="tabber-([^"]+)-label"/i);
		panels.push({
			label: idMatch ? idMatch[1] : null,
			html: match[2],
			text: cleanCellHtml(match[2])
		});
	}
	return panels;
}

function extractSectionsAndTables(html) {
	const cleaned = html
		.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
		.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');

	const tokenRe =
		/<h([2-4])\b[^>]*>([\s\S]*?)<\/h\1>|<(?:article|div)\b[^>]*class="[^"]*tabber__panel[^"]*"[^>]*id="tabber-([^"-]+)[^"]*"[^>]*>|<table\b[^>]*>([\s\S]*?)<\/table>/gi;
	const headings = { 2: '', 3: '', 4: '' };
	let currentTab = null;
	const tables = [];

	let match;
	while ((match = tokenRe.exec(cleaned)) !== null) {
		if (match[1]) {
			const level = Number(match[1]);
			const title = cleanCellHtml(match[2]).replace(/\[edit\]/gi, '').trim();
			headings[level] = title;
			for (let l = level + 1; l <= 4; l++) headings[l] = '';
			if (level === 2) currentTab = null;
		} else if (match[3]) {
			if (RARITY_NAMES.has(match[3])) {
				currentTab = match[3];
			}
		} else if (match[4]) {
			const tableHtml = match[4];
			const parsed = parseHtmlTable(tableHtml);
			if (parsed.rows.length > 0 || parsed.headers.length > 0) {
				tables.push({
					headingPath: [headings[2], headings[3], headings[4]].filter(Boolean),
					tabName: currentTab,
					headers: parsed.headers,
					rows: parsed.rows
				});
			}
		}
	}

	return tables;
}

function parseHtmlTable(tableHtml) {
	const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
	const cellRe = /<(t[hd])\b([^>]*)>([\s\S]*?)<\/\1>/gi;

	const rawRows = [];
	let rowMatch;
	while ((rowMatch = rowRe.exec(tableHtml)) !== null) {
		const cells = [];
		let cellMatch;
		cellRe.lastIndex = 0;
		while ((cellMatch = cellRe.exec(rowMatch[1])) !== null) {
			const tag = cellMatch[1].toLowerCase();
			const attrs = cellMatch[2];
			const body = cellMatch[3];
			const colspanMatch = attrs.match(/colspan=["']?(\d+)/i);
			const rowspanMatch = attrs.match(/rowspan=["']?(\d+)/i);
			cells.push({
				tag,
				colspan: colspanMatch ? Number(colspanMatch[1]) : 1,
				rowspan: rowspanMatch ? Number(rowspanMatch[1]) : 1,
				text: cleanCellHtml(body),
				rawHtml: body,
				links: extractLinks(body)
			});
		}
		if (cells.length > 0) rawRows.push(cells);
	}

	if (rawRows.length === 0) return { headers: [], rows: [] };

	const grid = [];
	for (let r = 0; r < rawRows.length; r++) {
		grid[r] ??= [];
		let colIdx = 0;
		for (const cell of rawRows[r]) {
			while (grid[r][colIdx] !== undefined) colIdx++;
			for (let dr = 0; dr < cell.rowspan; dr++) {
				grid[r + dr] ??= [];
				for (let dc = 0; dc < cell.colspan; dc++) {
					grid[r + dr][colIdx + dc] = cell;
				}
			}
			colIdx += cell.colspan;
		}
	}

	let headerRowCount = 0;
	for (let r = 0; r < grid.length; r++) {
		const row = grid[r];
		if (row.every((c) => c && c.tag === 'th')) headerRowCount++;
		else break;
	}
	if (headerRowCount === 0 && grid.length > 0) headerRowCount = 1;

	const colCount = Math.max(...grid.map((r) => r.length), 0);
	const headers = [];
	for (let c = 0; c < colCount; c++) {
		const parts = [];
		for (let r = 0; r < headerRowCount; r++) {
			const val = grid[r]?.[c]?.text;
			if (val && parts[parts.length - 1] !== val) parts.push(val);
		}
		headers.push(parts.join(' / ').trim());
	}

	const rows = [];
	for (let r = headerRowCount; r < grid.length; r++) {
		const row = grid[r];
		if (!row || row.every((c) => !c || !c.text)) continue;
		rows.push(Array.from({ length: colCount }, (_, c) => row[c] ?? { text: '', rawHtml: '', links: [] }));
	}

	return { headers, rows };
}

async function fetchParsedPage(pageTitle) {
	const params = new URLSearchParams({
		action: 'parse',
		page: pageTitle,
		prop: 'text|links',
		redirects: '1',
		format: 'json',
		formatversion: '2'
	});
	const res = await fetch(`${WIKI_API}?${params.toString()}`, {
		headers: { 'User-Agent': USER_AGENT }
	});
	if (!res.ok) {
		throw new Error(`HTTP ${res.status} fetching ${pageTitle}`);
	}
	const json = await res.json();
	if (json.error) {
		return { missing: true, title: pageTitle, error: json.error.info };
	}
	return {
		missing: false,
		title: json.parse.title,
		html: json.parse.text,
		links: json.parse.links ?? []
	};
}

function slugify(name) {
	return name
		.toLowerCase()
		.replace(/['’]/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
}

function ensureUniqueIds(items) {
	const seen = new Map();
	for (const item of items) {
		const base = item.id || slugify(item.name) || 'item';
		const count = seen.get(base) ?? 0;
		seen.set(base, count + 1);
		item.id = count === 0 ? base : `${base}-${count + 1}`;
	}
	return items;
}

function normalizeText(text) {
	return text.replace(/[\u2212]/g, '-').replace(/[\u2013\u2014]/g, '–');
}

function parseNumber(text) {
	if (!text) return null;
	const cleaned = normalizeText(text).replace(/,/g, '').trim();
	const match = cleaned.match(/[-+]?\d+(?:\.\d+)?/);
	if (!match) return null;
	const num = Number(match[0]);
	return Number.isFinite(num) ? num : null;
}

const STAT_ALIASES = [
	['shakeStrength', /shake\s*strength/i],
	['shakeSpeed', /shake\s*speed/i],
	['digStrength', /dig\s*strength/i],
	['digSpeed', /dig\s*speed/i],
	['sellBoost', /sell\s*(?:boost|value|multiplier)/i],
	['sizeBoost', /size\s*boost/i],
	['modifierBoost', /modifier\s*boost/i],
	['inventorySize', /inventory\s*size/i],
	['walkSpeed', /walk\s*speed/i],
	['jumpPower', /jump\s*power/i],
	['nightLuck', /night\s*luck/i],
	['capacity', /capacity/i],
	['toughness', /toughness/i],
	['luck', /\bluck\b/i]
];

function matchStatKey(label) {
	for (const [key, pattern] of STAT_ALIASES) {
		if (pattern.test(label)) return key;
	}
	return null;
}

const NON_STAT_CLAUSE_RE =
	/\b(chance|when|during|while|higher|lower|extra|every|stack|streak|critically|giving|granting|up\s+to|treasure\s+map|map\s+capacity|threshold|sluice|geode|duplicate|deposit|slower|faster|all|nearby|per\s+\w+|automatically)\b/i;

function parseModifiersFromText(rawText, fallbackRanges = null, fallbackModifiers = null) {
	const modifiers = {};
	const minModifiers = {};
	const statRanges = {};
	const unmatched = [];

	const normalized = normalizeText(rawText).replace(/\s*\(\d+\s*min(?:utes?)?\)\s*/gi, ' ');
	const clauses = normalized
		.split(/\n|,\s+|;\s*|\s+&\s+|•|\|/)
		.map((s) => s.trim())
		.filter(Boolean);

	for (const clause of clauses) {
		const statKey = matchStatKey(clause);
		if (!statKey || NON_STAT_CLAUSE_RE.test(clause)) {
			unmatched.push(clause);
			continue;
		}

		// Additive multiplier notation: e.g. "+1x Luck"
		const plusMultMatch = clause.match(/\+\s*(\d+(?:\.\d+)?)\s*[x×]/i);
		if (plusMultMatch) {
			const val = Number(plusMultMatch[1]);
			if (Number.isFinite(val)) {
				modifiers.boosts ??= {};
				modifiers.boosts[statKey] = (modifiers.boosts[statKey] ?? 0) + val;
				continue;
			}
		}

		// Multiplier pattern: e.g. "1.1× Pan Shake Strength" or "2x Luck"
		const multMatch = clause.match(/(?<![+-])(\d+(?:\.\d+)?)\s*[x×]/i);
		if (multMatch && !/%/.test(clause) && !/\+\s*\d+(?:\.\d+)?\s*[x×]/i.test(clause)) {
			const val = Number(multMatch[1]);
			if (Number.isFinite(val)) {
				modifiers.multipliers ??= {};
				modifiers.multipliers[statKey] = val;
				continue;
			}
		}

		// Range pattern: e.g. "Luck 0.3 – 0.8", "Dig Speed -50 – -30%", "Luck 5 - 20"
		const rangeMatch = clause.match(
			/([+-]?\d[\d,]*(?:\.\d+)?)\s*(%?)\s*(?:-|–|\bto\b)\s*([+-]?\d[\d,]*(?:\.\d+)?)\s*(%?)/i
		);
		if (rangeMatch) {
			const isPercent = Boolean(rangeMatch[2] || rangeMatch[4]);
			const minVal = Number(rangeMatch[1].replace(/,/g, '')) / (isPercent ? 100 : 1);
			const maxVal = Number(rangeMatch[3].replace(/,/g, '')) / (isPercent ? 100 : 1);
			if (Number.isFinite(minVal) && Number.isFinite(maxVal)) {
				statRanges[statKey] = [minVal, maxVal];
				const bucket = isPercent ? 'boosts' : 'base';
				minModifiers[bucket] ??= {};
				minModifiers[bucket][statKey] = minVal;
				modifiers[bucket] ??= {};
				modifiers[bucket][statKey] = maxVal;
				continue;
			}
		}

		// Unknown-max range pattern: e.g. "Luck 150 – ?" or "Modifier Boost 20 – ?%"
		const unknownMaxRangeMatch = clause.match(
			/([+-]?\d[\d,]*(?:\.\d+)?)\s*(%?)\s*(?:-|–|\bto\b)\s*\?+\s*(%?)/i
		);
		if (unknownMaxRangeMatch) {
			const isPercent = Boolean(
				unknownMaxRangeMatch[2] ||
					unknownMaxRangeMatch[3] ||
					fallbackModifiers?.boosts?.[statKey] !== undefined
			);
			const minVal = Number(unknownMaxRangeMatch[1].replace(/,/g, '')) / (isPercent ? 100 : 1);
			const maxVal =
				fallbackRanges?.[statKey]?.[1] ??
				fallbackModifiers?.boosts?.[statKey] ??
				fallbackModifiers?.base?.[statKey] ??
				minVal;
			if (Number.isFinite(minVal) && Number.isFinite(maxVal)) {
				statRanges[statKey] = [minVal, maxVal];
				const bucket = isPercent ? 'boosts' : 'base';
				minModifiers[bucket] ??= {};
				minModifiers[bucket][statKey] = minVal;
				modifiers[bucket] ??= {};
				modifiers[bucket][statKey] = maxVal;
				continue;
			}
		}

		// Single percentage: e.g. "+25% Shake Speed" or "Shake Speed 22%"
		const pctMatch = clause.match(/([+-]?\d[\d,]*(?:\.\d+)?)\s*%/);
		if (pctMatch) {
			const val = Number(pctMatch[1].replace(/,/g, '')) / 100;
			if (Number.isFinite(val)) {
				modifiers.boosts ??= {};
				modifiers.boosts[statKey] = (modifiers.boosts[statKey] ?? 0) + val;
				continue;
			}
		}

		// Single flat/base number: e.g. "+5 Luck" or "Luck 22"
		const numMatch = clause.match(/([+-]?\d[\d,]*(?:\.\d+)?)/);
		if (numMatch) {
			const val = Number(numMatch[1].replace(/,/g, ''));
			if (Number.isFinite(val)) {
				const bucket = /\+/.test(numMatch[1]) ? 'flats' : 'base';
				modifiers[bucket] ??= {};
				modifiers[bucket][statKey] = (modifiers[bucket][statKey] ?? 0) + val;
				continue;
			}
		}

		unmatched.push(clause);
	}

	return { modifiers, minModifiers, statRanges, unmatched };
}

function findColumnIndex(headers, patterns) {
	for (const pattern of patterns) {
		const idx = headers.findIndex((h) => pattern.test(h));
		if (idx !== -1) return idx;
	}
	return -1;
}

function extractNameAndLink(cell) {
	const name = cell?.text?.split('\n')[0]?.trim() ?? '';
	const link = cell?.links?.find((l) => l.label === name) ?? cell?.links?.[0];
	return { name, wikiUrl: link?.href };
}

function parsePans(tables) {
	const pans = [];
	for (const table of tables) {
		const nameIdx = findColumnIndex(table.headers, [/name/i, /\bpan\b/i]);
		const statsIdx = findColumnIndex(table.headers, [/\bstats\b/i]);
		if (nameIdx === -1 || statsIdx === -1) continue;

		const priceIdx = findColumnIndex(table.headers, [/price|cost/i]);
		const locIdx = findColumnIndex(table.headers, [/location|obtain|source|shop/i]);

		for (const row of table.rows) {
			const { name, wikiUrl } = extractNameAndLink(row[nameIdx]);
			if (!name) continue;

			const statLines = row[statsIdx]?.text?.split('\n') ?? [];
			const passiveLines = [];
			const stats = { luck: 0, capacity: 0, shakeStrength: 0, shakeSpeed: 0 };

			for (const rawLine of statLines) {
				const line = rawLine.replace(/\(Pans?\)/gi, '').trim();
				if (/^passive\s*:/i.test(line)) {
					passiveLines.push(line.replace(/^passive\s*:\s*/i, '').trim());
					continue;
				}
				const key = matchStatKey(line);
				let val = parseNumber(line);
				if (key && val !== null && key in stats) {
					// Wiki displays some pan shake speeds (e.g. Rose Pan 120%) as percent instead of decimal multiplier (1.2)
					if (key === 'shakeSpeed' && (/%/.test(line) || val > 10)) {
						val = Math.round((val / 100) * 10000) / 10000;
					}
					stats[key] = val;
				} else if (line) {
					passiveLines.push(line);
				}
			}

			const item = { id: slugify(name), name, stats };
			if (priceIdx !== -1 && row[priceIdx]?.text) item.price = row[priceIdx].text;
			if (locIdx !== -1 && row[locIdx]?.text) item.location = row[locIdx].text;
			if (passiveLines.length > 0) item.passive = passiveLines.join(' ');
			if (wikiUrl) item.wikiUrl = wikiUrl;
			pans.push(item);
		}
	}
	return ensureUniqueIds(pans);
}

function parseShovels(tables) {
	const shovels = [];
	for (const table of tables) {
		const nameIdx = findColumnIndex(table.headers, [/name/i, /\bshovel\b/i]);
		const statsIdx = findColumnIndex(table.headers, [/\bstats\b/i]);
		if (nameIdx === -1 || statsIdx === -1) continue;

		const priceIdx = findColumnIndex(table.headers, [/price|cost/i]);
		const locIdx = findColumnIndex(table.headers, [/location|obtain|source|shop/i]);

		for (const row of table.rows) {
			const { name, wikiUrl } = extractNameAndLink(row[nameIdx]);
			if (!name) continue;

			const statLines = row[statsIdx]?.text?.split('\n') ?? [];
			const passiveLines = [];
			const stats = { digStrength: 0, digSpeed: 0, toughness: 0 };

			for (const rawLine of statLines) {
				const line = rawLine.trim();
				if (/^passive\s*:/i.test(line)) {
					passiveLines.push(line.replace(/^passive\s*:\s*/i, '').trim());
					continue;
				}
				const key = matchStatKey(line);
				const val = parseNumber(line);
				if (key && val !== null && key in stats) {
					stats[key] = val;
				} else if (line) {
					passiveLines.push(line);
				}
			}

			const item = { id: slugify(name), name, stats };
			if (priceIdx !== -1 && row[priceIdx]?.text) item.price = row[priceIdx].text;
			if (locIdx !== -1 && row[locIdx]?.text) item.location = row[locIdx].text;
			if (passiveLines.length > 0) item.passive = passiveLines.join(' ');
			if (wikiUrl) item.wikiUrl = wikiUrl;
			shovels.push(item);
		}
	}
	return ensureUniqueIds(shovels);
}

function parseEnchants(tables) {
	const enchants = [];
	for (const table of tables) {
		const nameIdx = findColumnIndex(table.headers, [/enchant/i, /\bname\b/i]);
		const effectIdx = findColumnIndex(table.headers, [/effect|stat|buff|bonus/i]);
		if (nameIdx === -1 || effectIdx === -1) continue;

		const notesIdx = findColumnIndex(table.headers, [/source|note|book|obtain/i]);
		const hasAurorite = table.headers.some((h) => /aurorite/i.test(h));
		const hasSol = table.headers.some((h) => /^sol$/i.test(h));
		const target = hasSol && !hasAurorite ? 'shovel' : 'pan';

		for (const row of table.rows) {
			const name = row[nameIdx]?.text?.split('\n')[0]?.trim();
			const effectText = row[effectIdx]?.text?.trim();
			if (!name || !effectText) continue;

			const parsed = parseModifiersFromText(effectText);
			const item = {
				id: slugify(`${target}-${name}`),
				name,
				target,
				modifiers: parsed.modifiers,
				rawEffects: effectText.split('\n').filter(Boolean)
			};
			if (notesIdx !== -1 && row[notesIdx]?.text && row[notesIdx].text !== '-') {
				item.notes = row[notesIdx].text;
			}
			enchants.push(item);
		}
	}
	return ensureUniqueIds(enchants);
}

function parseEquipment(tables) {
	const items = [];
	for (const table of tables) {
		const nameIdx = findColumnIndex(table.headers, [/name/i]);
		const slotIdx = findColumnIndex(table.headers, [/\bslot\b/i]);
		const statsIdx = findColumnIndex(table.headers, [/\bstats\b/i]);
		if (nameIdx === -1 || slotIdx === -1 || statsIdx === -1) continue;

		const priceIdx = findColumnIndex(table.headers, [/cost|price/i]);
		const isLimited = table.headingPath.some((h) => /limited/i.test(h));
		const rarity = table.tabName ?? (isLimited ? 'Limited-Time' : undefined);

		for (const row of table.rows) {
			const { name, wikiUrl } = extractNameAndLink(row[nameIdx]);
			const rawSlot = row[slotIdx]?.text?.trim().toLowerCase();
			if (!name || (rawSlot !== 'ring' && rawSlot !== 'necklace' && rawSlot !== 'charm')) continue;

			const statsCell = row[statsIdx];
			const panels = extractTabberPanels(statsCell?.rawHtml ?? '');
			const baseText = panels.length > 0 ? panels[0].text : statsCell?.text ?? '';
			const sixStarText = panels.length > 1 ? panels[1].text : '';

			const parsedBase = parseModifiersFromText(baseText);
			const item = {
				id: slugify(`${rawSlot}-${name}`),
				name,
				slot: rawSlot,
				modifiers: parsedBase.modifiers
			};

			if (rarity) item.rarity = rarity;
			if (Object.keys(parsedBase.minModifiers).length > 0) item.minModifiers = parsedBase.minModifiers;
			if (Object.keys(parsedBase.statRanges).length > 0) item.statRanges = parsedBase.statRanges;

			if (sixStarText) {
				const parsedSix = parseModifiersFromText(
					sixStarText,
					parsedBase.statRanges,
					parsedBase.modifiers
				);
				if (Object.keys(parsedSix.modifiers).length > 0) item.sixStarModifiers = parsedSix.modifiers;
				if (Object.keys(parsedSix.minModifiers).length > 0) item.sixStarMinModifiers = parsedSix.minModifiers;
				if (Object.keys(parsedSix.statRanges).length > 0) item.sixStarStatRanges = parsedSix.statRanges;
			}

			if (baseText) item.rawStats = baseText;
			if (priceIdx !== -1 && row[priceIdx]?.text) item.price = row[priceIdx].text;
			if (wikiUrl) item.wikiUrl = wikiUrl;

			const descLines = row[nameIdx]?.text?.split('\n').slice(1).join(' ').trim();
			if (descLines && /only one can be worn|requires the blueprint/i.test(descLines)) {
				item.passive = descLines;
			}

			items.push(item);
		}
	}
	return ensureUniqueIds(items);
}

function parseRunes(tables) {
	const runes = [];
	for (const table of tables) {
		const nameIdx = findColumnIndex(table.headers, [/^runes?$/i, /\bname\b/i]);
		const descIdx = findColumnIndex(table.headers, [/description|effect/i]);
		if (nameIdx === -1 || descIdx === -1) continue;

		const locIdx = findColumnIndex(table.headers, [/location|obtain|source/i]);

		for (const row of table.rows) {
			const { name, wikiUrl } = extractNameAndLink(row[nameIdx]);
			const descText = row[descIdx]?.text?.trim();
			if (!name || !descText) continue;

			const parsed = parseModifiersFromText(descText);
			const item = {
				id: slugify(name),
				name,
				modifiers: parsed.modifiers,
				rawEffects: descText.split('\n').filter(Boolean)
			};
			if (locIdx !== -1 && row[locIdx]?.text) item.location = row[locIdx].text;
			if (wikiUrl) item.wikiUrl = wikiUrl;
			runes.push(item);
		}
	}
	return ensureUniqueIds(runes);
}

function parsePotions(tables) {
	const boosts = [];
	for (const table of tables) {
		const nameIdx = findColumnIndex(table.headers, [/^item$/i, /\bname\b/i]);
		const effectIdx = findColumnIndex(table.headers, [/^effect$/i]);
		if (nameIdx === -1 || effectIdx === -1) continue;

		const priceIdx = findColumnIndex(table.headers, [/cost|price/i]);

		for (const row of table.rows) {
			const { name, wikiUrl } = extractNameAndLink(row[nameIdx]);
			const effectText = row[effectIdx]?.text?.trim();
			if (!name || !effectText) continue;

			const durMatch = effectText.match(/\((\d+\s*min(?:utes?)?)\)/i);
			const parsed = parseModifiersFromText(effectText);
			const item = {
				id: slugify(`potion-${name}`),
				name,
				category: 'potion',
				modifiers: parsed.modifiers,
				rawEffects: [effectText]
			};
			if (priceIdx !== -1 && row[priceIdx]?.text) item.price = row[priceIdx].text;
			if (durMatch) item.duration = durMatch[1];
			if (wikiUrl) item.wikiUrl = wikiUrl;
			boosts.push(item);
		}
	}
	return boosts;
}

function parseTotemsFromWiki(shardMerchantTables, relicsHtml) {
	const totems = [];
	const seenIds = new Set();

	for (const table of shardMerchantTables) {
		const nameIdx = findColumnIndex(table.headers, [/^item$/i, /\bname\b/i]);
		const descIdx = findColumnIndex(table.headers, [/description|effect/i]);
		if (nameIdx === -1 || descIdx === -1) continue;

		const priceIdx = findColumnIndex(table.headers, [/cost|price/i]);

		for (const row of table.rows) {
			const { name, wikiUrl } = extractNameAndLink(row[nameIdx]);
			const desc = row[descIdx]?.text?.trim() ?? '';
			if (!name || !/totem/i.test(name)) continue;

			const durMatch = desc.match(/for\s+(\d+\s*min(?:utes?)?)/i);
			const modifiers = {};
			if (/2x\s*luck/i.test(desc)) {
				modifiers.multipliers = { luck: 2 };
			} else if (/doubles\s+dig\s+and\s+shake\s+strength/i.test(desc)) {
				modifiers.multipliers = { digStrength: 2, shakeStrength: 2 };
			} else {
				Object.assign(modifiers, parseModifiersFromText(desc).modifiers);
			}

			const id = slugify(`totem-${name}`);
			seenIds.add(id);
			const item = {
				id,
				name,
				category: 'totem',
				modifiers,
				rawEffects: desc ? [desc] : []
			};
			if (priceIdx !== -1 && row[priceIdx]?.text) item.price = `${row[priceIdx].text} Shards`;
			if (durMatch) item.duration = durMatch[1];
			if (wikiUrl) item.wikiUrl = wikiUrl;
			totems.push(item);
		}
	}

	// Parse extra Totems (e.g. Luminant Totem) from the Relics tabber panels
	if (relicsHtml) {
		const panels = extractTabberPanels(relicsHtml);
		for (const panel of panels) {
			if (!panel.label || !/totem/i.test(panel.label)) continue;
			if (/friendship/i.test(panel.label)) continue;
			const name = panel.label.replace(/_/g, ' ').trim();
			const id = slugify(`totem-${name}`);
			if (seenIds.has(id)) continue;

			const cleanText = normalizeText(panel.text).replace(/\n+/g, ' ');
			const introText = cleanText
				.split(/\b(?:Obtainment|Usage|Trivia|Gallery|Notes)\s*(?:\[\s*edit\s*\])?/i)[0]
				.replace(/\s+([,.;:!?])/g, '$1')
				.replace(/\s+/g, ' ')
				.trim();
			const effectSentences = introText
				.split(/(?<=\.)\s+/)
				.filter((s) => s && !/^Each totem lasts\b/i.test(s));
			const summaryText = effectSentences.slice(0, 2).join(' ').trim() || introText;

			const firstSentence = introText.split(/\.\s+/)[0] ?? introText;
			const boostSegmentMatch = firstSentence.match(/\bboost\s+of\s+(.+)$/i);
			const boostSegment = (boostSegmentMatch ? boostSegmentMatch[1] : firstSentence).replace(
				/\band\b/gi,
				','
			);
			const parsed = parseModifiersFromText(boostSegment);
			const hasStats = Object.values(parsed.modifiers).some((b) => b && Object.keys(b).length > 0);
			if (!hasStats) continue;

			const durMatch = cleanText.match(/(?:for|lasts)\s+(\d+\s*min(?:utes?)?)/i);
			seenIds.add(id);
			totems.push({
				id,
				name,
				category: 'totem',
				modifiers: parsed.modifiers,
				rawEffects: [summaryText],
				duration: durMatch ? durMatch[1] : '30 minutes',
				wikiUrl: `${WIKI_ORIGIN}/wiki/Relics#${panel.label}`
			});
		}
	}

	return totems;
}

function parseMutationsFromHtml(html) {
	const cleanPageText = cleanCellHtml(html.replace(/<table\b[^>]*>[\s\S]*?<\/table>/gi, ''));
	const catalystNotes = new Map();
	const catalystRe = /use\s+a\s+([^.\n]+?Catalyst)\s+to\s+apply\s+([A-Za-z0-9' -]+?)\s+to\s+a\s+piece/gi;
	let catMatch;
	while ((catMatch = catalystRe.exec(cleanPageText)) !== null) {
		catalystNotes.set(catMatch[2].trim().toLowerCase(), `Guaranteed via ${catMatch[1].trim()}`);
	}

	const effectsMatch = html.match(
		/<h([2-4])\b[^>]*>(?:(?!<\/h\1>)[\s\S])*?\bEffects\b(?:(?!<\/h\1>)[\s\S])*?<\/h\1>([\s\S]*?)(?=<h[2-4]\b|$)/i
	);
	if (!effectsMatch) return [];

	const sectionHtml = effectsMatch[2];
	const liRe = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
	const mutations = [];
	let liMatch;

	while ((liMatch = liRe.exec(sectionHtml)) !== null) {
		const liHtml = liMatch[1];
		const line = normalizeText(cleanCellHtml(liHtml));
		const colonMatch = line.match(/^([^:]+?)\s*:\s*(.+)$/);
		if (!colonMatch) continue;

		const name = colonMatch[1].trim();
		const effectRest = colonMatch[2].trim();
		const multMatch = effectRest.match(/^(\d+(?:\.\d+)?)\s*[x×]/i);
		const statMultiplier = multMatch ? Number(multMatch[1]) : 1;

		const bonusText = multMatch ? effectRest.slice(multMatch[0].length).replace(/^\s*,\s*/, '') : effectRest;
		const parsedBonus = bonusText ? parseModifiersFromText(bonusText) : { modifiers: {} };
		const hasBonus =
			parsedBonus.modifiers &&
			Object.values(parsedBonus.modifiers).some((bucket) => bucket && Object.keys(bucket).length > 0);

		const links = extractLinks(liHtml);
		const link = links.find((l) => l.label === name);
		const note = catalystNotes.get(name.toLowerCase());

		const entry = {
			id: slugify(name),
			name,
			statMultiplier: Number.isFinite(statMultiplier) ? statMultiplier : 1,
			rawEffects: [effectRest],
			wikiUrl: link?.href ?? `${WIKI_ORIGIN}/wiki/Mutations`
		};
		if (hasBonus) entry.bonusModifiers = parsedBonus.modifiers;
		if (note) entry.notes = note;
		mutations.push(entry);
	}

	return ensureUniqueIds(mutations);
}

const MODIFIER_COLOR_FALLBACKS = {
	perfect: '#00ffe1',
	lunar: '#ffe99b',
	mutated: '#7f43ff',
	cosmic: '#ff478e',
	iridescent: '#f36bff',
	irradiated: '#67ff20',
	scorching: '#ff861c',
	glowing: '#fff292',
	pure: '#ffffff',
	shiny: '#d4e7ff',
	voidtorn: '#8307ff',
	crystalline: '#b7e6ff',
	treasured: '#ffd849',
	entombed: '#3ab3aa',
	electrified: '#ffeb0b'
};

function extractMuseumRiderColors(museumHtml) {
	const colors = new Map();
	const spanRe = /<td[^>]*>\s*<span\b[^>]*style="[^"]*color:\s*(#[0-9a-fA-F]{3,8})[^"]*"[^>]*>([^<]+)<\/span>/gi;
	let m;
	while ((m = spanRe.exec(museumHtml)) !== null) {
		const hex = m[1].toLowerCase();
		const name = cleanCellHtml(m[2]).trim().toLowerCase();
		if (name) colors.set(name, hex);
	}
	return colors;
}

function parseModifiersFromWiki(modifiersHtml, museumHtml) {
	const museumColors = extractMuseumRiderColors(museumHtml);
	const h2Re = /<h2\b[^>]*>([\s\S]*?)<\/h2>([\s\S]*?)(?=<h2\b|$)/gi;
	const entries = [];
	const specialIds = new Set(['voidtorn', 'crystalline', 'treasured']);

	let m;
	while ((m = h2Re.exec(modifiersHtml)) !== null) {
		const rawHeading = cleanCellHtml(m[1]).replace(/\[edit\]/gi, '').trim();
		if (!rawHeading || /^(Contents|Mineral Modifiers|Gallery|Trivia|Navigation)$/i.test(rawHeading)) {
			continue;
		}
		const name = rawHeading;
		const id = slugify(name);
		const bodyHtml = m[2];

		const liFields = new Map();
		for (const liMatch of bodyHtml.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)) {
			const text = normalizeText(cleanCellHtml(liMatch[1])).replace(/\n+/g, ' ');
			const kv = text.match(/^([^:]+?)\s*:\s*(.+)$/);
			if (kv) {
				liFields.set(kv[1].trim().toLowerCase(), {
					text: kv[2].trim(),
					html: liMatch[1]
				});
			}
		}

		const sellVal = parseNumber(liFields.get('sell price multiplier')?.text ?? '');
		if (sellVal === null) continue;

		const chanceField = liFields.get('chance');
		const chanceMatch = chanceField?.text?.match(/^(\d+(?:\.\d+)?)\s*%/);
		const baseChancePercent = chanceMatch ? Number(chanceMatch[1]) : 0;

		if (id === 'purified' || (baseChancePercent <= 0 && !specialIds.has(id))) {
			continue;
		}

		const colorMatch = liFields
			.get('color')
			?.html?.match(/style="[^"]*color:\s*(#[0-9a-fA-F]{3,8})/i);
		const color =
			museumColors.get(name.toLowerCase()) ??
			(colorMatch ? colorMatch[1].toLowerCase() : null) ??
			MODIFIER_COLOR_FALLBACKS[id] ??
			'#ffffff';

		let source = 'panning';
		let notes;
		if (id === 'lunar') {
			source = 'night';
			notes = 'Night only';
		} else if (id === 'voidtorn') {
			source = 'void_touched';
			notes = '5% with Void Touched enchant / Galactic tools / The Void';
		} else if (id === 'crystalline') {
			source = 'crystal_touch';
			notes = '10% with Crystal Touch shovel enchant';
		} else if (id === 'treasured') {
			source = 'chest';
			notes = '100% from Treasure Chests';
		}

		const bonusText = liFields.get('museum bonus')?.text;
		const museumBonus =
			bonusText && !/^(none|\(none\))$/i.test(bonusText)
				? bonusText.replace(/\s*\+\s*/g, ' + ').replace(/\s+/g, ' ').trim()
				: undefined;

		const item = {
			id,
			name,
			sellMultiplier: sellVal,
			baseChancePercent,
			color,
			source
		};
		if (museumBonus) item.museumBonus = museumBonus;
		if (notes) item.notes = notes;
		entries.push(item);
	}

	// Order panning/night modifiers first, then special-source modifiers
	const panningOrder = entries.filter((e) => e.source === 'panning' || e.source === 'night');
	const specialOrder = entries.filter((e) => e.source !== 'panning' && e.source !== 'night');
	return [...panningOrder, ...specialOrder];
}

const REGION_BY_PAGE_TITLE = {
	'Rubble Creek': 'Starter',
	'Fortune River': 'Riverlands',
	'Fortune River Delta': 'Riverlands',
	'Crystal Caverns': 'Crystal',
	'Azuralite Oasis': 'Crystal',
	'Snowy Shores': 'Frost',
	'Frostbitten Path': 'Frost',
	'Frozen Peak': 'Frost',
	'Overgrown Grotto': 'Nature',
	'Deeproot Spring': 'Nature',
	'Fungal Marsh': 'Nature',
	'Rotwood Swamp': 'Nature',
	'Haunted Creek': 'Nature',
	'Enchanted Ruins': 'Nature',
	'Sunset Beach': 'Coastal',
	'Windswept Beach': 'Coastal',
	'Volcanic Sands': 'Volcanic',
	'Volcanic Springs': 'Volcanic',
	'The Magma Furnace': 'Volcanic',
	'Meteor Valley': 'Meteoric',
	'Sandstone Stream': 'Desert',
	'Mystic Floodplains': 'Desert',
	'Lifespring Oasis': 'Desert',
	Pyramid: 'Desert',
	'Pharaoh\'s Tomb': 'Desert',
	'Abyssal Depths': 'Dark',
	'The Void': 'Special',
	'North Pole': 'Limited',
	'Seashell Isle': 'Limited'
};

function parseDropItemsFromFragment(fragmentHtml, knownMineralsMap) {
	const drops = [];
	const seen = new Set();
	for (const liMatch of fragmentHtml.matchAll(/<(?:li|dd)\b[^>]*>([\s\S]*?)<\/(?:li|dd)>/gi)) {
		const rawLine = normalizeText(cleanCellHtml(liMatch[1])).replace(/\n+/g, ' ').trim();
		const m = rawLine.match(/^(.+?)\s*[–•-]\s*(\d+(?:\.\d+)?)\s*%/);
		if (!m) continue;
		const candidateName = m[1].trim();
		const pct = Number(m[2]);
		if (!Number.isFinite(pct) || pct <= 0) continue;
		const canonical = knownMineralsMap.get(candidateName.toLowerCase());
		if (!canonical) continue;
		if (seen.has(canonical)) continue;
		seen.add(canonical);
		drops.push({ mineral: canonical, chance_percent: pct });
	}
	return drops;
}

function parseMineralPageChances(mineralHtml) {
	const sections = splitSectionsWithHeadings(mineralHtml);
	const sec = sections.find((s) => /Locations\s*&?\s*Chances/i.test(s.title));
	if (!sec) return [];
	const results = [];
	for (const liMatch of sec.bodyHtml.matchAll(/<(?:li|dd)\b[^>]*>([\s\S]*?)<\/(?:li|dd)>/gi)) {
		const rawLine = normalizeText(cleanCellHtml(liMatch[1])).replace(/\n+/g, ' ').trim();
		const m = rawLine.match(/^(.+?)\s*[–•-]\s*(\d+(?:\.\d+)?)\s*%/);
		if (!m) continue;
		const locName = m[1].replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
		const pct = Number(m[2]);
		if (!locName || !Number.isFinite(pct) || pct <= 0) continue;
		results.push({ location: locName, chance_percent: pct });
	}
	return results;
}

function splitSectionsWithHeadings(html) {
	const cleaned = html
		.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
		.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
	const headings = [];
	const hRe = /<h([2-4])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
	let m;
	while ((m = hRe.exec(cleaned)) !== null) {
		const title = cleanCellHtml(m[2]).replace(/\[edit\]/gi, '').trim();
		headings.push({
			level: Number(m[1]),
			title,
			start: m.index,
			end: hRe.lastIndex
		});
	}
	return headings.map((h, i) => ({
		...h,
		bodyHtml: cleaned.slice(h.end, i + 1 < headings.length ? headings[i + 1].start : cleaned.length)
	}));
}

async function syncMineralsAndLocations(mineralsPageHtml) {
	const tables = extractSectionsAndTables(mineralsPageHtml);
	const mineralOrder = [];
	const mineralMap = new Map();
	const knownMineralsMap = new Map();
	const digsiteToPage = new Map();

	for (let ti = 0; ti < Math.min(RARITY_LIST.length, tables.length); ti++) {
		const rarity = RARITY_LIST[ti].toLowerCase();
		const table = tables[ti];
		const minIdx = findColumnIndex(table.headers, [/^mineral$/i, /\bname\b/i]);
		const locIdx = findColumnIndex(table.headers, [/location/i]);
		const priceIdx = findColumnIndex(table.headers, [/\$\s*\/\s*kg/i, /price/i]);
		if (minIdx === -1) continue;

		for (const row of table.rows) {
			const { name, wikiUrl } = extractNameAndLink(row[minIdx]);
			if (!name) continue;
			knownMineralsMap.set(name.toLowerCase(), name);

			const pageTitleFromLink = wikiUrl
				? decodeURIComponent(wikiUrl.slice(`${WIKI_ORIGIN}/wiki/`.length)).split('#')[0]
				: null;

			let pricePerKg = null;
			if (priceIdx !== -1) {
				const priceCell = row[priceIdx];
				const sortValue = priceCell?.rawHtml?.match(/data-sort-value="([\d.]+)"/)?.[1];
				const parsed = sortValue
					? Number(sortValue)
					: Number(String(priceCell?.text ?? '').replace(/[^\d.]/g, ''));
				if (Number.isFinite(parsed) && parsed > 0) pricePerKg = parsed;
			}

			const entry = {
				mineral: name,
				rarity,
				pricePerKg,
				pageTitle: pageTitleFromLink,
				wikiLocations: [],
				locations: [],
				chests: []
			};
			mineralMap.set(name.toLowerCase(), entry);
			mineralOrder.push(entry);

			if (locIdx !== -1 && row[locIdx]?.links) {
				for (const link of row[locIdx].links) {
					const rawTitle = link.title.split('#')[0].replace(/_/g, ' ').trim();
					const label = link.label.trim();
					if (!label || !rawTitle) continue;
					if (!entry.wikiLocations.includes(label)) entry.wikiLocations.push(label);
					if (!digsiteToPage.has(label)) digsiteToPage.set(label, rawTitle);
				}
			}
		}
	}

	// Ensure Pyramid is fetched for Tomb Veins + Sarcophagus
	const uniquePages = new Set([...digsiteToPage.values(), 'Pyramid']);
	const pageList = [...uniquePages];
	const pageCache = new Map();

	for (let i = 0; i < pageList.length; i += 6) {
		const chunk = pageList.slice(i, i + 6);
		const fetched = await Promise.all(chunk.map((title) => fetchParsedPage(title)));
		for (let j = 0; j < chunk.length; j++) {
			const res = fetched[j];
			if (!res.missing) {
				pageCache.set(chunk[j], res);
				pageCache.set(res.title, res);
			}
		}
	}

	// Reverse lookup: wikiPage -> Set<digsiteLabel>
	const pageToDigsites = new Map();
	for (const [label, pageTitle] of digsiteToPage.entries()) {
		const resolved = pageCache.get(pageTitle)?.title ?? pageTitle;
		if (!pageToDigsites.has(resolved)) pageToDigsites.set(resolved, new Set());
		pageToDigsites.get(resolved).add(label);
	}

	const locationsCatalog = [];
	const seenLocNames = new Set();

	const recordDrop = (locName, drops) => {
		if (!seenLocNames.has(locName)) {
			seenLocNames.add(locName);
			const pageTitle = digsiteToPage.get(locName) ?? locName.split(' - ')[0];
			const resolvedPage = pageCache.get(pageTitle)?.title ?? pageTitle;
			locationsCatalog.push({
				id: slugify(locName).replace(/-/g, '_'),
				name: locName,
				region: REGION_BY_PAGE_TITLE[resolvedPage] ?? REGION_BY_PAGE_TITLE[pageTitle] ?? 'Other'
			});
		}
		for (const d of drops) {
			const target = mineralMap.get(d.mineral.toLowerCase());
			if (!target) continue;
			if (!target.locations.some((l) => l.location === locName)) {
				target.locations.push({ location: locName, chance_percent: d.chance_percent });
			}
		}
	};

	// Process every fetched page
	const handledPages = new Set();
	for (const res of pageCache.values()) {
		if (handledPages.has(res.title)) continue;
		handledPages.add(res.title);

		const title = res.title;
		const sections = splitSectionsWithHeadings(res.html);

		if (title === 'Pyramid') {
			// Tomb Veins I, II, III + Sarcophagus chest
			for (const sec of sections) {
				if (/^Tomb Chests$/i.test(sec.title)) {
					const sarcIdx = sec.bodyHtml.indexOf('Sarcophagus');
					if (sarcIdx !== -1) {
						const sarcChunk = sec.bodyHtml.slice(sarcIdx);
						for (const liMatch of sarcChunk.matchAll(/<(?:li|dd)\b[^>]*>([\s\S]*?)<\/(?:li|dd)>/gi)) {
							const line = normalizeText(cleanCellHtml(liMatch[1])).replace(/\n+/g, ' ').trim();
							const m = line.match(/^(.+?)\s*[–•-]\s*(\d+(?:\.\d+)?)\s*%/);
							if (!m) continue;
							const canonical = knownMineralsMap.get(m[1].trim().toLowerCase());
							const pct = Number(m[2]);
							if (canonical && Number.isFinite(pct) && pct > 0) {
								const target = mineralMap.get(canonical.toLowerCase());
								if (target && !target.chests.some((c) => c.name === 'Sarcophagus Chest')) {
									target.chests.push({
										name: 'Sarcophagus Chest',
										location: "Pharaoh's Tomb",
										chance_percent: pct
									});
								}
							}
						}
					}
				} else if (/^Tomb Vein I$/i.test(sec.title)) {
					recordDrop('Pyramid - Tomb Vein 1', parseDropItemsFromFragment(sec.bodyHtml, knownMineralsMap));
				} else if (/^Tomb Vein II$/i.test(sec.title)) {
					recordDrop('Pyramid - Tomb Vein 2', parseDropItemsFromFragment(sec.bodyHtml, knownMineralsMap));
				} else if (/^Tomb Vein III$/i.test(sec.title)) {
					recordDrop('Pyramid - Tomb Vein 3', parseDropItemsFromFragment(sec.bodyHtml, knownMineralsMap));
				}
			}
			continue;
		}

		const labels = [...(pageToDigsites.get(title) ?? [title])];
		if (labels.length > 1) {
			// Match each digsite label to the heading section that names it
			for (const label of labels) {
				const exactSec = sections.find(
					(s) =>
						s.title.toLowerCase() === label.toLowerCase() ||
						s.title.toLowerCase() === `${label.toLowerCase()} digsite`
				);
				if (exactSec) {
					recordDrop(label, parseDropItemsFromFragment(exactSec.bodyHtml, knownMineralsMap));
				}
			}
		} else {
			const label = labels[0];
			// Avoid accidentally capturing Waterfall Temple relic list on Crystal Caverns
			const digSec = sections.find(
				(s) =>
					s.title.toLowerCase() === label.toLowerCase() ||
					s.title.toLowerCase() === `${label.toLowerCase()} digsite`
			);
			const htmlToScan = digSec ? digSec.bodyHtml : res.html;
			const drops = parseDropItemsFromFragment(htmlToScan, knownMineralsMap);
			if (drops.length > 0) {
				recordDrop(label, drops);
			}
		}
	}

	// Fetch individual mineral pages for any mineral missing chances from location pages
	const missingMineralEntries = mineralOrder.filter(
		(e) => e.pageTitle && e.locations.length < Math.max(1, e.wikiLocations.length)
	);
	for (let i = 0; i < missingMineralEntries.length; i += 8) {
		const chunk = missingMineralEntries.slice(i, i + 8);
		const pages = await Promise.all(chunk.map((e) => fetchParsedPage(e.pageTitle)));
		for (let j = 0; j < chunk.length; j++) {
			const pageRes = pages[j];
			if (pageRes.missing) continue;
			const parsedChances = parseMineralPageChances(pageRes.html);
			for (const ch of parsedChances) {
				recordDrop(ch.location, [{ mineral: chunk[j].mineral, chance_percent: ch.chance_percent }]);
			}
		}
	}

	const finalMinerals = mineralOrder.map((entry) => {
		entry.locations.sort((a, b) => b.chance_percent - a.chance_percent);
		const out = {
			mineral: entry.mineral,
			rarity: entry.rarity,
			locations: entry.locations
		};
		if (entry.pricePerKg !== null) out.pricePerKg = entry.pricePerKg;
		if (entry.chests.length > 0) out.chests = entry.chests;
		return out;
	});

	return {
		catalog: {
			meta: {
				game: 'Prospecting',
				version: '1.0.0',
				lastUpdated: new Date().toISOString().slice(0, 10),
				source: 'Official Prospecting Miraheze Wiki (sync-wiki-data.mjs)'
			},
			locations: locationsCatalog,
			minerals: finalMinerals
		},
		wikiLocationsByMineral: new Map(
			mineralOrder.map((e) => [e.mineral.toLowerCase(), e.wikiLocations])
		)
	};
}

function parseTreasureChestLocations(treasureChestHtml) {
	const sectionIdx = treasureChestHtml.indexOf('Lootpool_by_Location');
	const slice = sectionIdx !== -1 ? treasureChestHtml.slice(sectionIdx) : treasureChestHtml;
	const locs = new Set();
	for (const m of slice.matchAll(/aria-controls="tabber-([^"]+)"/gi)) {
		const name = decodeURIComponent(m[1]).replace(/_/g, ' ').trim();
		// Top-level location tabs vs relic item sub-tabs
		if (
			/\b(River|Delta|Beach|Sands|Swamp|Peak|Falls|Grotto|Oasis|Caverns|Springs|Furnace|Heart|Creek|Stream|Floodplains|Depths|Void|Pole|Isle|Ruins|Marsh|Sanctuary)\b/i.test(
				name
			)
		) {
			locs.add(name);
		}
	}
	return locs;
}

function parseMuseumBoostCell(bonusCellText, maxBoostCellText) {
	const rawStats = normalizeText(bonusCellText)
		.split(/,|\n/)
		.map((s) => s.trim())
		.filter(Boolean);
	const rawVals = normalizeText(maxBoostCellText)
		.split(/,|\n/)
		.map((s) => s.trim())
		.filter(Boolean);

	const statKeys = rawStats.map((s) => ({
		key: matchStatKey(s.replace(/^[+–-]+\s*/, '')),
		isNeg: /^[–-]/.test(s.trim())
	}));

	const values = rawVals.map((v) => parseNumber(v)).filter((n) => n !== null);
	const maxBoosts = {};

	for (let i = 0; i < statKeys.length; i++) {
		const { key, isNeg } = statKeys[i];
		if (!key) continue;
		let val = values.length === 1 ? values[0] : (values[i] ?? values[values.length - 1]);
		if (val === undefined || val === null) continue;
		if (isNeg && val > 0) val = -val;
		maxBoosts[key] = val;
	}

	return maxBoosts;
}

function parseMuseumFromWiki(museumHtml, treasureChestHtml, mineralsCatalog, wikiLocationsByMineral) {
	const tables = extractSectionsAndTables(museumHtml);
	// Table 0: Displays summary (Common..Exotic)
	const slotCounts = {};
	for (const row of tables[0]?.rows ?? []) {
		const rName = row[0]?.text?.trim().toLowerCase();
		const total = parseNumber(row[5]?.text ?? row[row.length - 1]?.text ?? '');
		if (rName && total !== null && RARITY_LIST.some((r) => r.toLowerCase() === rName)) {
			slotCounts[rName] = total;
		}
	}

	// Table 9: Rarity multipliers
	const rarityMultipliers = {};
	for (const row of tables[9]?.rows ?? []) {
		const rName = row[0]?.text?.trim().toLowerCase();
		const mult = parseNumber(row[1]?.text ?? '');
		if (rName && mult !== null && RARITY_LIST.some((r) => r.toLowerCase() === rName)) {
			rarityMultipliers[rName] = mult;
		}
	}

	// Mineral lookup for Treasured / Entombed / chestOnly derivation
	const minByName = new Map(mineralsCatalog.minerals.map((m) => [m.mineral.toLowerCase(), m]));
	const treasuredLocations = parseTreasureChestLocations(treasureChestHtml);
	const isTombLoc = (loc) =>
		/^Pyramid\s*-\s*Tomb Vein/i.test(loc) || /Pharaoh's Tomb|Pharoah's Tomb/i.test(loc);

	// Tables 1..7: Ores by rarity
	const ores = [];
	for (let ti = 1; ti <= 7; ti++) {
		const rarity = RARITY_LIST[ti - 1].toLowerCase();
		const table = tables[ti];
		if (!table) continue;

		const oreIdx = findColumnIndex(table.headers, [/^ore$/i, /\bmineral\b/i]);
		const minKgIdx = findColumnIndex(table.headers, [/minimum\s*kg/i]);
		const bonusIdx = findColumnIndex(table.headers, [/^bonus$/i]);
		const maxIdx = findColumnIndex(table.headers, [/maximum\s*boost/i]);
		if (oreIdx === -1 || minKgIdx === -1 || bonusIdx === -1 || maxIdx === -1) continue;

		for (const row of table.rows) {
			const name = row[oreIdx]?.text?.split('\n')[0]?.trim();
			const minKg = parseNumber(row[minKgIdx]?.text ?? '');
			if (!name || minKg === null) continue;

			const maxBoosts = parseMuseumBoostCell(
				row[bonusIdx]?.text ?? '',
				row[maxIdx]?.text ?? ''
			);
			if (Object.keys(maxBoosts).length === 0) continue;

			const minEntry = minByName.get(name.toLowerCase());
			const dropLocs = (minEntry?.locations ?? []).map((l) => l.location);
			const wikiLocs = wikiLocationsByMineral.get(name.toLowerCase()) ?? [];
			const chestLocs = (minEntry?.chests ?? []).map((c) => c.location);

			const canBeTreasured =
				dropLocs.some((loc) => treasuredLocations.has(loc)) ||
				wikiLocs.some((loc) => treasuredLocations.has(loc));
			const canBeEntombed =
				dropLocs.some(isTombLoc) ||
				wikiLocs.some(isTombLoc) ||
				chestLocs.some(isTombLoc);
			const chestOnly =
				Boolean(minEntry && minEntry.locations.length === 0 && (minEntry.chests?.length ?? 0) > 0);

			const oreObj = {
				id: slugify(name),
				name,
				rarity,
				minKg,
				maxBoosts,
				canBeTreasured,
				canBeEntombed
			};
			if (chestOnly) oreObj.chestOnly = true;
			ores.push(oreObj);
		}
	}

	// Table 8: Modifier Riders
	const modifierRiders = [];
	const riderTable = tables[8];
	if (riderTable) {
		for (const row of riderTable.rows) {
			const modCell = row[0];
			const bonusCell = row[1];
			const name = modCell?.text?.split('\n')[0]?.trim();
			const bonusText = bonusCell?.text?.trim() ?? '';
			if (!name || /^(none|\(none\))$/i.test(bonusText)) continue;

			const id = slugify(name);
			const colorMatch = modCell?.rawHtml?.match(/style="[^"]*color:\s*(#[0-9a-fA-F]{3,8})/i);
			const color = colorMatch
				? (colorMatch[1].toLowerCase() === '#3ab3aa' ? '#3ab3aa' : colorMatch[1])
				: (MODIFIER_COLOR_FALLBACKS[id] ?? '#ffffff');
			const multiplierFactor = /2\s*[×x]/i.test(bonusText) ? 2 : 1;

			const stats = [];
			for (const part of normalizeText(bonusText).split(/\+|\n|,/)) {
				const k = matchStatKey(part.trim());
				if (k && !stats.includes(k)) stats.push(k);
			}
			if (stats.length === 0) continue;

			modifierRiders.push({
				id,
				name,
				color,
				stats,
				multiplierFactor
			});
		}
	}

	return {
		slotCounts,
		rarityMultipliers,
		ores: ensureUniqueIds(ores),
		modifierRiders
	};
}

async function writeCatalog(filename, data) {
	await mkdir(DATA_DIR, { recursive: true });
	const outPath = resolve(DATA_DIR, filename);
	await writeFile(outPath, `${JSON.stringify(data, null, '\t')}\n`, 'utf8');
	const count = Array.isArray(data)
		? data.length
		: (data.minerals?.length ?? data.ores?.length ?? 1);
	console.log(`Wrote ${count} entries -> src/lib/data/${filename}`);
}

async function runSync() {
	const [
		pansPage,
		shovelsPage,
		enchantPage,
		equipPage,
		runesPage,
		potionsPage,
		shardMerchantPage,
		relicsPage,
		mutationsPage,
		modifiersPage,
		mineralsPage,
		museumPage,
		treasureChestPage
	] = await Promise.all([
		fetchParsedPage('Pans'),
		fetchParsedPage('Shovels'),
		fetchParsedPage('Enchanting'),
		fetchParsedPage('Equipment'),
		fetchParsedPage('Runes'),
		fetchParsedPage('Potions'),
		fetchParsedPage('Shard_Merchant'),
		fetchParsedPage('Relics'),
		fetchParsedPage('Mutations'),
		fetchParsedPage('Modifiers'),
		fetchParsedPage('Minerals'),
		fetchParsedPage('Museum'),
		fetchParsedPage('Treasure_Chest')
	]);

	const pans = pansPage.missing ? [] : parsePans(extractSectionsAndTables(pansPage.html));
	const shovels = shovelsPage.missing ? [] : parseShovels(extractSectionsAndTables(shovelsPage.html));
	const enchants = enchantPage.missing ? [] : parseEnchants(extractSectionsAndTables(enchantPage.html));
	const equipment = equipPage.missing ? [] : parseEquipment(extractSectionsAndTables(equipPage.html));
	const runes = runesPage.missing ? [] : parseRunes(extractSectionsAndTables(runesPage.html));
	const potions = potionsPage.missing ? [] : parsePotions(extractSectionsAndTables(potionsPage.html));
	const totems = shardMerchantPage.missing
		? []
		: parseTotemsFromWiki(
				extractSectionsAndTables(shardMerchantPage.html),
				relicsPage.missing ? '' : relicsPage.html
			);
	const boosts = ensureUniqueIds([...potions, ...totems]);
	const mutations = mutationsPage.missing ? [] : parseMutationsFromHtml(mutationsPage.html);
	const modifiers = modifiersPage.missing
		? []
		: parseModifiersFromWiki(modifiersPage.html, museumPage.missing ? '' : museumPage.html);

	const { catalog: mineralsCatalog, wikiLocationsByMineral } = mineralsPage.missing
		? { catalog: { meta: {}, locations: [], minerals: [] }, wikiLocationsByMineral: new Map() }
		: await syncMineralsAndLocations(mineralsPage.html);

	const museum = museumPage.missing
		? { slotCounts: {}, rarityMultipliers: {}, ores: [], modifierRiders: [] }
		: parseMuseumFromWiki(
				museumPage.html,
				treasureChestPage.missing ? '' : treasureChestPage.html,
				mineralsCatalog,
				wikiLocationsByMineral
			);

	await Promise.all([
		writeCatalog('pans.json', pans),
		writeCatalog('shovels.json', shovels),
		writeCatalog('enchants.json', enchants),
		writeCatalog('equipment.json', equipment),
		writeCatalog('runes.json', runes),
		writeCatalog('boosts.json', boosts),
		writeCatalog('mutations.json', mutations),
		writeCatalog('modifiers.json', modifiers),
		writeCatalog('minerals.json', mineralsCatalog),
		writeCatalog('museum.json', museum)
	]);
}

if (process.argv.includes('--inspect')) {
	const page = await fetchParsedPage('Mutations');
	if (!page.missing) {
		const idx = page.html.indexOf('Effects');
		const idx2 = page.html.indexOf('Effects', idx + 1);
		console.log('=== Slice 1 ===\n', page.html.slice(Math.max(0, idx - 80), idx + 600));
		console.log('=== Slice 2 ===\n', page.html.slice(Math.max(0, idx2 - 80), idx2 + 1200));
	}
} else {
	await runSync();
}
