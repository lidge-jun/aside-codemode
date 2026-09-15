// The ONE place a browse job reaches Aside. Nothing else spawns.
//
// Two measured facts shape this module (001 E1, E5):
//   1. The Aside CLI exits 0 even when the run failed. Success is the trailing
//      `[ok | Nms]` marker AND inspection of the files the run claims to have written.
//   2. Killing the CLI leaks its tabs permanently, so the host deadline is deliberately
//      LATER than the script's own deadline. If the host timer ever fires, the script
//      never printed its payload and the tabs are unrecoverable — that is reported as a
//      host-kill leak rather than quietly dropped.
import { randomUUID } from 'node:crypto';
import { validateJob } from './schema.js';
import { compile, deadlineMath } from './script.js';
import { attachDiff } from './diff.js';
import { helperStamp } from './helper-bundle.js';

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
// Steps are printed the moment they run, so an executed side effect is recoverable from a
// transcript whose final payload never arrived.
export function parseSteps(stdout) {
  const rows = [];
  for (const line of stripAnsi(stdout).split(/\r?\n/)) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    try {
      const o = JSON.parse(t);
      if (o && o.type === 'step' && o.step) rows.push(o.step);
    } catch (_) { /* not a step line */ }
  }
  return rows;
}

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

// Side effects are printed as they happen, on the same line-oriented channel as steps, so
// a run whose final payload never arrived still leaves a record of what it touched.
export function parseEffects(stdout) {
  const rows = [];
  for (const line of stripAnsi(stdout).split(/\r?\n/)) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    try {
      const o = JSON.parse(t);
      if (o && o.type === 'effect' && o.effect) rows.push(o.effect);
    } catch (_) { /* not an effect line */ }
  }
  return rows;
}

// started with no confirmation is INDETERMINATE, not failed. Promise.race ends a wait; it
// does not cancel a click that Aside already handed to the page. A killed process makes
// every effect indeterminate, because the confirmation may simply never have been printed.
export function settleEffects(rows = [], { killed = false } = {}) {
  const byId = new Map();
  for (const e of rows) {
    if (!e || typeof e.operationId !== 'string') continue;
    const cur = byId.get(e.operationId)
      || { operationId: e.operationId, jobId: e.jobId, verb: e.verb, i: e.i, state: 'started' };
    if (e.state === 'confirmed') cur.state = 'confirmed';
    byId.set(e.operationId, cur);
  }
  return [...byId.values()].map((e) => (
    !killed && e.state === 'confirmed' ? e : { ...e, state: 'indeterminate' }
  ));
}

// The host issues every identifier and derives every status. The script echoes ids and
// reports per-item facts; it never decides whether the RUN succeeded.
//
// Order matters here. A host-kill item carries ok:false, but so does an ordinary failure,
// and script.js only lowers out.ok when stopOnError is set — so an item whose action list
// half ran arrives with ok:true. Reading ok first would call both of those completed.
//
// EBLOCKED is one code carrying two different answers, and collapsing them was this
// module's only contract violation: 'blocked' was returned here and never listed in
// ITEM_STATUSES, so a blocked item was produced in ordinary operation and then failed
// checkResultEnvelope. What separates the two is what the caller can do about it. A
// sign-in wall or a challenge is something a person can clear, which is what needs_input
// has always meant. An origin refusing this client, or an upstream answering 5xx, is not
// cleared by a person sitting down at the browser.
//
// An EBLOCKED that never said which kind it was stays a failure. needs_input is a claim
// that human action unblocks this item, and a code that did not say so has not earned it.
const HUMAN_CLEARABLE = new Set(['login-wall', 'captcha']);

// Chrome's own error page is a page. It loads, it has a title, openTab resolves, and the
// script records a finalUrl like any other — so a DNS failure and a refused connection
// arrive looking exactly like a success and nothing downstream disagrees.
//
// The scheme is the only tell available here. HTTP status is not: waitForResponse is absent
// from this surface, so the batch never sees one. That is also why a RENDERED 404 is left
// to the content check instead of being guessed at — a page that loaded and says Not Found
// is a page the caller has to describe, and inventing a rule for it would trade this false
// success for a false failure.
const DEAD_END = /^chrome-error:/i;

export function deadEndReason(item) {
  if (!item || typeof item.finalUrl !== 'string') return null;
  if (!DEAD_END.test(item.finalUrl)) return null;
  return 'the navigation ended on the browser\'s own error page (' + item.finalUrl
    + '), so no page was loaded; the host, the scheme or the network is the place to look';
}

export function itemStatus(item) {
  if (!item) return 'unreturned';
  if (item.code === 'EHOSTKILL' || item.code === 'ENOMARKER') return 'indeterminate';
  if (item.code === 'EUNRETURNED') return 'unreturned';
  if (item.actionsOk === false) return 'failed';
  // Ahead of the ok check on purpose: this is the case where ok is true and wrong.
  if (deadEndReason(item)) return 'failed';
  if (item.ok) return 'completed';
  if (item.code === 'ESKIP' || item.code === 'ETABBUDGET') return 'skipped';
  if (item.code === 'EBLOCKED') return HUMAN_CLEARABLE.has(item.blockKind) ? 'needs_input' : 'failed';
  return 'failed';
}

