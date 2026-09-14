# 010 — wp2 foundations: Aside REPL execution contract

> **Read [003_locked_contracts.md](003_locked_contracts.md) first; it overrides this file.**
> The wp1 audit found that these phase docs, written in parallel, disagreed with each other on
> the `session.run` signature, the `browseCaps` defaults, the spawn/batch model, the deadline
> ordering, and several Aside call forms that had never been measured. 003 settles all of them
> with new measurements (E7). Where this document shows a different shape, 003 is correct.
> Known corrections that apply here: `openTab` returns the page itself (`tab.page` and `tab.id`
> are undefined; identity is `page.targetId`), `snapshot` requires that page object and rejects
> a string id, `file://` navigation is refused, and `waitUntil`/`waitForLoadState` accept any
> string silently so they must be validated host-side.

Unit: `devlog/_plan/260914_browse-batch/`. Implementation phase (010-range).
Closes **#20**. Records the **#23** architecture decision. Does **not** close #23 (wp7).
Supersedes goalplan filename `aside-cli.js`: 002 locked `session.js` as the only spawn+deadline+parse path. Do not create `src/host/browse/aside-cli.js`.

Independently verifiable at close (000): `--doctor --browse` prints the capability matrix; the session contract is unit-tested with a fake child; `test/search-boundary.test.js` cancel test is no longer a time oracle.

---

## 1. Purpose and issues closed

### 1.1 Purpose

Install the browse execution spine so later phases can compile jobs, spawn one Aside `repl`, parse one JSON envelope, and never invent a second spawn path. This phase does not capture-many, extract, report, cache, or break circuits. It makes those features possible without leaking tabs or lying about completeness.

### 1.2 #23 decision (record now, close in wp7)

Issue #23 asked A (opt-in `browse` host module via `cdpUrl|playwright`) or B (leave codemode file-only; hand the spec to Aside).

**Locked in 000:** A-shaped surface, B-shaped engine. Guest names are `browse.*` / `report.*` host globals. The engine is the already-installed Aside REPL CLI, not Playwright/CDP, not a bundled browser. Pure B ships nothing verifiable in this repo; pure A adds a browser dependency this repo has refused.

Accepted architect A1, A2, A3, A4, A6, A8, A9.
**Amended A5/A7:** process death is not tab death (001 E5). Host kill is last resort and MUST return `partial` plus leaked URLs. The in-script deadline fires first; the host wait is longer by a cleanup slack so `finally` can `closeTab` and the CLI can exit. See §3.3. The 000/001 phrase "host deadline below in-script deadline" is treated as "host kill sits behind the in-script timeout", not as a smaller millisecond value. A smaller host timeout would SIGKILL first and leak tabs, which E5 forbids as the happy path.

### 1.3 #20 closed by this phase

Issue #20 asks for per-step timings (`navigate`, `waitFor`, `snapshot`, `screenshot`, `postprocess`) on the envelope, plus `codemode --doctor --browse` as the capability / bottleneck surface.

wp2 delivers:
- every session result carries enumerable `items[].timings` and a top-level `timings` / `slowest` summary
- `browse.probe()` returns the static matrix
- `--doctor --browse` prints that matrix plus resolver status
- live Aside is never required for unit tests or CI

`postprocess` is 0 in wp2 (wp4 owns image transcode). The field exists so later phases fill it without changing the envelope shape.

---

## 2. Scope

### 2.1 IN

- `src/host/browse/{schema,result,script,session,probe,browse}.js` (NEW)
- argv-only Aside spawn helpers in `src/child-opts.js`
- config keys `asidePath`, `browseCaps`
- `--doctor --browse`
- guest wiring: `browse` and empty `report` through globals, ROOTS, worker freeze, actions catalog, `GUEST_API_DOC`, README tables, example config
- t8: rewrite `test/search-boundary.test.js:46` to a `fork()` ready/go handshake

### 2.2 OUT

- `src/host/browse/pool.js`, `cache.js`, `fetch-first.js`, `adapters.js`, `policy.js`, `extract.js`, `image.js` (wp3–wp6)
- any file under `src/host/report/` (wp5). wp2 only injects `report: {}` so the worker freeze does not throw when wp5 adds methods
- `page.route` / request interception / resource blocking (001 E3: `page.route` absent; `p.on('request')` delivers 0 events). Schema rejects these with `ENOTSUP`
- viewport setting, `screenshot.maxWidth` honouring, JPEG host transcode, PDF MediaBox parser (wp4/wp5)
- `browse.captureMany`, `browse.extract`, `browse.watch`, recipes, cache, circuit breaker
- new npm dependencies, bundled browser, `~/.aside` credentials, live browser in `npm test`
- closing #23

### 2.3 Binding measured constraints (contradicting these is an implementation error)

| ID | Fact | Design consequence |
| --- | --- | --- |
| E1 | argv is `['repl', script]`; script is one argv element | never `shell:true`; never split the script path |
| E1 | stdout ends with `[ok \| Nms]` or `[error \| Nms]`; exit code is 0 even on failure | success = trailing ok-marker AND parsed JSON AND claimed files exist |
| E1 | stderr on `repl` is empty; `created new session:` is exec-mode only | do not parse stderr for session ids |
| E1 | one invocation = one session; ~1.4–2.4s process overhead; 120s cap | batch inside one compiled script; never one process per URL in this phase |
| E3 | `page.route` missing; `p.on('request')` = 0 events | no interception plan, ever |
| E3 | `setViewportSize` missing; `viewportSize({w,h})` returns 1440×900 | viewport options are `ENOTSUP` |
| E4 | `screenshot.maxWidth` silently ignored; only `clip` changes geometry | `maxWidth` is `ENOTSUP` until wp4 post-process |
| E4 | `pdf({format:'A4'})` → MediaBox `0 0 612 792` (US Letter); inches work | `format` is `ENOTSUP`; `paperWidth`/`paperHeight` are inches |
| E4 | ~30s default screenshot timeout inside Aside | per-job timeout must sit below 30000 if it is to bind a screenshot |
| E5 | killing the CLI leaks tabs forever; later sessions cannot close them | cleanup is script `finally`; host kill is last resort + `partial` + leaked URLs |
| E6 | 5 pages in one script: 908ms parallel vs 3397ms sequential | tab pool belongs in the compiled script, not the host (wp4 uses this; wp2 compile must allow N urls) |

---

## 3. File change map

Legend: every path is NEW, MODIFY, or DELETE. No DELETE in wp2.

### 3.1 NEW `src/host/browse/schema.js`

Option SSOT, mirroring `src/search-schema.js:14-253`. Discovery catalog, value rules, and execution validation share one table. Unsupported-but-named options use `code: 'ENOTSUP'` the way `followSymlinks` does at `src/search-schema.js:128-134`.

```js
// src/host/browse/schema.js
export class BrowseOptionError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'BrowseOptionError';
    this.code = code;
  }
}

export const VIEWPORT_UNSUPPORTED =
  'viewport/setViewportSize is not supported: Aside ignores viewport writes and viewportSize() stays {width:1440,height:900} (measured 2026-09-14). Omit viewport; use screenshot.clip for geometry.';
export const MAX_WIDTH_UNSUPPORTED =
  'screenshot.maxWidth is not supported: Aside ignores it and still emits 1440×900 (measured 2026-09-14). Omit maxWidth. clip is honoured. Host-side resize arrives in wp4.';
export const PDF_FORMAT_UNSUPPORTED =
  "pdf.format is not supported: format:'A4' silently yields US Letter MediaBox 0 0 612 792 (measured 2026-09-14). Pass paperWidth/paperHeight in INCHES (A4 = 210/25.4 × 297/25.4).";
export const ROUTE_UNSUPPORTED =
  'resource blocking / page.route / waitForRequest is not supported: page.route does not exist and p.on("request") delivers zero events (measured 2026-09-14).';

function positiveInt(name, v) {
  if (!Number.isSafeInteger(v) || v <= 0) return `${name} must be a positive integer (got ${JSON.stringify(v)})`;
  return null;
}
function nonEmptyString(name, v) {
  if (typeof v !== 'string' || v.length === 0) return `${name} must be a non-empty string (got ${JSON.stringify(v)})`;
  return null;
}
function httpUrl(name, v) {
  const s = nonEmptyString(name, v);
  if (s) return s;
  try {
    const u = new URL(v);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return `${name} must be http(s) (got ${JSON.stringify(v)})`;
  } catch {
    return `${name} must be an absolute http(s) URL (got ${JSON.stringify(v)})`;
  }
  return null;
}

const OPTS = {
  urls: {
    type: 'array',
    required: true,
    description: 'Absolute http(s) URLs to open in ONE repl invocation',
    validate: (v) => {
      if (!Array.isArray(v) || v.length === 0) return 'urls must be a non-empty array';
      if (v.length > 32) return 'urls length exceeds 32 (wp2 cap; wp4 pool raises this via browseCaps.maxTabs)';
      for (const [i, u] of v.entries()) {
        const problem = httpUrl(`urls[${i}]`, u);
        if (problem) return problem;
      }
      return null;
    },
  },
  timeoutMs: {
    type: 'number',
    required: false,
    description: 'In-script deadline in ms. Host wait is this plus CLEANUP_SLACK_MS. Must be < 30000 to bind Aside screenshot timeout.',
    validate: (v) => positiveInt('timeoutMs', v) || (v > 2147483647 ? 'timeoutMs exceeds the timer range' : null),
  },
  snapshot: {
    type: 'boolean',
    required: false,
    description: 'Call snapshot(tab) per URL (default false in wp2)',
  },
  waitUntil: {
    type: 'string',
    required: false,
    description: "page.waitForLoadState value. Only 'load' and 'domcontentloaded' are accepted (waitForNavigation is absent).",
    validate: (v) => (v === 'load' || v === 'domcontentloaded' ? null : "waitUntil must be 'load' or 'domcontentloaded'"),
  },
  screenshot: {
    type: 'object',
    required: false,
    description: 'PNG screenshot via page.screenshot. clip is the only honoured geometry. type jpeg is allowed but quality:20 has a measured 30s CDP timeout.',
    validate: (v) => {
      if (v === null || typeof v !== 'object' || Array.isArray(v)) return 'screenshot must be an object';
      if ('maxWidth' in v) return MAX_WIDTH_UNSUPPORTED;
      if ('viewport' in v) return VIEWPORT_UNSUPPORTED;
      if ('format' in v) return 'screenshot.format is unknown; use type: "png"|"jpeg"';
      if (v.type !== undefined && v.type !== 'png' && v.type !== 'jpeg') return 'screenshot.type must be png or jpeg';
      if (v.quality !== undefined && (!Number.isSafeInteger(v.quality) || v.quality < 0 || v.quality > 100)) {
        return 'screenshot.quality must be an integer 0..100';
      }
      if (v.path !== undefined) {
        const s = nonEmptyString('screenshot.path', v.path);
        if (s) return s;
      }
      if (v.clip !== undefined) {
        const c = v.clip;
        if (!c || typeof c !== 'object') return 'screenshot.clip must be {x,y,width,height}';
        for (const k of ['x', 'y', 'width', 'height']) {
          if (!Number.isFinite(c[k]) || c[k] < 0) return `screenshot.clip.${k} must be a non-negative number`;
        }
        if (c.width === 0 || c.height === 0) return 'screenshot.clip width/height must be > 0';
      }
      return null;
    },
    code: 'ENOTSUP', // used when validate returns MAX_WIDTH_UNSUPPORTED / VIEWPORT_UNSUPPORTED
  },
  pdf: {
    type: 'object',
    required: false,
    description: 'PDF via page.pdf. format is ENOTSUP. paperWidth/paperHeight are required, in INCHES.',
    validate: (v) => {
      if (v === null || typeof v !== 'object' || Array.isArray(v)) return 'pdf must be an object';
      if ('format' in v) return PDF_FORMAT_UNSUPPORTED;
      if (!Number.isFinite(v.paperWidth) || v.paperWidth <= 0) return 'pdf.paperWidth (inches) is required and must be > 0';
      if (!Number.isFinite(v.paperHeight) || v.paperHeight <= 0) return 'pdf.paperHeight (inches) is required and must be > 0';
      if (v.path !== undefined) {
        const s = nonEmptyString('pdf.path', v.path);
        if (s) return s;
      }
      return null;
    },
    code: 'ENOTSUP',
  },
  viewport: {
    type: 'object',
    required: false,
    description: 'Rejected. Aside viewport is not settable.',
    validate: () => VIEWPORT_UNSUPPORTED,
    code: 'ENOTSUP',
  },
  maxWidth: {
    type: 'number',
    required: false,
    description: 'Rejected. Silently ignored by Aside screenshots.',
    validate: () => MAX_WIDTH_UNSUPPORTED,
    code: 'ENOTSUP',
  },
  blockResources: {
    type: 'boolean',
    required: false,
    description: 'Rejected. page.route does not exist.',
    validate: () => ROUTE_UNSUPPORTED,
    code: 'ENOTSUP',
  },
  route: {
    type: 'boolean',
    required: false,
    description: 'Rejected. page.route does not exist.',
    validate: () => ROUTE_UNSUPPORTED,
    code: 'ENOTSUP',
  },
};

const EXEC_ORDER = ['urls', 'timeoutMs', 'waitUntil', 'snapshot', 'screenshot', 'pdf', 'viewport', 'maxWidth', 'blockResources', 'route'];

function inputsFor(order) {
  const out = {};
  for (const name of order) {
    const spec = OPTS[name];
    out[name] = { type: spec.type, required: !!spec.required, description: spec.description };
  }
  return out;
}

export const BROWSE_ACTIONS = [
  {
    path: 'browse.exec',
    description: 'Run one Aside repl job: open urls in one session, optional snapshot/screenshot/pdf, always close tabs in finally.',
    signature: 'browse.exec({ urls, timeoutMs?, waitUntil?, snapshot?, screenshot?, pdf? }) => Promise<BrowseEnvelope>',
    notes: 'Plain enumerable object (not the search toJSON lane). complete/truncated/partial describe the batch. Killing the CLI leaks tabs; a kill is reported as partial plus leakedUrls. viewport, maxWidth, pdf.format, blockResources, route are ENOTSUP.',
    inputs: inputsFor(EXEC_ORDER),
  },
  {
    path: 'browse.probe',
    description: 'Return the static Aside capability matrix used by --doctor --browse. Does not spawn a browser unless CODEMODE_BROWSE_LIVE=1.',
    signature: 'browse.probe() => Promise<BrowseCaps>',
    notes: 'Static by default. Live probe is an explicit env flag and is never on in CI.',
    inputs: {},
  },
];

export const EXEC_OPTS = new Set(EXEC_ORDER);
export const OPT_SETS = { 'browse.exec': EXEC_OPTS, 'browse.probe': new Set() };

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

export function checkBrowseOptionValue(name, value) {
  const spec = OPTS[name];
  if (!spec) return { name, code: 'EBADOPT', message: `unknown option ${JSON.stringify(name)}` };
  if (name === 'screenshot' || name === 'pdf') {
    const problem = spec.validate(value);
    if (problem) {
      const code = (problem === MAX_WIDTH_UNSUPPORTED || problem === VIEWPORT_UNSUPPORTED || problem === PDF_FORMAT_UNSUPPORTED || problem === ROUTE_UNSUPPORTED)
        ? 'ENOTSUP' : 'EBADVAL';
      return { name, code, message: problem };
    }
    return null;
  }
  if (typeOf(value) !== spec.type) {
    return { name, code: 'EBADVAL', message: `${name} must be a ${spec.type} (got ${typeOf(value)})` };
  }
  const problem = spec.validate ? spec.validate(value) : null;
  if (problem) return { name, code: spec.code ?? 'EBADVAL', message: problem };
  return null;
}

export function validateBrowseJob(fn, opts) {
  const allowed = OPT_SETS[fn];
  if (!allowed) throw new Error(`validateBrowseJob: unknown entry point ${fn}`);
  if (fn === 'browse.probe') {
    if (opts != null && (typeof opts !== 'object' || Array.isArray(opts) || Object.keys(opts).length)) {
      throw new BrowseOptionError('browse.probe takes no options', 'EBADOPT');
    }
    return {};
  }
  if (opts === null || typeof opts !== 'object' || Array.isArray(opts)) {
    throw new BrowseOptionError(`${fn}: options must be an object`, 'EBADVAL');
  }
  const bad = Object.keys(opts).filter((k) => !allowed.has(k));
  if (bad.length) {
    throw new BrowseOptionError(
      `${fn}: unknown option(s) ${bad.map((b) => JSON.stringify(b)).join(', ')}. valid: ${[...allowed].join(', ')}`,
      'EBADOPT',
    );
  }
  for (const name of allowed) {
    const spec = OPTS[name];
    const present = name in opts && opts[name] !== undefined;
    if (!present) {
      if (spec.required) throw new BrowseOptionError(`${fn}: ${name} is required`, 'EBADVAL');
      continue;
    }
    const problem = checkBrowseOptionValue(name, opts[name]);
    if (problem) throw new BrowseOptionError(`${fn}: ${problem.message}`, problem.code);
  }
  return opts;
}

export { OPTS };
```

