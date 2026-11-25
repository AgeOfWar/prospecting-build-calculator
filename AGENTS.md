# Prospecting! Build Calculator — Project Guide

## Project Goal
Web application to calculate stats and find the optimal build for the Roblox game **Prospecting!**.

## Official Data Source (Wiki)
- **Primary Wiki**: https://prospecting.miraheze.org/wiki/Main_Page
- Always consult the official Miraheze wiki above when adding or updating item stats, formulas, drop mechanics, or game updates.

## Core Game Mechanics
- **Stat Calculation Formula**:
  `Final Stat = (Base + Flats) * (1 + Boosts)`
  - `Base`: Provided directly by equipped gear (pans, shovels, jewelry, upgraded/prismatic items).
  - `Flats`: Raw additive points from potions, quest rewards, enchants, or specific buffs.
  - `Boosts`: Percentage bonuses (runes, museum collections, totems, cookies, mastery, enchants) summed together before multiplying.
- **Tools**:
  - **Pans**: `luck`, `capacity`, `shakeStrength`, `shakeSpeed`
  - **Shovels**: `digStrength`, `digSpeed`, `toughness`
- **Enchanting**:
  - Max **1 active enchant per tool** (Pan enchants at Mysterious Altar / via Enchant Books; Shovel enchants at Oasis Enchantment Altar).
- **Equipment (Jewelry)**:
  - **1 Necklace**, **1 Charm**, and up to **8 Rings**.
  - Supports star quality upgrades (1★–6★, e.g., Magma Forge merging), reforging, and mutations (e.g., Frozen Peak forge).
- **Additional Boost Sources**:
  - Runes, Museum collections, Totems, Potions/Buffs, and Mastery.

## Tech Stack & Architecture
- **Framework**: SvelteKit (Svelte 5 runes mode enforced in `vite.config.ts`), TypeScript (`strict: true`), Tailwind CSS v4.
- **Path Aliases**: `#lib/*` maps to `./src/lib/*` (configured in `package.json`).
- **Directory Structure**:
  - `src/lib/types/` — Domain models and stat/loadout interfaces
  - `src/lib/data/` — Wiki-sourced JSON catalogs (`pans.json`, `shovels.json`, `enchants.json`, `equipment.json`, `mutations.json`, `runes.json`, `boosts.json`, `minerals.json`, `modifiers.json`, `museum.json`) exported via `index.ts`
  - `src/lib/engine/` — Pure stat calculation, museum bonuses, mineral drop probability, and build optimization logic
  - `src/lib/components/` — Reusable UI components
  - `src/routes/` — SvelteKit pages (`/`, `/builder`, `/museum`, `/optimizer`, `/chance`) and layouts
  - `scripts/sync-wiki-data.mjs` — Refresh wiki JSON catalogs via `npm run sync:data`

## Conventions
- The user communicates in Italian; keep Roblox / **Prospecting!** item names and stat labels aligned with the official English wiki unless the user explicitly asks for translations.
- Keep calculation logic pure and deterministic in `src/lib/engine/` so it can be unit-tested and used by both the interactive calculator and automated optimizer.
