#!/usr/bin/env node
/**
 * osrs-dps-mcp-server: live OSRS DPS from RuneLite, computed by the OSRS Wiki DPS calculator engine.
 * Local stdio server. Reads only: the DPS Bridge plugin file (or WikiSync on localhost). Never acts in the game.
 */
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';
import {
  buildPlayer, calculate, defenceAfterReductions, DefenceReductions, describeLoadout, Overrides, resolveMonster,
  searchMonsters, VALID,
} from './calc';
import { bridgeFile, getSnapshot, Snapshot } from './snapshot';
import { planBankMode, type Setup } from './core/bankMode';
import { readState } from './core/liveState';
import { dirname, join } from 'node:path';
import type { Monster } from '@/types/Monster';

const CHARACTER_LIMIT = 25_000;

enum ResponseFormat { MARKDOWN = 'markdown', JSON = 'json' }

// All tools only read local game state and compute; nothing is modified.
const READ_ONLY = {
  readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false,
} as const;

// ---------- shared schemas ----------

const SLOTS = ['head', 'cape', 'neck', 'ammo', 'weapon', 'body', 'shield', 'legs', 'hands', 'feet', 'ring'] as const;
const slotValue = z.union([z.string(), z.number().int(), z.null()]).optional();

const responseFormat = z.enum(ResponseFormat).default(ResponseFormat.MARKDOWN)
  .describe("'markdown' for readable text (default), 'json' for structured data");

const monsterFields = {
  monster: z.string().min(2).max(100).optional()
    .describe('Monster name, e.g. "Vorkath", "Abyssal demon". Omit to use what the player is currently fighting.'),
  monster_version: z.string().max(100).optional()
    .describe('Monster variant when a name has several, e.g. "Post-quest", "Challenge Mode". See osrs_search_monsters.'),
  monster_id: z.number().int().positive().optional()
    .describe('Exact NPC id from osrs_search_monsters; overrides monster/monster_version.'),
  defence_reductions: z.strictObject({
    dwh_hits: z.number().int().min(0).max(10).optional().describe('Successful Dragon warhammer specs (-30% current defence each)'),
    elder_maul_hits: z.number().int().min(0).max(10).optional().describe('Successful Elder maul specs (-35% each)'),
    bgs_damage: z.number().int().min(0).max(1000).optional().describe('Total damage dealt by Bandos godsword specs (drains defence first, then other stats)'),
    arclight_hits: z.number().int().min(0).max(10).optional().describe('Successful Arclight specs'),
    emberlight_hits: z.number().int().min(0).max(10).optional().describe('Successful Emberlight specs'),
    accursed: z.boolean().optional().describe('Accursed sceptre spec active (-15% defence and magic)'),
    vulnerability: z.boolean().optional().describe('Vulnerability spell active (-10% defence)'),
  }).optional()
    .describe('Defence drains landed before attacking, applied in order: accursed/vulnerability, elder maul, DWH, arclight/emberlight, BGS. Boss defence floors are applied automatically. e.g. {"dwh_hits": 2}'),
};

const overrideFields = {
  prayers: z.array(z.string()).max(5).optional()
    .describe(`Replace the active prayers; [] means none. Values: ${VALID.prayers.join(', ')}`),
  potions: z.array(z.string()).max(5).optional()
    .describe(`Simulate these potions on base levels instead of live boosts. Values: ${VALID.potions.join(', ')}`),
  style: z.string().max(40).optional()
    .describe('Combat style name or stance, e.g. "Lash", "Rapid", "Aggressive". Default: the in-game style.'),
  spell: z.string().max(60).optional()
    .describe('Spell for magic with a normal staff, e.g. "Fire Surge", "Ice Barrage". Powered staves need none.'),
  on_slayer_task: z.boolean().optional().describe('Override the slayer-task flag read from the game.'),
  equipment: z.strictObject(Object.fromEntries(SLOTS.map((s) => [s, slotValue])) as Record<typeof SLOTS[number], typeof slotValue>)
    .optional()
    .describe('Gear swaps by slot: item name or id, null empties the slot. e.g. {"weapon": "Abyssal tentacle"}'),
};

