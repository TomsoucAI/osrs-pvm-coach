// Player profile core (spec #72, module 3): the Goals and a typed kc per boss, in one local JSON file per player.
// The file lives next to the app's other local data (`~/.osrs-pvm-coach/`), outside the repo: it is private.
// This module hides the read, the atomic write, the schema check and the dry math, so the page computes nothing.
// Account type is "unknown" until the Hiscores reader (ticket 7).
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { z } from 'zod';

/** The Player profile file of the player on this PC. */
export const PROFILE_FILE = join(homedir(), '.osrs-pvm-coach', 'profile.json');

const name = z.string().trim().min(1).max(100);

const Goal = z.discriminatedUnion('kind', [
  /** An item drop, picked from the boss's Boss notes, with its drop rate: 1 in `oneIn` kills. */
  z.strictObject({
    kind: z.literal('item'), boss: name, item: name, oneIn: z.number().min(1).max(10_000_000), done: z.boolean(),
  }),
  /** A combat achievement, picked from the boss's Boss notes. The player marks it done by hand (v1). */
  z.strictObject({
    kind: z.literal('combatAchievement'), boss: name, name, done: z.boolean(),
  }),
]);

const PlayerProfileSchema = z.strictObject({
  goals: z.array(Goal).max(200),
  /** The kc that the player typed, by boss name. */
  kc: z.record(name, z.number().int().min(0).max(1_000_000)),
}).superRefine((profile, ctx) => {
  // A Goal is listed once.
  const seen = new Set<string>();
  profile.goals.forEach((goal, i) => {
    const key = JSON.stringify([goal.kind, goal.boss, goal.kind === 'item' ? goal.item : goal.name]);
    if (seen.has(key)) ctx.addIssue({ code: 'custom', message: 'this Goal is listed twice', path: ['goals', i] });
    seen.add(key);
  });
});

export type PlayerProfile = z.infer<typeof PlayerProfileSchema>;
export type Goal = PlayerProfile['goals'][number];

/** The dry math of an item Goal: the kc it uses (null when none is typed), the expected kills, and the chance by now. */
export interface Dry { kc: number | null; expectedKills: number; chance: number | null }

/** What the profile endpoint returns: the profile with the dry math done. */
export interface ProfileView {
  accountType: 'unknown';
  kc: PlayerProfile['kc'];
  goals: (Goal & { dry?: Dry })[];
}

const EMPTY: PlayerProfile = { goals: [], kc: {} };

/** For a drop of 1 in `oneIn`: the expected kills to get it, and the chance to have had it by `kc` kills. */
export function dryMath(oneIn: number, kc: number): { expectedKills: number; chance: number } {
  return { expectedKills: oneIn, chance: 1 - (1 - 1 / oneIn) ** kc };
}

/** A body checked against the profile schema: the profile, or a message safe to show. */
export function checkProfile(body: unknown): { ok: true; profile: PlayerProfile } | { ok: false; message: string } {
  const parsed = PlayerProfileSchema.safeParse(body);
  return parsed.success ? { ok: true, profile: parsed.data } : { ok: false, message: z.prettifyError(parsed.error) };
}

/** The profile on disk. No file yet is an empty profile. Throws when the file is malformed: it is never overwritten by a read. */
export async function readProfile(file: string): Promise<PlayerProfile> {
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return EMPTY;
    throw e;
  }
  const checked = checkProfile(JSON.parse(raw));
  if (!checked.ok) throw new Error(`Player profile ${file} is malformed:\n${checked.message}`);
  return checked.profile;
}

/** Writes the profile atomically: a temporary file in the same folder, then a rename over the old file. */
export async function writeProfile(file: string, profile: PlayerProfile): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, `${JSON.stringify(profile, null, 2)}\n`, 'utf8');
    await rename(temp, file);
  } catch (e) {
    await rm(temp, { force: true });
    throw e;
  }
}

/** The profile with the dry math done for each item Goal, from the kc typed for its boss. */
export function viewProfile(profile: PlayerProfile): ProfileView {
  return {
    accountType: 'unknown',
    kc: profile.kc,
    goals: profile.goals.map((goal) => {
      if (goal.kind !== 'item') return goal;
      const kc = profile.kc[goal.boss] ?? null;
      const { expectedKills, chance } = dryMath(goal.oneIn, kc ?? 0);
      return { ...goal, dry: { kc, expectedKills, chance: kc === null ? null : chance } };
    }),
  };
}
