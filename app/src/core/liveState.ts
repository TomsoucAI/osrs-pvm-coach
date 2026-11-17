// Reads the DPS Bridge plugin's files into one LiveState. Both files pass a schema at this boundary.
//   state.json: schema version 1 (worn gear, levels, prayers, style, target) or
//               version 2 (+ inventory, rune pouch, spellbook, drains). A v1 file reads with the v2 fields empty.
//   bank.json:  the last bank snapshot. The plugin writes it only while the bank is open, so it can be absent.
import { readFile } from 'node:fs/promises';
import * as z from 'zod/v4';
import { countedDrainsSchema, type Snapshot } from '../snapshot';

const itemStack = z.object({ id: z.number().int(), quantity: z.number().int() });
const skillMap = z.partialRecord(
  z.enum(['atk', 'str', 'def', 'ranged', 'magic', 'prayer', 'hp', 'mining', 'herblore', 'farming']),
  z.number().int(),
);

const loggedInState = z.object({
  version: z.number().int().min(1).max(2),
  loggedIn: z.literal(true),
  timestamp: z.number().optional(),
  playerName: z.string().optional(),
  equipment: z.record(z.string(), z.number().int().nullable()).optional(),
  realLevels: skillMap.optional(),
  boostedLevels: skillMap.optional(),
  prayers: z.array(z.string()).optional(),
  attackStyleIndex: z.number().int().optional(),
  castingMode: z.number().int().optional(),
  styleSlots: z.array(z.string()).optional(),
  autocastSpell: z.string().optional(),
  buffs: z.object({
    onSlayerTask: z.boolean().optional(),
    inWilderness: z.boolean().optional(),
    kandarinDiary: z.boolean().optional(),
    chargeSpell: z.boolean().optional(),
  }).optional(),
  target: z.object({ id: z.number().int(), name: z.string() }).nullable().optional(),
  inventory: z.array(itemStack).default([]),
  runePouch: z.array(z.object({ runeItemId: z.number().int(), quantity: z.number().int() })).default([]),
  spellbook: z.enum(['standard', 'ancient', 'lunar', 'arceuus']).nullable().default(null),
  drains: countedDrainsSchema.nullable().default(null),
});

const loggedOutState = z.object({
  version: z.number().int().min(1).max(2),
  loggedIn: z.literal(false),
  timestamp: z.number().optional(),
});

const stateFileSchema = z.discriminatedUnion('loggedIn', [loggedInState, loggedOutState]);

const bankFileSchema = z.object({
  timestamp: z.number(),
  items: z.array(itemStack),
});

type LoggedInState = z.infer<typeof loggedInState>;
export type ItemStack = z.infer<typeof itemStack>;
export type Spellbook = NonNullable<LoggedInState['spellbook']>;

/** The player's live state. It extends Snapshot, so `buildPlayer` takes it as it is. */
export interface LiveState extends Snapshot {
  loggedIn: boolean;
  inventory: ItemStack[];
  /** The last bank snapshot, or null when the plugin has not written one yet. */
  bank: { items: ItemStack[]; ageMs: number } | null;
  runePouch: LoggedInState['runePouch'];
  /** null = unknown (a v1 state file). */
  spellbook: Spellbook | null;
  drains: LoggedInState['drains'];
}

async function readJson(file: string): Promise<unknown | undefined> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw e;
  }
  return JSON.parse(text);
}

export async function readState(stateFile: string, bankFile: string, now: number = Date.now()): Promise<LiveState> {
  const rawState = await readJson(stateFile);
  if (rawState === undefined) {
    throw new Error(`No state file at ${stateFile}. Log in with the "DPS Bridge" plugin enabled.`);
  }
  const state = stateFileSchema.safeParse(rawState);
  if (!state.success) throw new Error(`State file ${stateFile} does not match the schema:\n${z.prettifyError(state.error)}`);

  let bank: LiveState['bank'] = null;
  const rawBank = await readJson(bankFile);
  if (rawBank !== undefined) {
    const parsed = bankFileSchema.safeParse(rawBank);
    if (!parsed.success) throw new Error(`Bank file ${bankFile} does not match the schema:\n${z.prettifyError(parsed.error)}`);
    bank = { items: parsed.data.items, ageMs: now - parsed.data.timestamp };
  }

  if (!state.data.loggedIn) {
    return {
      source: 'dps-bridge', loggedIn: false, timestamp: state.data.timestamp, inventory: [], bank, runePouch: [], spellbook: null, drains: null,
    };
  }
  const { version: _version, ...fields } = state.data;
  return { source: 'dps-bridge', ...fields, bank };
}