type OverrideArgs = {
  prayers?: string[]; potions?: string[]; style?: string; spell?: string;
  on_slayer_task?: boolean; equipment?: Partial<Record<typeof SLOTS[number], string | number | null>>;
};
const toOverrides = (a: OverrideArgs): Overrides => ({
  prayers: a.prayers, potions: a.potions, style: a.style, spell: a.spell,
  onSlayerTask: a.on_slayer_task, equipment: a.equipment,
});

// ---------- helpers ----------

type ReductionArgs = {
  dwh_hits?: number; elder_maul_hits?: number; bgs_damage?: number; arclight_hits?: number;
  emberlight_hits?: number; accursed?: boolean; vulnerability?: boolean;
};
const toReductions = (r?: ReductionArgs): DefenceReductions | undefined => (r ? {
  dwhHits: r.dwh_hits, elderMaulHits: r.elder_maul_hits, bgsDamage: r.bgs_damage, arclightHits: r.arclight_hits,
  emberlightHits: r.emberlight_hits, accursed: r.accursed, vulnerability: r.vulnerability,
} : undefined);

function pickMonster(snap: Snapshot, a: {
  monster?: string; monster_version?: string; monster_id?: number; defence_reductions?: ReductionArgs;
}): Monster {
  const reductions = toReductions(a.defence_reductions);
  if (a.monster_id !== undefined || a.monster) {
    return resolveMonster({ id: a.monster_id, name: a.monster, version: a.monster_version, reductions });
  }
  if (snap.target) return resolveMonster({ id: snap.target.id, name: snap.target.name, reductions });
  throw new Error('No target: the player is not fighting anything. Pass `monster` (e.g. "Vorkath"), or ask the player to attack the NPC first.');
}

const monsterLabel = (m: Monster) => `${m.name}${m.version ? ` (${m.version})` : ''}`;

function sourceWarnings(snap: Snapshot): string[] {
  return snap.source === 'wikisync'
    ? ['Using WikiSync fallback: base levels only; no live prayers, potions, style or target. Pass prayers/potions/style/monster explicitly, or ask the player to enable the DPS Bridge plugin.']
    : [];
}

function reply(format: ResponseFormat, data: Record<string, unknown>, markdown: () => string) {
  if (format === ResponseFormat.JSON) {
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }], structuredContent: data };
  }
  return { content: [{ type: 'text' as const, text: markdown() }] };
}

const mdNotes = (notes: string[]) => (notes.length ? `\n\n**Notes**\n${notes.map((n) => `- ${n}`).join('\n')}` : '');

function mdLoadout(l: ReturnType<typeof describeLoadout>) {
  const gear = Object.entries(l.equipment).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(' · ');
  return [
    `- **Gear**: ${gear || '(nothing equipped)'}`,
    `- **Levels** (current/base): atk ${l.levels.attack}, str ${l.levels.strength}, def ${l.levels.defence}, ranged ${l.levels.ranged}, magic ${l.levels.magic}`,
    `- **Prayers**: ${l.prayers.join(', ') || 'none'}`,
    `- **Style**: ${l.style ?? '?'}${l.spell ? ` · spell ${l.spell}` : ''}`,
    `- **On slayer task**: ${l.onSlayerTask ? 'yes' : 'no'}`,
  ].join('\n');
}

function mdSetup(s: Setup, rank: number) {
  const gear = Object.entries(s.items).filter(([, item]) => item).map(([slot, item]) => `${slot}: ${item!.name} [${item!.source}]`).join(' · ');
  const swaps = s.swaps.map((w) => `${w.slot}: ${w.from ?? 'empty'} → ${w.to ? `${w.to} [${w.source}]` : 'empty'}`).join('; ');
  return [
    `${rank}. **${s.dps} DPS** · max hit ${s.maxHit} · accuracy ${s.accuracyPct}% · avg kill ${s.avgTtkSeconds ?? '?'}s · ${s.style}${s.spell ? ` · ${s.spell}` : ''}`,
    `   - **Gear**: ${gear || '(nothing equipped)'}`,
    `   - **Swaps (${s.swaps.length})**: ${swaps || 'none, this is what you wear now'}`,
  ].join('\n');
}

