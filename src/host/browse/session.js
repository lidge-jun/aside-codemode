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
import { validateJob, gatedVerbs } from './schema.js';
import { compile, deadlineMath, WIRE_LIMIT } from './script.js';
import { attachDiff } from './diff.js';
import { helperStamp } from './helper-bundle.js';
import { DEAD_END } from './policy.js';

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
// The script decides this first, so an item usually arrives already stamped. This stays as
// the net for the one case the script has nothing to look at: a page it could not evaluate.
export function deadEndReason(item) {
  if (!item || typeof item.finalUrl !== 'string') return null;
  if (!DEAD_END.test(item.finalUrl)) return null;
  return 'the navigation ended on the browser\'s own error page (' + item.finalUrl
    + '), so no page was loaded; the host, the scheme or the network is the place to look';
}

// A selector that matched nothing on ONE page is a page that does not have it. A selector
// that matched nothing on EVERY page is a selector that is wrong, and the run is the only
// place that sees more than one item at a time, so it is the only place that can tell.
//
// Measured: eight course pages returned zero for the same selector with no error anywhere,
// because the content lived inside an iframe. Believing that answer turns "I could not read
// this" into "there is nothing here", which is the same failure as reaching completed on an
// error page — the call worked, the result is empty, and nothing says the combination is
// worth a second look.
export function suspectSelectors(items = [], extract = null) {
  if (!extract) return [];
  // A ref names a row in one observation, so a ref field that came back empty is a stale
  // fingerprint rather than a wrong selector, and the run already reports that as what it
  // is. Telling the caller their selector is wrong would send them to rewrite a selector
  // they never wrote.
  const fields = Object.keys(extract).filter((f) => {
    const spec = extract[f];
    return !(spec && typeof spec === 'object' && !Array.isArray(spec) && 'ref' in spec);
  });
  if (fields.length === 0) return [];
  const answered = items.filter((i) => i && i.status === 'completed' && i.data && Array.isArray(i.data.missing));
  // One page proves nothing either way, so this needs at least two to be an aggregate.
  if (answered.length < 2) return [];
  return fields.filter((f) => answered.every((i) => i.data.missing.includes(f)));
}

export function itemStatus(item) {
  if (!item) return 'unreturned';
  if (item.code === 'EHOSTKILL' || item.code === 'ENOMARKER') return 'indeterminate';
  // Ahead of actionsOk on purpose. This item was acting when another item proved the
  // session gone, so its remaining steps were refused mid-list. It started and we do not
  // know what landed, which is what indeterminate says and what failed would deny.
  if (item.code === 'ESESSIONGONE') return 'indeterminate';
  if (item.code === 'EUNRETURNED') return 'unreturned';
  if (item.actionsOk === false) return 'failed';
  // Ahead of the ok check on purpose: this is the case where ok is true and wrong.
  if (deadEndReason(item)) return 'failed';
  if (item.ok) return 'completed';
  if (item.code === 'ESKIP' || item.code === 'ETABBUDGET') return 'skipped';
  // The caller said what proves a live session and the page did not have it. A person can
  // sign in again, which is the whole reason this is not a failure.
  if (item.code === 'ENOTLOGGEDIN') return 'needs_input';
  // Nothing was sent. The job asked for a step that could change something and never said
  // it meant to, so the answer waits on a person the same way a sign-in does.
  if (item.code === 'EWRITEAPPROVAL') return 'needs_input';
  // Never started: the run had already stopped when this item came off the queue. Skipped
  // would be true and useless — nothing here is retryable until a person signs in.
  if (item.code === 'ELOGINREQUIRED') return 'needs_input';
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
  // Ranked above the two below it. Both of those answer 'failed' when nothing completed,
  // which is a definite claim that the run is over and the cause is terminal — and neither
  // is true when a person signing in would unblock it. The contract calls an unconfirmed
  // effect neither a failure nor a success and then used to return the definite one, and
  // needs_input is the only signal that tells an agent to hand the run back rather than
  // retry it. Both facts survive in effects[] and partial[] for a caller who needs them.
  if (items.some((i) => i.status === 'needs_input')) return done > 0 ? 'partial' : 'needs_input';
  // An effect we started but never saw confirmed is not a failure and not a success. It
  // cannot raise the run to completed, and it must not erase the work that did finish.
  if (effects.some((e) => e.state === 'indeterminate')) return done > 0 ? 'partial' : 'failed';
  // A result we could not place — a duplicate of an id we already matched, or an id we
  // never issued — means the run and the ledger disagree. Every request may look answered
  // and the run still cannot be called clean.
  if (extras > 0) return done > 0 ? 'partial' : 'failed';
  if (items.length > 0 && done === items.length && leakedUrls.length === 0 && marker === 'ok') return 'completed';
  if (done === 0) return 'failed';
  return 'partial';
}

