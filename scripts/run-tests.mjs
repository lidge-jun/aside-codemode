#!/usr/bin/env node
// Enumerate explicitly: Node 18/20 do not expand quoted test globs, and shell
// expansion is not portable to Windows. Keep every *.test.js in the suite.
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const files = readdirSync(new URL('test/', root))
  .filter((name) => name.endsWith('.test.js'))
  .sort()
  .map((name) => fileURLToPath(new URL(`test/${name}`, root)));
if (!files.length) throw new Error('No test/*.test.js files found');
const result = spawnSync(process.execPath, ['--test', ...process.argv.slice(2), ...files], {
  cwd: fileURLToPath(root),
  stdio: 'inherit',
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