const mdAge = (ms: number) => (ms < 3_600_000 ? `${Math.max(0, Math.round(ms / 60_000))} min` : `${Math.round(ms / 3_600_000)} h`);

// ---------- server ----------

function createServer(): McpServer {
  const server = new McpServer({ name: 'osrs-dps-mcp-server', version: '0.2.0' });

  server.registerTool('osrs_get_loadout', {
    title: 'Get live OSRS loadout',
    description: `Read the player's live Old School RuneScape state from RuneLite: equipped gear, current vs base levels (potion boosts), active prayers, attack style, slayer task and current target.

Use this to answer "what am I wearing / what's boosted / what am I fighting". For damage numbers use osrs_calculate_dps instead.`,
    inputSchema: z.strictObject({ response_format: responseFormat }),
    annotations: READ_ONLY,
  }, async ({ response_format }) => {
    const snap = await getSnapshot();
    const monster = snap.target ? resolveMonster({ id: snap.target.id, name: snap.target.name }) : resolveMonster({ name: 'Abyssal demon' });
    const { player, notes } = buildPlayer(snap, monster);
    const loadout = describeLoadout(player);
    const allNotes = [...sourceWarnings(snap), ...notes];
    const data = {
      source: snap.source, player: snap.playerName ?? null, target: snap.target ?? null, loadout, notes: allNotes,
    };
    return reply(response_format, data, () => [
      `# Loadout: ${snap.playerName ?? 'player'}`,
      mdLoadout(loadout),
      `- **Target**: ${snap.target ? `${snap.target.name} (#${snap.target.id})` : 'none'}`,
      `- **Source**: ${snap.source}`,
    ].join('\n') + mdNotes(allNotes));
  });

  server.registerTool('osrs_calculate_dps', {
    title: 'Calculate OSRS DPS',
    description: `Calculate DPS, max hit, accuracy and average time-to-kill for the player's live loadout against a monster, using the OSRS Wiki DPS calculator engine. Optional overrides simulate changes (prayers, potions, style, spell, gear swaps) without touching the game.

Examples:
  - "What's my DPS on what I'm fighting?" -> {}
  - "DPS on Vorkath post-quest with Piety?" -> {monster: "Vorkath", monster_version: "Post-quest", prayers: ["PIETY"]}
  - "What if I used a tentacle?" -> {equipment: {weapon: "Abyssal tentacle"}}
  - "DPS on Vorkath after 2 DWH specs land?" -> {monster: "Vorkath", monster_version: "Post-quest", defence_reductions: {dwh_hits: 2}}
Use osrs_compare_setups to rank several variants at once; osrs_search_monsters if the name is ambiguous.`,
    inputSchema: z.strictObject({ ...monsterFields, ...overrideFields, response_format: responseFormat }),
    annotations: READ_ONLY,
  }, async (a) => {
    const snap = await getSnapshot();
    const monster = pickMonster(snap, a);
    const { player, notes } = buildPlayer(snap, monster, toOverrides(a));
    const result = calculate(player, monster);
    const loadout = describeLoadout(player);
    const allNotes = [...sourceWarnings(snap), ...notes];
    const defence = defenceAfterReductions(monster);
    const data = {
      monster: monsterLabel(monster), monster_id: monster.id, defence_level: defence, result, loadout, notes: allNotes,
    };
    const defLine = defence.effective !== defence.base ? `Defence ${defence.base} → **${defence.effective}** after drains\n` : '';
    return reply(a.response_format, data, () => [
      `# DPS vs ${monsterLabel(monster)}`,
      `${defLine}**${result.dps} DPS** · max hit ${result.maxHit} · accuracy ${result.accuracyPct}% · ${result.attackSpeedTicks}-tick weapon · avg kill ${result.avgTtkSeconds ?? '?'}s`,
      '',
      '## Loadout used',
      mdLoadout(loadout),
    ].join('\n') + mdNotes(allNotes));
  });

  server.registerTool('osrs_compare_setups', {
    title: 'Compare OSRS setups',
    description: `Rank up to 10 variations of the live loadout against one monster by DPS. The live setup is always included as "current". Each variant takes the same overrides as osrs_calculate_dps.

Variants can also carry their own defence_reductions, e.g. to compare "no spec" vs "1 DWH" vs "2 DWH" vs "elder maul".

Example: "Tentacle vs Slayer helm (i) vs no prayer on Abyssal demons" ->
  {monster: "Abyssal demon", variants: [{label: "tentacle", equipment: {weapon: "Abyssal tentacle"}}, {label: "slayer helm", equipment: {head: "Slayer helmet (i)"}}, {label: "no prayer", prayers: []}]}`,
    inputSchema: z.strictObject({
      ...monsterFields,
      variants: z.array(z.strictObject({
        label: z.string().min(1).max(40).describe('Short name shown in the ranking'),
        ...overrideFields,
        defence_reductions: monsterFields.defence_reductions,
      })).min(1).max(10).describe('Variations to compare against the current setup'),
      response_format: responseFormat,
    }),
    annotations: READ_ONLY,
  }, async (a) => {
    const snap = await getSnapshot();
    const monster = pickMonster(snap, a);
    type Row = { label: string; defence?: number; dps?: number; max_hit?: number; accuracy_pct?: number; avg_ttk_seconds?: number | null; error?: string };
    const rows: Row[] = [{ label: 'current' } as OverrideArgs & { label: string; defence_reductions?: ReductionArgs }, ...a.variants].map((v) => {
      try {
        // A variant's own defence_reductions replace the shared ones
        const m = v.defence_reductions
          ? resolveMonster({ id: monster.id, reductions: toReductions(v.defence_reductions) })
          : monster;
        const { player } = buildPlayer(snap, m, toOverrides(v));
        const r = calculate(player, m);
        return {
          label: v.label, defence: defenceAfterReductions(m).effective, dps: r.dps, max_hit: r.maxHit, accuracy_pct: r.accuracyPct, avg_ttk_seconds: r.avgTtkSeconds,
        };
      } catch (e) {
        return { label: v.label, error: (e as Error).message };
      }
    });
    rows.sort((x, y) => (y.dps ?? -1) - (x.dps ?? -1));
    const notes = sourceWarnings(snap);
    const data = { monster: monsterLabel(monster), monster_id: monster.id, results: rows, notes };
    return reply(a.response_format, data, () => [
      `# Setups vs ${monsterLabel(monster)}`,
      '| # | Setup | Defence | DPS | Max hit | Accuracy | Avg kill |',
      '|---|---|---|---|---|---|---|',
      ...rows.map((r, i) => (r.error
        ? `| ${i + 1} | ${r.label} | | error: ${r.error} | | | |`
        : `| ${i + 1} | ${r.label} | ${r.defence} | ${r.dps} | ${r.max_hit} | ${r.accuracy_pct}% | ${r.avg_ttk_seconds ?? '?'}s |`)),
    ].join('\n') + mdNotes(notes));
  });

  server.registerTool('osrs_best_owned_setup', {
    title: 'Best owned OSRS setup',
    description: `Rank the best setups the player OWNS against one monster version, per combat style (melee, ranged, magic). The owned pool is the worn gear, the inventory and the last bank snapshot from the DPS Bridge plugin. DPS comes from the OSRS Wiki DPS calculator engine with the player's live levels and prayers.

Returns up to 3 setups per style: the 3 best overall. Setups with the same DPS count once (the one with the fewest swaps is shown), so two entries can use the same weapon. Each item carries where it is (worn / inventory / bank), and each setup lists the slots to swap from what is worn now. A style that the phase makes impossible is "unavailable" (e.g. Maggot King "Far": no melee).

Examples:
  - "Best setup I own vs Maggot King Far?" -> {monster: "Maggot King", monster_version: "Far"}
  - "Best ranged setup I own for Vorkath?" -> {monster: "Vorkath", monster_version: "Post-quest", style: "ranged"}
  - "And after 2 DWH specs?" -> {monster: "Maggot King", monster_version: "Nearby", defence_reductions: {dwh_hits: 2}}
Use osrs_search_monsters for the exact monster_version. Prefer monster + monster_version to monster_id: the phases of one boss can share an id.`,
    inputSchema: z.strictObject({
      ...monsterFields,
      style: z.enum(['melee', 'ranged', 'magic']).optional().describe('One combat style. Omit to rank all three.'),
      response_format: responseFormat,
    }),
    annotations: READ_ONLY,
  }, async (a) => {
    const state = await readState(bridgeFile(), join(dirname(bridgeFile()), 'bank.json'));
    let monster;
    if (a.monster_id !== undefined) monster = { id: a.monster_id };
    else if (a.monster) monster = { name: a.monster, version: a.monster_version };
    else if (state.target) monster = state.target;
    else throw new Error('No target: the player is not fighting anything. Pass `monster` (e.g. "Maggot King") and `monster_version`.');

    const plan = planBankMode(state, { monster, style: a.style, drains: toReductions(a.defence_reductions) });
    const label = `${plan.monster.name}${plan.monster.version ? ` (${plan.monster.version})` : ''}`;
    return reply(a.response_format, { ...plan }, () => [
      `# Best owned setups vs ${label}`,
      plan.bankAgeMs === null ? 'Bank: no snapshot yet.' : `Bank snapshot: ${mdAge(plan.bankAgeMs)} old.`,
      ...Object.entries(plan.styles).flatMap(([style, stylePlan]) => [
        '',
        `## ${style[0].toUpperCase()}${style.slice(1)}`,
        'unavailable' in stylePlan ? `Unavailable: ${stylePlan.unavailable}` : stylePlan.setups.map((s, i) => mdSetup(s, i + 1)).join('\n'),
      ]),
    ].join('\n') + mdNotes(plan.notes));
  });

  server.registerTool('osrs_search_monsters', {
    title: 'Search OSRS monsters',
    description: `Find monsters in the Wiki calculator data by name: returns id, name, version, hitpoints and defence level. Use it to pick the exact monster/monster_version (or monster_id) for osrs_calculate_dps when a name has several variants.

Example: "vorkath" -> Vorkath (Dragon Slayer II), Vorkath (Post-quest).`,
    inputSchema: z.strictObject({
      query: z.string().min(2).max(100).describe('Part of the monster name, e.g. "vork", "abyssal"'),
      limit: z.number().int().min(1).max(50).default(10).describe('Maximum results to return'),
      offset: z.number().int().min(0).default(0).describe('Results to skip, for pagination'),
      response_format: responseFormat,
    }),
    annotations: READ_ONLY,
  }, async ({
    query, limit, offset, response_format,
  }) => {
    const all = searchMonsters(query);
    if (all.length === 0) {
      return { content: [{ type: 'text' as const, text: `No monster matches "${query}". Try a shorter part of the name (e.g. "vork").` }] };
    }
    const render = (count: number) => {
      const monsters = all.slice(offset, offset + count);
      const nextOffset = offset + monsters.length;
      const hasMore = all.length > nextOffset;
      const page = {
        total: all.length, count: monsters.length, offset, monsters, has_more: hasMore, ...(hasMore ? { next_offset: nextOffset } : {}),
      };
      const text = response_format === ResponseFormat.JSON
        ? JSON.stringify(page, null, 2)
        : [`# Monsters matching "${query}"`, `Showing ${monsters.length} of ${all.length}.`, '',
          ...monsters.map((m) => `- **${m.name}**${m.version ? ` (${m.version})` : ''}: id ${m.id}, ${m.hp} hp, ${m.def} def`),
          ...(hasMore ? ['', `More results: call again with offset=${nextOffset}.`] : [])].join('\n');
      return { page, text };
    };
    let count = limit;
    let r = render(count);
    while (count > 1 && r.text.length > CHARACTER_LIMIT) { count = Math.ceil(count / 2); r = render(count); }
    return response_format === ResponseFormat.JSON
      ? { content: [{ type: 'text' as const, text: r.text }], structuredContent: r.page }
      : { content: [{ type: 'text' as const, text: r.text }] };
  });

  return server;
}

serveStdio(createServer);
console.error(`osrs-dps-mcp-server running on stdio (reading ${bridgeFile()})`);
