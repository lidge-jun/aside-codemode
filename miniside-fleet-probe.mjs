import { readFileSync, readdirSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const home = os.homedir();
let cur = null;
try { cur = JSON.parse(readFileSync(path.join(home, '.aside', 'accounts.json'), 'utf8')).currentAccountId; } catch {}
const dir = path.join(home, '.aside', 'u');
const ids = existsSync(dir) ? readdirSync(dir) : [];
const out = { platform: process.platform, node: process.version, current: cur, accounts: [] };
for (const id of ids) {
  let m = null;
  try { m = JSON.parse(readFileSync(path.join(dir, id, 'settings.json'), 'utf8')).mcp; } catch {}
  out.accounts.push({
    id,
    servers: m && m.servers ? Object.entries(m.servers).map(([k, v]) => [k, v.enabled !== false]) : null,
    inv: m && m.inventories ? Object.keys(m.inventories) : null,
    v: m ? (m.toolInventoryMigrationVersion ?? null) : null,
  });
}
console.log(JSON.stringify(out));
