// Fetches the OSRS Wiki DPS calculator engine (pinned) into ../vendor, needed only to rebuild.
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
const COMMIT = process.env.CALC_COMMIT ?? '74958b18f6559cf1bf58f7ac74e7a442a7ac8e2f';
const dir = '../vendor/osrs-dps-calc';
const run = (c) => execSync(c, { stdio: 'inherit' });
if (!existsSync(dir)) run(`git clone https://github.com/weirdgloop/osrs-dps-calc.git ${dir}`);
run(`git -C ${dir} fetch origin`);
run(`git -C ${dir} checkout ${process.argv[2] === '--latest' ? 'origin/main' : COMMIT}`);
console.log('Calculator engine ready. Now: npm run build');
