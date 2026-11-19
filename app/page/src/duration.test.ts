// The one duration format of the page: m:ss, like an in-game timer.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { duration } from './duration';

test('a duration reads m:ss, like an in-game timer', () => {
  assert.equal(duration(150), '2:30');
  assert.equal(duration(769), '12:49');
  assert.equal(duration(59), '0:59');
});

test('a duration rounds to the nearest second', () => {
  assert.equal(duration(59.6), '1:00');
  assert.equal(duration(0.4), '0:00');
});
