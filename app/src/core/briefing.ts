// Briefing core: given a boss name, its Boss notes or "no notes" (spec #72, module 2).
// The notes are one JSON file per boss in the top-level `boss-notes/` folder (CC BY-NC-SA 3.0, see its LICENSE).
// A file is checked against the schema at load: a malformed file is refused, never shown.
//
// Legality condition (spec #72): the Briefing reads the Boss notes only. It never reads the target, its HP or any
// live combat field, so it cannot react to a fight.
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'a date is YYYY-MM-DD');
const text = z.string().trim().min(1);
const percent = z.number().min(0).max(100);
/** The deep-link anchor of a Phase or a Mechanic, e.g. #slam. */
const anchor = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'an id is lower-case words joined by "-"');

/**
 * A fact's source, by its key in the file's `sources`. `says` is set when two sources disagree on the fact:
 * both are kept, each with what it says, and the page shows them side by side with their dates.
 */
const SourceRef = z.strictObject({ ref: text, says: text.optional() });
const sourced = { sources: z.array(SourceRef).min(1) };

const Source = z.strictObject({
  name: text,
  url: z.url({ protocol: /^https$/ }),
  /** The source's date: a Wiki page's last edit, or the day the source was read. */
  date: day,
});

const AttackStyle = z.enum(['melee', 'ranged', 'magic', 'typeless']);
/** The protection prayer a Mechanic asks for. 'off' = turn protection prayers off. */
const Prayer = z.enum(['melee', 'missiles', 'magic', 'off']);

const Clip = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('wiki'), file: text, label: text, watch: text, credit: text,
  }),
  z.strictObject({
    kind: z.literal('youtube'),
    videoId: z.string().regex(/^[\w-]{11}$/),
    start: z.number().int().min(0),
    end: z.number().int().positive(),
    label: text,
    watch: text,
    credit: text,
  }).refine((c) => c.end > c.start, { message: 'a clip ends after it starts', path: ['end'] }),
]);

const fromTo = (v: { from: number; to: number }) => v.from > v.to;
const FROM_TO = { message: '"from" is the higher boss HP %, "to" the lower', path: ['from'] };

const Phase = z.strictObject({
  id: anchor, name: text, from: percent, to: percent, summary: text, topMistake: text, ...sourced,
}).refine(fromTo, FROM_TO);

const Mechanic = z.strictObject({
  id: anchor,
  name: text,
  style: AttackStyle,
  prayer: Prayer.optional(),
  from: percent,
  to: percent,
  tell: text,
  do: text,
  miss: text,
  /** "55", or a range "15–25" (an en dash), drawn as one hitsplat per number. */
  missDamage: z.string().regex(/^\d+(–\d+)?$/, 'missDamage is "55" or a range "15–25"').optional(),
  why: text,
  clips: z.array(Clip),
  ...sourced,
}).refine(fromTo, FROM_TO);

