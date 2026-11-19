// The Briefing's selected Mechanic: a click on the timeline picks one, and scrolling picks the row in view.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { anchorOf, picked, seen } from './selection';

test('a click selects its Mechanic, and the scroll it starts does not change that on the way', () => {
  let selection = picked('dharok', 1000);
  // The smooth scroll passes the rows between here and Dharok's.
  selection = seen(selection, 'larvae', 1100);
  selection = seen(selection, 'slam', 1300);

  assert.equal(selection.id, 'dharok');
});

test('once the clicked row is in view, scrolling selects the row in view again', () => {
  let selection = seen(picked('dharok', 1000), 'dharok', 1400);
  selection = seen(selection, 'slam', 1500);

  assert.equal(selection.id, 'slam');
});

test('a scroll that never reaches the clicked row (the last rows of the page) gives scrolling back after a while', () => {
  const selection = seen(picked('melee-only', 1000), 'dharok', 5000);

  assert.equal(selection.id, 'dharok');
});

test('the URL anchor names a Mechanic of the notes, or nothing', () => {
  const ids = ['screech', 'slam', 'dharok'];

  assert.equal(anchorOf('#slam', ids), 'slam');
  assert.equal(anchorOf('#phase-slams', ids), null);
  assert.equal(anchorOf('', ids), null);
});