// completed | partial | failed | needs_input | indeterminate. needs_input reaches a run
// through itemStatus above: a batch that stopped only because someone has to sign in is a
// request, not a failure, and telling those apart is the difference between a caller who
// retries forever and one who opens a tab.
export function runStatus({ marker, items = [], leakedUrls = [], killed = false, effects = [], extras = 0 }) {
  if (killed || marker === null) return 'indeterminate';
  if (items.some((i) => i.status === 'indeterminate')) return 'indeterminate';
  const done = items.filter((i) => i.status === 'completed').length;
  // An effect we started but never saw confirmed is not a failure and not a success. It
  // cannot raise the run to completed, and it must not erase the work that did finish.
  if (effects.some((e) => e.state === 'indeterminate')) return done > 0 ? 'partial' : 'failed';
  // A result we could not place — a duplicate of an id we already matched, or an id we
  // never issued — means the run and the ledger disagree. Every request may look answered
  // and the run still cannot be called clean.
  if (extras > 0) return done > 0 ? 'partial' : 'failed';
  // Ranked below the two above on purpose. A run we cannot account for is not a run whose
  // problem a person can fix by signing in, so 'we do not know' and 'the ledger disagrees'
  // both outrank the invitation.
  if (items.some((i) => i.status === 'needs_input')) return done > 0 ? 'partial' : 'needs_input';
  if (items.length > 0 && done === items.length && leakedUrls.length === 0 && marker === 'ok') return 'completed';
  if (done === 0) return 'failed';
  return 'partial';
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
    // The issuing ledger. Position is the key because the same url may be requested twice,
    // and two requests for one url have nothing else to tell them apart.
    const runId = 'run-' + randomUUID();
    const requested = job.urls.map((url, i) => ({ jobId: 'j' + String(i).padStart(3, '0'), url, index: i }));
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
    const planIds = (planFinal || job.urls.map((url) => ({ url, timeoutMs: job.timeoutMs, waitSelector: job.waitSelector, skip: false })))
      .map((p, i) => ({ ...p, jobId: requested[i].jobId }));
    const source = compile({ ...job, runId }, planIds);
    // Windows caps a command line at 32,767 characters and the source travels as an
    // argument. Refusing here with a named code beats spawn ENAMETOOLONG, which says
    // nothing about which option made the script too big.
    if (source.length > 30000) {
      const e = new Error(`the generated script is ${source.length} characters, over the 30000 wire limit; drop helper, snapshot, actions or some urls`);
      e.code = 'ESOURCETOOLONG';
      throw e;
    }
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
      //
      // This is indeterminate rather than failed. The run may have clicked, navigated and
      // written before it was killed; we simply never heard about it.
      return {
        schema: 'browse/2',
        runId,
        status: 'indeterminate',
        ok: false,
        requested: requested.length,
        completed: 0,
        unreturned: 0,
        items: requested.map((r) => ({
          jobId: r.jobId, url: r.url, ok: false,
          code: killed ? 'EHOSTKILL' : 'ENOMARKER', status: 'indeterminate',
        })),
        ledger: requested,
        reconciledBy: 'ledger',
        // The payload never arrived, but the effect lines did. Recovering them here is the
        // difference between "we do not know what this run touched" and "it touched these
        // four things and we never saw them confirmed". Only a real kill folds a printed
        // confirmation back to unknown; a run that merely lost its marker still told the
        // truth about what it confirmed.
        effects: settleEffects(parseEffects(stdout), { killed }),
        complete: false,
        truncated: false,
        timings: { steps: [], totalMs },
        actionLog: parseSteps(stdout),
        partial: [killed ? 'host-kill' : 'no-marker'],
        leakedUrls: job.urls.slice(),
        tabs: (parseFinal(stdout) && parseFinal(stdout).tabs) || null,
        raw: { stdout, marker },
        pwd: null,
      };
    }

    const items = final && Array.isArray(final.items) ? final.items : [];
    const actionLog = final && Array.isArray(final.actionLog) && final.actionLog.length
      ? final.actionLog
      : parseSteps(stdout);
    const leakedUrls = final && Array.isArray(final.leakedUrls) ? final.leakedUrls : [];
    const partial = final && Array.isArray(final.partial) ? final.partial.slice() : [];
    if (marker === 'error') partial.push('script-error');
    if (leakedUrls.length) partial.push('tab-leak');
    // A page that arrived but did not render is a DIFFERENT outcome from a clean read,
    // and the caller must not have to infer it from the item bodies.
    if (items.some((i) => i.contentVerified === false || i.code === 'EUNRENDERED')) partial.push('content-unverified');
    // An action that failed is a different outcome from a page that did not render, and
    // the caller must not have to walk items[] to find out that the page was half-driven.
    if (items.some((i) => i.actionsOk === false || i.code === 'EACTION')) partial.push('action-failed');
    if (items.some((i) => i.navigatedDuringActions === true)) partial.push('navigated-during-actions');
    // Feed the outcomes back so the NEXT call sees a domain that keeps failing.
    if (breaker) breaker.record(items);
    const steps = aggregateSteps(items);
    const effects = settleEffects(parseEffects(stdout), { killed });
    if (effects.some((e) => e.state === 'indeterminate')) partial.push('effect-indeterminate');

    // Reconcile what came back against what was asked for. Counting only the items that
    // arrived is how eight of nine urls used to report as a whole success.
    const byJob = new Map();
    // A second result carrying an id we already matched cannot silently replace the first.
    // Map.set would have kept the last writer and thrown away a real observation.
    const duplicates = [];
    for (const it of items) {
      if (!it || typeof it.jobId !== 'string') continue;
      if (byJob.has(it.jobId)) { duplicates.push(it); continue; }
      byJob.set(it.jobId, it);
    }
    const positional = byJob.size === 0 && items.length === requested.length && items.length > 0;
    const unreconciled = byJob.size === 0 && items.length > 0 && items.length !== requested.length;
    const reconciled = requested.map((r, i) => {
      const hit = byJob.get(r.jobId) || (positional ? items[i] : null);
      if (!hit) return { jobId: r.jobId, url: r.url, ok: false, code: 'EUNRETURNED', status: 'unreturned' };
      const merged = { ...hit, jobId: r.jobId, url: hit.url || r.url };
      // Stamp the code only where the item still looks successful. An item that already
      // named why it failed keeps its own reason; overwriting it would hide the cause
      // behind the symptom.
      const dead = deadEndReason(merged);
      if (dead && !merged.code) {
        merged.ok = false;
        merged.code = 'EDEADEND';
        merged.error = dead;
      }
      return { ...merged, status: itemStatus(merged) };
    });
    // Only an item that names a jobId we never issued is an extra. Items with no jobId at
    // all are either the position-matched path or the unreconciled one.
    const extra = items.filter((it) => it && it.jobId && !requested.some((r) => r.jobId === it.jobId));
    // The comparison the caller asked for. It runs here rather than in the generated script
    // because it needs no browser and the script's wire budget is already tight.
    if (job.snapshotAfter === 'diff') for (const it of reconciled) attachDiff(it);
    const orphans = unreconciled ? items.slice() : [];
    if (reconciled.some((i) => i.status === 'unreturned')) partial.push('unreturned');
    // These three read the RECONCILED items, because they describe a verdict rather than
    // something the script reported. An earlier revision tagged them off the raw items,
    // which carry a code and no status, so the needs-input tag was never once emitted.
    //
    // Two block tags, because the two blocks mean different things to the caller: one is
    // waiting for a person and one is an origin that will keep saying no.
    if (reconciled.some((i) => i.status === 'needs_input')) partial.push('needs-input');
    if (reconciled.some((i) => i.code === 'EBLOCKED' && i.status !== 'needs_input')) partial.push('blocked');
    if (reconciled.some((i) => i.code === 'EDEADEND')) partial.push('dead-end');
    if (unreconciled) partial.push('unreconciled');
    if (extra.length) partial.push('extra-items');
    if (duplicates.length) partial.push('duplicate-jobid');
    const status = runStatus({
      marker, items: reconciled, leakedUrls, killed, effects,
      extras: extra.length + duplicates.length,
    });

    return {
      schema: 'browse/2',
      runId,
      status,
      ok: status === 'completed',
      requested: requested.length,
      // Which helper answered, when one was shipped. The body is not echoed; the hash is
      // what lets an installed copy be checked against the one this run actually ran.
      helper: job.helper ? helperStamp() : undefined,
      completed: reconciled.filter((i) => i.status === 'completed').length,
      unreturned: reconciled.filter((i) => i.status === 'unreturned').length,
      items: reconciled,
      ledger: requested,
      extraItems: (extra.length || orphans.length || duplicates.length)
        ? extra.concat(duplicates).concat(orphans)
        : undefined,
      reconciledBy: positional ? 'position' : (byJob.size ? 'jobId' : 'none'),
      // Side-effect lifetimes arrive with wp4. The slot exists now so runStatus already
      // knows the rule and nothing has to change shape later.
      effects,
      complete: status === 'completed',
      truncated: false,
      // Steps that really ran, even when their item never made it into items[]. A click on
      // a live page is a side effect and must never be erased by a deadline.
      actionLog,
      // Aggregate verdict across the batch: true only when every item proved its content,
      // false when any item failed a check, null when nothing was checkable.
      contentVerified: items.length === 0 ? null
        : (items.some((i) => i.contentVerified === false) ? false
          : (items.every((i) => i.contentVerified === true) ? true : null)),
      timings: { byStep: steps.byStep, slowest: steps.slowest, totalMs, replMs: ms },
      partial,
      leakedUrls,
      tabs: (final && final.tabs) || null,
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
    // Same wire limit as the generated job path. This entry point skipped the check, so a
    // caller that injected a helper found out by way of a platform error from the OS rather
    // than a sentence naming the limit.
    if (String(replSource).length > 30000) {
      const e = new Error(`the repl source is ${String(replSource).length} characters, over the 30000 wire limit; send less source or split the work`);
      e.code = 'ESOURCETOOLONG';
      throw e;
    }
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
