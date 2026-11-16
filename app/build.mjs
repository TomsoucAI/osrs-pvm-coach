import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const here = dirname(fileURLToPath(import.meta.url));
const calc = join(here, '..', 'vendor', 'osrs-dps-calc');
for (const [entry, out] of [['src/index.ts', 'dist/index.js'], ['src/selftest.ts', 'dist/selftest.js'], ['src/inspect.ts', 'dist/inspect.js']]) {
  await build({
    entryPoints: [entry], outfile: out, bundle: true, platform: 'node', format: 'esm', target: 'node20',
    alias: { '@': join(calc, 'src') },
    loader: { '.png': 'empty', '.svg': 'empty', '.webp': 'empty', '.gif': 'empty', '.jpg': 'empty' },
    nodePaths: [join(here, 'node_modules')],
    banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
    logLevel: 'warning',
    tsconfigRaw: { compilerOptions: { useDefineForClassFields: true } },
  });
}
console.log('built dist/');