checkBrowseOptionValue for `screenshot`/`pdf` skips the outer typeOf-then-validate split used by search because those objects have nested ENOTSUP keys. `actions.check` must call this helper for `browse.*` paths (see §3.10).

---

### 3.2 NEW `src/host/browse/result.js`

Plain enumerable envelope. Must NOT grow a `toJSON` / `restoreSearchResult` lane. `src/sandbox.js:110-112` only special-cases `search.*` and `fs.grepFile`. Browse metadata lives on enumerable fields so structured clone and `stringifyResult` keep it, and so `fitEnvelope` trimming cannot drop per-item failures that exist only in logs (002).

```js
// src/host/browse/result.js
export const STEP_NAMES = ['navigate', 'waitFor', 'snapshot', 'screenshot', 'postprocess'];

export function emptyTimings() {
  return { navigate: 0, waitFor: 0, snapshot: 0, screenshot: 0, postprocess: 0 };
}

export function buildItem({ url, ok, error = null, timings = emptyTimings(), scope, path = null, bytes = null }) {
  return {
    url,
    ok: ok === true,
    error,
    timings: { ...emptyTimings(), ...timings },
    scope: {
      requested: scope?.requested ?? {},
      actual: scope?.actual ?? {},
    },
    path,
    bytes,
  };
}

export function summariseTimings(items) {
  const rows = [];
  for (const item of items) {
    for (const step of STEP_NAMES) {
      const ms = item.timings?.[step] ?? 0;
      if (ms > 0) rows.push({ url: item.url, step, ms });
    }
  }
  rows.sort((a, b) => b.ms - a.ms);
  return { timings: rows, slowest: rows.slice(0, 5) };
}

export function buildEnvelope({ items, leakedUrls = [], truncated = false, killed = false, warnings = [] }) {
  const list = Array.isArray(items) ? items : [];
  const { timings, slowest } = summariseTimings(list);
  const partial = [...warnings];
  if (killed) partial.push('process killed; Aside tabs opened by this job may remain open (no later session can close them)');
  if (leakedUrls.length) partial.push(`leakedUrls: ${leakedUrls.join(', ')}`);
  const anyFail = list.some((i) => !i.ok);
  const complete = !truncated && !killed && !anyFail && partial.length === 0;
  return {
    items: list,
    timings,
    slowest,
    complete,
    truncated: truncated === true,
    partial,
    leakedUrls: [...leakedUrls],
    status: killed || leakedUrls.length ? 'partial' : truncated ? 'truncated' : complete ? 'complete' : 'partial',
    scope: {
      requested: list[0]?.scope?.requested ?? {},
      actual: list[0]?.scope?.actual ?? {},
    },
  };
}
```

`partial` is a string[] (search convention at `src/search-result.js:32-35`), not a boolean. `status` is a derived convenience for doctor/humans. Per-item failures stay inside `items[]`.

---

### 3.3 NEW `src/host/browse/script.js`

Compiles a validated job into REPL source. The source `console.log`s exactly one JSON object and always closes opened tabs in `finally`. No request interception. No `setViewportSize`. No `screenshot.maxWidth`. No `pdf({format})`.

Host injects numeric constants; the compiled source must not read `process` (Aside repl has it, but we do not rely on it).

```js
// src/host/browse/script.js
export const ASIDE_REPL_HARD_CAP_MS = 120_000;
export const CLEANUP_SLACK_MS = 1_500;
export const HOST_KILL_SLACK_MS = 500;
export const SCREENSHOT_BIND_MS = 30_000;

export function deadlineMath(requestedMs, hardCapMs = ASIDE_REPL_HARD_CAP_MS) {
  const req = requestedMs ?? 30_000;
  const innerCeiling = hardCapMs - CLEANUP_SLACK_MS - HOST_KILL_SLACK_MS;
  const innerDeadlineMs = Math.max(1, Math.min(req, innerCeiling));
  const hostDeadlineMs = innerDeadlineMs + CLEANUP_SLACK_MS;
  return { innerDeadlineMs, hostDeadlineMs, hardCapMs };
}

export function compileBrowseScript(job, { innerDeadlineMs }) {
  // job is already validateBrowseJob('browse.exec', job)
  const payload = JSON.stringify({
    urls: job.urls,
    waitUntil: job.waitUntil ?? 'load',
    snapshot: job.snapshot === true,
    screenshot: job.screenshot ?? null,
    pdf: job.pdf ?? null,
    innerDeadlineMs,
  });
  return `"use strict";
const JOB = ${payload};
const opened = [];
function elapsed(t0) { return Date.now() - t0; }
function failItem(url, error, timings, scope) {
  return { url, ok: false, error: String(error && error.message ? error.message : error), timings, scope, path: null, bytes: null };
}
async function one(url) {
  const timings = { navigate: 0, waitFor: 0, snapshot: 0, screenshot: 0, postprocess: 0 };
  const requested = {
    viewport: null,
    clip: JOB.screenshot && JOB.screenshot.clip ? JOB.screenshot.clip : null,
    screenshotType: JOB.screenshot ? (JOB.screenshot.type || 'png') : null,
    pdfPaper: JOB.pdf ? { paperWidth: JOB.pdf.paperWidth, paperHeight: JOB.pdf.paperHeight } : null,
  };
  const actual = { viewport: null, screenshot: null, pdf: null };
  const scope = { requested, actual };
  let tab;
  try {
    let t0 = Date.now();
    // E7 (003): openTab RETURNS the page. There is no tab.page and no tab.id;
    // identity is page.targetId. Register the promise before awaiting it (003 C5.2).
    const pagePromise = openTab(url);
    pending.push(pagePromise);
    const page = await pagePromise;
    opened.push({ targetId: page && page.targetId, url, page });
    timings.navigate = elapsed(t0);
    t0 = Date.now();
    if (page && typeof page.waitForLoadState === 'function') {
      await page.waitForLoadState(JOB.waitUntil);
    }
    timings.waitFor = elapsed(t0);
    if (page && typeof page.viewportSize === 'function') actual.viewport = page.viewportSize();
    if (JOB.snapshot && typeof snapshot === 'function') {
      t0 = Date.now();
      await snapshot(tab); // E7: snapshot rejects a string id
      timings.snapshot = elapsed(t0);
    }
    let shotPath = null, shotBytes = null;
    if (JOB.screenshot && page && typeof page.screenshot === 'function') {
      t0 = Date.now();
      const opts = { type: JOB.screenshot.type || 'png' };
      if (JOB.screenshot.clip) opts.clip = JOB.screenshot.clip;
      if (JOB.screenshot.quality != null && opts.type === 'jpeg') opts.quality = JOB.screenshot.quality;
      if (JOB.screenshot.path) opts.path = JOB.screenshot.path;
      const buf = await page.screenshot(opts);
      timings.screenshot = elapsed(t0);
      shotPath = JOB.screenshot.path || null;
      shotBytes = buf && buf.length != null ? buf.length : null;
      actual.screenshot = { bytes: shotBytes, clipHonoured: !!opts.clip };
    }
    let pdfPath = null, pdfBytes = null;
    if (JOB.pdf && page && typeof page.pdf === 'function') {
      t0 = Date.now();
      const buf = await page.pdf({ paperWidth: JOB.pdf.paperWidth, paperHeight: JOB.pdf.paperHeight, path: JOB.pdf.path });
      timings.screenshot = timings.screenshot; // pdf is not a screenshot step
      const pdfMs = elapsed(t0);
      timings.postprocess = 0;
      pdfPath = JOB.pdf.path || null;
      pdfBytes = buf && buf.length != null ? buf.length : null;
      actual.pdf = { bytes: pdfBytes, paperWidth: JOB.pdf.paperWidth, paperHeight: JOB.pdf.paperHeight };
      return { url, ok: true, error: null, timings: { ...timings, waitFor: timings.waitFor }, scope, path: pdfPath || shotPath, bytes: pdfBytes || shotBytes, pdfMs };
    }
    return { url, ok: true, error: null, timings, scope, path: shotPath, bytes: shotBytes };
  } catch (e) {
    return failItem(url, e, timings, scope);
  }
}
async function main() {
  const items = await Promise.all(JOB.urls.map(one));
  const leakedUrls = [];
  return { items, leakedUrls, innerOk: true };
}
async function run() {
  let payload;
  try {
    payload = await Promise.race([
      main(),
      new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error('inner deadline ' + JOB.innerDeadlineMs + 'ms'), { code: 'ETIMEOUT' })), JOB.innerDeadlineMs)),
    ]);
  } catch (e) {
    payload = {
      items: [],
      leakedUrls: opened.map(t => t.url),
      innerOk: false,
      error: String(e && e.message ? e.message : e),
    };
  } finally {
    for (const t of opened) {
      try { await t.page.close(); } catch (_) {}
    }
  }
  console.log(JSON.stringify(payload));
}
run();
`;
}
```

