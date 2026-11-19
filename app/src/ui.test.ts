// Entry point of the UI test bundle: the UI server (the core's engine imports need the esbuild bundle, like
// core.test.ts) and the page's browser-storage helper.
// Run with: npm run build && node --test dist/ui.test.js
import './ui/server.test';
import '../page/src/recentBosses.test';
