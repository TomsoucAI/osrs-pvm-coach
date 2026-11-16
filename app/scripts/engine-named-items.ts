/**
 * Lists the non-weapon items that the Wiki engine's code names (set effects, slayer helmet, salve, tomes...).
 * The optimizer never prunes these items on stats alone, because the engine gives them an effect beyond their stats.
 *
 * It scans the vendored engine source for string literals, so the list follows the pinned engine commit.
 * `npm run gen-named-items` writes the list to src/core/engineNamedItems.json (`npm run update-calc` runs it).
 * A core test fails when that file is out of date.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const LITERAL = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"/g;
const INCLUDES_LITERAL = /\.includes\(\s*(?:'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)")\s*\)/g;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.isDirectory()) return sourceFiles(join(dir, e.name));
    return e.name.endsWith('.ts') ? [join(dir, e.name)] : [];
  });
}

const unescape = (s: string) => s.replace(/\\(['"])/g, '$1');

export function scanEngineNamedItems(engineDir: string): string[] {
  const equipment = JSON.parse(readFileSync(join(engineDir, 'cdn', 'json', 'equipment.json'), 'utf8')) as { name: string; slot: string }[];
  const exact = new Set<string>();
  const partial = new Set<string>();
  for (const file of [...sourceFiles(join(engineDir, 'src', 'lib')), join(engineDir, 'src', 'utils.ts')]) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(LITERAL)) exact.add(unescape(m[1] ?? m[2]));
    for (const m of src.matchAll(INCLUDES_LITERAL)) partial.add(unescape(m[1] ?? m[2]));
  }
  const names = new Set<string>();
  for (const item of equipment) {
    if (item.slot === 'weapon') continue;
    if (exact.has(item.name) || [...partial].some((p) => item.name.includes(p))) names.add(item.name);
  }
  return [...names].sort();
}
