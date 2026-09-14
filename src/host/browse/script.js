// Compiles a validated job into Aside REPL source, and owns the deadline arithmetic.
//
// The generated script is the ONLY place tabs are owned, because a killed CLI leaks its
// tabs permanently and no later session can close them (001 E5). So the script must always
// finish under its OWN timer: inner deadline first, host deadline second.
import { A4_INCHES, ASIDE_REPL_CAP_MS, DEFAULT_INNER_CAP_MS } from './schema.js';
import { detectionPatterns } from './policy.js';
import { ACTION_STEP_SRC } from './actions-run.js';

export const SLACK_MS = 1500;

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
export const TREE_SUMMARY_SRC = String.raw`function summarizeTree(tree, mode, capChars) {
  var ROW_REF = /\[ref=([^\]]+)\]/;
  var ROW_ROLE = /^[\s-]*([a-zA-Z][a-zA-Z0-9_-]*)/;
  var ROW_NAME = /"([^"]*)"/;
  var ACTIONABLE = /^[\s-]*(link|button|textbox|searchbox|checkbox|radio|combobox|listbox|option|menuitem|menuitemcheckbox|menuitemradio|tab|switch|slider|spinbutton|treeitem|iframe)\b/;
  var lines = String(tree == null ? '' : tree).split('\n');
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
  return {
    mode: mode,
    chars: body.length,
    truncated: body.length > cap,
    tree: body.slice(0, cap),
    refCount: refs.length,
    refs: refs.slice(0, 500),
    refsTruncated: refs.length > 500
  };
}`;

export const summarizeTree = new Function(TREE_SUMMARY_SRC + '; return summarizeTree;')();

export function compile(job, plan = null) {
  const items = plan && plan.length
    ? plan
    : job.urls.map((url) => ({ url, timeoutMs: job.timeoutMs, waitSelector: job.waitSelector, skip: false }));
  const payload = {
    items,
    innerMs: deadlineMath(job.timeoutMs).innerMs,
    concurrency: job.concurrency,
    waitUntil: job.waitUntil,
    snapshot: job.snapshot,
    maxTreeChars: job.maxTreeChars || 20000,
    actions: job.actions || null,
    stopOnError: job.stopOnError !== false,
    allowStaleRefs: job.allowStaleRefs === true,
    requireSelector: job.requireSelector || [],
    minTextChars: job.minTextChars || null,
    requireContent: job.requireContent === true,
    screenshot: job.screenshot,
    pdf: job.pdf && { ...A4_INCHES, ...job.pdf },
    extract: job.extract || null,
    detect: job.detect === false ? null : detectionPatterns(),
  };
  return TEMPLATE
    .replace('__JOB__', JSON.stringify(payload))
    .replace('/*__TREE_SUMMARY__*/', TREE_SUMMARY_SRC)
    .replace('/*__ACTION_STEPS__*/', ACTION_STEP_SRC);
}

