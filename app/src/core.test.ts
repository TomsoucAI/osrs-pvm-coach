// Entry point of the core test bundle (the engine's imports need the esbuild bundle, like selftest.ts).
// Run with: npm run build && node --test dist/core.test.js
import './core/liveState.test';
import './core/bankMode.test';
import './core/bankModeBoosts.test';
import './core/thrall.test';
import './core/bankModePins.test';
import './core/briefing.test';
