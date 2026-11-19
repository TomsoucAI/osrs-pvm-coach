// The page's recent-boss chips: kept in browser storage when it works, and never a reason for the page to fail.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { addRecent, loadRecent, saveRecent } from './recentBosses';

/** A working storage, in memory. */
function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() { return data.size; },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => { data.delete(k); },
    setItem: (k, v) => { data.set(k, String(v)); },
  };
}

const denied = () => { throw new DOMException('The operation is insecure.', 'SecurityError'); };

test('a picked boss comes first, once, and the list keeps the 6 most recent', () => {
  let list = [{ boss: 'Vorkath', phase: 'Post-quest' }];
  for (const boss of ['Zulrah', 'Maggot King', 'Vorkath', 'Cerberus', 'Kraken', 'Scorpia', 'Vet\'ion']) {
    list = addRecent(list, { boss, phase: boss === 'Vorkath' ? 'Post-quest' : '' });
  }
  list = addRecent(list, { boss: 'Maggot King', phase: 'Far' });

  assert.deepEqual(list.map((r) => r.boss), ['Maggot King', 'Vet\'ion', 'Scorpia', 'Kraken', 'Cerberus', 'Vorkath']);
  assert.equal(list[0].phase, 'Far');
});

test('the list survives a reload through the storage', () => {
  const storage = memoryStorage();
  const list = addRecent([], { boss: 'Maggot King', phase: 'Nearby' });

  saveRecent(() => storage, list);

  assert.deepEqual(loadRecent(() => storage), list);
});

test('with no usable storage, loading gives no chips and saving does nothing, with no error', () => {
  const throwing = { ...memoryStorage(), getItem: denied, setItem: denied };
  const list = addRecent([], { boss: 'Maggot King', phase: 'Far' });

  for (const getStorage of [denied, () => throwing, () => null]) {
    assert.deepEqual(loadRecent(getStorage), []);
    assert.doesNotThrow(() => saveRecent(getStorage, list));
  }
});

test('a stored value that is not a list of bosses gives no chips', () => {
  const storage = memoryStorage();
  for (const value of ['not json', '{"boss":"Zulrah"}', '[1,2]', '[{"boss":"Zulrah"}]']) {
    storage.setItem('bank-mode.recent-bosses', value);
    assert.deepEqual(loadRecent(() => storage), [], value);
  }
});