Fix the pdf timing in the real implementation: add `timings.pdf` is OUT (envelope steps are the five #20 names). Count PDF work under `screenshot` only if no screenshot ran; otherwise keep pdf duration in `postprocess` for wp2 (host-side pdf MediaBox verify is wp5; wp2 has no postprocess). **Locked:** PDF duration is recorded as `timings.screenshot` when `screenshot` was not requested, else as a sixth item-level field `pdfMs` that `result.js` does not promote. Simpler locked rule: **PDF duration goes into `timings.snapshot` if snapshot was false and screenshot was false; otherwise attach `pdfMs` on the item and leave the five steps as specified.** Cleanest locked rule for implementers:

**Locked PDF timing:** if `job.pdf` is set, put the `page.pdf` duration in `timings.screenshot` when `job.screenshot` is absent, otherwise in `timings.postprocess` (wp2 placeholder meaning "other capture work"). Do not add a sixth step name.

Remove the dead `timings.screenshot = timings.screenshot` line when implementing. The skeleton above is the control flow; implementers must emit the locked PDF timing rule and keep `finally { closeTab }` around both success and inner-timeout.

**Inner timer vs Aside `sleep`:** E3 lists `waitForTimeout` as absent. The compiled source may use Aside's `sleep` global (E2) OR `setTimeout`. Prefer `setTimeout` for the inner race so a missing `sleep` does not hang past the host wait.

**Always log JSON:** both success and catch paths `console.log` one object. Host marker parsing looks at the last JSON object before the `[ok|error]` marker.

---

### 3.4 NEW `src/host/browse/session.js`

Single execution contract. Mirrors `createRgResolver` in `src/rg.js:61-110` and spawn injection in `src/child-opts.js:13-27`.

```js
// src/host/browse/session.js
import { existsSync } from 'node:fs';
import { mkdtempSync, writeFileSync, rmSync, statSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileAside, spawnAside } from '../../child-opts.js';
import { compileBrowseScript, deadlineMath, ASIDE_REPL_HARD_CAP_MS } from './script.js';
import { buildEnvelope, buildItem } from './result.js';
import { validateBrowseJob } from './schema.js';

const isWindows = process.platform === 'win32';
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const MARKER_RE = /\[(ok|error)\s*\|\s*(\d+)ms\]\s*$/;

export class AsideNotFoundError extends Error {
  constructor() {
    super('Aside CLI not found: install Aside or set CODEMODE_ASIDE / asidePath');
    this.name = 'AsideNotFoundError';
    this.code = 'EASIDE404';
    this.hint = 'install Aside or set CODEMODE_ASIDE';
  }
}

export class AsideFailedError extends Error {
  constructor(message, extra = {}) {
    super(message);
    this.name = 'AsideFailedError';
    this.code = extra.code || 'EASIDEFAIL';
    if (extra.leakedUrls) this.leakedUrls = extra.leakedUrls;
    if (extra.envelope) this.envelope = extra.envelope;
  }
}

function pathCandidates(env) {
  const out = [];
  const pathEnv = env.PATH ?? env.Path ?? '';
  const names = isWindows ? ['aside.exe', 'aside'] : ['aside'];
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue;
    for (const name of names) out.push(path.join(dir, name));
  }
  const local = env.LOCALAPPDATA;
  if (isWindows && local) out.push(path.join(local, 'Aside', 'CLI', 'current', 'aside.exe'));
  return out;
}

async function whereAside(execFileAsideImpl, signal) {
  if (!isWindows) return null;
  try {
    const { stdout } = await execFileAsideImpl('where.exe', ['aside'], { timeout: 5000, signal, killSignal: 'SIGKILL' });
    const first = stdout.split(/\r?\n/).map((s) => s.trim()).find(Boolean);
    if (!first) return null;
    if (/\.(bat|cmd)$/i.test(first)) return null; // same EINVAL trap as rg.js:33-34
    return first;
  } catch {
    return null;
  }
}

export function createAsideResolver(config, env = process.env, {
  signal,
  exists = existsSync,
  execFileAsideImpl = execFileAside,
} = {}) {
  let cached = null;
  return async function resolveAside() {
    signal?.throwIfAborted();
    if (cached) return cached;
    const explicit = config.asidePath || env.CODEMODE_ASIDE;
    if (explicit) {
      const abs = path.isAbsolute(explicit) ? explicit : path.resolve(repoRoot, explicit);
      if (!exists(abs)) throw new AsideNotFoundError();
      try {
        await execFileAsideImpl(abs, ['--version'], { timeout: 5000, signal, killSignal: 'SIGKILL' }, env);
        return (cached = abs);
      } catch (e) {
        signal?.throwIfAborted();
        const err = new AsideNotFoundError();
        err.candidates = [`${abs}: ${e.code ?? e.message}`];
        throw err;
      }
    }
    const candidates = [
      ...pathCandidates(env),
      await whereAside(execFileAsideImpl, signal),
    ].filter(Boolean);
    const failures = [];
    for (const cand of candidates) {
      signal?.throwIfAborted();
      try {
        await execFileAsideImpl(cand, ['--version'], { timeout: 5000, signal, killSignal: 'SIGKILL' }, env);
        return (cached = cand);
      } catch (e) {
        signal?.throwIfAborted();
        failures.push(`${cand}: ${e.code ?? e.message}`);
      }
    }
    const err = new AsideNotFoundError();
    err.candidates = failures.slice(0, 12);
    throw err;
  };
}

function parseMarkerAndJson(stdout) {
  const text = String(stdout || '');
  const lines = text.split(/\r?\n/);
  let marker = null;
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = MARKER_RE.exec(lines[i].trim());
    if (m) {
      marker = { ok: m[1] === 'ok', ms: Number(m[2]), raw: lines[i] };
      break;
    }
  }
  let json = null;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line.startsWith('{')) continue;
    try { json = JSON.parse(line); break; } catch { /* keep looking */ }
  }
  return { marker, json, text };
}

function inspectClaimed(item, statImpl, existsImpl) {
  if (!item || !item.path) return item;
  if (!existsImpl(item.path)) {
    return { ...item, ok: false, error: `claimed file missing: ${item.path}` };
  }
  const st = statImpl(item.path);
  if (!st.isFile() || st.size <= 0) {
    return { ...item, ok: false, error: `claimed file empty: ${item.path}` };
  }
  return { ...item, bytes: item.bytes ?? st.size };
}

export function createBrowseSession({
  config,
  env = process.env,
  signal,
  resolveAside,
  spawnAsideImpl = spawnAside,
  existsImpl = existsSync,
  statImpl = statSync,
  writeFileImpl = writeFileSync,
  mkdtempImpl = mkdtempSync,
  rmImpl = rmSync,
  tmpdirImpl = os.tmpdir,
  deadlines,
} = {}) {
  const resolver = resolveAside || createAsideResolver(config, env, { signal, exists: existsImpl });
  return {
    async run(rawJob) {
      const job = validateBrowseJob('browse.exec', rawJob);
      if (config?.browseCaps?.enabled === false) {
        const err = new Error('browse is disabled (browseCaps.enabled=false)');
        err.code = 'EDISABLED';
        throw err;
      }
      const requested = job.timeoutMs ?? config.browseCaps?.timeoutMs ?? 30_000;
      const { innerDeadlineMs, hostDeadlineMs } = deadlines || deadlineMath(requested);
      const bin = await resolver();
      const dir = mkdtempImpl(path.join(tmpdirImpl(), 'codemode-browse-'));
      const scriptPath = path.join(dir, 'job.js');
      writeFileImpl(scriptPath, compileBrowseScript(job, { innerDeadlineMs }));
      let child;
      let stdout = '';
      let stderr = '';
      let killed = false;
      let exitCode = null;
      const spawnArgs = ['repl', scriptPath];
      try {
        if (signal?.aborted) {
          return buildEnvelope({ items: [], leakedUrls: job.urls, killed: true, warnings: ['search cancelled before spawn'] });
        }
        child = spawnAsideImpl(bin, spawnArgs, { stdio: ['ignore', 'pipe', 'pipe'] }, env);
        if (!child || !child.stdout) throw new AsideFailedError('aside spawn returned no stdout pipe');
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', (c) => { stdout += c; });
        child.stderr.on('data', (c) => { stderr += c; });
        const result = await new Promise((resolve) => {
          let settled = false;
          const finish = (extra) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            signal?.removeEventListener('abort', onAbort);
            resolve(extra);
          };
          const onAbort = () => {
            killed = true;
            try { child.kill('SIGKILL'); } catch {}
            finish({ killed: true, why: 'abort' });
          };
          const timer = setTimeout(() => {
            killed = true;
            try { child.kill('SIGKILL'); } catch {}
            finish({ killed: true, why: 'host-deadline' });
          }, hostDeadlineMs);
          signal?.addEventListener('abort', onAbort, { once: true });
          child.on('error', (e) => finish({ spawnError: e }));
          child.on('close', (code) => { exitCode = code; finish({ exitCode: code }); });
        });
        const parsed = parseMarkerAndJson(stdout);
        const leakedFromKill = result.killed ? job.urls : (parsed.json?.leakedUrls ?? []);
        if (result.spawnError) {
          return buildEnvelope({
            items: job.urls.map((url) => buildItem({ url, ok: false, error: result.spawnError.message })),
            leakedUrls: [],
            warnings: [String(result.spawnError.message)],
          });
        }
        // Exit code is NOT a success signal (E1). Marker + JSON + files are.
        const markerOk = parsed.marker && parsed.marker.ok === true;
        const rawItems = Array.isArray(parsed.json?.items) ? parsed.json.items : [];
        const items = rawItems.map((it) => inspectClaimed(it, statImpl, existsImpl));
        const warnings = [];
        if (!parsed.marker) warnings.push('missing [ok|error | Nms] marker');
        if (parsed.marker && !parsed.marker.ok) warnings.push('Aside marker is [error]');
        if (!parsed.json) warnings.push('no JSON object on stdout');
        if (parsed.json?.error) warnings.push(String(parsed.json.error));
        return buildEnvelope({
          items: items.length ? items : job.urls.map((url) => buildItem({ url, ok: false, error: warnings.join('; ') || 'no items' })),
          leakedUrls: leakedFromKill,
          truncated: false,
          killed: result.killed === true,
          warnings,
        });
      } finally {
        try { rmImpl(dir, { recursive: true, force: true }); } catch {}
      }
    },
  };
}
```

**Spawn argv lock:** `spawnAsideImpl(bin, ['repl', scriptPath], extra, env)` only. Tests assert `args` deepEqual that pair.

**Cancel lock:** abort and host-deadline both SIGKILL, then envelope `status:'partial'`, `leakedUrls: job.urls`, warning about permanent leaks. Do not pretend tabs closed.

**Success lock:** `marker.ok === true` AND JSON parsed AND every claimed `path` exists and size>0. CLI exit 0 is ignored (do not even branch on it except to record).

**Injection lock:** tests pass `spawnAsideImpl`, `execFileAsideImpl`, `existsImpl`. `npm test` never launches Aside or a browser.

---

### 3.5 NEW `src/host/browse/probe.js`

Static matrix from 001. No I/O unless `CODEMODE_BROWSE_LIVE=1`.

```js
// src/host/browse/probe.js
export const ASIDE_CAPS = Object.freeze({
  measuredAt: '2026-09-14',
  cliVersion: '1.26.906.1630',
  engine: 'aside-repl',
  decision: 'A-shaped surface, B-shaped engine',
  page: Object.freeze({
    present: Object.freeze(['goto','title','content','url','screenshot','pdf','evaluate','locator','click','fill','waitForSelector','waitForLoadState','close','reload','goBack','goForward','frames','mainFrame','viewportSize','on','bringToFront','video','keyboard','mouse']),
    absent: Object.freeze(['route','unroute','setViewportSize','emulateMedia','waitForFunction','waitForTimeout','waitForNavigation','waitForRequest','waitForResponse','cookies','boundingBox','textContent','innerText','getAttribute','isVisible','setContent','addStyleTag','addScriptTag','setDefaultTimeout','exposeFunction','isClosed','accessibility','press','focus','hover','selectOption']),
  }),
  screenshot: Object.freeze({
    maxWidthHonoured: false,
    clipHonoured: true,
    viewportSettable: false,
    defaultViewport: Object.freeze({ width: 1440, height: 900 }),
    jpegQuality20Unreliable: true,
    defaultTimeoutMs: 30_000,
  }),
  pdf: Object.freeze({
    formatA4Honoured: false,
    paperInchesHonoured: true,
    letterMediaBox: Object.freeze([0, 0, 612, 792]),
    a4MediaBox: Object.freeze([0, 0, 595.92, 841.92]),
  }),
  network: Object.freeze({ pageRoute: false, requestEvents: false }),
  session: Object.freeze({
    argv: Object.freeze(['repl', '<script>']),
    oneReplOneSession: true,
    hardCapMs: 120_000,
    killLeaksTabs: true,
    exitCodeUnreliable: true,
    processOverheadMs: Object.freeze({ min: 1400, max: 2400 }),
  }),
  guest: Object.freeze({
    functions: Object.freeze(['openTab','closeTab','snapshot','attachBrowserTab','listBrowserTabs','sleep','fetch']),
    undefined: Object.freeze(['passwordManager','download']),
  }),
});

export function probeCaps({ live = false } = {}) {
  return { ...ASIDE_CAPS, live: live === true, liveDrift: null };
}
```

Live probe (only when `env.CODEMODE_BROWSE_LIVE === '1'` AND a session factory is passed) may later diff `typeof page.route`. wp2 doctor does not turn this on. CI must not set the flag.

---

### 3.6 NEW `src/host/browse/browse.js`

```js
// src/host/browse/browse.js
import { createBrowseSession, createAsideResolver } from './session.js';
import { probeCaps } from './probe.js';
import { validateBrowseJob } from './schema.js';

export function createBrowse({ config, env = process.env, signal, session } = {}) {
  const resolveAside = createAsideResolver(config, env, { signal });
  const sess = session || createBrowseSession({ config, env, signal, resolveAside });
  return Object.freeze({
    async probe() {
      validateBrowseJob('browse.probe', {});
      return probeCaps({ live: env.CODEMODE_BROWSE_LIVE === '1' });
    },
    async exec(job) {
      return sess.run(job);
    },
  });
}
```

No `index.js` barrel (002). Callers import this file.

---

### 3.7 MODIFY `src/child-opts.js`

Current entire file (`src/child-opts.js:1-29`):

```js
// Shared child_process options for rg (issue #5).
// Aside's Windows shell can die with 0xC0000142 when windowsHide is true.
// Default: omit the key. Opt-in only when CODEMODE_WINDOWS_HIDE === '1'.
// Never set shell. Extra is copied, not mutated.
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

After-state (keep `rgChildOpts` / `createRgProcessFns` byte-for-byte behaviour; add an Aside twin that reuses the same hide/no-shell rule):

```js
// Shared child_process options for rg (issue #5) and Aside repl (browse wp2).
// Aside's Windows shell can die with 0xC0000142 when windowsHide is true.
// Default: omit the key. Opt-in only when CODEMODE_WINDOWS_HIDE === '1'.
// Never set shell. Extra is copied, not mutated.
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

export function createAsideProcessFns({ spawnImpl = spawn, execFileImpl = execFile } = {}) {
  return {
    spawnAside(bin, args, extra = {}, env = process.env) {
      return spawnImpl(bin, args, rgChildOpts(extra, env));
    },
    execFileAside(bin, args, extra = {}, env = process.env) {
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
export const { spawnAside, execFileAside } = createAsideProcessFns();
```

Do not call `spawn` / `execFile` from `session.js`. A source lock test (copy `test/windows-hide.test.js:66-74`) reads `session.js` and asserts it matches `spawnAside` / `execFileAside` and does not match `\bspawn\s*\(` or `shell:\s*true`.

---

### 3.8 MODIFY `src/config.js`

Current `DEFAULTS` at `src/config.js:29-36`:

```js
const DEFAULTS = {
  roots: [],
  rgPath: null,
  maxResultBytes: 65536,
  maxTimeoutMs: 120000,
  searchCaps: { files: 5000, content: 500 },
  excludeGlobs: DEFAULT_EXCLUDES,
};
```

After:

```js
const DEFAULTS = {
  roots: [],
  rgPath: null,
  asidePath: null,
  maxResultBytes: 65536,
  maxTimeoutMs: 120000,
  searchCaps: { files: 5000, content: 500 },
  // Superseded by 003 C3: opt-in by default, inner cap 25000 (below Aside's ~30s
  // internal screenshot timeout), and wp3/wp4 keys live in the SAME object.
  browseCaps: {
    enabled: false, timeoutMs: 25000, maxTabs: 8, concurrency: 4,
    navigateTimeoutMs: 15000, maxNavigateTimeoutMs: 25000,
    breakerFailures: 3, breakerCooldownMs: 30000, domainTimeouts: {},
  },
  excludeGlobs: DEFAULT_EXCLUDES,
};
```

Current `apply()` rgPath copy at `src/config.js:103-112`:

```js
    if ('rgPath' in obj && (typeof obj.rgPath === 'string' || obj.rgPath === null)) {
      cfg.rgPath = obj.rgPath;
    }
    if (Array.isArray(obj.excludeGlobs)) cfg.excludeGlobs = obj.excludeGlobs.filter((g) => typeof g === 'string');
    if ('maxResultBytes' in obj) cfg.maxResultBytes = requireInteger('maxResultBytes', obj.maxResultBytes, MIN_OUTPUT_BYTES, MAX_OUTPUT_BYTES);
    if ('maxTimeoutMs' in obj) cfg.maxTimeoutMs = requireInteger('maxTimeoutMs', obj.maxTimeoutMs);
    if (obj.searchCaps && typeof obj.searchCaps === 'object') {
      if ('files' in obj.searchCaps) cfg.searchCaps.files = requireInteger('searchCaps.files', obj.searchCaps.files);
      if ('content' in obj.searchCaps) cfg.searchCaps.content = requireInteger('searchCaps.content', obj.searchCaps.content);
    }
```

After (insert asidePath next to rgPath; copy browseCaps field-wise like searchCaps):

```js
    if ('rgPath' in obj && (typeof obj.rgPath === 'string' || obj.rgPath === null)) {
      cfg.rgPath = obj.rgPath;
    }
    if ('asidePath' in obj && (typeof obj.asidePath === 'string' || obj.asidePath === null)) {
      cfg.asidePath = obj.asidePath;
    }
    if (Array.isArray(obj.excludeGlobs)) cfg.excludeGlobs = obj.excludeGlobs.filter((g) => typeof g === 'string');
    if ('maxResultBytes' in obj) cfg.maxResultBytes = requireInteger('maxResultBytes', obj.maxResultBytes, MIN_OUTPUT_BYTES, MAX_OUTPUT_BYTES);
    if ('maxTimeoutMs' in obj) cfg.maxTimeoutMs = requireInteger('maxTimeoutMs', obj.maxTimeoutMs);
    if (obj.searchCaps && typeof obj.searchCaps === 'object') {
      if ('files' in obj.searchCaps) cfg.searchCaps.files = requireInteger('searchCaps.files', obj.searchCaps.files);
      if ('content' in obj.searchCaps) cfg.searchCaps.content = requireInteger('searchCaps.content', obj.searchCaps.content);
    }
    if (obj.browseCaps && typeof obj.browseCaps === 'object') {
      if ('enabled' in obj.browseCaps) cfg.browseCaps.enabled = obj.browseCaps.enabled === true;
      if ('timeoutMs' in obj.browseCaps) cfg.browseCaps.timeoutMs = requireInteger('browseCaps.timeoutMs', obj.browseCaps.timeoutMs);
      if ('maxTabs' in obj.browseCaps) cfg.browseCaps.maxTabs = requireInteger('browseCaps.maxTabs', obj.browseCaps.maxTabs);
    }
```

Current env overrides at `src/config.js:125`:

```js
  if (env.CODEMODE_RG) cfg.rgPath = env.CODEMODE_RG;
```

After:

```js
  if (env.CODEMODE_RG) cfg.rgPath = env.CODEMODE_RG;
  if (env.CODEMODE_ASIDE) cfg.asidePath = env.CODEMODE_ASIDE;
  if (env.CODEMODE_BROWSE_ENABLED !== undefined) {
    cfg.browseCaps.enabled = env.CODEMODE_BROWSE_ENABLED === '1' || env.CODEMODE_BROWSE_ENABLED === 'true';
  }
  if (env.CODEMODE_BROWSE_TIMEOUT_MS !== undefined) {
    cfg.browseCaps.timeoutMs = requireInteger('CODEMODE_BROWSE_TIMEOUT_MS', Number(env.CODEMODE_BROWSE_TIMEOUT_MS));
  }
```

No nested env (002). Unknown top-level JSON keys stay ignored. `asidePath: null` must clear an inherited string (same bug class as `rgPath` at `src/config.js:99-102`).

---

### 3.9 MODIFY `src/host/globals.js`

Current `src/host/globals.js:1-20`:

```js
import { createRgResolver, createRgRunner } from '../rg.js';
import { createSearch } from './search.js';
import { createFs } from './fs.js';
import { createApplyPatch } from './patch.js';
import { createActions } from './actions.js';

export function createHostGlobals(config, assertInside, signal) {
  const rgRunner = createRgRunner(createRgResolver(config, process.env, { signal }), { excludeGlobs: config.excludeGlobs, signal });
  const hostFs = createFs({ assertInside, signal });
  return {
    search: createSearch({ rgRunner, assertInside, caps: config.searchCaps }),
    fs: hostFs,
    read_file: hostFs.read_file,
    write_file: hostFs.write_file,
    edit_file: hostFs.edit_file,
    apply_patch: createApplyPatch({ write_file: hostFs.write_file, edit_file: hostFs.edit_file }),
    actions: createActions(),
  };
}
```

After:

```js
import { createRgResolver, createRgRunner } from '../rg.js';
import { createSearch } from './search.js';
import { createFs } from './fs.js';
import { createApplyPatch } from './patch.js';
import { createActions } from './actions.js';
import { createBrowse } from './browse/browse.js';

export function createHostGlobals(config, assertInside, signal) {
  const rgRunner = createRgRunner(createRgResolver(config, process.env, { signal }), { excludeGlobs: config.excludeGlobs, signal });
  const hostFs = createFs({ assertInside, signal });
  return {
    search: createSearch({ rgRunner, assertInside, caps: config.searchCaps }),
    fs: hostFs,
    read_file: hostFs.read_file,
    write_file: hostFs.write_file,
    edit_file: hostFs.edit_file,
    apply_patch: createApplyPatch({ write_file: hostFs.write_file, edit_file: hostFs.edit_file }),
    browse: createBrowse({ config, env: process.env, signal }),
    report: Object.freeze({}),
    actions: createActions(),
  };
}
```

`signal` is already passed into the factory (`src/sandbox.js:34`). Browse must honour it in `session.run`. `report` is an empty frozen object so wp5 can replace the factory later without a second ROOTS change.

---

### 3.10 MODIFY `src/sandbox.js`

Current `src/sandbox.js:7`:

```js
const ROOTS = ['search', 'fs', 'actions', 'read_file', 'write_file', 'edit_file', 'apply_patch'];
```

After:

```js
const ROOTS = ['search', 'fs', 'actions', 'read_file', 'write_file', 'edit_file', 'apply_patch', 'browse', 'report'];
```

`hostMethods` (`src/sandbox.js:9-20`) walks one level. `browse.exec` registers as `browse.exec`. Nested `browse.tab.open` cannot register — do not design such a path.

Do **not** add a `msg.browse` special clone lane next to `src/sandbox.js:110-112`. Browse envelopes are plain enumerable objects.

---

### 3.11 MODIFY `src/execution-worker.js`

Current `src/execution-worker.js:50-56`:

```js
const injected = { search: {}, fs: {}, actions: {} };
for (const name of manifest) {
  const [root, method] = name.split('.');
  if (method) injected[root][method] = (...args) => root === 'actions' ? syncRpc(name, args) : rpc(name, args);
  else injected[root] = (...args) => rpc(name, args);
}
for (const key of ['search', 'fs', 'actions']) Object.freeze(injected[key]);
```

After:

```js
const injected = { search: {}, fs: {}, actions: {}, browse: {}, report: {} };
for (const name of manifest) {
  const [root, method] = name.split('.');
  if (method) injected[root][method] = (...args) => root === 'actions' ? syncRpc(name, args) : rpc(name, args);
  else injected[root] = (...args) => rpc(name, args);
}
for (const key of ['search', 'fs', 'actions', 'browse', 'report']) Object.freeze(injected[key]);
```

Without the pre-created objects, `injected[root][method] =` throws while building stubs (002). Browse stays on the async RPC lane. Do not add `browse.*` to the `actions.` sync prefix check at `src/sandbox.js:91`.

---

### 3.12 MODIFY `src/host/actions.js`

Current import and REGISTRY head `src/host/actions.js:9-12`:

```js
import { SEARCH_ACTIONS, checkOptionValue } from '../search-schema.js';

const REGISTRY = [
  ...SEARCH_ACTIONS,
```

After:

```js
import { SEARCH_ACTIONS, checkOptionValue } from '../search-schema.js';
import { BROWSE_ACTIONS, checkBrowseOptionValue } from './browse/schema.js';

const REGISTRY = [
  ...SEARCH_ACTIONS,
  ...BROWSE_ACTIONS,
```

Current value check at `src/host/actions.js:185-193`:

```js
      const isSearch = rec.path.startsWith('search.');
      for (const [name, spec] of Object.entries(rec.inputs)) {
        if (spec.required && !(name in args)) missing.push(name);
        else if (name in args && typeOf(args[name]) !== spec.type) {
          typeErrors.push({ name, want: spec.type, got: typeOf(args[name]) });
        } else if (name in args && (isSearch || rec.path === 'fs.grepFile')) {
          const problem = checkOptionValue(name, args[name]);
          if (problem) invalid.push(problem);
        }
      }
```

After:

```js
      const isSearch = rec.path.startsWith('search.');
      const isBrowse = rec.path.startsWith('browse.');
      for (const [name, spec] of Object.entries(rec.inputs)) {
        if (spec.required && !(name in args)) missing.push(name);
        else if (name in args && typeOf(args[name]) !== spec.type) {
          typeErrors.push({ name, want: spec.type, got: typeOf(args[name]) });
        } else if (name in args && (isSearch || rec.path === 'fs.grepFile')) {
          const problem = checkOptionValue(name, args[name]);
          if (problem) invalid.push(problem);
        } else if (name in args && isBrowse) {
          const problem = checkBrowseOptionValue(name, args[name]);
          if (problem) invalid.push(problem);
        }
      }
```

For `browse.exec`, `screenshot`/`pdf` are type `object`; nested ENOTSUP (maxWidth, format) is reported via `invalid[].code === 'ENOTSUP'`, same shape as followSymlinks at `test/search-hardening.test.js:299-302`.

No REPORT_ACTIONS splice in wp2 (empty namespace, no methods).

---

### 3.13 MODIFY `src/tools.js`

Current `GUEST_API_DOC` bullets `src/tools.js:7-22`. After the search bullets (`src/tools.js:11-13`) insert:

```js
  '- browse.exec({ urls, timeoutMs?, waitUntil?, snapshot?, screenshot?, pdf? }) => {items,timings,slowest,complete,truncated,partial,leakedUrls,status,scope} — one Aside repl job. Engine is the Aside CLI, not Playwright. viewport/maxWidth/pdf.format/route are ENOTSUP. Killing the CLI leaks tabs; that path returns partial plus leakedUrls.',
  '- browse.probe() => capability matrix (static; --doctor --browse). Does not spawn a browser unless CODEMODE_BROWSE_LIVE=1.',
```

Also append to the last contract bullet (`src/tools.js:21`) the sentence: `browse.*` results are plain objects; they do not use the search `{rows,...}` envelope. `inputSchema` stays `{code, timeoutMs}` (`src/tools.js:28-36`).

---

### 3.14 MODIFY `src/cli.js`

002: `--doctor` currently runs after `makeRootGuard` (`src/cli.js:45-79`), so a machine with zero existing roots never prints. Browse diagnostics must still print. Restructure as follows.

Current block `src/cli.js:38-79` (cwd → root guard → doctor). After-state:

```js
let workCwd;
try {
  workCwd = resolveCwd({ argv });
} catch (e) {
  fail(e.message);
}

let assertInside = null;
let rootError = null;
try {
  assertInside = makeRootGuard(config.roots, { cwd: workCwd });
} catch (e) {
  rootError = e;
  if (!has('--doctor')) fail(e.message, { code: e.code ?? null });
}

const rgResolver = createRgResolver(config);

if (has('--doctor')) {
  const { probeCaps } = await import('./host/browse/probe.js');
  const { createAsideResolver } = await import('./host/browse/session.js');
  const report = {
    ok: true,
    node: process.version,
    platform: process.platform,
    cwd: workCwd,
    roots: assertInside ? assertInside.roots : [],
    missingRoots: assertInside ? assertInside.missingRoots : [],
    configSources: config._sources,
    rgPath: config.rgPath,
    asidePath: config.asidePath,
    excludeGlobs: config.excludeGlobs,
    browseCaps: config.browseCaps,
  };
  if (rootError) {
    report.ok = false;
    report.rootError = rootError.message;
    report.rootCode = rootError.code ?? null;
  }
  try {
    report.rgResolved = await rgResolver();
  } catch (e) {
    report.ok = false;
    report.rgResolved = null;
    report.rgError = e.message;
    if (e.candidates) report.rgCandidates = e.candidates;
  }
  if (has('--browse')) {
    report.browse = {
      ...probeCaps(),
      asidePath: config.asidePath,
      asideResolved: null,
      asideError: null,
    };
    try {
      report.browse.asideResolved = await createAsideResolver(config)();
    } catch (e) {
      report.ok = false;
      report.browse.asideResolved = null;
      report.browse.asideError = e.message;
      if (e.candidates) report.browse.asideCandidates = e.candidates;
    }
  }
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  process.exit(report.ok ? 0 : 1);
}

if (rootError) fail(rootError.message, { code: rootError.code ?? null });

const globals = signal => createHostGlobals(config, assertInside, signal);
```

Move `const globals = ...` to after the doctor return (it currently sits at `src/cli.js:52-53` before doctor). Doctor must not construct host globals.

Usage strings `src/cli.js:83-84` after:

```js
  console.error("usage: node src/cli.js --code '<js>' [--config <file>] [--timeout-ms N] [--cwd <dir>]");
  console.error('       node src/cli.js --doctor [--browse] [--config <file>] [--cwd <dir>]');
```

Bare `--browse` without `--doctor` still falls through to usage/exit 2 (002: unknown flags are ignored).

`--doctor` without `--browse` must not require Aside. CI has no Aside. `ok` tracks rg (+ roots) only unless `--browse` is present.

Doctor does not spawn `aside repl` and does not open tabs. Resolver may run `aside --version` via `execFileAside` (argv-only). Tests inject by pointing `CODEMODE_ASIDE` at a missing path; they do not need a real binary for the matrix body.

---

### 3.15 MODIFY `codemode.config.example.json`

Current `codemode.config.example.json:1-23`. After, add next to `rgPath`:

```json
  "asidePath": null,
  "browseCaps": {
    "enabled": true,
    "timeoutMs": 30000,
    "maxTabs": 8
  },
```

---

### 3.16 MODIFY README / template (SOT-SYNC-01)

These are in the unit write scope; wp2 C must patch them because guest-visible names are added.

`README.md:49-55` table — insert after the search row:

```
| `browse.exec({ urls, timeoutMs?, snapshot?, screenshot?, pdf? })` | One Aside `repl` job. Plain envelope with `items`, timings, complete/truncated/partial. viewport/maxWidth/pdf.format/route are rejected (`ENOTSUP`). |
| `browse.probe()` | Static Aside capability matrix. `codemode --doctor --browse` |
```

`README.ko.md:49-55` — same two rows in Korean.

`templates/AGENTS.codemode.md:10-14` available-tools sentence — append `browse.exec|probe`. After the doctor sentence (`templates/AGENTS.codemode.md:31`) add: if browsing is needed, run `{{NODE}} {{CLI}} --doctor --browse` and do not call `aside` on PATH from the agent card.

`src/register.js` `mergeMachineConfig` (`src/register.js:23-35`) seeds roots / excludeGlobs / rgPath. After the rgPath branch, seed browse defaults without inventing a binary path:

```js
  if (!config.browseCaps || typeof config.browseCaps !== 'object') {
    config.browseCaps = {
      enabled: false, timeoutMs: 25000, maxTabs: 8, concurrency: 4,
      navigateTimeoutMs: 15000, maxNavigateTimeoutMs: 25000,
      breakerFailures: 3, breakerCooldownMs: 30000, domainTimeouts: {},
    }; // 003 C3
  }
  if (!('asidePath' in config)) config.asidePath = null;
```

Do not write `~/.aside` credentials. Do not set `asidePath` to a guessed install.

---

### 3.17 MODIFY `test/search-boundary.test.js` (task t8)

Current imports `test/search-boundary.test.js:1-7`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRgResolver, createRgRunner } from '../src/rg.js';
import { runStream } from '../src/rg-stream.js';
```

After:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRgResolver, createRgRunner } from '../src/rg.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const rgStreamHref = pathToFileURL(path.join(here, '..', 'src', 'rg-stream.js')).href;
```

Current failing test `test/search-boundary.test.js:46-52`:

```js
test('cancelling an active stream kills its child instead of waiting for the rg deadline', async()=>{
  const controller=new AbortController();
  await assert.rejects(runStream(process.execPath,['-e',"process.stdout.write('ready\\n');setInterval(()=>{},1000)"],{
    signal:controller.signal,timeoutMs:300,max:10,
    onLine:()=>{controller.abort();return true;},
  }),e=>e.code==='ECANCELLED');
});
```

This is a time oracle: `timeoutMs:300` races the abort. Under `node --test` file concurrency the timer wins and the assertion sees `RgFailedError: rg timed out` (000). Isolated runs pass. Convention at `test/write-hardening.test.js:4-7`: settle with `fork()` IPC ready/go, never elapsed time.

Exact replacement:

```js
test('cancelling an active stream kills its child instead of waiting for the rg deadline', async (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'codemode-search-cancel-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const hangPath = path.join(root, 'hang.mjs');
  writeFileSync(hangPath, 'process.stdout.write("line\\n"); setInterval(() => {}, 1000);\\n');

  const wrapperPath = path.join(root, 'wrapper.mjs');
  writeFileSync(wrapperPath, `
import { runStream } from ${JSON.stringify(rgStreamHref)};
const hang = process.argv[2];
const controller = new AbortController();
process.on('message', (m) => {
  if (m === 'go') controller.abort();
});
const pending = runStream(process.execPath, [hang], {
  signal: controller.signal,
  timeoutMs: 30_000,
  max: 10,
  onLine: () => {
    process.send('ready');
    return true;
  },
});
try {
  await pending;
  process.send({ ok: true });
} catch (e) {
  process.send({ ok: false, code: e.code ?? null, message: e.message });
}
`);

  const child = fork(wrapperPath, [hangPath], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  t.after(() => { try { child.kill(); } catch {} });

  const outcome = await new Promise((resolve, reject) => {
    let settled = false;
    const done = (err, value) => {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else resolve(value);
    };
    child.on('message', (m) => {
      if (m === 'ready') {
        child.send('go');
        return;
      }
      done(null, m);
    });
    child.on('error', (e) => done(e));
    child.on('exit', (code, signal) => {
      done(new Error(`cancel wrapper exited ${code} signal ${signal} before reporting`));
    });
  });

  assert.equal(outcome.ok, false, outcome.message);
  assert.equal(outcome.code, 'ECANCELLED');
});
```

Why this is not a time oracle: the wrapper sends `ready` from `onLine`, which runs only after `runStream` has attached the abort listener (`src/rg-stream.js:81-92` timer then abort listener then stdout). Parent then sends `go`. `timeoutMs: 30000` is a hang safety net; if abort is lost the test fails with `ERGFAIL` timeout, it does not pass. Correctness is the IPC message ordering, matching `test/write-hardening.test.js:42-78`.

Do not keep the unused `runStream` import in the parent file.

---

### 3.18 NEW tests

All `node:test` + `node:assert/strict`. No network, no `shell:true`, no live Aside. `scripts/run-tests.mjs` enumerates `test/*.test.js` automatically.

#### `test/browse-schema.test.js`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateBrowseJob, checkBrowseOptionValue,
  MAX_WIDTH_UNSUPPORTED, VIEWPORT_UNSUPPORTED, PDF_FORMAT_UNSUPPORTED, ROUTE_UNSUPPORTED,
} from '../src/host/browse/schema.js';

test('unknown option is EBADOPT and names valid keys', () => {
  assert.throws(
    () => validateBrowseJob('browse.exec', { urls: ['https://example.com'], bogus: 1 }),
    (e) => e.code === 'EBADOPT' && /valid:/.test(e.message),
  );
});

test('missing urls is EBADVAL', () => {
  assert.throws(() => validateBrowseJob('browse.exec', {}), (e) => e.code === 'EBADVAL' && /urls/.test(e.message));
});

test('non-http url is EBADVAL', () => {
  assert.throws(() => validateBrowseJob('browse.exec', { urls: ['ftp://x'] }), (e) => e.code === 'EBADVAL');
});

test('maxWidth is ENOTSUP before any spawn', () => {
  for (const opts of [
    { urls: ['https://example.com'], maxWidth: 640 },
    { urls: ['https://example.com'], screenshot: { maxWidth: 640 } },
  ]) {
    assert.throws(() => validateBrowseJob('browse.exec', opts), (e) => e.code === 'ENOTSUP' && /maxWidth/.test(e.message));
  }
  assert.equal(checkBrowseOptionValue('maxWidth', 640).code, 'ENOTSUP');
  assert.match(MAX_WIDTH_UNSUPPORTED, /1440/);
});

test('viewport is ENOTSUP', () => {
  assert.throws(
    () => validateBrowseJob('browse.exec', { urls: ['https://example.com'], viewport: { width: 800, height: 600 } }),
    (e) => e.code === 'ENOTSUP' && /1440/.test(e.message),
  );
  assert.match(VIEWPORT_UNSUPPORTED, /1440/);
});

test('pdf.format is ENOTSUP and paper inches are required', () => {
  assert.throws(
    () => validateBrowseJob('browse.exec', { urls: ['https://example.com'], pdf: { format: 'A4' } }),
    (e) => e.code === 'ENOTSUP' && /612/.test(e.message),
  );
  assert.throws(
    () => validateBrowseJob('browse.exec', { urls: ['https://example.com'], pdf: {} }),
    (e) => e.code === 'EBADVAL' && /paperWidth/.test(e.message),
  );
  validateBrowseJob('browse.exec', { urls: ['https://example.com'], pdf: { paperWidth: 210 / 25.4, paperHeight: 297 / 25.4 } });
  assert.match(PDF_FORMAT_UNSUPPORTED, /612 792/);
});

test('route and blockResources are ENOTSUP', () => {
  for (const opts of [{ route: true }, { blockResources: true }]) {
    assert.throws(
      () => validateBrowseJob('browse.exec', { urls: ['https://example.com'], ...opts }),
      (e) => e.code === 'ENOTSUP',
    );
  }
  assert.match(ROUTE_UNSUPPORTED, /page\.route/);
});

test('waitUntil networkidle is EBADVAL; load is ok', () => {
  assert.throws(() => validateBrowseJob('browse.exec', { urls: ['https://example.com'], waitUntil: 'networkidle' }), (e) => e.code === 'EBADVAL');
  validateBrowseJob('browse.exec', { urls: ['https://example.com'], waitUntil: 'load' });
});

test('probe rejects extra keys', () => {
  assert.throws(() => validateBrowseJob('browse.probe', { urls: [] }), (e) => e.code === 'EBADOPT');
  assert.deepEqual(validateBrowseJob('browse.probe'), {});
});

test('jpeg quality 20 is allowed by schema (runtime warning lives on the probe matrix)', () => {
  validateBrowseJob('browse.exec', { urls: ['https://example.com'], screenshot: { type: 'jpeg', quality: 20 } });
});
```

#### `test/browse-result.test.js`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEnvelope, buildItem, summariseTimings } from '../src/host/browse/result.js';

test('complete envelope is enumerable and has no toJSON', () => {
  const env = buildEnvelope({ items: [buildItem({ url: 'https://example.com', ok: true, timings: { navigate: 1 } })] });
  assert.equal(env.complete, true);
  assert.equal(env.status, 'complete');
  assert.deepEqual(env.partial, []);
  assert.equal(typeof env.toJSON, 'undefined');
  const json = JSON.parse(JSON.stringify(env));
  assert.equal(json.items[0].timings.navigate, 1);
});

test('item failure is partial and stays inside items[]', () => {
  const env = buildEnvelope({ items: [buildItem({ url: 'https://example.com', ok: false, error: 'boom' })] });
  assert.equal(env.complete, false);
  assert.equal(env.status, 'partial');
  assert.equal(env.items[0].error, 'boom');
});

test('kill reports leakedUrls and a permanent-leak warning', () => {
  const env = buildEnvelope({ items: [], leakedUrls: ['https://example.com'], killed: true });
  assert.equal(env.status, 'partial');
  assert.deepEqual(env.leakedUrls, ['https://example.com']);
  assert.ok(env.partial.some((w) => /remain open/i.test(w)));
});

test('truncated status', () => {
  const env = buildEnvelope({ items: [buildItem({ url: 'https://example.com', ok: true })], truncated: true });
  assert.equal(env.status, 'truncated');
  assert.equal(env.complete, false);
});

test('slowest is top 5 by ms', () => {
  const items = [
    buildItem({ url: 'a', ok: true, timings: { navigate: 10, waitFor: 50 } }),
    buildItem({ url: 'b', ok: true, timings: { snapshot: 5, screenshot: 80, postprocess: 20 } }),
    buildItem({ url: 'c', ok: true, timings: { navigate: 3 } }),
  ];
  const { slowest } = summariseTimings(items);
  assert.equal(slowest.length, 5);
  assert.equal(slowest[0].ms, 80);
});
```

#### `test/browse-script.test.js`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileBrowseScript, deadlineMath, CLEANUP_SLACK_MS, ASIDE_REPL_HARD_CAP_MS, HOST_KILL_SLACK_MS } from '../src/host/browse/script.js';

const job = { urls: ['https://example.com', 'https://example.net', 'https://example.org'] };

test('compiled source has one JSON log, finally closeTab, no forbidden APIs', () => {
  const src = compileBrowseScript(job, { innerDeadlineMs: 1000 });
  assert.equal((src.match(/console\.log\(JSON\.stringify/g) || []).length, 1);
  assert.match(src, /finally/);
  assert.match(src, /closeTab/);
  assert.equal(/page\.route/.test(src), false);
  assert.equal(/setViewportSize/.test(src), false);
  assert.equal(/maxWidth/.test(src), false);
  assert.equal(/format:\s*['"]A4['"]/.test(src), false);
  assert.match(src, /Promise\.all/);
  assert.match(src, /JOB\.urls/);
});

test('clip and pdf inches are compiled; format is not', () => {
  const src = compileBrowseScript({
    urls: ['https://example.com'],
    screenshot: { clip: { x: 0, y: 0, width: 320, height: 200 } },
    pdf: { paperWidth: 210 / 25.4, paperHeight: 297 / 25.4 },
  }, { innerDeadlineMs: 1000 });
  assert.match(src, /clip/);
  assert.match(src, /paperWidth/);
  assert.match(src, /paperHeight/);
  assert.equal(/format/.test(src), false);
});

test('deadlineMath: host sits behind inner by CLEANUP_SLACK_MS and under the 120s cap', () => {
  const a = deadlineMath(30_000);
  assert.equal(a.innerDeadlineMs, 30_000);
  assert.equal(a.hostDeadlineMs, 30_000 + CLEANUP_SLACK_MS);
  const b = deadlineMath(200_000);
  const innerCeiling = ASIDE_REPL_HARD_CAP_MS - CLEANUP_SLACK_MS - HOST_KILL_SLACK_MS;
  assert.ok(b.innerDeadlineMs <= innerCeiling);
  assert.equal(b.hostDeadlineMs, b.innerDeadlineMs + CLEANUP_SLACK_MS);
  assert.ok(b.hostDeadlineMs < ASIDE_REPL_HARD_CAP_MS);
  assert.ok(a.innerDeadlineMs < a.hostDeadlineMs, 'inner must fire first so finally can run');
});
```

#### `test/browse-session.test.js`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createBrowseSession, createAsideResolver, AsideNotFoundError } from '../src/host/browse/session.js';

function fakeChild({ stdoutText = '', hang = false } = {}) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killed = false;
  child.killSignal = null;
  child.kill = (sig) => {
    child.killed = true;
    child.killSignal = sig;
    queueMicrotask(() => child.emit('close', null, sig));
  };
  queueMicrotask(() => {
    if (stdoutText) child.stdout.end(stdoutText);
    else child.stdout.end();
    child.stderr.end();
    if (!hang) child.emit('close', 0, null);
  });
  return child;
}

function sessionFor(spawnAsideImpl, extra = {}) {
  return createBrowseSession({
    config: { browseCaps: { timeoutMs: 30_000, maxTabs: 8 } },
    resolveAside: async () => '/fake/aside',
    spawnAsideImpl,
    ...extra,
  });
}

const okJson = JSON.stringify({
  items: [{ url: 'https://example.com', ok: true, timings: { navigate: 1, waitFor: 1, snapshot: 0, screenshot: 0, postprocess: 0 }, scope: { requested: {}, actual: {} } }],
});

test('spawn argv is repl plus the temp script path', async () => {
  let captured;
  const sess = sessionFor((bin, args, extra) => {
    captured = { bin, args, extra };
    return fakeChild({ stdoutText: okJson + '\n[ok | 12ms]\n' });
  });
  await sess.run({ urls: ['https://example.com'] });
  assert.equal(captured.bin, '/fake/aside');
  assert.equal(captured.args[0], 'repl');
  assert.equal(captured.args.length, 2);
  assert.equal(path.basename(captured.args[1]), 'job.js');
  assert.equal(captured.extra?.shell, undefined);
});

test('ok marker plus JSON is success even when exit is 0 and would also be 0 on failure', async () => {
  const sess = sessionFor(() => fakeChild({ stdoutText: okJson + '\n[ok | 12ms]\n' }));
  const env = await sess.run({ urls: ['https://example.com'] });
  assert.equal(env.complete, true);
  assert.equal(env.items[0].ok, true);
});

test('error marker is not success at exit 0', async () => {
  const sess = sessionFor(() => fakeChild({ stdoutText: okJson + '\n[error | 12ms]\n' }));
  const env = await sess.run({ urls: ['https://example.com'] });
  assert.equal(env.complete, false);
  assert.ok(env.partial.some((w) => /marker is \[error\]/.test(w)));
});

test('missing marker is not success', async () => {
  const sess = sessionFor(() => fakeChild({ stdoutText: okJson + '\n' }));
  const env = await sess.run({ urls: ['https://example.com'] });
  assert.equal(env.complete, false);
  assert.ok(env.partial.some((w) => /missing/.test(w)));
});

test('no JSON object is not success', async () => {
  const sess = sessionFor(() => fakeChild({ stdoutText: '[ok | 12ms]\n' }));
  const env = await sess.run({ urls: ['https://example.com'] });
  assert.ok(env.partial.some((w) => /JSON/.test(w)));
});

test('claimed file missing flips the item', async (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'codemode-claimed-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const missing = path.join(dir, 'nope.png');
  const body = JSON.stringify({
    items: [{ url: 'https://example.com', ok: true, path: missing, timings: { navigate: 1, waitFor: 0, snapshot: 0, screenshot: 0, postprocess: 0 }, scope: { requested: {}, actual: {} } }],
  });
  const sess = sessionFor(() => fakeChild({ stdoutText: body + '\n[ok | 12ms]\n' }));
  const env = await sess.run({ urls: ['https://example.com'] });
  assert.equal(env.items[0].ok, false);
  assert.match(env.items[0].error, /missing/);
});

test('claimed empty file flips the item', async (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'codemode-claimed-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const empty = path.join(dir, 'empty.png');
  writeFileSync(empty, '');
  const body = JSON.stringify({
    items: [{ url: 'https://example.com', ok: true, path: empty, timings: { navigate: 1, waitFor: 0, snapshot: 0, screenshot: 0, postprocess: 0 }, scope: { requested: {}, actual: {} } }],
  });
  const sess = sessionFor(() => fakeChild({ stdoutText: body + '\n[ok | 12ms]\n' }));
  const env = await sess.run({ urls: ['https://example.com'] });
  assert.equal(env.items[0].ok, false);
  assert.match(env.items[0].error, /empty/);
});

test('host deadline kill is SIGKILL plus leakedUrls', async () => {
  const sess = sessionFor(() => fakeChild({ hang: true }), { deadlines: { innerDeadlineMs: 60_000, hostDeadlineMs: 0 } });
  const env = await sess.run({ urls: ['https://example.com'] });
  assert.equal(env.status, 'partial');
  assert.deepEqual(env.leakedUrls, ['https://example.com']);
  assert.ok(env.partial.some((w) => /remain open/i.test(w)));
});

test('abort before spawn does not spawn', async () => {
  const controller = new AbortController();
  controller.abort();
  let spawned = 0;
  const sess = sessionFor(() => { spawned += 1; return fakeChild(); }, { signal: controller.signal });
  const env = await sess.run({ urls: ['https://example.com'] });
  assert.equal(spawned, 0);
  assert.ok(env.partial.some((w) => /cancel/i.test(w)));
});

test('abort after spawn kills and reports leakedUrls via ready/go handshake', async () => {
  const controller = new AbortController();
  let child;
  const sess = sessionFor(() => {
    child = fakeChild({ hang: true });
    queueMicrotask(() => controller.abort());
    return child;
  }, { signal: controller.signal });
  const env = await sess.run({ urls: ['https://example.com'] });
  assert.equal(child.killSignal, 'SIGKILL');
  assert.deepEqual(env.leakedUrls, ['https://example.com']);
});

test('explicit missing asidePath does not fall through to PATH', async () => {
  let execCalls = 0;
  const sess = createBrowseSession({
    config: { asidePath: '/no/such/aside', browseCaps: { timeoutMs: 1000, maxTabs: 8 } },
    existsImpl: () => false,
    spawnAsideImpl: () => { throw new Error('spawned'); },
  });
  await assert.rejects(sess.run({ urls: ['https://example.com'] }), (e) => e instanceof AsideNotFoundError || e.code === 'EASIDE404');
  assert.equal(execCalls, 0);
});

test('browseCaps.enabled false throws EDISABLED and does not spawn', async () => {
  let spawned = 0;
  const sess = createBrowseSession({
    config: { browseCaps: { enabled: false, timeoutMs: 1000, maxTabs: 8 } },
    resolveAside: async () => '/fake/aside',
    spawnAsideImpl: () => { spawned += 1; return fakeChild(); },
  });
  await assert.rejects(sess.run({ urls: ['https://example.com'] }), (e) => e.code === 'EDISABLED');
  assert.equal(spawned, 0);
});

test('temp script dir is removed after success and failure', async () => {
  const dirs = [];
  const orig = mkdtempSync;
  const sess = createBrowseSession({
    config: { browseCaps: { timeoutMs: 1000, maxTabs: 8 } },
    resolveAside: async () => '/fake/aside',
    spawnAsideImpl: () => fakeChild({ stdoutText: okJson + '\n[ok | 1ms]\n' }),
    mkdtempImpl: (p) => { const d = orig(p); dirs.push(d); return d; },
  });
  await sess.run({ urls: ['https://example.com'] });
  assert.equal(dirs.length, 1);
  assert.equal(existsSync(dirs[0]), false);
});
```

Resolver tests (import `createAsideResolver` already exported from session.js):

```js
import { createAsideResolver } from '../src/host/browse/session.js';

test('explicit missing path is EASIDE404 with no PATH walk', async () => {
  const calls = [];
  const resolve = createAsideResolver(
    { asidePath: '/no/such/aside' },
    {},
    { exists: () => false, execFileAsideImpl: async (bin) => { calls.push(bin); return { stdout: 'Aside 1' }; } },
  );
  await assert.rejects(resolve(), (e) => e.code === 'EASIDE404');
  assert.deepEqual(calls, []);
});

test('explicit path that fails --version does not fall through', async () => {
  const calls = [];
  const resolve = createAsideResolver(
    { asidePath: '/broken/aside' },
    { PATH: '/other' },
    {
      exists: () => true,
      execFileAsideImpl: async (bin) => { calls.push(bin); throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); },
    },
  );
  await assert.rejects(resolve(), (e) => e.code === 'EASIDE404' && Array.isArray(e.candidates));
  assert.deepEqual(calls, ['/broken/aside']);
});

test('PATH candidate is proven with --version', async () => {
  const env = { PATH: '/bin' };
  const wanted = process.platform === 'win32' ? path.join('/bin', 'aside.exe') : path.join('/bin', 'aside');
  const resolve = createAsideResolver(
    { asidePath: null },
    env,
    {
      exists: () => true,
      execFileAsideImpl: async (bin, args) => {
        assert.deepEqual(args, ['--version']);
        if (bin === wanted) return { stdout: 'Aside 1.26' };
        throw new Error('skip');
      },
    },
  );
  assert.equal(await resolve(), wanted);
});

test('where.exe .cmd shim is skipped', async () => {
  if (process.platform !== 'win32') return;
  const resolve = createAsideResolver(
    { asidePath: null },
    { PATH: '', LOCALAPPDATA: '' },
    {
      exists: () => true,
      execFileAsideImpl: async (bin, args) => {
        if (bin === 'where.exe') return { stdout: 'C:\\shim\\aside.cmd\n' };
        throw new Error('must not spawn .cmd: ' + bin);
      },
    },
  );
  await assert.rejects(resolve(), (e) => e.code === 'EASIDE404');
});
```

Host-deadline test S35: `fakeChild({ hang: true })` never emits close until `kill`. `session.run`'s host timer will call `kill`. That is a real timer. To keep timing out of the oracle, inject `deadlineMath`... session currently calls `deadlineMath(requested)` internally. **Locked extra injection for tests:** `createBrowseSession` accepts optional `deadlines: { innerDeadlineMs, hostDeadlineMs }`. When present, skip `deadlineMath`. Session tests pass `deadlines: { innerDeadlineMs: 60_000, hostDeadlineMs: 1 }` only if needed. Prefer hang-child that is killed by abort handshake (S37) as the kill-path proof; the host-timer path can be activated by passing `deadlines: { innerDeadlineMs: 60_000, hostDeadlineMs: 0 }` so the timer fires on the next turn without being a race against 300ms of CPU load. Implement `hostDeadlineMs: 0` as "kill on next macrotask" (`setTimeout(fn, 0)`), then assert SIGKILL. Do not use 300ms.

Add to `createBrowseSession` options:

```js
deadlines, // optional { innerDeadlineMs, hostDeadlineMs } override
```

and `const { innerDeadlineMs, hostDeadlineMs } = deadlines || deadlineMath(requested);`

#### `test/browse-probe.test.js`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { probeCaps, ASIDE_CAPS } from '../src/host/browse/probe.js';
import { createBrowse } from '../src/host/browse/browse.js';

test('static matrix matches measured constraints and does not spawn', async () => {
  let spawned = 0;
  const browse = createBrowse({
    config: { browseCaps: { timeoutMs: 1000, maxTabs: 8 } },
    session: { run: async () => { spawned += 1; }, },
  });
  const caps = await browse.probe();
  assert.equal(spawned, 0);
  assert.equal(caps.screenshot.maxWidthHonoured, false);
  assert.equal(caps.screenshot.clipHonoured, true);
  assert.equal(caps.screenshot.viewportSettable, false);
  assert.equal(caps.pdf.formatA4Honoured, false);
  assert.equal(caps.network.pageRoute, false);
  assert.equal(caps.session.killLeaksTabs, true);
  assert.match(caps.decision, /B-shaped engine/);
  assert.ok(caps.page.absent.includes('route'));
  assert.equal(ASIDE_CAPS.screenshot.jpegQuality20Unreliable, true);
});
```

#### `test/browse-doctor.test.js`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'cli.js');

function cfg(obj) {
  const dir = mkdtempSync(path.join(tmpdir(), 'codemode-doc-browse-'));
  const p = path.join(dir, 'c.json');
  writeFileSync(p, JSON.stringify({ roots: [dir], ...obj }));
  return p;
}

test('--doctor --browse prints the matrix and failed resolver without launching repl', () => {
  const r = spawnSync(process.execPath, [cli, '--doctor', '--browse', '--config', cfg({})], {
    encoding: 'utf8',
    env: { ...process.env, CODEMODE_ASIDE: path.join(tmpdir(), 'no-such-aside-binary') },
  });
  const body = JSON.parse(r.stdout);
  assert.equal(body.browse.screenshot.maxWidthHonoured, false);
  assert.ok(body.browse.page.absent.includes('route'));
  assert.equal(body.browse.pdf.formatA4Honoured, false);
  assert.equal(body.browse.asideResolved, null);
  assert.ok(body.browse.asideError);
  assert.equal(r.status, 1);
});

test('--doctor without --browse does not require Aside', () => {
  const r = spawnSync(process.execPath, [cli, '--doctor', '--config', cfg({})], {
    encoding: 'utf8',
    env: { ...process.env, CODEMODE_ASIDE: path.join(tmpdir(), 'no-such-aside-binary') },
  });
  const body = JSON.parse(r.stdout);
  assert.equal(body.browse, undefined);
});

test('bare --browse is usage exit 2', () => {
  const r = spawnSync(process.execPath, [cli, '--browse'], { encoding: 'utf8' });
  assert.equal(r.status, 2);
});

test('--doctor --browse still prints when every root is missing', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'codemode-doc-missing-'));
  const p = path.join(dir, 'c.json');
  writeFileSync(p, JSON.stringify({ roots: [path.join(dir, 'nope-root')] }));
  const r = spawnSync(process.execPath, [cli, '--doctor', '--browse', '--config', p], {
    encoding: 'utf8',
    env: { ...process.env, CODEMODE_ASIDE: path.join(tmpdir(), 'no-such-aside-binary') },
  });
  const body = JSON.parse(r.stdout);
  assert.ok(body.rootError || body.ok === false);
  assert.ok(body.browse);
  assert.ok(body.browse.page);
});
```

#### `test/browse-wire.test.js`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCode } from '../src/sandbox.js';
import { createBrowse } from '../src/host/browse/browse.js';

test('guest sees browse.exec, browse.probe, and an empty report object', async () => {
  const browse = createBrowse({
    config: { browseCaps: { timeoutMs: 1000, maxTabs: 8 } },
    session: { run: async (job) => ({ items: [{ url: job.urls[0], ok: true }], complete: true, truncated: false, partial: [], leakedUrls: [], timings: [], slowest: [], status: 'complete', scope: {} }) },
  });
  const globals = { search: {}, fs: {}, actions: {}, browse, report: Object.freeze({}) };
  const keys = await runCode('return Object.keys(browse).sort();', { timeoutMs: 5000, globals, maxResultBytes: 1024 });
  assert.deepEqual(keys.result, ['exec', 'probe']);
  const probe = await runCode('return await browse.probe();', { timeoutMs: 5000, globals, maxResultBytes: 4096 });
  assert.equal(probe.ok, true);
  assert.equal(probe.result.screenshot.maxWidthHonoured, false);
  const exec = await runCode("return await browse.exec({ urls: ['https://example.com'] });", { timeoutMs: 5000, globals, maxResultBytes: 4096 });
  assert.equal(exec.ok, true);
  assert.equal(exec.result.items[0].ok, true);
  assert.equal(typeof exec.result.timings, 'object');
  const report = await runCode('return typeof report;', { timeoutMs: 5000, globals, maxResultBytes: 1024 });
  assert.equal(report.result, 'object');
});
```

Wire test must use the real `createHostGlobals` path too:

```js
import { createHostGlobals } from '../src/host/globals.js';
import { makeRootGuard } from '../src/paths.js';

test('createHostGlobals injects browse and report so the worker freeze does not throw', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'codemode-g-'));
  const globals = createHostGlobals({ searchCaps: { files: 1, content: 1 }, browseCaps: { timeoutMs: 1000, maxTabs: 8 }, excludeGlobs: [] }, makeRootGuard([root], { cwd: root }));
  const out = await runCode('return [typeof browse.exec, typeof browse.probe, typeof report];', {
    timeoutMs: 5000,
    globals: (signal) => globals,
    maxResultBytes: 1024,
  });
  assert.equal(out.ok, true);
  assert.deepEqual(out.result, ['function', 'function', 'object']);
});
```

That second test will try to construct a real Aside resolver only if `browse.exec` is called. `probe` is static. Safe.

#### `test/config.test.js` additions

```js
test('asidePath null clears an inherited string; env CODEMODE_ASIDE wins; browseCaps is field-wise', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'codemode-cfg-aside-'));
  const first = writeCfg(dir, 'a.json', { roots: [dir], asidePath: '/from-file', browseCaps: { timeoutMs: 9 } });
  const second = writeCfg(dir, 'b.json', { asidePath: null });
  const cleared = loadConfig(['--config', second], {});
  // apply() is per-file; loadConfig reads one --config. Test the copier via two sequential applies by putting both keys in one file:
  const both = writeCfg(dir, 'c.json', { roots: [dir], asidePath: null, browseCaps: { timeoutMs: 9 } });
  const cfg = loadConfig(['--config', both], {});
  assert.equal(cfg.asidePath, null);
  assert.equal(cfg.browseCaps.timeoutMs, 9);
  assert.equal(cfg.browseCaps.maxTabs, 8);
  const viaEnv = loadConfig(['--config', first], { CODEMODE_ASIDE: '/from-env' });
  assert.equal(viaEnv.asidePath, '/from-env');
});
```

Add a second test that a later config file is not how loadConfig works — only one `--config`. The null-clear behaviour is the `apply()` branch `'asidePath' in obj`. Drive it with a single JSON `{ asidePath: null }` after defaults (defaults are already null). To prove clear-from-string, `loadConfig` applies repo file then argv. Use env `CODEMODE_CONFIG` string path then argv file with null... actually argv `--config` is applied after `CODEMODE_CONFIG` (`src/config.js:120-123`). So:

```js
test('later asidePath null clears CODEMODE_CONFIG string', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'codemode-cfg-aside2-'));
  const envCfg = writeCfg(dir, 'env.json', { roots: [dir], asidePath: '/inherited' });
  const argvCfg = writeCfg(dir, 'argv.json', { asidePath: null });
  const cfg = loadConfig(['--config', argvCfg], { CODEMODE_CONFIG: envCfg });
  assert.equal(cfg.asidePath, null);
});
```

#### `test/windows-hide.test.js` addition

```js
import { createAsideProcessFns } from '../src/child-opts.js';

test('spawnAside forwards rgChildOpts to the process impl', () => {
  const captured = [];
  const { spawnAside } = createAsideProcessFns({
    spawnImpl(bin, args, opts) {
      captured.push({ bin, args, opts });
      return { pid: 0 };
    },
  });
  spawnAside('aside', ['repl', 'job.js'], { timeout: 5 }, {});
  assert.equal(Object.hasOwn(captured[0].opts, 'windowsHide'), false);
  captured.length = 0;
  spawnAside('aside', ['repl', 'job.js'], {}, { CODEMODE_WINDOWS_HIDE: '1' });
  assert.equal(captured[0].opts.windowsHide, true);
});

test('browse session spawn only through child-opts helpers', () => {
  const session = readFileSync(path.join(srcDir, 'host', 'browse', 'session.js'), 'utf8');
  assert.match(session, /spawnAside/);
  assert.equal(/\bspawn\s*\(/.test(session), false);
  assert.equal(/shell\s*:\s*true/.test(session), false);
});
```

`srcDir` already exists at `test/windows-hide.test.js:8`. `readFileSync` is already imported.

#### `test/actions.test.js`

`actions.list().length >= 11` is already a floor (`test/actions.test.js:11`). Add:

```js
test('browse actions are in the catalog and check ENOTSUP', () => {
  const paths = actions.list('browse').map((a) => a.path);
  assert.deepEqual(paths, ['browse.exec', 'browse.probe']);
  const r = actions.check('browse.exec', { urls: ['https://example.com'], maxWidth: 640 });
  assert.equal(r.ok, false);
  assert.equal(r.invalid[0].code, 'ENOTSUP');
});
```

---

## 4. Dependency order of edits

1. t8 rewrite of `test/search-boundary.test.js` (unblocks local `npm test` on this host; no production import cycle).
2. `src/child-opts.js` Aside spawn/execFile helpers.
3. `src/host/browse/schema.js`
4. `src/host/browse/result.js`
5. `src/host/browse/script.js` (deadlineMath + compiler)
6. `src/host/browse/session.js` (resolver + run)
7. `src/host/browse/probe.js`
8. `src/host/browse/browse.js`
9. `src/config.js` + `codemode.config.example.json`
10. `src/host/globals.js`, `src/sandbox.js`, `src/execution-worker.js`, `src/host/actions.js`, `src/tools.js`
11. `src/cli.js` doctor browse + root-guard bypass for doctor
12. README.md, README.ko.md, templates/AGENTS.codemode.md
13. tests in §3.18
14. Stop. Do not push (wp2 C of the loop does that). Do not create report/*. Do not add captureMany.

---

## 5. Testable acceptance criteria

Every new conditional path has an ACTIVATION SCENARIO. Timing is never the oracle.

| # | Path | ACTIVATION SCENARIO | Observable proof it ran |
| --- | --- | --- | --- |
| S1 | schema unknown key | `validateBrowseJob('browse.exec', { urls:['https://example.com'], bogus:1 })` | throws `BrowseOptionError` code `EBADOPT`, message lists `valid:` |
| S2 | schema missing urls | `validateBrowseJob('browse.exec', {})` | `EBADVAL`, message `urls is required` |
| S3 | schema non-http url | `urls:['ftp://x']` | `EBADVAL` |
| S4 | schema maxWidth | `screenshot:{maxWidth:640}` or top-level `maxWidth:640` | `ENOTSUP`, message cites silent ignore / clip |
| S5 | schema viewport | `viewport:{width:800,height:600}` | `ENOTSUP`, message cites 1440×900 |
| S6 | schema pdf.format | `pdf:{format:'A4'}` | `ENOTSUP`, message cites MediaBox 612 792 and inches |
| S7 | schema pdf missing paper | `pdf:{}` | `EBADVAL` paperWidth/paperHeight |
| S8 | schema route/blockResources | `route:true` or `blockResources:true` | `ENOTSUP`, message cites page.route absent |
| S9 | schema waitUntil garbage | `waitUntil:'networkidle'` | `EBADVAL` |
| S10 | schema probe extra keys | `validateBrowseJob('browse.probe', { urls:[] })` | `EBADOPT` |
| S11 | actions.check ENOTSUP | `actions.check('browse.exec', { urls:['https://example.com'], maxWidth:1 })` | `ok:false`, `invalid[0].code==='ENOTSUP'` |
| S12 | result complete | one ok item, no warnings, not killed | `complete===true`, `status==='complete'`, `partial==[]` |
| S13 | result item failure | one item `ok:false` | `complete===false`, `status==='partial'`, failure still in `items[0]` |
| S14 | result kill | `buildEnvelope({killed:true, leakedUrls:['https://example.com']})` | `partial` contains leak sentence AND `leakedUrls` |
| S15 | result truncated | `truncated:true` | `status==='truncated'`, `complete===false` |
| S16 | result slowest | items with timings 10, 50, 5, 80, 20, 3 | `slowest.length===5`, first ms===80 |
| S17 | script no route | `compileBrowseScript` output | `/page\.route/.test(src)===false`, no `setViewportSize`, no `maxWidth`, no `format:\s*['"]A4['"]` |
| S18 | script finally | compile output | matches `finally` and `closeTab` |
| S19 | script one JSON | compile output | exactly one `console.log(JSON.stringify` |
| S20 | script multi-url | job with 3 urls | source contains `Promise.all` and `JOB.urls` |
| S21 | deadline math | `deadlineMath(30000)` | `innerDeadlineMs===30000`, `hostDeadlineMs===31500` (inner + CLEANUP_SLACK_MS 1500) |
| S22 | deadline cap | `deadlineMath(200000)` | inner <= 120000-1500-500=117999, host = inner+1500, host < 120000 |
| S23 | resolver explicit miss | `asidePath` to missing file, injected exists=false | `AsideNotFoundError` `EASIDE404`, no PATH walk (no execFile calls after) |
| S24 | resolver explicit fail --version | exists true, execFile throws | `EASIDE404` with `candidates` containing the abs path; no fallthrough |
| S25 | resolver PATH hit | no asidePath, first PATH cand --version ok | returns that cand; later cands not called |
| S26 | resolver Windows localappdata | win32, LOCALAPPDATA set, PATH empty, that exe --version ok | returns `%LOCALAPPDATA%\\Aside\\CLI\\current\\aside.exe` |
| S27 | resolver where.exe skips .cmd | where returns `aside.cmd` | candidate dropped; not spawned |
| S28 | session argv | fake spawn capturing args | `args` deepEqual `['repl', <abs job.js>]` |
| S29 | session success | fake stdout `{"items":[{"url":"https://example.com","ok":true,"timings":{"navigate":1,"waitFor":1,"snapshot":0,"screenshot":0,"postprocess":0},"scope":{"requested":{},"actual":{}}}]}\n[ok \| 12ms]\n`, close 0 | envelope `complete===true`; exit code ignored |
| S30 | session error marker | same JSON but `[error \| 12ms]` | `complete===false`, warning `Aside marker is [error]` even though exit 0 |
| S31 | session missing marker | JSON only, close 0 | warning `missing [ok\|error \| Nms] marker`, not complete |
| S32 | session no JSON | `[ok \| 12ms]` only | warning `no JSON object on stdout` |
| S33 | claimed file missing | JSON item.path to absent file, marker ok | item.ok false, error `claimed file missing` |
| S34 | claimed file empty | path exists size 0 | item.ok false, `claimed file empty` |
| S35 | host deadline kill | fake child never emits close; `kill` records SIGKILL and then emits close | envelope `killed` path: `status==='partial'`, `leakedUrls` equals job.urls, warning mentions tabs may remain. Activate by injecting a child whose `kill` emits close; do not wait on wall clock — the test's fake timer is the injected child itself: spawnImpl returns a child that does not emit close until `kill` is called. Assert `child.killSignal==='SIGKILL'`. |
| S36 | abort before spawn | AbortController aborted before `run` | no spawnImpl call; envelope leakedUrls=job.urls (or warnings contain cancelled before spawn) |
| S37 | abort after spawn | child hangs until kill; abort after a sync `spawned` flag the fake sets | spawnImpl called once; kill SIGKILL; partial+leakedUrls. Handshake: fake spawnImpl calls a test callback, test then `controller.abort()`, fake kill emits close. No `setTimeout` oracle. |
| S38 | spawn error | spawnImpl throws / child emits error | items all ok false, no leakedUrls (tabs never opened) |
| S39 | temp script cleanup | after run, mkdtemp dir is gone | `existsSync(dir)===false` even on failure |
| S40 | never shell | extra passed to spawnAside | `shell` not true; `args` not joined into a string |
| S41 | probe static | `browse.probe()` with CODEMODE_BROWSE_LIVE unset | `page.absent` includes `route`, `screenshot.maxWidthHonoured===false`, `pdf.formatA4Honoured===false`, `session.killLeaksTabs===true`, `decision` contains `B-shaped engine` |
| S42 | probe no spawn | probe() | spawnAsideImpl not called |
| S43 | doctor --browse matrix | spawnSync cli `--doctor --browse --config` with CODEMODE_ASIDE missing | stdout JSON has `browse.page.absent` including route, `browse.asideResolved===null`, `browse.asideError` set, exit 1 |
| S44 | doctor without --browse | spawnSync `--doctor` | no `browse` key required; missing Aside does not fail this path; still has rg fields |
| S45 | doctor bare --browse | spawnSync `--browse` only | exit 2, usage on stderr |
| S46 | doctor broken roots | config roots to a missing path, `--doctor --browse` | still prints JSON (not a node stack), `rootError` set, `browse` matrix still present |
| S47 | guest browse.exec | `runCode('return Object.keys(browse)', {globals: factory})` | keys include `exec` and `probe` |
| S48 | guest report object | `return typeof report` | `'object'` |
| S49 | guest no sync browse | calling browse.exec uses async rpc; a unit that inspects worker is optional. Minimum: `runCode('return await browse.probe()')` with injected createHostGlobals returns the matrix without throwing `unknown host action` |
| S50 | config asidePath null clears | file sets asidePath string, later file sets null | cfg.asidePath===null |
| S51 | config env wins | CODEMODE_ASIDE set | cfg.asidePath equals env |
| S52 | config browseCaps field-wise | JSON `browseCaps:{timeoutMs:9}` | timeoutMs 9, maxTabs still default 8 |
| S53 | t8 cancel | full `npm test` including this file | the cancel test passes; outcome.code==='ECANCELLED'; does not fail with `rg timed out` |
| S54 | child-opts hide | `createAsideProcessFns` spawnImpl capture | default env omits windowsHide; `CODEMODE_WINDOWS_HIDE=1` sets true |
| S55 | source lock session | read session.js | has spawnAside, no raw `spawn(`, no `shell:true` |
| S56 | source lock script | compiled source | no `page.route`, no `format:'A4'` |
| S57 | jpeg quality 20 allowed by schema | `screenshot:{type:'jpeg',quality:20}` | validate succeeds (unreliable at runtime, not ENOTSUP). Doctor matrix `jpegQuality20Unreliable===true` is the warning. |
| S58 | clip honoured in compile | `screenshot:{clip:{x:0,y:0,width:320,height:200}}` | compiled source contains `opts.clip` |
| S59 | pdf inches in compile | paperWidth 210/25.4 | compiled source contains `paperWidth` and `paperHeight`, not `format` |
| S60 | empty screenshot object | `screenshot:{}` | validate ok; compile emits png screenshot without clip |

| S61 | disabled exec | `browseCaps.enabled:false` then `session.run({urls:['https://example.com']})` | throws `code==='EDISABLED'`; spawn count 0. `browse.probe()` still returns the matrix |

S35/S37 must use fake-child handshake, not `Date.now()` diffs.

---

## 6. Verifiers

| Command | Observes this phase? | What it must show |
| --- | --- | --- |
| `npm test` | yes | `scripts/run-tests.mjs:9-12` enumerates every `test/*.test.js`. New browse tests run automatically. t8 must be green inside this full run, not only isolation. |
| `node --test test/search-boundary.test.js` | yes, t8 only |  not sufficient as the gate; isolation already passed before the fix |
| `node --test test/browse-session.test.js test/browse-schema.test.js test/browse-result.test.js test/browse-script.test.js test/browse-probe.test.js test/browse-doctor.test.js test/browse-wire.test.js` | yes | focused suite during C |
| `node src/cli.js --doctor --browse` | yes | JSON includes `browse.page`, `browse.screenshot.maxWidthHonoured===false`, `browse.pdf.formatA4Honoured===false`, `browse.decision`. Aside resolution may fail on CI — that is exit 1 and is OK for a machine without Aside. |
| `node src/cli.js --doctor` | yes, non-regression | no Aside requirement; existing cwd test `test/cwd.test.js:68-74` still exit 0 |
| `node src/cli.js --browse` | yes | exit 2 usage |
| hosted `gh run list --repo lidge-jun/aside-codemode` | yes, after push (loop C, not this docs pass) | 5 combos green. This docs-only pass does not push. |
| live `aside.exe repl` | **no** for unit tests | human-review / `CODEMODE_BROWSE_LIVE=1` only. Marked human-review. |

If a verifier does not observe the change, the row is human-review. Live tab-leak behaviour (E5) cannot be unit-tested without Aside; the unit test observes that the **kill path reports** leakedUrls. Whether Aside actually leaks is already measured in 001 and is not re-probed in CI.

---

## 7. Risks and what would prove this design wrong

| Risk | Falsifier |
| --- | --- |
| Inequality of deadlines inverted (host timer < inner) | A fake child that logs "finally-ran" before close never logs it on timeout; tabs would leak on every timeout. If an implementation sets `hostDeadlineMs < innerDeadlineMs`, reject the PR. |
| Honouring `maxWidth` or `format:'A4'` | PNG IHDR still 1440×900 / MediaBox `0 0 612 792` (001 E4). Schema must ENOTSUP, not forward. |
| Joining the search `toJSON` lane | `JSON.stringify` of a guest return drops `timings`/`partial`. 002 forbids teaching the worker another special case. |
| `page.route` "support" | `typeof page.route` is not a function (E3). Any compiled source calling it will throw inside Aside; treat as schema ENOTSUP, not a runtime retry. |
| Tests launching Aside | CI Ubuntu/macOS have no Aside; suite would go red. `spawnAsideImpl` injection is mandatory. |
| Doctor requiring Aside without `--browse` | CI `--doctor` (via cwd test) would fail. |
| SIGKILL as the happy-path cancel without `partial` | Silent success after a leak. Envelope without `leakedUrls` on kill is a fail. |
| Compiling user URLs with string concat | Breakout from the job into the repl script. Must `JSON.stringify` the job payload. |
| `actions.check` type-erroring `screenshot` objects before nested ENOTSUP | `maxWidth` would show as unknown/type error instead of ENOTSUP. The browse branch in check() must run `checkBrowseOptionValue`. |
| t8 still using 300ms | Full `npm test` red on this Windows host; CI green only because the runner wins the race. |
| Creating `aside-cli.js` or `src/host/report/*.js` in wp2 | Collides with 002 layout and with the wp5 sibling. |
| Empty `browse: {}` without methods | Namespace is visible but `browse.exec` is undefined; guest wiring tests fail. Must ship probe+exec. |

| `browseCaps.enabled:false` still spawning | Falsifier: S61. Probe must keep working. |

**#23 record:** `probe.js` `decision: 'A-shaped surface, B-shaped engine'` plus the README row stating the engine is the Aside CLI, not Playwright. Closing the GitHub issue is wp7.

The compiled `function sleep(ms)` in the §3.3 skeleton must not be emitted: it would shadow Aside `sleep` and recurse. Implement the inner `Promise.race` timeout with `setTimeout` only.

`browse.probe()` stays available when `browseCaps.enabled===false`. Only `session.run` / `browse.exec` throw `EDISABLED`.

---

## 8. Guest names locked for later phases

wp2 guest verbs: `browse.probe`, `browse.exec`. wp4 `captureMany` may wrap `exec` or become a sibling; do not add it here. `report.build` is wp5. `web.*` / `api.*` / `media.*` from the original #23 A sketch are **not** injected. `report` is a frozen empty object so the worker freeze does not throw when wp5 adds methods.

#23 is **recorded** (decision text in §1.2 and doctor `browse.decision`). #23 is **closed** in wp7 (`000_plan.md`).
