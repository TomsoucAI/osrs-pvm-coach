#!/usr/bin/env node
// Legality linter for RuneLite plugins. Pattern checks only: it catches risky CODE, the
// osrs-legality-gate skill judges FEATURES. Rules mirror AGENTS.md "Plugin Rules & Restrictions".
//
//   node tools/legal-lint.mjs [dir]   scan (default src/main/java); exit 1 on RED
//   node tools/legal-lint.mjs --hook  Claude Code PostToolUse hook; exit 2 sends findings to Claude
//
// RED  = rejected outright by the rules. Remove it.
// AMBER = legal or banned depending on the feature. Allowed in a file that records a verdict:
//         // legal-gate: GREEN <one-line reason>
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';

const RED = [
  [/\bjava\.awt\.Robot\b|\bnew\s+Robot\s*\(/, 'Input injection (Robot). Rule: no injecting mouse/keyboard events'],
  [/dispatchEvent\s*\(\s*new\s+(KeyEvent|MouseEvent)/, 'Synthetic key/mouse event. Rule: no injecting input events'],
  [/\b(client\s*\.\s*)?(menuAction|invokeMenuAction)\s*\(/, 'Sends a game action. Rule: no automation / menu entries that act on the server'],
  [/CHATBOX_TYPED_TEXT|CHATBOX_TYPEDTEXT/, 'Writes chatbox input. Rule: no autotyping'],
  [/\b(Runtime\.getRuntime\(\)\.exec|ProcessBuilder)\b/, 'Runs external processes. Rule: forbidden language feature'],
  [/\b(setAccessible|getDeclaredField|getDeclaredMethod|Class\.forName)\s*\(/, 'Reflection. Rule: forbidden language feature'],
  [/\bcom\.sun\.jna\b|\bnative\s+\w+\s*\(|\bSystem\.loadLibrary\b/, 'JNI/JNA. Rule: forbidden language feature'],
  [/\bsun\.misc\.Unsafe\b/, 'Unsafe memory access. Rule: forbidden language feature'],
  [/\b(defineClass|URLClassLoader)\b/, 'Dynamic class loading. Rule: no downloading/loading code at runtime'],
  [/\b(ObjectInputStream|ObjectOutputStream)\b/, 'Java serialization. Rule: forbidden language feature'],
  [/\b(HttpServer|ServerSocket|WebSocketServer)\b/, 'Serves data over the network. Rule: no exposing player information over HTTP'],
  [/\bThread\s*\.\s*sleep\b/, 'Blocks the thread (Thread.sleep). Rule: never use Thread.sleep()'],
];

const AMBER = [
  [/\b(ProjectileMoved|getProjectiles|Projectile\b)/, 'Tracks projectiles: banned at bosses/raids/wave content if it shows landing, target or timing'],
  [/\bAnimationChanged\b/, 'Reacts to animations: banned at bosses if it predicts attacks, counts attacks or cues mechanics'],
  [/PROTECT_FROM_(MAGIC|MISSILES|MELEE)|Prayerbook|PRAYERBOOK|PrayerID|InterfaceID\.Prayer/, 'Touches protection prayers / prayer tab: no prayer recommendations or switching indicators'],
  [/\b(createMenuEntry|setDeprioritized|MenuEntrySwap|swapMenu|setMenuEntries)\b/, 'Changes menus: several menu changes are rejected (attack/cast options, equipped items, player options)'],
  [/\b(SoundEffect|playSoundEffect|clip\.start)\b/, 'Plays sounds: banned as an extra audio cue for a boss mechanic'],
  [/\b\w*[nN]pc\w*\s*\.\s*getInteracting\s*\(/, "Reads an NPC's target: no NPC focus identification at bosses or in PvP"],
  [/\b(OkHttpClient|HttpURLConnection|HttpClient)\b/, 'Network calls: check data & privacy rules (no crowdsourcing other players)'],
  [/\bnew\s+File\s*\(|\bFiles\.(write|newBufferedWriter|newOutputStream)\b|\bRUNELITE_DIR\b/, 'Direct file I/O: Plugin Hub requires the Filepath utility'],
];

const VERDICT = /\/\/\s*legal-gate:\s*GREEN\s+\S/;

function javaFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...javaFiles(p));
    else if (p.endsWith('.java')) out.push(p);
  }
  return out;
}

function lint(file) {
  const text = readFileSync(file, 'utf8');
  const hasVerdict = VERDICT.test(text);
  const findings = [];
  text.split('\n').forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, '');
    for (const [re, why] of RED) if (re.test(code)) findings.push({ level: 'RED', line: i + 1, why, src: line.trim() });
    if (!hasVerdict) {
      for (const [re, why] of AMBER) if (re.test(code)) findings.push({ level: 'AMBER', line: i + 1, why, src: line.trim() });
    }
  });
  return findings;
}

function report(files, root) {
  let red = 0; let amber = 0; const lines = [];
  for (const f of files) {
    for (const x of lint(f)) {
      x.level === 'RED' ? red++ : amber++;
      lines.push(`${x.level.padEnd(5)} ${relative(root, f)}:${x.line}  ${x.why}\n        ${x.src.slice(0, 140)}`);
    }
  }
  return { red, amber, text: lines.join('\n') };
}

const advice = `
RED: remove it; the rules reject it whatever the feature.
AMBER: run the osrs-legality-gate skill on the feature, then record the verdict at the top of the file:
  // legal-gate: GREEN <one-line reason>   (only when the gate says GREEN)`;

if (process.argv.includes('--hook')) {
  // Claude Code PostToolUse: lint the edited file only
  let input = '';
  process.stdin.on('data', (d) => { input += d; }).on('end', () => {
    let file;
    try { file = JSON.parse(input).tool_input?.file_path; } catch { /* not JSON */ }
    if (!file || !file.endsWith('.java') || !file.includes(`${'src'}`)) process.exit(0);
    const r = report([resolve(file)], process.cwd());
    if (r.red + r.amber === 0) process.exit(0);
    console.error(`legal-lint: ${r.red} RED, ${r.amber} AMBER\n${r.text}\n${advice}`);
    process.exit(2);
  });
} else {
  const dir = resolve(process.argv[2] ?? 'src/main/java');
  const r = report(javaFiles(dir), process.cwd());
  console.log(r.text || 'legal-lint: clean');
  if (r.red + r.amber) console.log(`\n${r.red} RED, ${r.amber} AMBER${advice}`);
  process.exit(r.red ? 1 : 0);
}