// The one place a job becomes the source that travels, exported so a test can measure the
// same bytes the CLI receives. It used to live inline in run(), which meant the only way to
// check the wire budget was to rebuild part of this shape in the test file — and the part
// it rebuilt was missing the runId and the per-row jobId, so the suite called a job legal
// that the host refused. A seam is cheaper than a comment asking the next person to
// remember.
// A settled run that never ran. It carries the same fields a finished run carries, because
// a caller that has to tell two envelope shapes apart will eventually read the wrong one:
// the counts are zero, the lists are empty, and the status is stamped rather than computed.
// runStatus cannot compute it — with nothing spawned there is no marker, and a null marker
// means "we never heard back", which is the opposite of what happened here.
export function writeApprovalRefusal({ runId, requested, wants, job, approvalId = null, expiresAt = null }) {
  const items = requested.map((r) => ({
    jobId: r.jobId, url: r.url, ok: false, status: 'needs_input', code: 'EWRITEAPPROVAL', wants,
  }));
  return {
    schema: 'browse/2',
    runId,
    status: 'needs_input',
    ok: false,
    code: 'EWRITEAPPROVAL',
    // What to name when approving. A run id would not do: this envelope and the one the
    // approved run returns are two different answers, and one id pointing at both stops
    // being an identifier. The approved run carries this id back so the pair can be joined.
    approvalId,
    expiresAt,
    // Named in the order the job asked for them, once each, so the caller can read back the
    // decision it is being asked to make instead of re-deriving it from its own input.
    wants,
    requested: requested.length,
    helper: job && job.helper ? helperStamp() : undefined,
    completed: 0,
    unreturned: 0,
    items,
    ledger: requested,
    reconciledBy: 'none',
    effects: [],
    complete: false,
    truncated: false,
    actionLog: [],
    contentVerified: null,
    partial: ['needs-input', 'write-approval'],
    timings: { steps: [], totalMs: 0 },
    leakedUrls: [],
    tabs: null,
    raw: null,
    pwd: null,
  };
}

export function buildRunSource(job, { plan = null, runId = null, requested = null, artifactNames = null, pdfNames = null } = {}) {
  const fallback = () => job.urls.map((url) => ({ url, timeoutMs: job.timeoutMs, waitSelector: job.waitSelector, skip: false }));
  // Host-generated artifact names ride in the plan; the script never invents one.
  let rows = plan || fallback();
  if (artifactNames) rows = rows.map((p, i) => ({ ...p, artifactName: artifactNames[i] }));
  if (pdfNames) rows = rows.map((p, i) => ({ ...p, pdfName: pdfNames[i] }));
  if (requested) rows = rows.map((p, i) => ({ ...p, jobId: requested[i].jobId }));
  return compile({ ...job, runId }, rows);
}

