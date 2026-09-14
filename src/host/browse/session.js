// The ONE place a browse job reaches Aside. Nothing else spawns.
//
// Two measured facts shape this module (001 E1, E5):
//   1. The Aside CLI exits 0 even when the run failed. Success is the trailing
//      `[ok | Nms]` marker AND inspection of the files the run claims to have written.
//   2. Killing the CLI leaks its tabs permanently, so the host deadline is deliberately
//      LATER than the script's own deadline. If the host timer ever fires, the script
//      never printed its payload and the tabs are unrecoverable — that is reported as a
//      host-kill leak rather than quietly dropped.
import { validateJob } from './schema.js';
import { compile, deadlineMath } from './script.js';

const MARKER = /\[(ok|error) \| (\d+)ms\]\s*$/;

export function parseMarker(stdout) {
  const m = MARKER.exec(String(stdout).trimEnd());
  if (!m) return { marker: null, ms: null };
  return { marker: m[1], ms: Number(m[2]) };
}

export function parseFinal(stdout) {
  for (const line of String(stdout).split(/\r?\n/).reverse()) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    try {
      const o = JSON.parse(t);
      if (o && o.type === 'final') return o;
    } catch (_) { /* not the payload line */ }
  }
  return null;
}

export function createBrowseSession({ spawnAside, resolveAside, now = Date.now, signal } = {}) {
  if (typeof spawnAside !== 'function') throw new TypeError('spawnAside is required');
  if (typeof resolveAside !== 'function') throw new TypeError('resolveAside is required');

  async function run(rawJob, opts = {}) {
    const effective = opts.signal || signal;
    if (effective && effective.aborted) {
      const e = new Error('browse cancelled before the session started');
      e.code = 'ECANCELLED';
      throw e;
    }
    const job = validateJob(rawJob, opts.browseCaps || {});
    const { innerMs, hostMs } = deadlineMath(job.timeoutMs, opts.browseCaps || {});
    const source = compile(job);
    const bin = await resolveAside();
    const startedAt = now();

    const child = await spawnAside(bin, ['repl', source], { hostMs, signal: effective });
    const stdout = String(child && child.stdout !== undefined ? child.stdout : '');
    const killed = Boolean(child && child.killed);
    const { marker, ms } = parseMarker(stdout);
    const final = parseFinal(stdout);
    const totalMs = now() - startedAt;

    if (killed || marker === null) {
      // The script never got to print, so it never got to close its tabs. Every url we
      // asked for is a candidate leak and must be named: reporting nothing here would
      // turn a permanent, unrecoverable leak into a clean-looking result.
      return {
        ok: false,
        items: job.urls.map((url) => ({ url, ok: false, code: killed ? 'EHOSTKILL' : 'ENOMARKER' })),
        timings: { steps: [], totalMs },
        partial: [killed ? 'host-kill' : 'no-marker'],
        leakedUrls: job.urls.slice(),
        raw: { stdout, marker },
      };
    }

    const items = final && Array.isArray(final.items) ? final.items : [];
    const leakedUrls = final && Array.isArray(final.leakedUrls) ? final.leakedUrls : [];
    const partial = final && Array.isArray(final.partial) ? final.partial.slice() : [];
    if (marker === 'error') partial.push('script-error');
    if (leakedUrls.length) partial.push('tab-leak');

    return {
      ok: marker === 'ok' && items.length > 0 && items.every((i) => i.ok) && leakedUrls.length === 0,
      items,
      timings: { steps: items.map((i) => i.timings || null), totalMs, replMs: ms },
      partial,
      leakedUrls,
      raw: { stdout, marker },
    };
  }

  return Object.freeze({ run, innerCapMs: (caps) => deadlineMath(undefined, caps || {}).innerMs });
}
