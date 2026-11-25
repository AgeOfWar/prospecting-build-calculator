# Prospecting! Build Calculator

Web app built with **SvelteKit**, **TypeScript**, and **Tailwind CSS** to calculate stats and optimize loadouts for the Roblox game **Prospecting!**.

## Official Wiki Reference
All game mechanics, items, and stat formulas are sourced from the official Miraheze wiki:
- https://prospecting.miraheze.org/wiki/Main_Page

## Core Formula & Loadout Slots
- **Formula**: `Final Stat = (Base + Flats) * (1 + Boosts)`
- **Tools**: 1 Pan (+1 Pan Enchant), 1 Shovel (+1 Shovel Enchant)
- **Jewelry**: 1 Necklace, 1 Charm, up to 8 Rings
- **Additional Boosts**: Runes, Museum collections, Totems, Potions, Mastery

## Project Structure
- `src/lib/types/` — TypeScript types for tools, enchants, equipment, runes, and loadouts
- `src/lib/data/` — Wiki-sourced JSON catalogs (`pans.json`, `shovels.json`, `enchants.json`, `equipment.json`, `mutations.json`, `runes.json`, `boosts.json`, `minerals.json`, `modifiers.json`, `museum.json`) and typed exports in `index.ts`
- `src/lib/engine/` — Pure stat calculation, museum boosts, mineral drop chance math, and build optimizer engine
- `src/routes/` — SvelteKit UI routes (`/`, `/builder`, `/museum`, `/optimizer`, `/chance`)
- `scripts/sync-wiki-data.mjs` — Script to fetch and regenerate JSON catalogs from the Miraheze wiki

## Scripts
- `npm run dev` — Start the local development server
- `npm run sync:data` — Fetch latest item data from the official Miraheze wiki and regenerate `src/lib/data/*.json`
- `npm run check` — Run `svelte-kit sync` and `svelte-check` type checking
- `npm run build` — Create a production build
- `npm run preview` — Preview the production build locally