const BossNotesSchema = z.strictObject({
  boss: text,
  status: z.enum(['draft', 'reviewed']),
  checkedOn: day,
  /** The Wiki credit line that the licence asks for. */
  credit: text,
  sources: z.record(z.string(), Source),
  // The seven parts.
  phases: z.array(Phase).min(1),
  mechanics: z.array(Mechanic).min(1),
  styles: z.strictObject({
    attacks: z.array(AttackStyle.exclude(['typeless'])).min(1), weakness: text, detail: text, ...sourced,
  }),
  methods: z.array(z.strictObject({ rank: z.number().int().positive(), name: text, summary: text, ...sourced })).min(1),
  gearPrinciples: z.array(z.strictObject({ principle: text, why: text, ...sourced })).min(1),
  combatAchievements: z.array(z.strictObject({
    name: text, tier: z.enum(['easy', 'medium', 'hard', 'elite', 'master', 'grandmaster']), task: text, tip: text, ...sourced,
  })).min(1),
  mistakes: z.array(z.strictObject({ mistake: text, fix: text, ...sourced })).min(1),
  // The drops, for the Goals tab: the rate is 1 in `oneIn` kills.
  drops: z.array(z.strictObject({ item: text, oneIn: z.number().min(1), note: text.optional(), ...sourced })).min(1),
  // The Cheat sheet (ticket #77). `killers`: the ids of the Mechanics that kill you most, the worst first.
  killers: z.array(anchor).min(1).max(3),
  // The inventory to bring, slot by slot as the game draws it (4 × 7). `id` is the game's item id; its icon is the
  // Wiki image "<item>.png". `note` says which setup it is for.
  inventory: z.strictObject({
    note: text,
    items: z.array(z.strictObject({ item: text, id: z.number().int().positive() })).min(1).max(28),
    ...sourced,
  }),
}).superRefine((notes, ctx) => {
  // Every source that a fact names is listed in the file.
  const check = (refs: z.infer<typeof SourceRef>[], path: (string | number)[]) => refs.forEach(({ ref }, i) => {
    if (!(ref in notes.sources)) ctx.addIssue({ code: 'custom', message: `unknown source "${ref}"`, path: [...path, 'sources', i, 'ref'] });
  });
  check(notes.styles.sources, ['styles']);
  check(notes.inventory.sources, ['inventory']);
  // Each killer is a Mechanic of this file, named once.
  notes.killers.forEach((id, i) => {
    if (!notes.mechanics.some((m) => m.id === id)) ctx.addIssue({ code: 'custom', message: `killer "${id}" is no Mechanic of this file`, path: ['killers', i] });
    if (notes.killers.indexOf(id) !== i) ctx.addIssue({ code: 'custom', message: `killer "${id}" is named twice`, path: ['killers', i] });
  });
  for (const part of ['phases', 'mechanics', 'methods', 'gearPrinciples', 'combatAchievements', 'mistakes', 'drops'] as const) {
    notes[part].forEach((fact, i) => check(fact.sources, [part, i]));
  }
  // Ids are anchors in one page: each is used once.
  for (const part of ['phases', 'mechanics'] as const) {
    const seen = new Set<string>();
    notes[part].forEach(({ id }, i) => {
      if (seen.has(id)) ctx.addIssue({ code: 'custom', message: `duplicate id "${id}"`, path: [part, i, 'id'] });
      seen.add(id);
    });
  }
});

export type BossNotes = z.infer<typeof BossNotesSchema>;
export type Mechanic = BossNotes['mechanics'][number];
export type AttackStyle = Mechanic['style'];
export type Prayer = NonNullable<Mechanic['prayer']>;

/** "Maggot King" → "maggot-king": the file name of a boss's notes. */
const fileOf = (boss: string) => `${boss.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.json`;

/** The notes files in the folder. A request never builds a path: it can only pick a name from this list. */
async function noteFiles(notesDir: string): Promise<string[]> {
  return (await readdir(notesDir)).filter((name) => name.endsWith('.json'));
}

async function load(notesDir: string, file: string): Promise<BossNotes> {
  let json: unknown;
  try {
    json = JSON.parse(await readFile(join(notesDir, file), 'utf8'));
  } catch (e) {
    throw new Error(`Boss notes ${file}: not readable JSON (${(e as Error).message})`);
  }
  const parsed = BossNotesSchema.safeParse(json);
  if (!parsed.success) throw new Error(`Boss notes ${file} are malformed:\n${z.prettifyError(parsed.error)}`);
  if (fileOf(parsed.data.boss) !== file) throw new Error(`Boss notes ${file} name the boss "${parsed.data.boss}": the file name must be ${fileOf(parsed.data.boss)}`);
  return parsed.data;
}

/** A boss's notes, or null when it has none. Throws when its file is malformed. */
export async function readBriefing(notesDir: string, boss: string): Promise<BossNotes | null> {
  const file = fileOf(boss);
  return (await noteFiles(notesDir)).includes(file) ? load(notesDir, file) : null;
}

/** Every notes file in the folder, each checked. Throws on the first malformed file. */
export async function listBossNotes(notesDir: string): Promise<BossNotes[]> {
  return Promise.all((await noteFiles(notesDir)).map((file) => load(notesDir, file)));
}
