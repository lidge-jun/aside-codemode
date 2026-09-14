# WP5 — Behavior tests over string locks

Depends on WP1–WP2 so the new contracts exist. Does not reopen WP3 numbers or WP4 license text except to add tests that *call* them.

## Loop spec

- Archetype: satisfy-spec.
- Trigger: WP0 D; after line-mode and grepFile land.
- Goal: a wrong implementation cannot pass by matching a source substring or a README slogan alone.
- Non-goals: deleting `test/readme-51x.test.js` copy locks (they still protect the operator wording); new APIs; extra lint toolchain.
- Verifier: `npm test` (glob `test/*.test.js` includes the files this phase edits).
- Stop: windowsHide is proven via `rgChildOpts`; grep/patch negatives already in WP1/WP2 stay; bench `--self-check` is in the suite (WP3). This phase only fills remaining holes.
- Escalation: none.

## IN / OUT

IN: `src/child-opts.js` (add injectable spawn/exec wrappers), `src/rg.js`, `src/rg-stream.js` (call those wrappers), `test/windows-hide.test.js`, `test/readme-51x.test.js` (add, do not remove).  
OUT: new features, README 51x numbers, license copyright line.

## MODIFY `src/child-opts.js` — injectable process wrappers

A source grep cannot prove spawn options. Add wrappers that **are** the only rg spawn/exec path, and test them with a stub.

```js
import { spawn, execFile } from 'node:child_process';

export function rgChildOpts(extra = {}, env = process.env) {
  const opts = { ...extra };
  if (env.CODEMODE_WINDOWS_HIDE === '1') opts.windowsHide = true;
  return opts;
}

export function createRgProcessFns({ spawnImpl = spawn, execFileImpl = execFile } = {}) {
  return {
    spawnRg(bin, args, extra = {}, env = process.env) {
      return spawnImpl(bin, args, rgChildOpts(extra, env));
    },
    execFileRg(bin, args, extra = {}, env = process.env) {
      return new Promise((resolve, reject) => {
        execFileImpl(bin, args, rgChildOpts(extra, env), (err, stdout, stderr) => {
          if (err) reject(err);
          else resolve({ stdout, stderr });
        });
      });
    },
  };
}

export const { spawnRg, execFileRg } = createRgProcessFns();
```

Do **not** `promisify(execFileRg)`. The wrapper is already a Promise. `promisify` would treat `env` as the callback.

## MODIFY `src/rg-stream.js` and `src/rg.js`

- `rg-stream.js:70` becomes `child = spawnRg(bin, args);` — delete the direct `spawn(..., rgChildOpts())` call. `import { spawnRg } from './child-opts.js'`. Do not import `spawn` in this file.
- `rg.js` version probes (`:74`, `:99`) become `await execFileRg(abs, ['--version'], { timeout: 5000, signal, killSignal: 'SIGKILL' }, env)` (same for `cand`). Delete `promisify(execFile)` for those probes. `where.exe` (`:46`) stays `execFile`/`execFileP('where.exe', …)` — not rg, no hide policy. `rg.js` may import `execFile` only for `where.exe`.

## MODIFY `test/windows-hide.test.js`

Keep the four `rgChildOpts` behavior tests (`:10-29`).

Replace the source-string test (`:31-35`) with a **stubbed spawn** proof plus a thin import lock:

```js
test('spawnRg forwards rgChildOpts to the process impl', () => {
  const captured = [];
  const { spawnRg } = createRgProcessFns({
    spawnImpl(bin, args, opts) {
      captured.push({ bin, args, opts });
      return { pid: 0 };
    },
  });
  spawnRg('rg', ['--version'], { timeout: 5 }, {});
  assert.equal(Object.hasOwn(captured[0].opts, 'windowsHide'), false);
  assert.equal(captured[0].opts.timeout, 5);

  captured.length = 0;
  spawnRg('rg', ['--version'], {}, { CODEMODE_WINDOWS_HIDE: '1' });
  assert.equal(captured[0].opts.windowsHide, true);
});

test('execFileRg forwards rgChildOpts and does not use promisify', async () => {
  const captured = [];
  const { execFileRg } = createRgProcessFns({
    execFileImpl(bin, args, opts, cb) {
      captured.push({ bin, args, opts });
      cb(null, 'ok', '');
    },
  });
  const out = await execFileRg('rg', ['--version'], { timeout: 5 }, { CODEMODE_WINDOWS_HIDE: '1' });
  assert.equal(out.stdout, 'ok');
  assert.equal(captured[0].opts.windowsHide, true);
  assert.equal(captured[0].opts.timeout, 5);
});

test('rg call sites spawn only through child-opts helpers', () => {
  const stream = readFileSync(path.join(srcDir, 'rg-stream.js'), 'utf8');
  const rg = readFileSync(path.join(srcDir, 'rg.js'), 'utf8');
  assert.match(stream, /spawnRg\(/);
  assert.equal(/\bspawn\s*\(/.test(stream), false);
  assert.match(rg, /execFileRg/);
  assert.equal(/windowsHide/.test(stream + rg), false);
});
```

The stub test fails if `spawnRg` ignores `rgChildOpts`. The import lock fails if a call site goes back to raw `spawn`. Together they close the “dead rgChildOpts() still passes” hole.

## Keep WP1/WP2 negatives

Confirm (do not duplicate unless missing):

- `test/patch-line.test.js` foobar / delete-blank / CRLF context
- `test/grepfile-envelope.test.js` max lookahead + invalid max

If WP1/WP2 files exist, WP5 only reviews they are not phrase tests.

## MODIFY `test/readme-51x.test.js`

Add one test that `evidence/dev-folder-51x.md` contains `eval/bench-search.mjs` and `equality`, so the companion cannot vanish while the slogan tests still pass. Do not assert timings.

```js
test('51x evidence names the companion bench and equality check', () => {
  const note = readFileSync(path.join(root, 'evidence', 'dev-folder-51x.md'), 'utf8');
  assert.match(note, /eval\/bench-search\.mjs/);
  assert.match(note, /equality/);
});
```

## Threat leftovers (hardening, no new controls)

| Residual | Already owned | This phase |
| --- | --- | --- |
| Agent JS is trusted-peer, not hostile sandbox | README trust model | no change |
| Inclusive glob vs ignore | WP2 docs | no rg flag change |
| Public `edit_file` CRLF substring | WP1 residual | no change |
| CI not run without push | WP4 | no change |
| `grepFile` JS regex can block the host | README | no change |

Do not add rate limits, new root checks, or dependency scanners (no deps).

## Activation

| Case | How | Observe |
| --- | --- | --- |
| Hide | `node --test test/windows-hide.test.js` | `rgChildOpts` required; `windowsHide` token absent from rg sources |
| Evidence lock | `node --test test/readme-51x.test.js` | companion filenames present; 55s/1s/51x remain |
| Full | `npm test` | 0 fail |

## Residuals

Phrase tests remain as *copy* locks. They are not performance or spawn proofs. That distinction stays in 000 / 001.
