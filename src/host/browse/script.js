// Compiles a validated job into Aside REPL source, and owns the deadline arithmetic.
//
// The generated script is the ONLY place tabs are owned, because a killed CLI leaks its
// tabs permanently and no later session can close them (001 E5). So the script must always
// finish under its OWN timer: inner deadline first, host deadline second.
import { A4_INCHES, ASIDE_REPL_CAP_MS, DEFAULT_INNER_CAP_MS } from './schema.js';
import { detectionPatterns } from './policy.js';

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
    screenshot: job.screenshot,
    pdf: job.pdf && { ...A4_INCHES, ...job.pdf },
    detect: detectionPatterns(),
  };
  return TEMPLATE.replace('__JOB__', JSON.stringify(payload));
}

// Kept as one string so a test can evaluate it with fake globals instead of grepping it.
const TEMPLATE = `"use strict";
const JOB = __JOB__;
const opened = [];
const pending = [];
const items = [];
let deadlineHit = false;
function markClosed(rec) { rec.closed = true; }
const RX = {
  captcha: new RegExp(JOB.detect.captcha, 'i'),
  hardBlock: new RegExp(JOB.detect.hardBlock, 'i'),
  loginPath: new RegExp(JOB.detect.loginPath, 'i'),
  password: new RegExp(JOB.detect.password, 'i'),
};
function hostOf(u) { try { return new URL(u).host.toLowerCase(); } catch (_) { return null; } }
function detectBlock(requestedUrl, finalUrl, title, tree) {
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
  const t = { navigate: 0, waitFor: 0, detect: 0, snapshot: 0, screenshot: 0, pdf: 0 };
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
    try { if (typeof page.url === 'function') finalUrl = await page.url(); } catch (_) {}
    try { if (typeof page.title === 'function') title = await page.title(); } catch (_) {}
    try { if (typeof snapshot === 'function') { const snap = await snapshot(page); tree = (snap && snap.tree) || ''; } } catch (_) {}
    t.detect = lap();
    const blocked = detectBlock(item.url, finalUrl, title, tree);
    if (blocked) {
      items.push({ url: item.url, ok: false, code: 'EBLOCKED', blockKind: blocked.kind, alternate: blocked.alternate, finalUrl, title, timings: t });
      return;
    }
    const out = { url: item.url, ok: true, finalUrl, title, timings: t, capture: { requested: {}, actual: {}, matched: true } };
    if (JOB.snapshot) { out.snapshotBytes = tree.length; t.snapshot = lap(); }
    if (JOB.screenshot) {
      const buf = await page.screenshot(JOB.screenshot);
      out.capture.requested.screenshot = JOB.screenshot;
      out.capture.actual.bytes = buf ? buf.length : 0;
      t.screenshot = lap();
    }
    if (JOB.pdf) {
      const buf = await page.pdf(JOB.pdf);
      out.capture.requested.pdf = JOB.pdf;
      out.capture.actual.pdfBytes = buf ? buf.length : 0;
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
  console.log(JSON.stringify({ type: 'final', items, leakedUrls, partial: deadlineHit ? ['inner-deadline'] : [] }));
}`;
