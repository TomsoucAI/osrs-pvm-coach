// The Player profile's dry math, through the core's public function.
// Run with: npm run build && node --test dist/core.test.js (from app/)
import { strict as assert } from 'node:assert';
import { isAbsolute, relative, resolve } from 'node:path';
import { test } from 'node:test';
import { dryMath, PROFILE_FILE } from './playerProfile';

test('the Player profile file is outside the repo', () => {
  const fromRepo = relative(resolve('..'), PROFILE_FILE);

  assert.ok(fromRepo.startsWith('..') || isAbsolute(fromRepo), PROFILE_FILE);
});

test('the dry math gives the expected kills and the chance to have had the drop by this kc', () => {
  // Worked by hand: 1 - (1 - 1/2)^1 = 0.5; 1 - (1/2)^2 = 0.75; 1 - (1 - 1/512)^512 ≈ 1 - 1/e = 0.6325.
  assert.deepEqual(dryMath(2, 1), { expectedKills: 2, chance: 0.5 });
  assert.deepEqual(dryMath(2, 2), { expectedKills: 2, chance: 0.75 });
  assert.equal(dryMath(512, 512).expectedKills, 512);
  assert.ok(Math.abs(dryMath(512, 512).chance - 0.6325) < 0.0005, String(dryMath(512, 512).chance));
  assert.ok(Math.abs(dryMath(340, 300).chance - 0.5866) < 0.0005, String(dryMath(340, 300).chance));
});

test('no kill is no chance, and a 1/1 drop is certain after one kill', () => {
  assert.equal(dryMath(340, 0).chance, 0);
  assert.equal(dryMath(1, 1).chance, 1);
});