// Kept as one string so a test can evaluate it with fake globals instead of grepping it.
const TEMPLATE = `"use strict";
const JOB = __JOB__;
/*__TREE_SUMMARY__*/
/*__ACTION_STEPS__*/
const SCRIPT_STARTED_AT = Date.now();
const ACTION_DEADLINE_AT = SCRIPT_STARTED_AT + JOB.innerMs;
const opened = [];
const pending = [];
const items = [];
let deadlineHit = false;
function markClosed(rec) { rec.closed = true; }
const RX = JOB.detect ? {
  captcha: new RegExp(JOB.detect.captcha, 'i'),
  hardBlock: new RegExp(JOB.detect.hardBlock, 'i'),
  loginPath: new RegExp(JOB.detect.loginPath, 'i'),
  password: new RegExp(JOB.detect.password, 'i'),
} : null;
function hostOf(u) { try { return new URL(u).host.toLowerCase(); } catch (_) { return null; } }
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
async function one(item) {
  if (deadlineHit) { items.push({ url: item.url, ok: false, code: 'ESKIP', reason: 'inner-deadline' }); return; }
  if (item.skip) { items.push({ url: item.url, ok: false, code: 'ESKIP', reason: 'breaker-open' }); return; }
  const t = { navigate: 0, waitFor: 0, detect: 0, actions: 0, snapshot: 0, screenshot: 0, pdf: 0 };
  let out_render = null;
  let mark = Date.now();
  const lap = () => { const d = Date.now() - mark; mark = Date.now(); return d; };
  const pr = openTab(item.url);
  pending.push({ url: item.url, pr });
  let page;
  try {
    page = await pr;
  } catch (e) {
    // One url that cannot even open must not take the batch down with it.
    items.push({ url: item.url, ok: false, code: 'EOPEN', error: String(e && e.message ? e.message : e), timings: t });
    return;
  }
  t.navigate = lap();
  const rec = { targetId: page && page.targetId, url: item.url, page, closed: false };
  opened.push(rec);
  try {
    if (item.waitSelector) { await page.waitForSelector(item.waitSelector, { timeout: item.timeoutMs || JOB.innerMs }); }
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
    const blocked = detectBlock(item.url, finalUrl, title, tree);
    if (blocked) {
      items.push({ url: item.url, ok: false, code: 'EBLOCKED', blockKind: blocked.kind, alternate: blocked.alternate, finalUrl, title, timings: t });
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
      return {
        textChars: visibleText.length,
        rawChars: rawLen,
        scriptChars: scriptLen,
        // How much of the raw text is script payload rather than prose.
        scriptRatio: totalLen ? Math.round((scriptLen / totalLen) * 100) / 100 : 0,
        requiredSelectorsMatched: matched,
        requiredSelectorsMissing: unmatched,
        skeletonNodes,
        sample: visibleText.slice(0, 160),
      };
      }, { selectors: JOB.requireSelector || [] });
    } catch (_) { render = null; }

    if (render) {
    const reasons = [];
    if (JOB.minTextChars && render.textChars < JOB.minTextChars) reasons.push('only ' + render.textChars + ' visible characters (wanted >= ' + JOB.minTextChars + ')');
    if (render.requiredSelectorsMissing.length) reasons.push('missing required selectors: ' + render.requiredSelectorsMissing.join(', '));
    // scriptRatio is REPORTED but is deliberately not a verdict input. Any bundled SPA
    // ships large inline scripts, so a ratio test fails pages that rendered perfectly well
    // — it would trade the false success we are fixing for a false failure, which is no
    // better. The verdict comes from what the caller actually asked for.
    if (render.skeletonNodes > 0 && render.textChars < 400) reasons.push(render.skeletonNodes + ' loading-skeleton nodes still present and almost no text');
    render.reasons = reasons;
    // null means nobody asked and no heuristic fired; true/false is a real verdict.
    const asked = Boolean((JOB.requireSelector && JOB.requireSelector.length) || JOB.minTextChars);
    render.contentVerified = reasons.length ? false : (asked ? true : null);
    out_render = render;
    if (reasons.length && JOB.requireContent) {
      items.push({ url: item.url, ok: false, code: 'EUNRENDERED', finalUrl, title, render, timings: t });
      return;
    }
    }
    const out = { url: item.url, ok: true, finalUrl, title, timings: t, render: out_render, contentVerified: out_render ? out_render.contentVerified : null, capture: { requested: {}, actual: {}, matched: true } };
    // The render verdict above describes the page we ARRIVED at. If an action navigates,
    // that verdict is about a document we have left, so it is stamped with its stage and
    // the move is reported rather than left for the caller to infer from a changed url.
    if (out_render) out_render.stage = 'pre-actions';
    if (JOB.actions && JOB.actions.length) {
      const urlBeforeActions = finalUrl;
      const ran = await runActions(page, JOB.actions, {
        deadlineAt: ACTION_DEADLINE_AT,
        urlAtSnapshot: urlBeforeActions,
        allowStaleRefs: JOB.allowStaleRefs,
        stopOnError: JOB.stopOnError
      });
      t.actions = lap();
      out.actions = ran.steps;
      out.actionsOk = ran.ok;
      out.urlBeforeActions = urlBeforeActions;
      out.navigatedDuringActions = ran.navigated;
      if (ran.urlAfter) { finalUrl = ran.urlAfter; out.finalUrl = ran.urlAfter; }
      if (!ran.ok && JOB.stopOnError) { out.ok = false; out.code = 'EACTION'; }
    }
    if (JOB.extract) {
      // ONE evaluate for the whole schema: the point of #10 is to avoid shipping a tree.
      out.data = await page.evaluate((schema) => {
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
      }, JOB.extract);
    }
    if (JOB.snapshot) {
      out.snapshotBytes = tree.length;
      if (JOB.snapshot !== 'bytes') {
        // The tree above is the real Aside accessibility snapshot and it already contains
        // the child frames, which is why a frame arrives as its own [ref=fNN] row. Shipping
        // it was refused on token grounds; 'interactive' answers that instead of silence.
        out.snapshot = summarizeTree(tree, JOB.snapshot, JOB.maxTreeChars || 20000);
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
    items.push({ url: item.url, ok: false, error: String(e && e.message ? e.message : e), timings: t });
  } finally {
    try { await page.close(); markClosed(rec); } catch (_) {}
  }
}
async function main() {
  const queue = JOB.items.slice();
  const limit = Math.max(1, JOB.concurrency);
  const workers = [];
  for (let i = 0; i < limit; i++) {
    workers.push((async () => { while (queue.length && !deadlineHit) { await one(queue.shift()); } })());
  }
  await Promise.all(workers);
}
async function cleanup() {
  const settled = await Promise.allSettled(pending.map((x) => x.pr));
  for (let i = 0; i < settled.length; i++) {
    const s = settled[i];
    if (s.status !== 'fulfilled' || !s.value) continue;
    const page = s.value;
    let rec = opened.find((o) => o.page === page);
    if (!rec) { rec = { targetId: page.targetId, url: pending[i].url, page, closed: false }; opened.push(rec); }
    if (!rec.closed) { try { await page.close(); markClosed(rec); } catch (_) {} }
  }
  return opened.filter((o) => !o.closed).map((o) => o.url);
}
const timer = (typeof sleep === 'function' ? sleep(JOB.innerMs) : new Promise((r) => setTimeout(r, JOB.innerMs))).then(() => { deadlineHit = true; });
try { await Promise.race([main(), timer]); }
finally {
  const leakedUrls = await cleanup();
  console.log(JSON.stringify({ type: 'final', pwd: String(pwd), items, leakedUrls, partial: deadlineHit ? ['inner-deadline'] : [] }));
}`;
