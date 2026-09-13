// Build the eval corpus (020 D3): 60 dirs x 50 files, 5 needles at fixed spots.
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const root = process.argv[2] ?? path.join(process.env.ASIDE_HOME ?? path.join(os.homedir(), '.aside'), 'u', '0', 'codemode-eval', 'corpus');
const DIRS = 60, FILES_PER_DIR = 50;
const needles = ['NEEDLE-A1', 'NEEDLE-A2', 'NEEDLE-A3', 'NEEDLE-A4', 'NEEDLE-A5'];
const planted = {};
let n = 0;
for (let d = 0; d < DIRS; d++) {
  const dir = path.join(root, `area-${String(d).padStart(2, '0')}`, `sub-${d % 7}`);
  await mkdir(dir, { recursive: true });
  for (let f = 0; f < FILES_PER_DIR; f++) {
    const name = `doc-${String(f).padStart(3, '0')}.txt`;
    const body = [`# doc ${d}/${f}`, 'lorem ipsum aside codemode eval filler line', 'second filler line with common words search needle decoy', ''].join('\n').repeat(8);
    await writeFile(path.join(dir, name), body);
    n++;
  }
}
for (const [i, needle] of needles.entries()) {
  const d = 7 + i * 11;
  const f = 13 + i * 7;
  const p = path.join(root, `area-${String(d).padStart(2, '0')}`, `sub-${d % 7}`, `doc-${String(f).padStart(3, '0')}.txt`);
  await writeFile(p, `marker file\ncontains ${needle} exactly once\n`);
  planted[needle] = p;
}
console.log(JSON.stringify({ files: n, planted }, null, 1));
