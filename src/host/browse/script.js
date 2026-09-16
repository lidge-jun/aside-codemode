// Compiles a validated job into Aside REPL source, and owns the deadline arithmetic.
//
// The generated script is the ONLY place tabs are owned, because a killed CLI leaks its
// tabs permanently and no later session can close them (001 E5). So the script must always
// finish under its OWN timer: inner deadline first, host deadline second.
import { A4_INCHES, ASIDE_REPL_CAP_MS, DEFAULT_INNER_CAP_MS, SLACK_MS } from './schema.js';
import { detectionPatterns, DEAD_END } from './policy.js';
import { ACTION_STEP_SRC } from './actions-run.js';
import { helperSource } from './helper-bundle.js';

export { SLACK_MS };

// inner < host, always. The host is the patient one; if it fires first the script never
// ran its cleanup and the tabs are gone for good.
export function deadlineMath(requestedMs, browseCaps = {}) {
  const cap = Math.min(
    Number.isSafeInteger(browseCaps.timeoutMs) ? browseCaps.timeoutMs : DEFAULT_INNER_CAP_MS,
    ASIDE_REPL_CAP_MS,
  );
  const wanted = Number.isSafeInteger(requestedMs) && requestedMs > 0 ? requestedMs : cap;
  const innerMs = Math.max(1, Math.min(wanted, cap));
  return { innerMs, hostMs: innerMs + SLACK_MS };
}

// ONE source of truth for tree summarising: this text is injected into the REPL script and
// is also evaluated here, so a test exercises the real code instead of grepping a template.
// Aside's snapshot rows look like:  - link "과제 및 평가" [ref=e21]
// and a child frame arrives as its own row with an f-prefixed ref, which is why exposing
// the tree also solves iframe discovery.
export const TREE_SUMMARY_SRC = String.raw`function summarizeTree(tree, mode, capChars, opts) {
  var ROW_REF = /\[ref=([^\]]+)\]/;
  var ROW_ROLE = /^[\s-]*([a-zA-Z][a-zA-Z0-9_-]*)/;
  // The name is what sits before the first bracketed attribute. Reading the first quoted run
  // anywhere on the line let a placeholder become the name of a nameless textbox, which is a
  // mistake diff.js already avoids the same way.
  var ROW_NAME = /^[\s-]*[a-zA-Z][a-zA-Z0-9_-]*\s+"([^"]*)"/;
  var ACTIONABLE = /^[\s-]*(link|button|textbox|searchbox|checkbox|radio|combobox|listbox|option|menuitem|menuitemcheckbox|menuitemradio|tab|switch|slider|spinbutton|treeitem|iframe)\b/;
  var lines = String(tree == null ? '' : tree).split('\n');
  // Opt-in. Measured: attaching a structured view to every snapshot pushed a middle-sized
  // page (~280 rows) from 49KB to 78KB against a 65536-byte envelope, and the shrinker
  // answered by dropping the whole snapshot - so a caller who never asked for nodes lost the
  // tree too. A caller who does ask takes that trade knowingly, inside its own budget.
  var kept = [];
  var refs = [];
  for (var li = 0; li < lines.length; li++) {
    var line = lines[li];
    var m = ROW_REF.exec(line);
    if (m) {
      var rr = ROW_ROLE.exec(line);
      var nn = ROW_NAME.exec(line);
      refs.push({ ref: m[1], role: rr ? rr[1] : null, name: nn ? nn[1] : null, actionable: ACTIONABLE.test(line) });
    }
    if (mode === 'tree') { kept.push(line); }
    else if (m && ACTIONABLE.test(line)) { kept.push(line.replace(/^\s+/, '')); }

  }
  var body = kept.join('\n');
  var cap = capChars > 0 ? capChars : 20000;
  // A fingerprint of the ref rows, not of the text. This is what makes staleness
  // detectable when the url did NOT change: a modal, a client-side tab switch or an SPA
  // re-render renumbers refs while location.href stays put, and a url comparison sees
  // nothing. Cheap FNV-1a over ref|role|name so it can be recomputed before acting.
  // Two independent 32-bit passes, because a single one was brute-forced to a same-length
  // collision in ~2.5s and a page controls its own accessible names. Also a SECOND
  // fingerprint over ref|role only: a clock or an unread badge in the tree changed the full
  // one on every read, which made the guard fire forever with no middle setting.
  function __fp(rows, withName) {
    var a = 2166136261;
    var b = 2166136261 ^ 0x5bf03635;
    for (var fi = 0; fi < rows.length; fi++) {
      var sig = rows[fi].ref + '|' + rows[fi].role + (withName ? '|' + rows[fi].name : '') + ';';
      for (var ci = 0; ci < sig.length; ci++) {
        var c = sig.charCodeAt(ci);
        a ^= c; a = (a + ((a << 1) + (a << 4) + (a << 7) + (a << 8) + (a << 24))) >>> 0;
        b = (((b ^ c) >>> 0) * 16777619) >>> 0;
      }
    }
    return a.toString(36) + b.toString(36);
  }
  return {
    mode: mode,
    chars: body.length,
    truncated: body.length > cap,
    tree: body.slice(0, cap),
    refCount: refs.length,
    refs: refs.slice(0, 500),
    refsTruncated: refs.length > 500,
    fingerprint: 'r' + refs.length + '-' + __fp(refs, true),
    fingerprintStructure: 's' + refs.length + '-' + __fp(refs, false)
  };
}`;

const summarizeTreeRaw = new Function(TREE_SUMMARY_SRC + '; return summarizeTree;')();

