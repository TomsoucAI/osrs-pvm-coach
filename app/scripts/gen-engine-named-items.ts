// Writes src/core/engineNamedItems.json from the vendored engine source. Run with: npm run gen-named-items
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { scanEngineNamedItems } from './engine-named-items';

const names = scanEngineNamedItems(resolve('../vendor/osrs-dps-calc'));
writeFileSync(resolve('src/core/engineNamedItems.json'), `${JSON.stringify(names, null, 2)}\n`, 'utf8');
console.log(`wrote ${names.length} names to src/core/engineNamedItems.json`);