export function createBrowseSession({ spawnAside, resolveAside, now = Date.now, signal, breaker = null, approvals = null } = {}) {
  if (typeof spawnAside !== 'function') throw new TypeError('spawnAside is required');
  if (typeof resolveAside !== 'function') throw new TypeError('resolveAside is required');

  async function run(rawJob, opts = {}) {
    const effective = opts.signal || signal;
    if (effective && effective.aborted) {
      const e = new Error('browse cancelled before the session started');
      e.code = 'ECANCELLED';
      throw e;
    }
    // Validated on every path, including the approved one. What approval changes is the
    // gate, not the checking: the record it replays sits in a shared temp directory, and a
    // job that skipped validation because it had been validated once, somewhere else,
    // earlier, is a job nobody is checking now.
    const job = validateJob(rawJob, opts.browseCaps || {});
    // The issuing ledger. Position is the key because the same url may be requested twice,
    // and two requests for one url have nothing else to tell them apart.
    const runId = 'run-' + randomUUID();
    const requested = job.urls.map((url, i) => ({ jobId: 'j' + String(i).padStart(3, '0'), url, index: i }));
    // Before anything is compiled, resolved or spawned. A refusal here costs the caller
    // nothing and leaves nothing behind, which is the only honest place to ask whether a
    // batch that can change things was meant to.
    //
    // It answers with a result envelope rather than by throwing. An option error means the
    // request was malformed; this request is well formed and waiting on a decision, and the
    // two are not the same sentence. The RPC boundary keeps only a message and a code off a
    // thrown error, so a throw could not carry which verbs were wanted anyway.
    const wants = (job.approveWrites || opts.approvedBy) ? [] : gatedVerbs(job.actions);
    if (wants.length) {
      // Stored before it is announced, so the id in the envelope is one that can actually be
      // named. Without a store the gate still refuses — it just cannot be approved later,
      // which is a smaller surface, not a weaker one.
      // The RAW job is stored, not the normalized one, so approving replays exactly what
      // the caller asked for and it goes through validateJob again on the way out.
      const held = approvals ? approvals.open({ job: rawJob, wants, urls: job.urls.slice() }) : null;
      return writeApprovalRefusal({
        runId, requested, wants, job,
        approvalId: held ? held.approvalId : null,
        expiresAt: held ? held.expiresAt : null,
      });
    }
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
    const source = buildRunSource(job, {
      plan, runId, requested,
      artifactNames: Array.isArray(opts.artifactNames) ? opts.artifactNames : null,
      pdfNames: Array.isArray(opts.pdfNames) ? opts.pdfNames : null,
    });
    // The source travels as a command-line argument, so the ceiling is the platform's.
    // Refusing here with a named code beats spawn ENAMETOOLONG, which says nothing about
    // which option made the script too big.
    if (source.length > WIRE_LIMIT) {
      const e = new Error(`the generated script is ${source.length} characters, over the ${WIRE_LIMIT} wire limit on ${process.platform}; drop helper, snapshot, actions or some urls`);
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
    if (reconciled.some((i) => i.code === 'ENOTLOGGEDIN' || i.code === 'ELOGINREQUIRED')) partial.push('logged-out');
    // Aggregate, so it belongs here rather than in any one item.
    const suspect = suspectSelectors(reconciled, job.extract);
    if (suspect.length) partial.push('suspect-empty');
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
      // Read off the reconciled items, like every status is. Reading the raw script items
      // meant the two views disagreed the moment the host stamped a code the script did not
      // write, and an item the run called failed could still be counted as verified here.
      contentVerified: reconciled.length === 0 ? null
        : (reconciled.some((i) => i.contentVerified === false) ? false
          : (reconciled.every((i) => i.contentVerified === true) ? true : null)),
      // Named fields rather than a bare flag, because "something was empty" sends the
      // caller looking and "this selector was empty everywhere and the pages have frames"
      // answers the question they were about to ask.
      suspectEmpty: suspect.length ? {
        selectors: suspect,
        // How many of the answering pages had frames at all, not how many frames there
        // were. A sum cannot tell two pages with two frames from one page with four, and
        // an item whose page could not be evaluated counts as zero and drags it down. The
        // per-page number is already on each item as render.iframes.
        framedPages: reconciled.filter((i) => i.render && i.render.iframes > 0).length,
        why: 'the same selector matched nothing on every page that answered, which is far more often a wrong selector than a set of pages that all lack it',
      } : undefined,
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
    if (String(replSource).length > WIRE_LIMIT) {
      const e = new Error(`the repl source is ${String(replSource).length} characters, over the ${WIRE_LIMIT} wire limit on ${process.platform}; send less source or split the work`);
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
