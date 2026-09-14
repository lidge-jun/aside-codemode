// Compiles a validated job into Aside REPL source, and owns the deadline arithmetic.
//
// The generated script is the ONLY place tabs are owned, because a killed CLI leaks its
// tabs permanently and no later session can close them (001 E5). So the script must always
// finish under its OWN timer: inner deadline first, host deadline second.
import { A4_INCHES, ASIDE_REPL_CAP_MS, DEFAULT_INNER_CAP_MS } from './schema.js';

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

export function compile(job) {
  const plan = {
    items: job.urls.map((url) => ({ url, skip: false })),
    innerMs: deadlineMath(job.timeoutMs).innerMs,
    concurrency: job.concurrency,
    waitUntil: job.waitUntil,
    waitSelector: job.waitSelector,
    snapshot: job.snapshot,
    screenshot: job.screenshot,
    pdf: job.pdf && { ...A4_INCHES, ...job.pdf },
  };
  return TEMPLATE.replace('__JOB__', JSON.stringify(plan));
}

// Kept as one string so a test can evaluate it with fake globals instead of grepping it.
const TEMPLATE = `"use strict";
const JOB = __JOB__;
const opened = [];
const pending = [];
const items = [];
let deadlineHit = false;
function markClosed(rec) { rec.closed = true; }
async function one(item) {
  if (deadlineHit || item.skip) { items.push({ url: item.url, ok: false, code: 'ESKIP' }); return; }
  const pr = openTab(item.url);
  pending.push({ url: item.url, pr });
  const page = await pr;
  const rec = { targetId: page && page.targetId, url: item.url, page, closed: false };
  opened.push(rec);
  const t = { navigate: 0, waitFor: 0, snapshot: 0, screenshot: 0 };
  try {
    if (JOB.waitSelector) { await page.waitForSelector(JOB.waitSelector, { timeout: JOB.innerMs }); }
    else if (typeof page.waitForLoadState === 'function') { await page.waitForLoadState(JOB.waitUntil); }
    const out = { url: item.url, ok: true, timings: t, capture: { requested: {}, actual: {}, matched: true } };
    if (JOB.snapshot) { const s = await snapshot(page); out.snapshotBytes = (s && s.tree ? s.tree.length : 0); }
    if (JOB.screenshot) {
      const buf = await page.screenshot(JOB.screenshot);
      out.capture.requested.screenshot = JOB.screenshot;
      out.capture.actual.bytes = buf ? buf.length : 0;
    }
    if (JOB.pdf) {
      const buf = await page.pdf(JOB.pdf);
      out.capture.requested.pdf = JOB.pdf;
      out.capture.actual.pdfBytes = buf ? buf.length : 0;
    }
    items.push(out);
  } catch (e) {
    items.push({ url: item.url, ok: false, error: String(e && e.message ? e.message : e) });
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