// The structured view, kept OUT of the always-injected summariser. The generated script
// travels as a command-line argument the host caps at 30000 characters, and the acting job
// was measured at 29,429 of them: a parser nobody asked for cost the case its headroom.
// Injected only when a job sets treeNodes.
export const TREE_NODES_SRC = String.raw`function summarizeNodes(tree, mode, opts) {
  var ROW_REF = /\[ref=([^\]]+)\]/;
  var ROW_ROLE = /^[\s-]*([a-zA-Z][a-zA-Z0-9_-]*)/;
  var ROW_NAME = /^[\s-]*[a-zA-Z][a-zA-Z0-9_-]*\s+"([^"]*)"/;
  var ROW_COLON_NAME = /^[\s-]*[a-zA-Z][a-zA-Z0-9_-]*:\s*(.+)$/;
  var ROW_SHAPE = /^\s*-\s+[a-zA-Z][a-zA-Z0-9_-]*(\s|:|\[|$)/;
  var ROW_BARE_VALUE = /\bvalue="([^"]*)"/;
  var ROW_PASSWORD = /\[type=password\]/;
  var ROW_ATTR = /\[([a-zA-Z][a-zA-Z0-9_-]*)=([^\]]*)\]/g;
  var ACTIONABLE = /^[\s-]*(link|button|textbox|searchbox|checkbox|radio|combobox|listbox|option|menuitem|menuitemcheckbox|menuitemradio|tab|switch|slider|spinbutton|treeitem|iframe)\b/;
  var SECRETISH = /password|passwd|secret|otp|token/i;
  var maxNodes = opts && opts.maxNodes > 0 ? opts.maxNodes : 2000;
  var budget = opts && opts.maxNodeChars > 0 ? opts.maxNodeChars : 8000;
  var lines = String(tree == null ? '' : tree).split('\n');
  var nodes = [];
  var truncated = false;
  var unparsed = 0;
  var spent = 0;
  for (var li = 0; li < lines.length; li++) {
    var line = lines[li];
    var m = ROW_REF.exec(line);
    if (mode !== 'tree' && !(m && ACTIONABLE.test(line))) continue;
    if (truncated) break;
    if (nodes.length >= maxNodes) { truncated = true; break; }
    if (!line.trim()) continue;
    if (!ROW_SHAPE.test(line)) { unparsed += 1; continue; }
    var indent = /^(\s*)/.exec(line)[1].length;
    var role = ROW_ROLE.exec(line);
    var quoted = ROW_NAME.exec(line);
    var colon = quoted ? null : ROW_COLON_NAME.exec(line);
    var bare = ROW_BARE_VALUE.exec(line);
    var secret = ROW_PASSWORD.test(line) || SECRETISH.test(line);
    var attrs = {};
    var am;
    ROW_ATTR.lastIndex = 0;
    while ((am = ROW_ATTR.exec(line)) !== null) {
      if (am[1] === 'ref') continue;
      if (secret && am[1] === 'value') continue;
      attrs[am[1]] = am[2];
    }
    if (bare) attrs.value = secret ? '[redacted]' : bare[1];
    var node = {
      depth: Math.floor(indent / 2),
      role: role ? role[1] : null,
      name: quoted ? quoted[1] : (colon ? colon[1].trim() : null),
      ref: m ? m[1] : null,
      attrs: attrs,
      line: li
    };
    var cost = (node.role ? node.role.length : 0) + (node.name ? node.name.length : 0) + 40;
    if (spent + cost > budget) { truncated = true; break; }
    spent += cost;
    nodes.push(node);
  }
  return { nodes: nodes, nodesTruncated: truncated, nodesUnparsed: unparsed };
}`;

export const summarizeNodes = new Function(TREE_NODES_SRC + '; return summarizeNodes;')();

// Host-side convenience with the same shape the generated script produces: the structured
// view is merged in only when it was asked for, so the default result is byte-for-byte what
// it was before nodes existed.
export function summarizeTree(tree, mode, capChars, opts) {
  const out = summarizeTreeRaw(tree, mode, capChars, opts);
  if (opts && opts.nodes) return { ...out, ...summarizeNodes(tree, mode, opts) };
  return { ...out, nodes: [], nodesTruncated: false, nodesUnparsed: 0 };
}

// Reading by ref is role-aware. innerText on a textbox returns "" whether or not it holds a
// value, and a checkbox's value attribute is the string it would submit, never whether it is
// checked. Reporting how the value was read lets a caller see which contract it got.
// Injected only when a job actually reads by ref, like the other helpers: the generated
// source travels as a command-line argument and the host refuses it over 30000 characters.
// The css extraction engine. Injected only when a job asks for extract: the evaluate
// and its helpers are 2.5KB on a wire the host caps at 30000 characters.
export const EXTRACT_SRC = String.raw`    if (JOB.extract) {
      // A ref names a row in one observation; a css selector means the same thing on any
      // document. They are read by different machinery, so a job that mixes them is split
      // here — and a job that has no refs never pays for the split.
      var refFields = [];
      var selectorSchema = JOB.extract;
      /*__REF_SPLIT__*/
      out.data = Object.keys(selectorSchema).length === 0 ? { data: {}, missing: [] } : await page.evaluate((schema) => {
        // textContent includes the text inside <script>, which is how extracting 'body' on
        // Threads returned 530KB of server bootstrap JSON and still reported success.
        // innerText is the rendered, visible text; scripts and styles are stripped either way.
        const readText = (n) => {
          if (!n) return null;
          if (typeof n.innerText === 'string' && n.innerText.length) return n.innerText;
          const clone = n.cloneNode(true);
          for (const bad of clone.querySelectorAll ? clone.querySelectorAll('script,style,noscript,template') : []) bad.remove();
          return clone.textContent;
        };
        const isVisible = (n) => {
          if (!n || !n.getBoundingClientRect) return false;
          const r = n.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) return false;
          const st = window.getComputedStyle ? window.getComputedStyle(n) : null;
          return !st || (st.visibility !== 'hidden' && st.display !== 'none');
        };
        const pick = (spec) => {
          const s = typeof spec === 'string' ? { selector: spec } : spec;
          let nodes = Array.from(document.querySelectorAll(s.selector));
          if (s.visible) nodes = nodes.filter(isVisible);
          let vals = nodes.map((n) => {
            const v = s.attr ? n.getAttribute(s.attr) : readText(n);
            return v === null || v === undefined ? null : (s.trim === false ? v : String(v).trim());
          });
          if (s.filterText) { const re = new RegExp(s.filterText, 'i'); vals = vals.filter((v) => v && re.test(v)); }
          // A selector like [class*=provider] matches wrappers and children alike, so the
          // same string comes back many times with blanks between. Dropping empties and
          // duplicates is what turns that into an answer.
          vals = vals.filter((v) => v !== null && String(v).length > 0);
          if (s.unique !== false) vals = [...new Set(vals)];
          if (s.all) return s.limit ? vals.slice(0, s.limit) : vals;
          return vals.length ? vals[0] : null;
        };
        const data = {}; const missing = [];
        for (const [field, spec] of Object.entries(schema)) {
          const v = pick(spec);
          data[field] = v;
          // absent must be distinguishable from empty, or a caller cannot tell
          // "no price on this page" from "the price is an empty string".
          if (v === null || (Array.isArray(v) && v.length === 0)) missing.push(field);
        }
        return { data, missing };
      }, selectorSchema);
      /*__REF_EXTRACT__*/
    }`;

