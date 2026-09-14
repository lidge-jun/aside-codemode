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

// The CLI colourises its own trailing marker, so the raw bytes are
// \u001b[2m[ok | 395ms]\u001b[0m. Anchoring to end-of-string missed it entirely and every
// successful run looked like a failure. Whether colour is emitted depends on the terminal,
// so this has to be stripped rather than assumed absent.
const ANSI = /\u001b\[[0-9;]*m/g;
const MARKER = /\[(ok|error) \| (\d+)ms\]/g;

export function stripAnsi(s) {
  return String(s).replace(ANSI, '');
}

export function parseMarker(stdout) {
  // Take the LAST marker: a run can print more than one line that looks like one.
  const all = [...stripAnsi(stdout).matchAll(MARKER)];
  if (all.length === 0) return { marker: null, ms: null };
  const m = all[all.length - 1];
  return { marker: m[1], ms: Number(m[2]) };
}

export function parseFinal(stdout) {
  for (const line of stripAnsi(stdout).split(/\r?\n/).reverse()) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    try {
      const o = JSON.parse(t);
      if (o && o.type === 'final') return o;
    } catch (_) { /* not the payload line */ }
  }
  return null;
}

// Aggregating per step is what turns a pile of item timings into an answer to "what is
// slow" — issue #20 asks for a bottleneck report, not a transcript.
export function aggregateSteps(items = []) {
  const byStep = {};
  for (const item of items) {
    const t = item && item.timings;
    if (!t) continue;
    for (const [step, ms] of Object.entries(t)) {
      if (typeof ms !== 'number') continue;
      if (!byStep[step]) byStep[step] = { totalMs: 0, maxMs: 0, count: 0 };
      byStep[step].totalMs += ms;
      byStep[step].maxMs = Math.max(byStep[step].maxMs, ms);
      byStep[step].count += 1;
    }
  }
  let slowest = null;
  for (const [step, v] of Object.entries(byStep)) {
    if (!slowest || v.totalMs > byStep[slowest].totalMs) slowest = step;
  }
  return { byStep, slowest };
}

export function createBrowseSession({ spawnAside, resolveAside, now = Date.now, signal, breaker = null } = {}) {
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
    const caps = opts.browseCaps || {};
    // C4: the host decides, the script enforces. policy state never leaves this process.
    const plan = breaker
      ? breaker.plan(job.urls, {
          domainTimeouts: caps.domainTimeouts || {},
          defaultTimeoutMs: job.timeoutMs,
          innerCapMs: innerMs,
          waitSelector: job.waitSelector,
        })
      : null;
    // Host-generated artifact names ride in the plan; the script never invents one.
    const names = Array.isArray(opts.artifactNames) ? opts.artifactNames : null;
    const pdfNames = Array.isArray(opts.pdfNames) ? opts.pdfNames : null;
    const planWithNames = names
      ? (plan || job.urls.map((url) => ({ url, timeoutMs: job.timeoutMs, waitSelector: job.waitSelector, skip: false })))
          .map((p, i) => ({ ...p, artifactName: names[i] }))
      : plan;
    const planFinal = pdfNames
      ? (planWithNames || job.urls.map((url) => ({ url, timeoutMs: job.timeoutMs, waitSelector: job.waitSelector, skip: false })))
          .map((p, i) => ({ ...p, pdfName: pdfNames[i] }))
      : planWithNames;
    const source = compile(job, planFinal);
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
      pwd: null,
    };
    }

    const items = final && Array.isArray(final.items) ? final.items : [];
    const leakedUrls = final && Array.isArray(final.leakedUrls) ? final.leakedUrls : [];
    const partial = final && Array.isArray(final.partial) ? final.partial.slice() : [];
    if (marker === 'error') partial.push('script-error');
    if (leakedUrls.length) partial.push('tab-leak');
    if (items.some((i) => i.code === 'EBLOCKED')) partial.push('blocked');
    // A page that arrived but did not render is a DIFFERENT outcome from a clean read,
    // and the caller must not have to infer it from the item bodies.
    if (items.some((i) => i.contentVerified === false || i.code === 'EUNRENDERED')) partial.push('content-unverified');
    // Feed the outcomes back so the NEXT call sees a domain that keeps failing.
    if (breaker) breaker.record(items);
    const steps = aggregateSteps(items);

    return {
      ok: marker === 'ok' && items.length > 0 && items.every((i) => i.ok) && leakedUrls.length === 0,
      items,
      // Aggregate verdict across the batch: true only when every item proved its content,
      // false when any item failed a check, null when nothing was checkable.
      contentVerified: items.length === 0 ? null
        : (items.some((i) => i.contentVerified === false) ? false
          : (items.every((i) => i.contentVerified === true) ? true : null)),
      timings: { byStep: steps.byStep, slowest: steps.slowest, totalMs, replMs: ms },
      partial,
      leakedUrls,
      raw: { stdout, marker },
      breaker: breaker ? breaker.snapshot() : undefined,
      pwd: final && typeof final.pwd === 'string' ? final.pwd : null,
    };
  }

  // Escape hatch for the Aside service globals (youtube.search, googleSearch.search) which
  // are not page operations and do not fit the url-batch job shape. Still one spawn, still
  // marker-judged, still never trusting the exit code.
  async function raw(replSource, opts = {}) {
    const effective = opts.signal || signal;
    if (effective && effective.aborted) { const e = new Error('browse cancelled'); e.code = 'ECANCELLED'; throw e; }
    const bin = await resolveAside();
    const child = await spawnAside(bin, ['repl', replSource], { hostMs: opts.hostMs || 30000, signal: effective });
    const stdout = String(child && child.stdout !== undefined ? child.stdout : '');
    const { marker } = parseMarker(stdout);
    const final = parseFinal(stdout);
    if (marker !== 'ok') {
      // Return the WHOLE transcript, not its tail. Slicing to the last 500 characters
      // captured a stack-trace tail and hid the actual message, which turned a detectable
      // bot challenge into a generic upstream failure.
      const text = stripAnsi(stdout).trim();
      return { error: text || 'the run produced no marker', rows: [] };
    }
    return { rows: (final && final.rows) || [], raw: { stdout, marker } };
  }

  return Object.freeze({ run, raw, innerCapMs: (caps) => deadlineMath(undefined, caps || {}).innerMs });
}
