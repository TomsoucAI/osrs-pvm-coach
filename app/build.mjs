import { build } from 'esbuild';
import react from '@vitejs/plugin-react';
import { build as buildPage } from 'vite';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const here = dirname(fileURLToPath(import.meta.url));
const calc = join(here, '..', 'vendor', 'osrs-dps-calc');
for (const [entry, out] of [['src/index.ts', 'dist/index.js'], ['src/selftest.ts', 'dist/selftest.js'], ['src/inspect.ts', 'dist/inspect.js'], ['src/ui.ts', 'dist/ui.js'], ['src/core.test.ts', 'dist/core.test.js'], ['src/ui.test.ts', 'dist/ui.test.js']]) {
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
// The bank-mode page (React + Vite, ADR-1). dist/ui.js serves this build output; the Vite dev server is never the app.
// File names carry no hash, so the committed bundle changes only when the page changes.
await buildPage({
  configFile: false,
  root: join(here, 'page'),
  plugins: [react()],
  logLevel: 'warn',
  build: {
    outDir: join(here, 'dist', 'page'),
    emptyOutDir: true,
    rolldownOptions: { output: { entryFileNames: 'assets/page.js', assetFileNames: 'assets/page.[ext]' } },
  },
});
console.log('built dist/');