export const REF_READ_SRC = String.raw`var VALUE_ROLES = ['textbox', 'searchbox', 'combobox', 'spinbutton', 'slider', 'checkbox', 'radio'];
async function readRefField(page, spec, rows, tree) {
  var row = null;
  for (var i = 0; i < rows.length; i++) { if (rows[i].ref === spec.ref) { row = rows[i]; break; } }
  if (!row) return { ok: false, code: 'ENOREF', ref: spec.ref };
  var line = '';
  var lines = String(tree || '').split('\n');
  for (var li = 0; li < lines.length; li++) {
    if (lines[li].indexOf('[ref=' + spec.ref + ']') >= 0) { line = lines[li]; break; }
  }
  var stateful = row.role === 'checkbox' || row.role === 'radio' || row.role === 'switch';
  var loc = page.locator('aria-ref=' + spec.ref);
  try {
    if (spec.attr) return { ok: true, value: await loc.getAttribute(spec.attr), read: 'attribute', role: row.role, ref: spec.ref };
    if (spec.text === true) return { ok: true, value: await loc.innerText(), read: 'innerText', role: row.role, ref: spec.ref };
    if (VALUE_ROLES.indexOf(row.role) >= 0) {
      var res = { ok: true, value: await loc.inputValue(), read: 'inputValue', role: row.role, ref: spec.ref };
      if (stateful) res.checked = /\[checked\]/.test(line);
      return res;
    }
    return { ok: true, value: await loc.innerText(), read: 'innerText', role: row.role, ref: spec.ref };
  } catch (e) {
    return { ok: false, code: 'EREAD', ref: spec.ref, error: String(e && e.message ? e.message : e).slice(0, 200) };
  }
}`;

// The read itself, injected with the helper above. The authorisation is the fingerprint of
// the observation the refs came from: if the tree has been re-minted since, those refs point
// at rows that no longer exist, and a confident wrong string is worse than a refusal.
export const REF_SPLIT_SRC = String.raw`selectorSchema = {};
      for (var ek of Object.keys(JOB.extract)) {
        var espec = JOB.extract[ek];
        if (espec && typeof espec === 'object' && !Array.isArray(espec) && 'ref' in espec) refFields.push([ek, espec]);
        else selectorSchema[ek] = espec;
      }`;

export const REF_EXTRACT_SRC = String.raw`if (refFields.length) {
        var nowSnap = null;
        try { nowSnap = await snapshot(page); } catch (e) { nowSnap = null; }
        var nowTree = (nowSnap && nowSnap.tree) || '';
        var nowSum = summarizeTree(nowTree, 'interactive', 200000);
        // Accept either the bare row fingerprint or the snapshotId a previous call returned.
        // The id form pins the document too, so refs minted elsewhere cannot be replayed
        // here just because two trees happen to have the same shape.
        var wantId = String(JOB.refsFingerprint || '');
        var atPos = wantId.indexOf('|');
        var wantFp = atPos > 0 ? wantId.slice(0, atPos) : wantId;
        var wantUrl = atPos > 0 ? wantId.slice(atPos + 1) : null;
        var fresh = wantFp === nowSum.fingerprint && (wantUrl === null || wantUrl === finalUrl);
        out.refsFingerprintNow = nowSum.fingerprint;
        out.snapshotIdNow = nowSum.fingerprint + '|' + finalUrl;
        for (var rf = 0; rf < refFields.length; rf++) {
          var fname = refFields[rf][0];
          var fspec = refFields[rf][1];
          if (!fresh) {
            out.data.data[fname] = { ok: false, code: 'ESTALEREF', guard: 'fingerprint', ref: fspec.ref };
            out.data.missing.push(fname);
            continue;
          }
          var read = await readRefField(page, fspec, nowSum.refs, nowTree);
          out.data.data[fname] = read;
          if (!read.ok) out.data.missing.push(fname);
        }
      }`;

// The observation the steps left behind. Its fingerprint is the only thing that makes a
// follow-up ref read on this tab legal, so it is reported rather than assumed. Injected only
// when asked for, because the generated source is capped at 30000 characters on the wire.
export const SNAPSHOT_AFTER_SRC = String.raw`try {
        var afterTree = ((await snapshot(page)) || {}).tree || '';
        var sa = summarizeTree(afterTree, 'interactive', 200000);
        // The id a following call passes back as refsFingerprint: the rows AND the document.
        out.snapshotAfter = { snapshotId: sa.fingerprint + '|' + finalUrl, fingerprint: sa.fingerprint, refCount: sa.refCount, url: finalUrl };
        if (JOB.snapshotAfter === 'diff') {
          // The comparison runs on the host: it needs no browser, and the wire budget here
          // is 30000 characters with the action helper alone taking 9.6KB. The before side
          // is the arrival snapshot the result already carries, so this side is summarised
          // the same way — comparing a raw tree against a filtered one reports the filter
          // as a change.
          out.snapshotAfter.tree = summarizeTree(afterTree, JOB.snapshot, JOB.maxTreeChars || 20000).tree;
        }
      } catch (e) {
        out.snapshotAfter = { ok: false, code: 'ESNAPSHOT', error: String(e && e.message ? e.message : e).slice(0, 200) };
      }`;

