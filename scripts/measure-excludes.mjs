// Reproduces the pruning figures the READMEs quote, with the same ripgrep the host uses and
// the same discovery arguments createRgRunner builds. It walks the configured root twice and
// counts the paths rg lists, because "files walked" is the number the sentence is about.
//
//   node scripts/measure-excludes.mjs            # roots from the resolved config
//   node scripts/measure-excludes.mjs --runs 3   # report every run, not just one
//
// The numbers belong to the machine that ran it. Record them in an evidence note with the
// machine's shape, never as a property of this project.
import { spawn } from 'node:child_process';
import os from 'node:os';
import { loadConfig } from '../src/config.js';
import { createRgResolver } from '../src/rg.js';

const argv = process.argv.slice(2);
const runs = Number(argv[argv.indexOf('--runs') + 1]) || 1;
const config = loadConfig([]);
const root = config.roots[0] || os.homedir();
const rg = await createRgResolver(config)();

function walk(excludeGlobs) {
  const args = ['--files', '--no-messages'];
  for (const g of excludeGlobs) args.push('-g', '!' + g);
  args.push(root);
  return new Promise((resolve, reject) => {
    const started = process.hrtime.bigint();
    const child = spawn(rg, args, { stdio: ['ignore', 'pipe', 'ignore'] });
    let files = 0;
    let tail = '';
    child.stdout.on('data', (chunk) => {
      const text = tail + chunk.toString('utf8');
      const lines = text.split('\n');
      tail = lines.pop();
      files += lines.length;
    });
    child.on('error', reject);
    child.on('close', () => {
      if (tail.length) files += 1;
      resolve({ files, seconds: Number(process.hrtime.bigint() - started) / 1e9 });
    });
  });
}

const out = { rg, root, excludeGlobs: config.excludeGlobs, runs: [] };
for (let i = 0; i < runs; i += 1) {
  const pruned = await walk(config.excludeGlobs);
  const everything = await walk([]);
  out.runs.push({
    pruned,
    everything,
    ratio: Number((everything.seconds / pruned.seconds).toFixed(1)),
  });
}
console.log(JSON.stringify(out, null, 2));
