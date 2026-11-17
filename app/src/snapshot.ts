// Reads the live character state.
// 1) DPS Bridge RuneLite plugin  -> ~/.runelite/plugin-data/dps_bridge/state.json (gear, boosts, prayers, style, target)
// 2) Fallback: WikiSync plugin   -> ws://localhost:37767-37776 (gear + base levels only)
import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import * as z from 'zod/v4';

export type SkillMap = Partial<Record<'atk' | 'str' | 'def' | 'ranged' | 'magic' | 'prayer' | 'hp' | 'mining' | 'herblore' | 'farming', number>>;

/** The player's own landed spec drains that the plugin counted on one NPC. */
export const countedDrainsSchema = z.object({
  targetId: z.number().int(),
  dwhHits: z.number().int(),
  elderMaulHits: z.number().int(),
  bgsDamage: z.number().int(),
});
export type CountedDrains = z.infer<typeof countedDrainsSchema>;

export interface Snapshot {
  source: 'dps-bridge' | 'wikisync' | 'manual';
  playerName?: string;
  timestamp?: number;
  equipment?: Partial<Record<string, number | null>>;
  realLevels?: SkillMap;
  boostedLevels?: SkillMap;
  prayers?: string[];
  attackStyleIndex?: number;
  castingMode?: number;
  styleSlots?: string[];
  autocastSpell?: string;
  buffs?: { onSlayerTask?: boolean; inWilderness?: boolean; kandarinDiary?: boolean; chargeSpell?: boolean };
  target?: { id: number; name: string } | null;
  drains?: CountedDrains | null;
}

export const bridgeFile = () => process.env.DPS_BRIDGE_FILE
  ?? join(homedir(), '.runelite', 'plugin-data', 'dps_bridge', 'state.json');

async function readBridge(): Promise<Snapshot | null> {
  try {
    await stat(bridgeFile());
    const data = JSON.parse(await readFile(bridgeFile(), 'utf8'));
    if (data.loggedIn === false) return null;
    // Drains that do not match the schema count as no drains.
    return { ...data, drains: countedDrainsSchema.nullable().catch(null).parse(data.drains ?? null), source: 'dps-bridge' };
  } catch {
    return null;
  }
}

function tryWikiSyncPort(port: number, timeoutMs = 1500): Promise<Snapshot | null> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://localhost:${port}`);
    const done = (v: Snapshot | null) => { clearTimeout(t); try { ws.close(); } catch { /* */ } resolve(v); };
    const t = setTimeout(() => done(null), timeoutMs);
    ws.on('error', () => done(null));
    ws.on('open', () => ws.send(JSON.stringify({ _wsType: 'GetPlayer', sequenceId: 1, data: {} })));
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg._wsType !== 'GetPlayer' || msg.error) return;
      const l = msg.payload?.loadouts?.[0];
      if (!l) return done(null);
      const equipment: Record<string, number | null> = {};
      for (const [slot, v] of Object.entries(l.equipment ?? {})) equipment[slot] = (v as { id?: number } | null)?.id ?? null;
      done({
        source: 'wikisync',
        playerName: l.name,
        equipment,
        realLevels: l.skills,
        buffs: l.buffs,
      });
    });
  });
}

async function readWikiSync(): Promise<Snapshot | null> {
  for (let port = 37767; port <= 37776; port++) {
    const s = await tryWikiSyncPort(port, port === 37767 ? 1500 : 300);
    if (s) return s;
  }
  return null;
}

export async function getSnapshot(): Promise<Snapshot> {
  const bridge = await readBridge();
  if (bridge) return bridge;
  const wiki = await readWikiSync();
  if (wiki) return wiki;
  throw new Error(
    'No live RuneLite data. Log in with the "DPS Bridge" plugin enabled '
    + `(writes ${bridgeFile()}) or the WikiSync plugin from the Plugin Hub.`,
  );
}