// JSON.stringify does not escape U+2028 / U+2029, and both are raw line terminators inside
// a script source. Legal since ES2019 in V8, unverified on the Aside REPL parser, so they
// are escaped rather than trusted.
export function jsonForScript(value) {
  return JSON.stringify(value)
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

// The generated source is handed to the CLI as a command-line ARGUMENT and Windows caps a
// command line at 32,767 characters. This file is deliberately heavy on comments because
// every non-obvious line here is a measurement; none of that has to travel. Only whole-line
// // comments and blank lines are removed, never a trailing comment and never indentation,
// so nothing inside a string or a template literal can be touched.
export function stripForWire(src) {
  const out = [];
  for (const line of String(src).split('\n')) {
    const t = line.trim();
    if (t.length === 0) continue;
    if (t.startsWith('//')) continue;
    out.push(line);
  }
  return out.join('\n');
}

// The same thing, plus the leading spaces, for the fragments that get INJECTED into the
// template. stripForWire keeps indentation because the template it is applied to may hold a
// multi-line string whose leading spaces are part of the value. None of these fragments
// holds one — they contain no backtick at all, which a test asserts for every one of them,
// because the day somebody adds a template literal here the indentation stops being free.
// It is worth doing: across the fragments an acting job reaches, this is over a kilobyte of
// command line that says nothing.
export function stripFragment(src) {
  return stripForWire(String(src).replace(/^ +/gm, ''));
}

// The wire cap, in one place, because two entry points enforce it and they used to carry
// the same number twice. It is not a round number chosen for looks: the generated source is
// handed to the CLI as a command-line ARGUMENT, and Windows caps a whole command line at
// 32,767 characters, so 30,000 is that ceiling with room for the binary path and the verb.
// No other platform is anywhere near it — macOS and Linux measure their limit in hundreds of
// kilobytes — and holding every host to the tightest one meant `helper: true` could not be
// used with a full batch at all. So the cap is the platform's, and the portable envelope is
// pinned separately by the suite: the ordinary acting and reading jobs stay under 30,000 on
// every host. The larger host-specific value is a conservative envelope under that
// platform's limit, and only combinations beyond the portable envelope depend on where you are.
export const WIRE_LIMIT = process.platform === 'win32' ? 30000 : 50000;
export const WIRE_LIMIT_PORTABLE = 30000;

// Fields the script only ever reads for truthiness, and one it never reads at all. They are
// per-row, so on a twenty-url batch they are a kilobyte of command line spent saying
// nothing: `breaker` is read by neither the script nor the host (the host's own view comes
// from breaker.snapshot()), and a null waitSelector or a false skip is exactly what the
// script assumes when the key is absent.
function thinRow(row) {
  const out = {};
  for (const k of Object.keys(row)) {
    if (k === 'breaker') continue;
    if (k === 'skip' && row[k] === false) continue;
    if (k === 'waitSelector' && (row[k] === null || row[k] === undefined)) continue;
    out[k] = row[k];
  }
  return out;
}

export function compile(job, plan = null) {
  const items = (plan && plan.length
    ? plan
    : job.urls.map((url) => ({ url, timeoutMs: job.timeoutMs, waitSelector: job.waitSelector, skip: false }))
  ).map(thinRow);
  const payload = {
    items,
    // Issued host side and echoed back on every effect line, so a side effect can be tied
    // to the run that caused it even when the final payload never arrives.
    runId: job.runId || null,
    innerMs: deadlineMath(job.timeoutMs).innerMs,
    concurrency: job.concurrency,
    waitUntil: job.waitUntil,
    snapshot: job.snapshot,
    maxTreeChars: job.maxTreeChars || 20000,
    // Carried into the payload so the generated script and its size both depend on it.
    treeNodes: job.treeNodes === true,
    actions: job.actions || null,
    stopOnError: job.stopOnError !== false,
    allowStaleRefs: job.allowStaleRefs === true,
    refsFingerprint: job.refsFingerprint || null,
    actionBudgetMs: job.actionBudgetMs || null,
    maxTabs: job.maxTabs,
    slackMs: job.slackMs,
    // Absolute, computed HOST side. The script's own clock starts after Aside boots and
    // parses, which is later than the instant the host deadline started at spawn, so a
    // budget the script re-derives from its own start believes in time it does not have.
    // Compiling before spawn makes this strictly conservative.
    hostDeadlineAt: Date.now() + deadlineMath(job.timeoutMs).hostMs,
    requireSelector: job.requireSelector || [],
    minTextChars: job.minTextChars || null,
    requireContent: job.requireContent === true,
    // The source, not a compiled RegExp: the script rebuilds it, the same way the
    // block-detection patterns travel. schema.js has already refused an invalid one.
    requireContentPattern: job.requireContentPattern || null,
    loggedInMarker: job.loggedInMarker || null,
    stopWhenLoggedOut: job.stopWhenLoggedOut === true,
    screenshot: job.screenshot,
    pdf: job.pdf && { ...A4_INCHES, ...job.pdf },
    extract: job.extract || null,
    snapshotAfter: job.snapshotAfter === 'diff' ? 'diff' : job.snapshotAfter === true,
    // Only when asked. Every key here is bytes on a command line the host caps at 30000.
    ...(job.fullText === true ? { fullText: true, maxTextChars: job.maxTextChars || 200000 } : {}),
    detect: job.detect === false ? null : detectionPatterns(),
    // Travels as data like the block patterns. The script rebuilds it and consults it
    // before every other verdict.
    deadEnd: DEAD_END.source,
  };
  // Function replacers, not string ones. String.prototype.replace interprets $&, $` and
  // $' in the REPLACEMENT, so a selector or a fill value carrying $& was substituted after
  // JSON.stringify had already escaped it: fill:'a$&b' typed "a__JOB__b" into the page, and
  // $' grew a 20KB script to 34KB and made the REPL fail to parse. A function replacer
  // disables that substitution entirely. This bug predates the action layer.
  // Inject only what this job can reach. The generated source is passed to the CLI as a
  // command-line ARGUMENT, and Windows caps a command line at 32,767 characters: with both
  // helpers always injected the script reached 34,881 and every browse job on Windows died
  // with spawn ENAMETOOLONG. Found by probing the Windows host, not by a unit test.
  // A ref read and snapshotAfter both summarise the tree to get a fingerprint, so they pull
  // the helper in too. Leaving them out made the read fail with a ReferenceError that the
  // catch dressed up as a snapshot error.
  const hasRefExtract = Boolean(payload.extract) && Object.keys(payload.extract)
    .some((k) => payload.extract[k] && typeof payload.extract[k] === 'object' && 'ref' in payload.extract[k]);
  const needsTree = Boolean(payload.snapshot) || Boolean(payload.refsFingerprint)
    || Boolean(payload.snapshotAfter) || hasRefExtract;
  const needsActions = Boolean(payload.actions && payload.actions.length);
  const src = TEMPLATE
    .replace('__JOB__', () => jsonForScript(payload))
    // Opt-in, and first, so the loop below can call cm the moment the script starts. It is
    // read from the same file an install copies, which is what lets the envelope's sha256
    // mean anything.
    .replace('/*__HELPER__*/', () => (job.helper === true ? stripForWire(helperSource().src) : ''))
    .replace('/*__TREE_SUMMARY__*/', () => (needsTree ? stripFragment(TREE_SUMMARY_SRC) : ''))
    .replace('/*__TREE_NODES__*/', () => (needsTree && payload.treeNodes === true ? stripFragment(TREE_NODES_SRC) : ''))
    .replace('/*__TREE_NODES_CALL__*/', () => (needsTree && payload.treeNodes === true
      ? 'if (out.snapshot) { var __n = summarizeNodes(tree, JOB.snapshot, { maxNodeChars: 8000 }); out.snapshot.nodes = __n.nodes; out.snapshot.nodesTruncated = __n.nodesTruncated; out.snapshot.nodesUnparsed = __n.nodesUnparsed; }'
      : ''))
    .replace('/*__EXTRACT__*/', () => (payload.extract ? stripFragment(EXTRACT_SRC) : ''))
    .replace('/*__REF_READ__*/', () => (hasRefExtract ? stripFragment(REF_READ_SRC) : ''))
    .replace('/*__REF_SPLIT__*/', () => (hasRefExtract ? stripFragment(REF_SPLIT_SRC) : ''))
    .replace('/*__REF_EXTRACT__*/', () => (hasRefExtract ? stripFragment(REF_EXTRACT_SRC) : ''))
    .replace('/*__SNAPSHOT_AFTER__*/', () => (payload.snapshotAfter ? stripFragment(SNAPSHOT_AFTER_SRC) : ''))
    .replace('/*__ACTION_STEPS__*/', () => (needsActions ? stripFragment(ACTION_STEP_SRC) : ''));
  return stripForWire(src);
}

// Kept as one string so a test can evaluate it with fake globals instead of grepping it.
const TEMPLATE = `"use strict";
const JOB = __JOB__;
/*__HELPER__*/
/*__TREE_SUMMARY__*/
/*__TREE_NODES__*/
/*__ACTION_STEPS__*/
const SCRIPT_STARTED_AT = Date.now();
// The action loop must finish EARLY enough that the item still gets pushed. Sharing the
// instant of the global inner timer meant a step in flight when that timer fired took the
// whole item with it: the click had already happened and the result was items: [] with
// partial:['inner-deadline'], so a real side effect on a live page left no record.
// The reserve has to cover everything that still has to happen AFTER the action list, or
// the item is dropped together with the side effect it already caused. A flat reserve was
// not enough: a 4.2s screenshot after a successful click still produced items: [].
const ACTION_RESERVE_MS = Math.min(
  Math.floor(JOB.innerMs * 0.6),
  1500 + (JOB.screenshot ? 3000 : 0) + (JOB.pdf ? 3500 : 0) + (JOB.snapshot ? 1500 : 0) + (JOB.extract ? 1000 : 0)
);
const ACTION_HARD_STOP_AT = SCRIPT_STARTED_AT + JOB.innerMs - ACTION_RESERVE_MS;
function actionDeadlineNow() {
  // Per item, at the moment its actions start: an earlier item's navigation must not be
  // billed to this one's step list. Still clamped by the hard stop.
  var want = Date.now() + (JOB.actionBudgetMs || JOB.innerMs);
  return Math.min(want, ACTION_HARD_STOP_AT);
}
const opened = [];
const pending = [];
const items = [];
// Tabs are counted at INTENT, not at success. owned() is read and tabsRequested
// incremented in the SAME synchronous run just before openTab; run-to-completion then
// guarantees a worker resuming from a wait increments before any other worker resumes.
// NEVER introduce an await between that check and that increment - it is the whole proof.
let tabsRequested = 0;
let tabsClosed = 0;
let tabsPeak = 0;
function owned() { return tabsRequested - tabsClosed; }
function napMs(ms) { return (typeof sleep === 'function' ? sleep(ms) : new Promise((r) => setTimeout(r, ms))); }
function withCap(p, ms) {
  let t = null;
  const clear = () => { if (t !== null && typeof clearTimeout === 'function') clearTimeout(t); };
  return Promise.race([
    Promise.resolve().then(() => p),
    new Promise((res) => { t = setTimeout(() => res('__capped__'), ms); }),
  ]).then((v) => { clear(); return v; }, (e) => { clear(); throw e; });
}
// Every step that actually ran, recorded the moment it ran. items[] is only pushed after
// extract and capture, so a deadline between the two used to erase the evidence that a live
// page had been clicked. This survives that.
const actionLog = [];
let deadlineHit = false;
// Counted, not latched. One miss is not proof: a marker can be absent because a page half
// rendered, and cancelling a batch that would have worked sends someone to sign in again
// for nothing. Three is the cost-asymmetric number, not a borrowed default — an item whose
// marker is missing returns before it acts, so the two extra attempts are two navigations
// and no clicks. What they are NOT allowed to do is keep acting on a session already
// proven gone, which is what the stopped callback below is for.
let markerMisses = 0;
// Idempotent: it carries a counter now, so the invariant lives with the counter rather
// than with every call site remembering to check rec.closed first.
// Printed the moment a tab exists and the moment it stops existing, not gathered into the
// final payload. A CLI killed on a hung close never writes that payload, and the tabs it
// left are the ones somebody has to find later, so the record has to leave the process
// before the process does. The run id and the clock are the host's: it issued one and owns
// the other, and every key here is bytes on the command line.
function tabEvent(e, r) {
  try { console.log(JSON.stringify({ type: 'tab', ev: e, targetId: r.targetId || null, url: r.url, jobId: r.jobId })); } catch (x) {}
}
function markClosed(rec) {
  if (rec.closed) return;
  rec.closed = true;
  tabsClosed += 1;
  tabEvent('close', rec);
}
const RX = JOB.detect ? {
  captcha: new RegExp(JOB.detect.captcha, 'i'),
  hardBlock: new RegExp(JOB.detect.hardBlock, 'i'),
  loginPath: new RegExp(JOB.detect.loginPath, 'i'),
  password: new RegExp(JOB.detect.password, 'i'),
} : null;
function hostOf(u) { try { return new URL(u).host.toLowerCase(); } catch (_) { return null; } }
var RX_DEAD = JOB.deadEnd ? new RegExp(JOB.deadEnd, 'i') : null;
// Every refusal names the same request, so the shape is written once. The script travels
// on a 30000 character command line and these pushes are the most repeated code in it.
function reject(item, code, extra) {
  var o = { jobId: item.jobId, url: item.url, ok: false, code: code };
  if (extra) for (var k in extra) o[k] = extra[k];
  items.push(o);
}
function detectBlock(requestedUrl, finalUrl, title, tree) {
  if (!RX) return null;
  const hay = String(title) + '\\n' + String(tree);
  if (RX.captcha.test(hay)) return { kind: 'captcha', alternate: 'authenticated-exec' };
  if (RX.hardBlock.test(hay)) return { kind: 'blocked', alternate: 'api' };
  const from = hostOf(requestedUrl); const to = hostOf(finalUrl);
  const redirected = Boolean(from && to && from !== to);
  const loginish = Boolean(finalUrl && RX.loginPath.test(finalUrl));
  if ((redirected && loginish) || (loginish && RX.password.test(hay)) || (redirected && RX.password.test(hay))) {
    return { kind: 'login-wall', alternate: 'authenticated-exec' };
  }
  return null;
}
/*__REF_READ__*/
async function one(item) {
  if (deadlineHit) { reject(item, 'ESKIP', { reason: 'inner-deadline' }); return; }
  if (item.skip) { reject(item, 'ESKIP', { reason: 'breaker-open' }); return; }
  if (markerMisses > 2) { reject(item, 'ELOGINREQUIRED', { reason: 'logged-out' }); return; }
  const t = { navigate: 0, waitFor: 0, detect: 0, actions: 0, snapshot: 0, screenshot: 0, pdf: 0 };
  let out_render = null;
  let mark = Date.now();
  const lap = () => { const d = Date.now() - mark; mark = Date.now(); return d; };
  // The single throttle point. Bounded by this item's own deadline rather than a slice
  // count: a fixed one-second ceiling was an order of magnitude below a measured 2143ms
  // click, so maxTabs 1 refused nearly the whole batch while most of innerMs remained.
  const tabWaitUntil = Math.min(ACTION_HARD_STOP_AT, Date.now() + (item.timeoutMs || JOB.innerMs));
  while (owned() >= JOB.maxTabs && !deadlineHit && Date.now() < tabWaitUntil) {
    await napMs(50);
  }
  // Re-check after waiting. The guard at the top of one() ran before the wait, so a worker
  // that queued behind the budget could still open a tab well past the inner deadline.
  if (deadlineHit) { reject(item, 'ESKIP', { reason: 'inner-deadline' }); return; }
  if (owned() >= JOB.maxTabs) {
    reject(item, 'ETABBUDGET', { owned: owned(), max: JOB.maxTabs, timings: t });
    return;
  }
  let pr;
  try {
    // Increment and call in one synchronous run, inside the try: openTab can throw
    // synchronously, and an increment outside would leave the count permanently high.
    tabsRequested += 1;
    pr = openTab(item.url);
  } catch (e) {
    tabsRequested -= 1;
    reject(item, 'EOPEN', { error: String(e && e.message ? e.message : e), timings: t });
    return;
  }
  // The record is held, not looked up later: two workers can be opening the same url, and
  // matching them by url afterwards attributes one worker's tab to the other.
  const pend = { url: item.url, jobId: item.jobId, pr, settled: null, rec: null };
  pending.push(pend);
  pr.then(function () { pend.settled = 'fulfilled'; }, function () { pend.settled = 'rejected'; });
  let page;
  try {
    page = await pr;
  } catch (e) {
    // A request that never became a tab must give its slot back, or the pool wedges.
    tabsRequested -= 1;
    reject(item, 'EOPEN', { error: String(e && e.message ? e.message : e), timings: t });
    return;
  }
  if (owned() > tabsPeak) tabsPeak = owned();
  t.navigate = lap();
  const rec = { targetId: page && page.targetId, url: item.url, jobId: item.jobId, page, closed: false };
  tabEvent('open', rec);
  opened.push(rec);
  pend.rec = rec;
  try {
    // A missed selector is a symptom; the probe below may know the cause. structure/session-contract.md
    var waitMissed = null;
    if (item.waitSelector) {
      try { await page.waitForSelector(item.waitSelector, { timeout: item.timeoutMs || JOB.innerMs }); }
      catch (e) { waitMissed = item.waitSelector; }
    }
    else if (typeof page.waitForLoadState === 'function') { await page.waitForLoadState(JOB.waitUntil); }
    t.waitFor = lap();
    // Probe read BEFORE any capture. Screenshotting a login wall and then calling it a
    // successful capture is the exact silent degradation this layer exists to stop.
    // Degrade rather than fail if a build does not expose one of these: a missing probe
    // method should cost detection, not the capture the caller actually asked for.
    let finalUrl = item.url;
    let title = '';
    let tree = '';
    // page.url() drops the fragment: opening localhost:10100/#providers reported
    // localhost:10100/ back, so an SPA hash route could not be recorded or reproduced.
    // location.href inside the page keeps it, so that is the authoritative reading and
    // page.url() is only the fallback.
    try { finalUrl = await page.evaluate(() => location.href); } catch (_) {}
    if (!finalUrl || finalUrl === 'about:blank') { try { if (typeof page.url === 'function') finalUrl = await page.url(); } catch (_) {} }
    try { if (typeof page.title === 'function') title = await page.title(); } catch (_) {}
    try { if (typeof snapshot === 'function') { const snap = await snapshot(page); tree = (snap && snap.tree) || ''; } } catch (_) {}
    t.detect = lap();
    // Arriving nowhere outranks every verdict below; see structure/batch-contract.md. The
    // wording is terse because this text travels on a 30000 character command line.
    if (RX_DEAD && RX_DEAD.test(finalUrl)) {
      reject(item, 'EDEADEND', { error: 'no page loaded; ended at ' + finalUrl, finalUrl: finalUrl, title: title, timings: t });
      return;
    }
    const blocked = detectBlock(item.url, finalUrl, title, tree);
    if (blocked) {
      reject(item, 'EBLOCKED', { blockKind: blocked.kind, alternate: blocked.alternate, finalUrl: finalUrl, title: title, timings: t });
      return;
    }

    // Did the page actually RENDER, or did we just arrive at it?
    //
    // Threads answered ok:true with the right title while the body was 530KB of server
    // bootstrap JSON and no post UI. "Navigated successfully" and "read the content" are
    // different claims and the caller could not tell them apart, so they are separate
    // fields now and the checks are reported even when nobody asked for them.
    // Degrade, never fail: a missing evaluate must cost the render VERDICT, not the
    // capture the caller actually asked for. Same rule as the url/title/tree probe above.
    let render = null;
    try {
      render = await page.evaluate((req) => {
      const body = document.body;
      const visibleText = body && typeof body.innerText === 'string' ? body.innerText.trim() : '';
      const rawLen = body ? (body.textContent || '').length : 0;
      const scriptLen = Array.from(document.querySelectorAll('script')).reduce((n, s) => n + (s.textContent || '').length, 0);
      // Share of ALL text that is script payload. Dividing script bytes by body.textContent
      // gave 201% on a normal dashboard, because head scripts are not inside the body.
      const totalLen = scriptLen + visibleText.length;
      const matched = [];
      const unmatched = [];
      for (const sel of (req.selectors || [])) {
        let hit = null;
        try { hit = document.querySelector(sel); } catch (_) { hit = null; }
        (hit ? matched : unmatched).push(sel);
      }
      const skeletonNodes = document.querySelectorAll('[class*="skeleton" i],[class*="shimmer" i],[class*="placeholder" i],[aria-busy="true"]').length;
      // Counted because it is the usual explanation for a selector that found nothing. The
      // probe already walks the document, so this costs a query and answers the question a
      // caller asks next.
      const iframes = document.querySelectorAll('iframe').length;
      // The text a required pattern is tested against is the DOM's own, with script and
      // style removed. innerText is the rendered view and collapses on a page the browser
      // has not laid out — the same page answered 2,024 characters that way and 271,303
      // the other — so a marker that is present would read as absent. Keeping script
      // bodies out matters just as much: a bootstrap payload mentioning the very string
      // being looked for would match while no one could see it.
      let patternMatched = null;
      let loggedIn = null;
      if (req.pattern || req.marker) {
        let hay = '';
        if (body) {
          const clone = body.cloneNode(true);
          const noisy = clone.querySelectorAll('script,style,template,noscript');
          for (let i = 0; i < noisy.length; i++) noisy[i].remove();
          hay = clone.textContent || '';
        }
        if (req.pattern) patternMatched = new RegExp(req.pattern).test(hay);
        if (req.marker) loggedIn = new RegExp(req.marker).test(hay);
      }
      return {
        textChars: visibleText.length,
        rawChars: rawLen,
        scriptChars: scriptLen,
        // How much of the raw text is script payload rather than prose.
        scriptRatio: totalLen ? Math.round((scriptLen / totalLen) * 100) / 100 : 0,
        requiredSelectorsMatched: matched,
        requiredSelectorsMissing: unmatched,
        patternMatched,
        loggedIn,
        skeletonNodes,
        iframes,
        sample: visibleText.slice(0, 160),
        // Only when the caller asked. Shipping the whole body by default is how a batch of
        // twenty pages turns into a megabyte of stdout.
        full: req.ft ? visibleText.slice(0, req.m || 200000) : null,
      };
      }, { selectors: JOB.requireSelector || [], ft: JOB.fullText, m: JOB.maxTextChars, pattern: JOB.requireContentPattern, marker: JOB.loggedInMarker });
    } catch (_) { render = null; }

    if (render) {
    // Ahead of the content checks, because a signed-out page fails those too and the
    // content miss is the less useful of the two answers: it sends the caller looking at
    // selectors when the actual problem is that nobody is signed in.
    if (JOB.loggedInMarker && render.loggedIn === false) {
      if (JOB.stopWhenLoggedOut) markerMisses++;
      reject(item, 'ENOTLOGGEDIN', { marker: JOB.loggedInMarker, finalUrl: finalUrl, title: title, render: render, timings: t });
      return;
    }
    const reasons = [];
    if (JOB.minTextChars && render.textChars < JOB.minTextChars) reasons.push('only ' + render.textChars + ' visible characters (wanted >= ' + JOB.minTextChars + ')');
    if (render.requiredSelectorsMissing.length) reasons.push('missing required selectors: ' + render.requiredSelectorsMissing.join(', '));
    if (render.patternMatched === false) reasons.push('the page does not contain the required content /' + JOB.requireContentPattern + '/');
    // scriptRatio is REPORTED but is deliberately not a verdict input. Any bundled SPA
    // ships large inline scripts, so a ratio test fails pages that rendered perfectly well
    // — it would trade the false success we are fixing for a false failure, which is no
    // better. The verdict comes from what the caller actually asked for.
    if (render.skeletonNodes > 0 && render.textChars < 400) reasons.push(render.skeletonNodes + ' loading-skeleton nodes still present and almost no text');
    render.reasons = reasons;
    // null means nobody asked and no heuristic fired; true/false is a real verdict.
    // A pattern counts as asking, because it IS the check. A bare requireContent does not,
    // and cannot arrive alone: schema.js refuses it without a check beside it, so there is
    // no path here where the verdict is true and nothing was verified.
    const asked = Boolean((JOB.requireSelector && JOB.requireSelector.length) || JOB.minTextChars || JOB.requireContentPattern);
    render.contentVerified = reasons.length ? false : (asked ? true : null);
    out_render = render;
    if (reasons.length && JOB.requireContent) {
      reject(item, 'EUNRENDERED', { finalUrl: finalUrl, title: title, render: render, timings: t });
      return;
    }
    }
    if (waitMissed) {
      reject(item, 'EWAITSELECTOR', { error: 'selector never appeared: ' + waitMissed, finalUrl: finalUrl, title: title, render: out_render, timings: t });
      return;
    }
    const out = { jobId: item.jobId, url: item.url, ok: true, finalUrl, title, timings: t, render: out_render, contentVerified: out_render ? out_render.contentVerified : null, capture: { requested: {}, actual: {}, matched: true } };
    // The body rides on the item, not inside the render summary: the render object is the
    // verdict on whether the page arrived, and the text is what the page said.
    if (out_render && typeof out_render.full === 'string') { out.text = out_render.full; delete out_render.full; }
    // The render verdict above describes the page we ARRIVED at. If an action navigates,
    // that verdict is about a document we have left, so it is stamped with its stage and
    // the move is reported rather than left for the caller to infer from a changed url.
    if (out_render) out_render.stage = 'pre-actions';
    if (JOB.actions && JOB.actions.length) {
      const urlBeforeActions = finalUrl;
      const ran = await runActions(page, JOB.actions, {
        deadlineAt: actionDeadlineNow(),
        refsFingerprint: JOB.refsFingerprint,
        guardTimeoutMs: 5000,
        // Both ids come from the host. The script composes the operation id from them so a
        // side effect can be traced back to the request that asked for it, but it never
        // invents an identifier of its own.
        runId: JOB.runId,
        jobId: item.jobId,
        // Position within the batch. Used only when no jobId was issued: without it every
        // item's step 0 composes the same operationId and the host folds distinct effects
        // into a single one.
        opSeq: JOB.items.indexOf(item),
        onEffect: function (rec, state) {
          try {
            console.log(JSON.stringify({ type: 'effect', effect: {
              operationId: rec.operationId, runId: JOB.runId, jobId: item.jobId,
              i: rec.i, verb: rec.verb, state: state, at: Date.now() } }));
          } catch (e) {}
        },
        onStep: function (rec) {
          var row = { url: item.url, i: rec.i, verb: rec.verb, target: rec.target, ok: rec.ok, code: rec.code };
          actionLog.push(row);
          // Printed IMMEDIATELY as well as buffered. The final payload is written after
          // cleanup(), so a CLI killed on a hung page.close() would otherwise take the
          // record of an executed side effect with it.
          try { console.log(JSON.stringify({ type: 'step', step: row })); } catch (e) {}
        },
        fingerprintOf: function (p) {
          return snapshot(p).then(function (s) {
            var sum = summarizeTree((s && s.tree) || '', 'interactive', 200000);
            return { full: sum.fingerprint, structure: sum.fingerprintStructure };
          });
        },
        urlAtSnapshot: urlBeforeActions,
        allowStaleRefs: JOB.allowStaleRefs,
        stopOnError: JOB.stopOnError,
        stopped: function () { return markerMisses > 2; }
      });
      t.actions = lap();
      out.actions = ran.steps;
      out.actionsOk = ran.ok;
      out.urlBeforeActions = urlBeforeActions;
      out.navigatedDuringActions = ran.navigated;
      out.refGuard = ran.refGuard;
      // finalUrl below becomes the post-action url while contentVerified above describes
      // the page we measured before acting. Stamp the top level too, not only the nested
      // render object, so the pair is never read as being about one document.
      out.contentVerifiedStage = 'pre-actions';
      if (ran.urlAfter) { finalUrl = ran.urlAfter; out.finalUrl = ran.urlAfter; }
      if (!ran.ok && JOB.stopOnError) { out.ok = false; out.code = markerMisses > 2 ? 'ESESSIONGONE' : 'EACTION'; }
    }
    // The observation this call leaves behind. Its id is what makes a follow-up ref read
    // legal, and a caller can ask for it without running any actions at all.
    /*__SNAPSHOT_AFTER__*/
    /*__EXTRACT__*/
    if (JOB.snapshot) {
      out.snapshotBytes = tree.length;
      if (JOB.snapshot !== 'bytes') {
        // The tree above is the real Aside accessibility snapshot and it already contains
        // the child frames, which is why a frame arrives as its own [ref=fNN] row. Shipping
        // it was refused on token grounds; 'interactive' answers that instead of silence.
        out.snapshot = summarizeTree(tree, JOB.snapshot, JOB.maxTreeChars || 20000);
        /*__TREE_NODES_CALL__*/
      }
      t.snapshot = lap();
    }
    if (JOB.screenshot) {
      const buf = await page.screenshot(JOB.screenshot);
      out.capture.requested.screenshot = JOB.screenshot;
      out.capture.actual.bytes = buf ? buf.length : 0;
      // The host supplies the filename. The script never invents one, so a payload can
      // never steer the host into reading a path it did not choose.
      if (item.artifactName) {
        await fs.mkdir('./artifacts', { recursive: true });
        await fs.writeFile('./artifacts/' + item.artifactName, buf);
        out.artifactName = item.artifactName;
      }
      t.screenshot = lap();
    }
    if (JOB.pdf) {
      const buf = await page.pdf(JOB.pdf);
      out.capture.requested.pdf = JOB.pdf;
      out.capture.actual.pdfBytes = buf ? buf.length : 0;
      if (item.pdfName) {
        await fs.mkdir('./artifacts', { recursive: true });
        await fs.writeFile('./artifacts/' + item.pdfName, buf);
        out.pdfName = item.pdfName;
      }
      t.pdf = lap();
    }
    items.push(out);
  } catch (e) {
    items.push({ jobId: item.jobId, url: item.url, ok: false, error: String(e && e.message ? e.message : e), timings: t });
  } finally {
    // A close that HANGS used to cost this worker for the rest of the run, with its queued
    // urls silently never attempted. Capped so the worker returns to the pool.
    // withCap resolves with '__capped__' when the close hangs, so marking it closed here
    // counted a tab that is still open and handed the worker a slot it does not have.
    // A close that hangs is not a close. It is also not worth a second attempt: retrying it
    // in cleanup spends the whole remaining budget waiting for the same hang, so the tab is
    // marked as one we could not close and reported through leakedUrls instead.
    try {
      const closedOk = await withCap(page.close(), 1500);
      if (closedOk !== '__capped__') markClosed(rec); else rec.capped = true;
    } catch (_) { /* a close that REFUSED may still close on a second attempt, so cleanup keeps it */ }
  }
}
async function main() {
  const queue = JOB.items.slice();
  const limit = Math.max(1, JOB.concurrency);
  const workers = [];
  for (let i = 0; i < limit; i++) {
    // Drained unconditionally. Both stop flags used to be conditions here, which abandoned
    // the queue and made the guards inside one() unreachable: the remaining items were never
    // reported at all and the host filled them in as requests that never came back. That is
    // the one outcome the contract cannot tell apart from a run that genuinely lost items.
    // A guard returns synchronously, so draining a stopped run costs a push per item.
    workers.push((async () => { while (queue.length) { await one(queue.shift()); } })());
  }
  await Promise.all(workers);
}
async function cleanup() {
  // ONE budget, started here, covering the pending await as well as the closes. That await
  // is unbounded and comes FIRST, so a tab that never finishes opening used to block
  // cleanup past the host deadline and lose the final payload - the exact failure this
  // budget exists to prevent. 400ms is held back for stringify and the stdout write.
  const budget = Math.max(250, JOB.hostDeadlineAt - Date.now() - 400);
  const deadline = Date.now() + budget;
  const left = () => Math.max(1, deadline - Date.now());
  const settled = await withCap(Promise.allSettled(pending.map((x) => x.pr)), left());
  if (settled !== '__capped__') {
    for (let i = 0; i < settled.length; i++) {
      const s = settled[i];
      if (s.status !== 'fulfilled' || !s.value) continue;
      const page = s.value;
      if (opened.some((o) => o.page === page)) continue;
      opened.push({ targetId: page.targetId, url: pending[i].url, jobId: pending[i].jobId, page, closed: false });
    }
  } else {
    // The budget ran out while some opens were still in flight. An open we never heard
    // back from may well be a tab we own, so it is named. One that already rejected is
    // not a tab at all, and counting it would invent a leak.
    for (const p of pending) {
      if (p.settled === 'rejected' || p.rec) continue;
      opened.push({ targetId: null, url: p.url, jobId: p.jobId, page: null, closed: false });
    }
  }
  // One pass over everything we own, capped or not. Skipping this when the pending await
  // was capped left already-open tabs behind for the sake of tabs we never got.
  const closes = [];
  for (const rec of opened) {
    if (rec.closed || !rec.page || rec.capped) continue;
    const r = rec;
    closes.push(Promise.resolve().then(() => r.page.close()).then(() => markClosed(r), () => {}));
  }
  // Concurrently, under the SAME budget. One timeout per tab multiplied out to sixteen
  // seconds against 1500ms of host slack and lost the payload it was added to save.
  await withCap(Promise.allSettled(closes), left());
  return opened.filter((o) => !o.closed).map((o) => o.url);
}
const timer = (typeof sleep === 'function' ? sleep(JOB.innerMs) : new Promise((r) => setTimeout(r, JOB.innerMs))).then(() => { deadlineHit = true; });
try { await Promise.race([main(), timer]); }
finally {
  const leakedUrls = await cleanup();
  // Counters are as of THIS instant. A close that resolves after the cleanup budget still
  // runs markClosed, so a late close can drift them by one; that is stated, not hidden.
  const tabs = { requested: tabsRequested, closed: tabsClosed, peak: tabsPeak, max: JOB.maxTabs, leaked: leakedUrls.length, asOfPrint: true };
  console.log(JSON.stringify({ type: 'final', pwd: String(pwd), items, actionLog, tabs, leakedUrls, partial: deadlineHit ? ['inner-deadline'] : [] }));
}`;
