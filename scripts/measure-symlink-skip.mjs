// Reproduces the case the README describes: a directory whose entries are mostly symlinks.
//
// Links are never followed, so the rows that come back are only the real files. The question
// this script answers is what the caller is told about the ones that were stepped over, which
// is the difference between a result and an answer.
//
//   node scripts/measure-symlink-skip.mjs [--entries 37] [--links 35]
import { mkdtemp, mkdir, writeFile, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRgResolver, createRgRunner } from '../src/rg.js';
import { createSearch } from '../src/host/search.js';
import { loadConfig } from '../src/config.js';

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(name);
  return i === -1 ? fallback : Number(argv[i + 1]);
};
const entries = opt('--entries', 37);
const links = opt('--links', 35);

const root = await mkdtemp(path.join(os.tmpdir(), 'codemode-symlink-'));
const tree = path.join(root, 'tree');
const target = path.join(root, 'target');
await mkdir(tree, { recursive: true });
await mkdir(target, { recursive: true });
await writeFile(path.join(target, 'hidden-by-the-link.txt'), 'needle\n');

for (let i = 0; i < entries; i += 1) {
  if (i < links) await symlink(target, path.join(tree, 'link-' + i), 'dir');
  else await writeFile(path.join(tree, 'real-' + i + '.txt'), 'needle\n');
}

const config = loadConfig([]);
const rgRunner = createRgRunner(createRgResolver(config), { excludeGlobs: [] });
const search = createSearch({ rgRunner, assertInside: (p) => p, caps: { files: 5000, content: 500 } });
const files = await search.files({ path: tree });
const content = await search.content({ query: 'needle', path: tree });

console.log(JSON.stringify({
  root: 'a temporary directory',
  entries,
  links,
  files: { rows: [...files].length, complete: files.complete, skippedSymlinks: files.scope.skippedSymlinks },
  content: { rows: [...content].length, complete: content.complete, skippedSymlinks: content.scope.skippedSymlinks },
}, null, 2));
