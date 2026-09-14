# 020 — Phase wp3: resilience (block detect + circuit breaker)

> **Read [003_locked_contracts.md](003_locked_contracts.md) first; it overrides this file.**
> The wp1 audit found that these phase docs, written in parallel, disagreed with each other on
> the `session.run` signature, the `browseCaps` defaults, the spawn/batch model, the deadline
> ordering, and several Aside call forms that had never been measured. 003 settles all of them
> with new measurements (E7). Where this document shows a different shape, 003 is correct.
> Known corrections that apply here: `openTab` returns the page itself (`tab.page` and `tab.id`
> are undefined; identity is `page.targetId`), `snapshot` requires that page object and rejects
> a string id, `file://` navigation is refused, and `waitUntil`/`waitForLoadState` accept any
> string silently so they must be validated host-side.

Unit: `devlog/_plan/260914_browse-batch/`. Implementation-phase doc (020-range).
Closes **#17** and **#21**. Depends on wp2 foundations (session spawn/deadline/parse
contract). Does not implement captureMany (#6, wp4), wait recipes (#11, wp5), or
`recipes.run` (#9, wp6).

This file is the copy-paste PRD for wp3. An implementer who has not seen the
conversation should be able to land the diff from this document alone.

Re-verify line numbers against the tree at the start of wp3. wp2 may have
created `src/host/browse/*.js`; those files are **absent from this tree today**.
Quoted `path:line` below is current HEAD of this docs-only pass.

---

## 1. Purpose and issues closed

#17 — after a page load, detect login wall / CAPTCHA / rate-limit / hard-block
from **title, final URL, HTTP status, snapshot text**. Return an alternate-path
item **immediately**. Never retry that URL in this execution.

#21 — per-domain circuit breaker so two consecutive timeout-or-block failures
fail-fast the rest of that domain. Short navigate timeouts, **below** Aside's
measured ~30s internal screenshot timeout (001 E4). Result meta matches the
search completeness contract: enumerable `complete`, `partial` as `string[]`,
plus `skippedDomains`. Cancellation is `ECANCELLED` and is **not** a breaker
failure.

Independently verifiable at close (000): block detection and circuit breaker
unit-tested against **fixture stdout**. No browser, no network, no Aside CLI.

---

## 2. Scope

### IN

- NEW `src/host/browse/policy.js` — SSOT for classification, alternate-path
  table, timeout clamp, circuit breaker, and the guarded batch loop.
- NEW `test/browse-policy.test.js` + `test/fixtures/browse-policy/*`.
- MODIFY `src/config.js` — `browseCaps` nested object, field-wise `apply()`,
  flat `CODEMODE_BROWSE_*` env keys.
- MODIFY `codemode.config.example.json` and `test/config.test.js` to match.
- Required caller contract for wp2 `session.js` / wp4 `captureMany`: they must
  drive items through `runGuardedBatch`. wp3 lands a fake-`runItem` test that
  is the oracle for that contract.

### OUT

- Request interception (`page.route`, `p.on('request')`). 001 E3: `route` is
  absent; `p.on('request')` delivered **0** events. Status is **only** the
  `goto` return value, which may be `null`.
- Viewport / `screenshot.maxWidth` / PDF MediaBox (wp4/wp5).
- `browse.*` guest names, `GUEST_API_DOC`, `BROWSE_ACTIONS`, README tables
  (guest-visible names land with the feature that exposes them).
- Wait strategies / `networkidle` (#11, wp5). Resource blocking (refused).
- `recipes.run` (#9, wp6). Alternate-path strings here are suggestions, not
  executed recipes.
- Persistent cross-process breaker state (#15 cache, wp6). Breaker is
  in-memory, per `createCircuitBreaker()` instance (one execution).
- Killing the Aside CLI as a timeout primitive (001 E5: kill leaks tabs).
- New npm dependencies. Tests that launch a browser. Timing as a correctness
  oracle.

### Binding evidence this phase must not contradict

| Id | Fact | Consequence here |
| --- | --- | --- |
| E1 | CLI exit code is 0 on failure; trailer is `[ok \| Nms]` / `[error \| Nms]` | Fixture stdout is classified from the JSON body + trailer. Never from an exit code. |
| E3 | no `route` / no request events | `readNavStatus(nav)` only. If `goto` returned undefined, `status: null`. |
| E4 | ~30s default screenshot timeout; `maxWidth` ignored | `maxNavigateTimeoutMs = 25000`. Config **rejects** values above that (no silent clamp — silent ignore is the E4 bug). |
| E5 | kill leaks tabs; host wait must let the script `finally` run | Domain timeout is an **in-script** budget passed into `runItem`. Policy never `SIGKILL`s. Cancel is `AbortSignal` → `ECANCELLED`. |
| E6 | multi-page in one repl works | Breaker is per-domain inside one execution, not per-process. |

Amendment to #21's `partial: true`: search's contract at
`src/search-result.js:32-35,60-65` and `src/rg.js:164-167` uses `partial` as
`string[]` and `complete` as boolean. Browse follows that, not a boolean
`partial` flag. `complete === false` plus `partial` entries is the equivalent.

---

## 3. File change map

| Path | Op | Role |
| --- | --- | --- |
| `src/host/browse/policy.js` | NEW | Classification, breaker, timeouts, `runGuardedBatch` |
| `test/browse-policy.test.js` | NEW | Every activation scenario below |
| `test/fixtures/browse-policy/*.stdout.txt` | NEW | Fixture stdout (E1 shape) |
| `src/config.js` | MODIFY | `browseCaps` defaults + apply + env |
| `codemode.config.example.json` | MODIFY | Document the keys |
| `test/config.test.js` | MODIFY | Env/file copy of `browseCaps` |
| `src/host/browse/session.js` | MODIFY (wp2 file; absent today) | Must call `runGuardedBatch`; no private retry loop |
| `src/host/browse/schema.js` | MODIFY (wp2 file; absent today) | Re-export `POLICY_OPTION_SPEC` into captureMany option SSOT |
| `src/host/browse/result.js` | MODIFY (wp2 file; absent today) | Item fields listed in §3.4 must be enumerable on the envelope |

Do not add `index.js` barrels (002). Do not import `./report/*`. Do not import
`rg-stream.js` — copy the three-line cancel helper so browse does not depend
on search internals.

---

### 3.1 NEW `src/host/browse/policy.js`

Create the directory if wp2 has not. Paste this module. Do not leave stubs for
waits/recipes; a comment pointing at 040/050 is enough.

The module below is the implementation. Keep the export names, constants,
state machine, and classify priority identical. Helper internals may be split
into local functions but must not change observable results of §5.

```js
// src/host/browse/policy.js
// wp3 — #17 block detect, #21 per-domain breaker + short timeouts.
// Wait strategies (#11) and recipes.run (#9) are later phases; do not add them here.

export const ASIDE_INTERNAL_SCREENSHOT_TIMEOUT_MS = 30000; // 001 E4, documentation only
export const MIN_NAVIGATE_TIMEOUT_MS = 1000;
export const DEFAULT_NAVIGATE_TIMEOUT_MS = 15000;
export const MAX_NAVIGATE_TIMEOUT_MS = 25000; // must stay below E4 ~30s
export const DEFAULT_BREAKER_FAILURES = 2;
export const DEFAULT_BREAKER_COOLDOWN_MS = 0; // 0 = sticky open for this execution
export const SNAPSHOT_CLASSIFY_MAX_CHARS = 32768;

export const POLICY_OPTION_SPEC = {
  navigateTimeoutMs: {
    type: 'number',
    required: false,
    description: 'Per-item navigate budget in ms. Default 15000. Rejected above 25000 (Aside ~30s screenshot cap).',
  },
  domainTimeouts: {
    type: 'object',
    required: false,
    description: 'Map of hostname (www-stripped) to navigateTimeoutMs override.',
  },
  breakerFailures: {
    type: 'number',
    required: false,
    description: 'Consecutive timeout-or-block failures before the domain circuit opens. Default 2.',
  },
  breakerCooldownMs: {
    type: 'number',
    required: false,
    description: 'Open→half-open cooldown. 0 (default) keeps the circuit open for the rest of this execution.',
  },
};

export function throwIfBrowseCancelled(signal) {
  if (signal?.aborted) {
    throw Object.assign(new Error('browse cancelled'), { code: 'ECANCELLED' });
  }
}

export function domainKey(url) {
  let parsed;
  try { parsed = new URL(url); }
  catch {
    throw Object.assign(new Error('browse: invalid URL ' + JSON.stringify(url)), { code: 'EBADVAL' });
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw Object.assign(new Error('browse: URL must be http(s) (got ' + parsed.protocol + ')'), { code: 'EBADVAL' });
  }
  let host = parsed.hostname.toLowerCase().replace(/\.$/, '');
  if (host.startsWith('www.')) host = host.slice(4);
  return host;
}

// Alternate-path lookup may alias; the breaker must not (twitter.com failing
// must not skip x.com).
const ALTERNATE_ALIASES = {
  'twitter.com': 'x.com',
  't.co': 'x.com',
  'youtu.be': 'youtube.com',
  'm.youtube.com': 'youtube.com',
  'music.youtube.com': 'youtube.com',
};

const ALTERNATE_PATHS = {
  'x.com': 'Do not retry the logged-out web UI. Use fetch-first web search (site:x.com) or the X API if credentials exist.',
  'youtube.com': 'Do not scrape watch/login pages. Use the YouTube Data API / oEmbed (api.batch, wp5).',
  'play.google.com': 'Do not retry the Play login wall. Use a public store listing / search index if one exists (api.batch, wp5).',
  'apps.apple.com': 'Use the iTunes lookup API instead of the App Store web UI.',
  'itunes.apple.com': 'Use the iTunes lookup API instead of the App Store web UI.',
  'news.ycombinator.com': 'Use https://hn.algolia.com/api/v1/ or the Firebase HN API.',
  'reddit.com': 'Use the public .json suffix or old.reddit.com for public posts; do not retry the login wall.',
  'linkedin.com': 'No unauthenticated scrape. Skip. Do not retry.',
  'instagram.com': 'No unauthenticated scrape. Skip. Do not retry.',
  'facebook.com': 'No unauthenticated scrape. Skip. Do not retry.',
  'slack.com': 'Use the Slack Web API (conversations.history). Browser login will not work in this session.',
  'app.slack.com': 'Use the Slack Web API (conversations.history). Browser login will not work in this session.',
};

export function alternatePathFor(domain) {
  const key = ALTERNATE_ALIASES[domain] || domain;
  return ALTERNATE_PATHS[key]
    || ('Do not retry. Use fetch-first (web.readText) or a documented API if one exists for ' + domain + '.');
}

export function readNavStatus(nav) {
  if (nav == null) return null;
  try {
    if (typeof nav.status === 'function') {
      const value = nav.status();
      return Number.isInteger(value) ? value : null;
    }
    if (typeof nav.status === 'number' && Number.isInteger(nav.status)) return nav.status;
  } catch {
    return null;
  }
  return null;
}

export function resolveNavigateTimeoutMs({
  domain,
  requestedMs,
  domainTimeouts = {},
  defaultMs = DEFAULT_NAVIGATE_TIMEOUT_MS,
  maxMs = MAX_NAVIGATE_TIMEOUT_MS,
} = {}) {
  const fromDomain = domain && domainTimeouts && typeof domainTimeouts === 'object'
    ? domainTimeouts[domain]
    : undefined;
  const raw = fromDomain ?? requestedMs ?? defaultMs;
  if (!Number.isSafeInteger(raw)) {
    throw Object.assign(
      new Error('browse: navigateTimeoutMs must be an integer (got ' + JSON.stringify(raw) + ')'),
      { code: 'EBADVAL' },
    );
  }
  if (raw < MIN_NAVIGATE_TIMEOUT_MS || raw > maxMs || maxMs > MAX_NAVIGATE_TIMEOUT_MS) {
    throw Object.assign(
      new Error('browse: navigateTimeoutMs must be in [' + MIN_NAVIGATE_TIMEOUT_MS + ', ' + Math.min(maxMs, MAX_NAVIGATE_TIMEOUT_MS) + '] (got ' + raw + ')'),
      { code: 'EBADVAL' },
    );
  }
  return raw;
}
```

Continue the same file after `resolveNavigateTimeoutMs`:

```js
function norm(text) {
  return String(text ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function clipSnapshot(text) {
  const s = String(text ?? '');
  return s.length > SNAPSHOT_CLASSIFY_MAX_CHARS ? s.slice(0, SNAPSHOT_CLASSIFY_MAX_CHARS) : s;
}

const LOGIN_HOSTS = [
  /(?:^|\.)accounts\.google\.com$/i,
  /(?:^|\.)login\.microsoftonline\.com$/i,
  /(?:^|\.)login\.live\.com$/i,
  /(?:^|\.)login\.yahoo\.com$/i,
  /(?:^|\.)accounts\.spotify\.com$/i,
  /(?:^|\.)okta\.com$/i,
  /(?:^|\.)auth0\.com$/i,
];
const LOGIN_PATH = /\/(?:login|log-in|signin|sign-in|sign_in|authenticate|auth(?:\/|$)|account\/login|session\/new|i\/flow\/login|checkpoint)(?:\/|$|\?)/i;
const CAPTCHA_HOSTS = [/(?:^|\.)challenges\.cloudflare\.com$/i];
const CAPTCHA_PATH = /\/(?:cdn-cgi\/challenge|sorry\/index|recaptcha|hcaptcha|captcha|challenge)(?:\/|$|\?)/i;

const STRONG = {
  captchaTitle: /\bcaptcha\b|are you a robot|verify you are (?:a )?human|security check/i,
  captchaSnap: /i['’]?m not a robot|recaptcha|h-?captcha|verify you are (?:a )?human|cf-browser-verification|checking your browser before accessing|please complete the security check/i,
  ratelimitTitle: /too many requests|rate limit|\b429\b/i,
  ratelimitSnap: /too many requests|rate limit(?:ed| exceeded)?|retry-after/i,
  loginTitle: /sign[- ]?in|log[- ]?in|로그인|authentication required/i,
  loginSnap: /you must be (?:signed|logged) in|sign in to continue|log in to continue|로그인(?:이 필요|하세요)|forgot password|don['’]t have an account/i,
  hardTitle: /access denied|403 forbidden|request blocked|why have i been blocked|접근이 거부/i,
  hardSnap: /access denied|your ip has been (?:blocked|banned)|you have been blocked|error 403|this request was blocked|접근이 거부/i,
};
const WEAK = {
  captchaTitle: /just a moment|attention required/i,
  loginSnapForm: /password/i,
  cfRayBlock: /cloudflare ray id/i,
};

function hostMatches(host, regexes) {
  return regexes.some((re) => re.test(host));
}

function urlSignals(requestedUrl, finalUrl) {
  let finalHost = '';
  let finalPath = '';
  try {
    const u = new URL(finalUrl || requestedUrl);
    finalHost = u.hostname.toLowerCase().replace(/\.$/, '');
    if (finalHost.startsWith('www.')) finalHost = finalHost.slice(4);
    finalPath = u.pathname + u.search;
  } catch {
    return { loginUrl: false, captchaUrl: false, finalHost, finalPath };
  }
  return {
    loginUrl: hostMatches(finalHost, LOGIN_HOSTS) || LOGIN_PATH.test(finalPath),
    captchaUrl: hostMatches(finalHost, CAPTCHA_HOSTS) || CAPTCHA_PATH.test(finalPath),
    finalHost,
    finalPath,
  };
}

/**
 * @param {{ requestedUrl: string, finalUrl?: string|null, title?: string|null, status?: number|null, snapshotText?: string|null }} signals
 * @returns {{ blocked: 'login'|'captcha'|'ratelimit'|'hard-block'|null, reason: string, alternatePath: string|null, signals: object }}
 */
export function classifyPage(signals = {}) {
  const requestedUrl = signals.requestedUrl ?? signals.url ?? '';
  const domain = (() => { try { return domainKey(requestedUrl); } catch { return ''; } })();
  const title = norm(signals.title);
  const snap = norm(clipSnapshot(signals.snapshotText ?? signals.snapshot));
  const status = Number.isInteger(signals.status) ? signals.status : null;
  const url = urlSignals(requestedUrl, signals.finalUrl ?? signals.url ?? requestedUrl);

  const hits = {
    captcha: Boolean(
      url.captchaUrl
      || STRONG.captchaTitle.test(title)
      || STRONG.captchaSnap.test(snap)
      || (WEAK.captchaTitle.test(title) && STRONG.captchaSnap.test(snap)),
    ),
    ratelimit: Boolean(
      status === 429
      || STRONG.ratelimitTitle.test(title)
      || STRONG.ratelimitSnap.test(snap),
    ),
    login: Boolean(
      status === 401
      || url.loginUrl
      || (STRONG.loginTitle.test(title) && STRONG.loginSnap.test(snap))
      || (url.loginUrl && STRONG.loginTitle.test(title))
      || (STRONG.loginSnap.test(snap) && WEAK.loginSnapForm.test(snap)),
    ),
    hard: Boolean(
      status === 451
      || (status === 403 && !url.loginUrl)
      || STRONG.hardTitle.test(title)
      || STRONG.hardSnap.test(snap)
      || (WEAK.cfRayBlock.test(snap) && STRONG.hardSnap.test(snap)),
    ),
  };

  // Priority: captcha > ratelimit > login > hard-block. One class only.
  // Weak title "Sign in" on a marketing page (no login URL, no login snapshot,
  // status 200) must NOT fire — that is the false-positive fixture.
  let blocked = null;
  let reason = 'ok';
  if (hits.captcha) { blocked = 'captcha'; reason = 'captcha challenge'; }
  else if (hits.ratelimit) { blocked = 'ratelimit'; reason = 'rate limited'; }
  else if (hits.login) { blocked = 'login'; reason = 'login wall'; }
  else if (hits.hard) { blocked = 'hard-block'; reason = 'hard block'; }

  return {
    blocked,
    reason,
    alternatePath: blocked ? alternatePathFor(domain) : null,
    signals: {
      domain,
      status,
      finalUrl: signals.finalUrl ?? null,
      loginUrl: url.loginUrl,
      captchaUrl: url.captchaUrl,
      title,
    },
  };
}
```

Continue the same file with the breaker and batch loop:

```js
export class CircuitBreaker {
  /**
   * @param {{ failureThreshold?: number, cooldownMs?: number, now?: () => number }} [opts]
   * `now` MUST be injected in tests. Default cooldownMs=0 means sticky open
   * (no half-open) for the rest of this execution, matching #21 "immediately skip".
   * Half-open is a real state: reachable when cooldownMs > 0 and now() has
   * advanced — never by sleeping.
   */
  constructor({
    failureThreshold = DEFAULT_BREAKER_FAILURES,
    cooldownMs = DEFAULT_BREAKER_COOLDOWN_MS,
    now = () => Date.now(),
  } = {}) {
    if (!Number.isSafeInteger(failureThreshold) || failureThreshold < 1) {
      throw Object.assign(new Error('browse: breakerFailures must be a positive integer'), { code: 'EBADVAL' });
    }
    if (!Number.isSafeInteger(cooldownMs) || cooldownMs < 0) {
      throw Object.assign(new Error('browse: breakerCooldownMs must be a non-negative integer'), { code: 'EBADVAL' });
    }
    this.failureThreshold = failureThreshold;
    this.cooldownMs = cooldownMs;
    this.now = now;
    this._domains = new Map();
  }

  _entry(domain) {
    let e = this._domains.get(domain);
    if (!e) {
      e = { state: 'closed', consecutiveFailures: 0, openedAt: null, probeInFlight: false, skipped: false };
      this._domains.set(domain, e);
    }
    return e;
  }

  inspect(domain) {
    const e = this._entry(domain);
    return { state: e.state, consecutiveFailures: e.consecutiveFailures, openedAt: e.openedAt, probeInFlight: e.probeInFlight };
  }

  skippedDomains() {
    return [...this._domains.entries()].filter(([, e]) => e.skipped).map(([d]) => d).sort();
  }

  allow(domain, { signal } = {}) {
    throwIfBrowseCancelled(signal);
    const e = this._entry(domain);
    if (e.state === 'closed') return { proceed: true, state: 'closed' };
    if (e.state === 'half-open') {
      if (e.probeInFlight) {
        e.skipped = true;
        return { proceed: false, skipped: 'circuit-open', state: 'half-open' };
      }
      e.probeInFlight = true;
      return { proceed: true, state: 'half-open' };
    }
    const canProbe = this.cooldownMs > 0 && e.openedAt != null && (this.now() - e.openedAt) >= this.cooldownMs;
    if (canProbe && !e.probeInFlight) {
      e.state = 'half-open';
      e.probeInFlight = true;
      return { proceed: true, state: 'half-open' };
    }
    e.skipped = true;
    return { proceed: false, skipped: 'circuit-open', state: 'open' };
  }

  recordSuccess(domain) {
    const e = this._entry(domain);
    e.state = 'closed';
    e.consecutiveFailures = 0;
    e.openedAt = null;
    e.probeInFlight = false;
  }

  recordFailure(domain, { kind } = {}) {
    const e = this._entry(domain);
    e.probeInFlight = false;
    e.consecutiveFailures += 1;
    if (e.consecutiveFailures >= this.failureThreshold || e.state === 'half-open') {
      e.state = 'open';
      e.openedAt = this.now();
    }
    return { state: e.state, kind: kind ?? 'error', consecutiveFailures: e.consecutiveFailures };
  }

  recordCancel(domain) {
    const e = this._entry(domain);
    e.probeInFlight = false;
    if (e.state === 'half-open') {
      e.state = 'open';
      e.openedAt = this.now();
    }
  }
}

export function createCircuitBreakerFromConfig(config = {}, { now } = {}) {
  const caps = config.browseCaps ?? {};
  return new CircuitBreaker({
    failureThreshold: caps.breakerFailures ?? DEFAULT_BREAKER_FAILURES,
    cooldownMs: caps.breakerCooldownMs ?? DEFAULT_BREAKER_COOLDOWN_MS,
    now,
  });
}

function isCancelledOutcome(outcome, signal) {
  if (signal?.aborted) return true;
  const err = outcome?.error;
  return err?.code === 'ECANCELLED' || outcome?.code === 'ECANCELLED';
}

function isTimeoutOutcome(outcome) {
  const err = outcome?.error;
  if (err?.code === 'ETIMEOUT' || outcome?.code === 'ETIMEOUT') return true;
  const msg = String(err?.message ?? outcome?.errorMessage ?? '');
  return /timed out|timeout/i.test(msg);
}

export function decideItemAction({
  url, domain, breaker, signal, requestedMs, domainTimeouts, defaultMs, maxMs,
} = {}) {
  throwIfBrowseCancelled(signal);
  const host = domain ?? domainKey(url);
  const allowed = breaker.allow(host, { signal });
  if (!allowed.proceed) {
    return {
      action: 'skip',
      item: {
        url, domain: host, ok: false, blocked: null, skipped: 'circuit-open',
        reason: 'circuit-open', alternatePath: alternatePathFor(host), code: null,
      },
    };
  }
  return {
    action: 'proceed',
    domain: host,
    state: allowed.state,
    timeoutMs: resolveNavigateTimeoutMs({ domain: host, requestedMs, domainTimeouts, defaultMs, maxMs }),
  };
}

export function interpretItemOutcome({ url, domain, outcome = {}, breaker, signal } = {}) {
  const host = domain ?? domainKey(url);
  if (isCancelledOutcome(outcome, signal)) {
    breaker.recordCancel(host);
    return {
      url, domain: host, ok: false, blocked: null, skipped: 'cancelled',
      reason: 'cancelled', alternatePath: null, code: 'ECANCELLED',
    };
  }
  if (isTimeoutOutcome(outcome)) {
    breaker.recordFailure(host, { kind: 'timeout' });
    return {
      url, domain: host, ok: false, blocked: null, skipped: null,
      reason: 'timeout', alternatePath: alternatePathFor(host), code: 'ETIMEOUT',
    };
  }
  if (outcome.error && outcome.error.code === 'EBADVAL') {
    return {
      url, domain: host, ok: false, blocked: null, skipped: null,
      reason: outcome.error.message, alternatePath: null, code: 'EBADVAL',
    };
  }
  const classified = classifyPage({
    requestedUrl: url,
    finalUrl: outcome.finalUrl,
    title: outcome.title,
    status: outcome.status ?? null,
    snapshotText: outcome.snapshotText ?? outcome.snapshot,
  });
  if (classified.blocked) {
    breaker.recordFailure(host, { kind: classified.blocked });
    return {
      url, domain: host, ok: false,
      blocked: classified.blocked, skipped: null,
      reason: classified.reason, alternatePath: classified.alternatePath,
      signals: classified.signals, code: null,
    };
  }
  if (outcome.error) {
    breaker.recordFailure(host, { kind: 'error' });
    return {
      url, domain: host, ok: false, blocked: null, skipped: null,
      reason: String(outcome.error.message ?? outcome.error),
      alternatePath: alternatePathFor(host),
      code: outcome.error.code ?? 'EFAIL',
    };
  }
  breaker.recordSuccess(host);
  return {
    url, domain: host, ok: true, blocked: null, skipped: null,
    reason: 'ok', alternatePath: null, code: null,
    finalUrl: outcome.finalUrl ?? url,
    title: outcome.title ?? null,
    status: outcome.status ?? null,
  };
}

export function buildBatchMeta(items, breaker, scope = {}) {
  const partial = [];
  for (const item of items) {
    if (item.skipped === 'circuit-open') partial.push('circuit-open:' + item.domain);
    else if (item.skipped === 'cancelled') partial.push('cancelled:' + (item.domain ?? item.url));
    else if (item.blocked) partial.push('blocked:' + item.blocked + ':' + item.domain);
    else if (item.reason === 'timeout') partial.push('timeout:' + item.domain);
    else if (item.ok === false) partial.push('error:' + (item.domain ?? item.url));
  }
  return {
    complete: partial.length === 0,
    truncated: false,
    partial,
    skippedDomains: breaker.skippedDomains(),
    scope: {
      navigateTimeoutMs: scope.defaultMs ?? DEFAULT_NAVIGATE_TIMEOUT_MS,
      breakerFailures: breaker.failureThreshold,
      breakerCooldownMs: breaker.cooldownMs,
      domainTimeouts: scope.domainTimeouts ?? {},
    },
  };
}

/**
 * Per-domain serialized, cross-domain parallel. This is the only retry/skip
 * brain. runItem must not retry. Tests inject runItem; production session
 * injects a spawn-backed function. Never launch a browser from this module.
 */
export async function runGuardedBatch({
  urls, runItem, signal, breaker, requestedMs, domainTimeouts,
  defaultMs = DEFAULT_NAVIGATE_TIMEOUT_MS,
  maxMs = MAX_NAVIGATE_TIMEOUT_MS,
} = {}) {
  throwIfBrowseCancelled(signal);
  if (!Array.isArray(urls)) {
    throw Object.assign(new Error('browse: urls must be an array'), { code: 'EBADVAL' });
  }
  const items = new Array(urls.length);
  const chains = new Map();
  const jobs = urls.map((url, i) => {
    let host;
    try { host = domainKey(url); }
    catch (e) {
      items[i] = {
        url, domain: null, ok: false, blocked: null, skipped: null,
        reason: e.message, alternatePath: null, code: e.code ?? 'EBADVAL',
      };
      return Promise.resolve();
    }
    const prev = chains.get(host) || Promise.resolve();
    const job = prev.then(async () => {
      throwIfBrowseCancelled(signal);
      const decided = decideItemAction({
        url, domain: host, breaker, signal, requestedMs, domainTimeouts, defaultMs, maxMs,
      });
      if (decided.action === 'skip') {
        items[i] = decided.item;
        return;
      }
      let outcome;
      try {
        outcome = await runItem({ url, domain: host, timeoutMs: decided.timeoutMs, signal });
      } catch (error) {
        outcome = { error };
      }
      items[i] = interpretItemOutcome({ url, domain: host, outcome, breaker, signal });
    });
    chains.set(host, job.then(() => {}, () => {}));
    return job;
  });
  await Promise.all(jobs);
  return { items, ...buildBatchMeta(items, breaker, { defaultMs, domainTimeouts }) };
}
```

---

### 3.2 NEW fixtures

Create `test/fixtures/browse-policy/` with **exactly** these files. Each is
Aside-repl-shaped (001 E1): JSON body, then a trailer. Tests must fail the
fixture load if the trailer is missing — that is how we refuse the CLI-exit-0
lie. Encoding UTF-8, LF newlines.

**`x-login.stdout.txt`**

```
{"url":"https://x.com/search","finalUrl":"https://x.com/i/flow/login","title":"Log in to X","status":200,"snapshotText":"You must be signed in to see this content. Sign in Log in Forgot password"}
[ok | 908ms]
```

**`cf-captcha.stdout.txt`**

```
{"url":"https://example.net/app","finalUrl":"https://example.net/cdn-cgi/challenge","title":"Just a moment...","status":403,"snapshotText":"Checking your browser before accessing example.net. I'm not a robot. Cloudflare Ray ID: 000"}
[ok | 1100ms]
```

**`ratelimit-429.stdout.txt`**

```
{"url":"https://api.example.org/v1","finalUrl":"https://api.example.org/v1","title":"429 Too Many Requests","status":429,"snapshotText":"Rate limit exceeded. Retry-After: 60"}
[ok | 220ms]
```

**`hardblock-403.stdout.txt`**

```
{"url":"https://blocked.example.org/","finalUrl":"https://blocked.example.org/","title":"Access Denied","status":403,"snapshotText":"Access denied. Your IP has been blocked. Error 403."}
[ok | 180ms]
```

**`ok-example.stdout.txt`**

```
{"url":"https://example.com/","finalUrl":"https://example.com/","title":"Example Domain","status":200,"snapshotText":"This domain is for use in illustrative examples in documents."}
[ok | 140ms]
```

**`google-sorry.stdout.txt`**

```
{"url":"https://www.google.com/search?q=test","finalUrl":"https://www.google.com/sorry/index?continue=https://www.google.com/search","title":"Are you a robot?","status":429,"snapshotText":"Our systems have detected unusual traffic. Please complete the security check. /sorry/index"}
[ok | 640ms]
```

**`weak-signin-cta.stdout.txt`** (must classify as NOT blocked)

```
{"url":"https://shop.example.com/","finalUrl":"https://shop.example.com/","title":"Sign in to our newsletter later","status":200,"snapshotText":"Summer sale. Create a wishlist. No password field here."}
[ok | 90ms]
```

**`login-korean.stdout.txt`**

```
{"url":"https://news.example.co.kr/paywall","finalUrl":"https://news.example.co.kr/login","title":"로그인","status":200,"snapshotText":"로그인이 필요합니다. 로그인하세요. Forgot password"}
[ok | 210ms]
```

**`timeout-error.stdout.txt`** (001 E4 jpeg-timeout wording; this is a timeout, not a block)

```
{"url":"https://slow.example.com/","error":{"message":"browser CDP command timed out for Page.captureScreenshot before the default screenshot timeout","code":"ETIMEOUT"}}
[error | 30013ms]
```

**`status-null-login.stdout.txt`** (`goto` returned no Response — E3 path)

```
{"url":"https://x.com/i/status/1","finalUrl":"https://x.com/i/flow/login","title":"Log in to X","status":null,"snapshotText":"You must be signed in"}
[ok | 400ms]
```

Trailer regex the test helper must use (CRLF-safe):

```js
const TRAILER = /\r?\n\[(ok|error) \| \d+ms\]\s*$/;
```

If `TRAILER` does not match, the test throws `fixture missing repl trailer`
before classification. That is the activation of the "exit code is not
success" guard.

---

### 3.3 NEW `test/browse-policy.test.js`

Use `node:test` + `node:assert/strict`. Read fixtures with `readFileSync` from
`test/fixtures/browse-policy/` via `fileURLToPath(new URL('./fixtures/browse-policy/...', import.meta.url))`.
Do not spawn, do not `setTimeout` for correctness, do not import `aside`.

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  classifyPage, readNavStatus, domainKey, alternatePathFor,
  resolveNavigateTimeoutMs, CircuitBreaker, runGuardedBatch,
  interpretItemOutcome, DEFAULT_NAVIGATE_TIMEOUT_MS, MAX_NAVIGATE_TIMEOUT_MS,
  createCircuitBreakerFromConfig,
} from '../src/host/browse/policy.js';
import { loadConfig } from '../src/config.js';

const FIX = (name) => fileURLToPath(new URL('./fixtures/browse-policy/' + name, import.meta.url));
const TRAILER = /\r?\n\[(ok|error) \| \d+ms\]\s*$/;

function loadStdout(name) {
  const raw = readFileSync(FIX(name), 'utf8');
  const m = raw.match(TRAILER);
  if (!m) throw new Error('fixture missing repl trailer: ' + name);
  return { marker: m[1], payload: JSON.parse(raw.slice(0, m.index).replace(/\s+$/, '')) };
}
```

Required test names (copy these strings; §5 maps 1:1):

1. `classifyPage: x.com login wall from fixture stdout`
2. `classifyPage: cloudflare captcha beats 403 hard-block`
3. `classifyPage: 429 is ratelimit and does not retry`
4. `classifyPage: 403 access-denied is hard-block`
5. `classifyPage: example.com 200 is not blocked`
6. `classifyPage: google /sorry is captcha (priority over ratelimit title)`
7. `classifyPage: weak Sign-in CTA is not a login wall`
8. `classifyPage: Korean login wall`
9. `classifyPage: status null still detects login from URL+snapshot`
10. `classifyPage: timeout error fixture is not a block class`
11. `fixture load throws when repl trailer is missing`
12. `readNavStatus: function / number / throw / null`
13. `resolveNavigateTimeoutMs: default 15000, domain override, reject 30000`
14. `domainKey strips www and rejects non-http`
15. `breaker closed → closed on success`
16. `breaker closed stays closed after one failure`
17. `breaker closed → open on second consecutive failure`
18. `breaker open fail-fast skips without calling runItem`
19. `breaker open → half-open after injected clock past cooldown`
20. `breaker half-open → closed on probe success`
21. `breaker half-open → open on probe failure`
22. `breaker half-open second concurrent probe is skipped`
23. `breaker cooldown 0 is sticky open (no half-open)`
24. `cancel before allow throws ECANCELLED and does not open the circuit`
25. `cancel of in-flight item is skipped=cancelled and is not a failure`
26. `runGuardedBatch serializes one domain and parallels others`
27. `runGuardedBatch never retries a blocked item`
28. `batch meta partial[] + skippedDomains matches search completeness shape`
29. `config browseCaps env overrides file and stays field-wise`
30. `createCircuitBreakerFromConfig reads browseCaps`

For (11), build a string that is valid JSON but has no trailer and assert the
loader throws. Do not commit that string as a fixture.

For (18)/(26)/(27), `runItem` pushes its url onto an array and returns a canned
outcome. The observable proof that skip ran is `runItem` was not called for
that url.

For (19)–(21): `let now = 0; const breaker = new CircuitBreaker({ cooldownMs: 1000, now: () => now });`
then `now = 1000`. Never `Date.now()` and never sleep.

For (12):

```js
assert.equal(readNavStatus(undefined), null);
assert.equal(readNavStatus({ status: 429 }), 429);
assert.equal(readNavStatus({ status: () => 403 }), 403);
assert.equal(readNavStatus({ status: () => { throw new Error('gone'); } }), null);
assert.equal(readNavStatus({ status: 12.5 }), null);
```

---

### 3.4 MODIFY `src/config.js` (exists today)

Current defaults at `src/config.js:29-36`:

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
  maxResultBytes: 65536,
  maxTimeoutMs: 120000,
  searchCaps: { files: 5000, content: 500 },
  browseCaps: {
    navigateTimeoutMs: 15000,
    maxNavigateTimeoutMs: 25000,
    breakerFailures: 2,
    breakerCooldownMs: 0,
    domainTimeouts: {},
  },
  excludeGlobs: DEFAULT_EXCLUDES,
};
```

Current nested copy at `src/config.js:109-112`:

```js
    if (obj.searchCaps && typeof obj.searchCaps === 'object') {
      if ('files' in obj.searchCaps) cfg.searchCaps.files = requireInteger('searchCaps.files', obj.searchCaps.files);
      if ('content' in obj.searchCaps) cfg.searchCaps.content = requireInteger('searchCaps.content', obj.searchCaps.content);
    }
```

After, immediately following that block (field-wise, same pattern; a key not
copied here is silently dropped — 002):

```js
    if (obj.browseCaps && typeof obj.browseCaps === 'object') {
      if ('navigateTimeoutMs' in obj.browseCaps) {
        cfg.browseCaps.navigateTimeoutMs = requireInteger(
          'browseCaps.navigateTimeoutMs', obj.browseCaps.navigateTimeoutMs, 1000, 25000,
        );
      }
      if ('maxNavigateTimeoutMs' in obj.browseCaps) {
        cfg.browseCaps.maxNavigateTimeoutMs = requireInteger(
          'browseCaps.maxNavigateTimeoutMs', obj.browseCaps.maxNavigateTimeoutMs, 1000, 25000,
        );
      }
      if ('breakerFailures' in obj.browseCaps) {
        cfg.browseCaps.breakerFailures = requireInteger(
          'browseCaps.breakerFailures', obj.browseCaps.breakerFailures, 1, 10,
        );
      }
      if ('breakerCooldownMs' in obj.browseCaps) {
        cfg.browseCaps.breakerCooldownMs = requireInteger(
          'browseCaps.breakerCooldownMs', obj.browseCaps.breakerCooldownMs, 0, 120000,
        );
      }
      if (obj.browseCaps.domainTimeouts && typeof obj.browseCaps.domainTimeouts === 'object' && !Array.isArray(obj.browseCaps.domainTimeouts)) {
        const next = { ...(cfg.browseCaps.domainTimeouts || {}) };
        for (const [host, ms] of Object.entries(obj.browseCaps.domainTimeouts)) {
          if (typeof host !== 'string' || !host) continue;
          const key = host.toLowerCase().replace(/^www\./, '');
          next[key] = requireInteger('browseCaps.domainTimeouts.' + host, ms, 1000, 25000);
        }
        cfg.browseCaps.domainTimeouts = next;
      }
    }
```

Current env overrides at `src/config.js:124-130`. After, append flat names
(002: no nested env convention):

```js
  if (env.CODEMODE_BROWSE_NAV_TIMEOUT_MS !== undefined) {
    cfg.browseCaps.navigateTimeoutMs = requireInteger(
      'CODEMODE_BROWSE_NAV_TIMEOUT_MS', Number(env.CODEMODE_BROWSE_NAV_TIMEOUT_MS), 1000, 25000,
    );
  }
  if (env.CODEMODE_BROWSE_MAX_NAV_TIMEOUT_MS !== undefined) {
    cfg.browseCaps.maxNavigateTimeoutMs = requireInteger(
      'CODEMODE_BROWSE_MAX_NAV_TIMEOUT_MS', Number(env.CODEMODE_BROWSE_MAX_NAV_TIMEOUT_MS), 1000, 25000,
    );
  }
  if (env.CODEMODE_BROWSE_BREAKER_FAILURES !== undefined) {
    cfg.browseCaps.breakerFailures = requireInteger(
      'CODEMODE_BROWSE_BREAKER_FAILURES', Number(env.CODEMODE_BROWSE_BREAKER_FAILURES), 1, 10,
    );
  }
  if (env.CODEMODE_BROWSE_BREAKER_COOLDOWN_MS !== undefined) {
    cfg.browseCaps.breakerCooldownMs = requireInteger(
      'CODEMODE_BROWSE_BREAKER_COOLDOWN_MS', Number(env.CODEMODE_BROWSE_BREAKER_COOLDOWN_MS), 0, 120000,
    );
  }
```

Do **not** import `policy.js` from `config.js` (layering). Drift is caught by
test 29 asserting `loadConfig().browseCaps.navigateTimeoutMs === DEFAULT_NAVIGATE_TIMEOUT_MS`.

`requireInteger('browseCaps.maxNavigateTimeoutMs', 30000, 1000, 25000)` must
throw. That is the activation of the "do not sit at Aside's 30s cap" guard.

---

### 3.5 MODIFY `codemode.config.example.json` (exists today)

Current `codemode.config.example.json:1-23` has `searchCaps` and no browse
keys. After, insert alongside `searchCaps`:

```json
  "browseCaps": {
    "navigateTimeoutMs": 15000,
    "maxNavigateTimeoutMs": 25000,
    "breakerFailures": 2,
    "breakerCooldownMs": 0,
    "domainTimeouts": {
      "x.com": 8000
    }
  },
```

---

### 3.6 MODIFY `test/config.test.js` (exists today)

Current file ends at `test/config.test.js:40` (`empty roots deny every fs call`).
Append:

```js
test('browseCaps field-wise copy and env override', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'codemode-cfg-browse-'));
  const cfg = writeCfg(dir, 'c.json', {
    roots: [path.join(dir, 'r')],
    browseCaps: { navigateTimeoutMs: 12000, breakerFailures: 3, ignored: 1, domainTimeouts: { 'X.com': 8000 } },
  });
  const fromFile = loadConfig(['--config', cfg], {});
  assert.equal(fromFile.browseCaps.navigateTimeoutMs, 12000);
  assert.equal(fromFile.browseCaps.breakerFailures, 3);
  assert.equal(fromFile.browseCaps.breakerCooldownMs, 0);
  assert.equal(fromFile.browseCaps.maxNavigateTimeoutMs, 25000);
  assert.equal(fromFile.browseCaps.domainTimeouts['x.com'], 8000);
  assert.equal('ignored' in fromFile.browseCaps, false);
  const fromEnv = loadConfig(['--config', cfg], { CODEMODE_BROWSE_NAV_TIMEOUT_MS: '8000' });
  assert.equal(fromEnv.browseCaps.navigateTimeoutMs, 8000);
  assert.throws(
    () => loadConfig(['--config', cfg], { CODEMODE_BROWSE_NAV_TIMEOUT_MS: '30000' }),
    /CODEMODE_BROWSE_NAV_TIMEOUT_MS/,
  );
  const tooHigh = writeCfg(dir, 'hi.json', { roots: [path.join(dir, 'r')], browseCaps: { domainTimeouts: { 'x.com': 30000 } } });
  assert.throws(() => loadConfig(['--config', tooHigh], {}), /browseCaps.domainTimeouts.x.com/);
});
```

Activation: `ignored: 1` is dropped (unknown nested key, same as searchCaps).
`30000` throws rather than clamping — observable `throws` message names the env key.

---

### 3.7 MODIFY `src/host/browse/session.js` (created by wp2; **absent today**)

Current tree: file does not exist. 002: `session.js` is the ONLY
spawn+deadline+parse path. wp3 does not spawn.

Intended after-state of the per-item path (implementer re-verifies against 010
after wp2; if wp2 named the function differently, wrap that function):

```js
import { runGuardedBatch, createCircuitBreakerFromConfig } from './policy.js';

// inside the session factory — runItem is the ONLY place that may call spawnImpl
async function captureUrls(urls, opts = {}) {
  const breaker = opts.breaker ?? createCircuitBreakerFromConfig(opts.config, { now: opts.now });
  return runGuardedBatch({
    urls,
    signal: opts.signal,
    breaker,
    requestedMs: opts.navigateTimeoutMs,
    domainTimeouts: opts.domainTimeouts ?? opts.config?.browseCaps?.domainTimeouts,
    defaultMs: opts.config?.browseCaps?.navigateTimeoutMs,
    maxMs: opts.config?.browseCaps?.maxNavigateTimeoutMs,
    runItem: async ({ url, timeoutMs, signal }) => {
      // SUPERSEDED BY 003 C4. spawnOnePage is DELETED from the design: one process
      // per URL pays the measured 1.4-2.4s startup per URL and throws away the
      // 3397ms -> 908ms batching win (001 E1/E6) this whole unit exists for.
      //
      // The breaker is decide-on-host, enforce-in-script. runGuardedBatch stays a
      // host function but wraps exactly ONE session.run: policy.js emits a plain
      // per-item plan { url, timeoutMs, waitSelector, skip }, script.js embeds that
      // plan as a literal in the compiled source, the script enforces it (a skipped
      // item is failed without opening a tab), and policy.js feeds the returned
      // per-item outcomes back into breaker state so the next call sees the trip.
      throw new Error('spawnOnePage removed: batch through one session.run (003 C4)');
    },
  });
}
```

Forbidden after this patch:

- a `for`/`while` retry around `goto` or `spawnOnePage`
- `page.route` / `page.on('request')`
- `child.kill` as the domain-timeout path

If wp2 has not landed `session.js` when wp3 is implemented, land `policy.js` +
tests + config first; add the import the moment `session.js` exists. Do not
invent a second spawn path in `policy.js`.

---

### 3.8 MODIFY `src/host/browse/schema.js` / `result.js` (wp2; **absent today**)

`schema.js` after-state: re-export, do not restate:

```js
export { POLICY_OPTION_SPEC } from './policy.js';
```

and, when captureMany options are assembled in wp4, spread
`POLICY_OPTION_SPEC` into that option map so `navigateTimeoutMs` cannot drift
between discovery and execution (the search-schema lesson at
`src/search-schema.js:1-12`).

`result.js` after-state: every item in `items[]` is a plain enumerable object
with at least `{ url, domain, ok, blocked, skipped, reason, alternatePath, code }`.
Batch envelope is a plain enumerable object (002: do **not** join the
`msg.search` / `toJSON` lane at `src/sandbox.js:109-112`) with
`{ items, complete, truncated, partial, skippedDomains, scope }`.

Per-item failures live in `items[]`, never only in logs (`fitEnvelope` at
`src/execution-output.js:59-68` drops logs first).

---

## 4. Dependency order of edits inside wp3

1. `src/config.js` `DEFAULTS.browseCaps` + `apply()` + env (otherwise policy
   tests that load config fail closed).
2. `codemode.config.example.json`.
3. `src/host/browse/policy.js` (full module in §3.1).
4. fixtures in `test/fixtures/browse-policy/`.
5. `test/browse-policy.test.js` tests 1–13 (classify + timeout clamp + status).
6. breaker tests 15–25, then `runGuardedBatch` tests 26–28.
7. `test/config.test.js` + test 29–30.
8. If `session.js` / `schema.js` / `result.js` exist from wp2, apply §3.7–3.8.
9. Run the verifier in §6.

Do not start with session wiring. Policy must be testable with a fake `runItem`
before any spawn seam is touched.

---

## 5. Testable acceptance criteria

Every conditional path has an **ACTIVATION SCENARIO**. Timing is never the
oracle: outcomes are canned, clocks are injected, skip is proved by
`runItem` not being called.

### 5.1 Classification

| # | Path | ACTIVATION SCENARIO | Observable proof |
| --- | --- | --- | --- |
| C1 | login via URL + snapshot | Load `x-login.stdout.txt`. `classifyPage(payload)`. | `blocked === 'login'`, `alternatePath` contains `site:x.com` or `X API`. |
| C2 | login via status 401 | `classifyPage({ requestedUrl: 'https://a.example/x', finalUrl: 'https://a.example/x', title: 'App', status: 401, snapshotText: '' })`. | `blocked === 'login'`. |
| C3 | login via Korean text + login path | Load `login-korean.stdout.txt`. | `blocked === 'login'`. |
| C4 | login with `status: null` | Load `status-null-login.stdout.txt`. | `blocked === 'login'` — proves we do not require request interception. |
| C5 | captcha via path + snapshot | Load `cf-captcha.stdout.txt`. | `blocked === 'captcha'` even though status is 403 (priority over hard-block). |
| C6 | captcha via google sorry | Load `google-sorry.stdout.txt`. | `blocked === 'captcha'` even though status is 429 (priority over ratelimit). |
| C7 | ratelimit via status 429 | Load `ratelimit-429.stdout.txt`. | `blocked === 'ratelimit'`. |
| C8 | hard-block via 403 + access denied | Load `hardblock-403.stdout.txt`. | `blocked === 'hard-block'`. |
| C9 | hard-block via 451 | `status: 451`, empty snapshot, url `https://pay.example/`. | `blocked === 'hard-block'`. |
| C10 | ok path | Load `ok-example.stdout.txt`. | `blocked === null`, `alternatePath === null`. |
| C11 | weak CTA false-positive guard | Load `weak-signin-cta.stdout.txt`. | `blocked === null`. Title contains "Sign in" but no login URL, no login snapshot pair, status 200. |
| C12 | timeout wording is not a block class | Load `timeout-error.stdout.txt`. Pass payload through `interpretItemOutcome` with a fresh breaker. | `blocked === null`, `reason === 'timeout'`, `code === 'ETIMEOUT'`. |
| C13 | missing trailer guard | `loadStdout` helper on `'{"url":"https://x.com"}\n'` (no trailer). | throws `/fixture missing repl trailer/`. |
| C14 | `readNavStatus` function | `{ status: () => 200 }`. | returns `200`. |
| C15 | `readNavStatus` throw | `status()` throws. | returns `null` (does not throw). |
| C16 | `readNavStatus` absent | `undefined`. | returns `null`. |
| C17 | no retry after block | `runGuardedBatch` with two x.com login URLs, `runItem` returning the login payload. | `items[0].blocked === 'login'`; after two login failures (threshold 2) a third same-domain url is `skipped === 'circuit-open'` and absent from the `runItem` call log. |

C17 is the #17 "do not retry" gate **and** feeds the breaker (login counts as
차단 per #21's "타임아웃/차단").

### 5.2 Timeouts

| # | Path | ACTIVATION SCENARIO | Observable proof |
| --- | --- | --- | --- |
| T1 | default | `resolveNavigateTimeoutMs({ domain: 'example.com' })`. | `=== 15000`. |
| T2 | domain override | `domainTimeouts: { 'x.com': 8000 }`, domain `x.com`. | `=== 8000`. |
| T3 | requestedMs | `requestedMs: 12000`, no domain override. | `=== 12000`. |
| T4 | reject above Aside cap | `requestedMs: 30000` or `maxMs: 30000`. | throws `EBADVAL`. Does **not** return 30000. |
| T4b | domainTimeouts 30000 refused in config | file `browseCaps.domainTimeouts: { 'x.com': 30000 }`. | `loadConfig` throws `browseCaps.domainTimeouts.x.com` (max 25000). |
| T5 | reject below min | `requestedMs: 0`. | throws `EBADVAL`. |
| T6 | env 30000 | `loadConfig(..., { CODEMODE_BROWSE_NAV_TIMEOUT_MS: '30000' })`. | throws, names the env key. |
| T7 | runItem receives clamped budget | `runGuardedBatch` with `requestedMs: 8000`; `runItem` records `timeoutMs`. | recorded `timeoutMs === 8000`. No elapsed-time assert. |

T4/T6 are the proof that we will not sit at E4's ~30s internal screenshot
timeout. A per-domain budget of 30s would be silently absorbed by Aside and
would not mean a host-side timeout.

### 5.3 Circuit breaker state transitions

Clock: `let now = 0; new CircuitBreaker({ failureThreshold: 2, cooldownMs: 1000, now: () => now })`.

| # | Transition | ACTIVATION SCENARIO | Observable proof |
| --- | --- | --- | --- |
| B1 | closed → closed (success) | `allow('a.com')`, `recordSuccess('a.com')`. | `inspect.state === 'closed'`, `consecutiveFailures === 0`. |
| B2 | closed → closed (below threshold) | one `recordFailure('a.com', { kind: 'timeout' })`. | `state === 'closed'`, `consecutiveFailures === 1`, next `allow` has `proceed: true`. |
| B3 | closed → open | second consecutive `recordFailure`. | `state === 'open'`, `openedAt === now`. |
| B4 | open → open (reject) | `allow('a.com')` with `now` still 0, `cooldownMs: 1000`. | `proceed === false`, `skipped === 'circuit-open'`, `skippedDomains()` includes `a.com`. |
| B5 | open → half-open | after B3, set `now = 1000`, `allow('a.com')`. | `proceed === true`, `state === 'half-open'`, `probeInFlight === true`. |
| B6 | half-open → closed | B5 then `recordSuccess('a.com')`. | `state === 'closed'`, `consecutiveFailures === 0`, `probeInFlight === false`. |
| B7 | half-open → open | B5 then `recordFailure('a.com', { kind: 'timeout' })`. | `state === 'open'` even if consecutive count would not have reached threshold from zero — probe failure re-opens immediately. |
| B8 | half-open concurrent skip | B5, second `allow('a.com')` before record. | `proceed === false`, `skipped === 'circuit-open'`. Only one probe. |
| B9 | sticky open when cooldownMs=0 | `new CircuitBreaker({ cooldownMs: 0, now: () => now })`, two failures, then `now = 999999`, `allow`. | still `proceed === false`. This is production default (#21 immediate skip). Half-open is **not** reachable on this instance. |
| B10 | success resets a single failure | one failure, then success, then one failure. | still closed (consecutive count reset). |
| B11 | login/captcha/ratelimit/hard-block all count | four breakers, each `recordFailure` twice with each kind. | each opens. Covered via `interpretItemOutcome` with the four block fixtures. |
| B12 | generic `error` counts | `runItem` throws `Error('net::ERR_NAME_NOT_RESOLVED')` twice. | third url same domain skipped `circuit-open`. |
| B13 | `EBADVAL` does not count | `urls: ['not a url', 'https://example.com/']`. | first item `code === 'EBADVAL'`; example.com still proceeds. |

### 5.4 Cancellation

| # | Path | ACTIVATION SCENARIO | Observable proof |
| --- | --- | --- | --- |
| X1 | pre-abort, no work | `controller.abort()` then `runGuardedBatch({ signal: controller.signal, urls: ['https://example.com/'] })`. | rejects with `code === 'ECANCELLED'`. `runItem` call count === 0. Breaker for example.com stays closed. Mirrors `test/search-boundary.test.js:38-43`. |
| X2 | abort in-flight | `runItem` for url A returns a Promise the test rejects with `Object.assign(new Error('browse cancelled'), { code: 'ECANCELLED' })` via a handshake callback (test aborts, runItem rejects). | item `skipped === 'cancelled'`, `code === 'ECANCELLED'`. A following url on the same domain with a success still proceeds if threshold is 2 and no prior failure. |
| X3 | abort of half-open probe | Reach half-open (B5), then cancelled outcome. | `recordCancel` returns state to `open` (not closed). Next `allow` at the same `now` skips. |
| X4 | abort vs timeout | `runItem` rejects `ECANCELLED` with a message that also says `timed out`. | `isCancelledOutcome` wins: `skipped === 'cancelled'`, not `reason === 'timeout'`. Cancel must not open the circuit. |

Do not prove X2 with `timeoutMs: 300` races. The search-boundary test at
`test/search-boundary.test.js:46-51` is the anti-pattern 000 folded into wp2;
do not copy it here.

### 5.5 Batch orchestration

| # | Path | ACTIVATION SCENARIO | Observable proof |
| --- | --- | --- | --- |
| G1 | per-domain serial | urls: three `https://x.com/a|b|c` plus `https://example.com/`. `runItem` for x.com always returns the login payload; example.com returns the ok payload. Push call-order via an injected monotonic `seq++` (not wall clock). | example.com's `runItem` is called without waiting for the third x.com skip. x.com `runItem` count === 2, third x.com item `skipped === 'circuit-open'` and is absent from the call log. |
| G2 | no retry on block | `runItem` returns login. | that url appears once in the call log. |
| G3 | meta shape | After G1. | `complete === false`, `Array.isArray(partial)`, `partial` contains `blocked:login:x.com` and `circuit-open:x.com`, `skippedDomains` deep-equal `['x.com']`, `truncated === false`, `scope.breakerFailures === 2`. `JSON.stringify` of the return value **keeps** these keys (enumerable — unlike search's hidden fields at `src/search-result.js:37-39`). |
| G4 | alternatePath on skip | circuit-open item. | `alternatePath` is the x.com suggestion string, so the agent still gets the #17 replacement path when the breaker trips. |

---

## 6. Verifier

| Command | Observes this phase? | What to read |
| --- | --- | --- |
| `node --test test/browse-policy.test.js` | **yes** | 0 failures. Every name in §3.3 ran. This is the authoritative local gate for wp3. |
| `node --test test/config.test.js` | **yes** | new `browseCaps` test green; existing three tests still green. |
| `npm test` | **yes, with caveat** | `scripts/run-tests.mjs:9-12` enumerates every `test/*.test.js`, so `browse-policy.test.js` is included automatically. The pre-existing `test/search-boundary.test.js:46` race (000) can still fail in the full suite on this Windows host. If the full suite is red **only** on that test, re-run it isolated; do not treat it as a wp3 regression. Authoritative hosted gate remains CI on `origin/dev`. |
| `node --test test/search-boundary.test.js` | **no** | Does not import policy.js. Human-review only as a non-regression of the cancel seam we copied the *shape* of. |
| `node bin/codemode.mjs --doctor --browse` | **no** | wp2 capability matrix. wp3 does not add doctor keys. Mark human-review if someone runs it expecting breaker stats. |
| Live Aside against x.com logged-out | **no** | Human-review, out of CI. Tests must never do this. |

Success for wp3 = `node --test test/browse-policy.test.js test/config.test.js`
exits 0, and a grep of `src/host/browse/policy.js` shows **zero** matches for
`page.route`, `.on('request'`, `child.kill`, or a correctness `setTimeout`.
(`CircuitBreaker` may mention timeout as a *kind* string.)

---

## 7. Risks — what would prove this design wrong

1. **Status is always null in real Aside `goto`.** Then C2 (401) never fires in
   production. The design is still valid if C1/C4 (URL+snapshot) catch the
   walls we care about; it is wrong if a 429 page keeps the original URL and
   an empty snapshot — we would miss ratelimit without status. Mitigation:
   treat snapshot `too many requests` as strong even without status (C7
   fixture includes both; add a status-null ratelimit fixture if wp4's first
   live probe shows empty snapshots).
2. **False-positive login on marketing CTAs.** If C11 starts failing because
   we loosened title-only matching, revert to the two-signal rule. A design
   that classifies `weak-signin-cta.stdout.txt` as login is wrong.
3. **False-negative on Cloudflare "Just a moment..."** with no snapshot
   because `snapshot()` itself is what is blocked. Then we need URL-only
   captcha (`/cdn-cgi/challenge`) which C5 already has. If CF stays on `/`
   with only that title, WEAK title alone must stay non-firing (too many
   blogs use "Just a moment") — accept the miss rather than poison the
   classifier.
4. **Per-domain timeout ≥ 30s.** If config allows 30000, E4's screenshot
   timeout fires first and the breaker sees a 30s hang, not our budget. T4/T6
   failing (or being changed to clamp silently) proves the design was
   abandoned.
5. **First-wave stampede.** If `runGuardedBatch` is replaced with a bare
   `Promise.all` without the per-domain chain, five x.com URLs all proceed
   while closed and #21 is not actually closed. G1 is the proof; deleting the
   chain to "simplify" is the wrong design.
6. **Cancel counted as failure.** Two cancelled x.com items would open the
   circuit and skip a later legitimate fetch in the same execution. X2/X4
   failing proves this.
7. **Kill-based timeout.** Any `SIGKILL` of `aside.exe` from policy/session
   on domain timeout reintroduces E5 leaked tabs. Presence of `child.kill` on
   the browse timeout path proves the design wrong.
8. **Retry loop in wp4.** If `captureMany` retries a `blocked` item, #17 is
   not closed no matter how green wp3 tests are. 030 must call
   `runGuardedBatch` and must not wrap it in another retry.
9. **Non-enumerable batch meta.** If someone copies `hide()` from
   `search-result.js:37-39`, `fitEnvelope` / JSON.stringify will drop
   `partial` and a skipped batch will look complete — the exact search bug
   that module exists to prevent (`src/search-result.js:7-9`). G3's
   `JSON.stringify` assertion is the tripwire.
10. **Using elapsed time as the breaker cooldown in tests.** If a test
    `await setTimeout(1000)` to reach half-open, it will flake under
    `node --test` file concurrency the same way `search-boundary.test.js:46`
    does. B5 must move an injected clock.

---

## 8. Caller contract for later phases (not implemented here)

wp4 `captureMany` / wp2 session:

- Compile one repl script per `runItem` **or** one script that already
  respects per-URL `timeoutMs` (E6 allows multi-page). Either way, **in-script**
  navigate budget is `timeoutMs` from `decideItemAction`. Host `WaitForExit`
  stays **above** that in-script budget so `finally` closes tabs (001 E5
  intent: the script self-terminates; kill is last resort). Host wait still
  must not be used as the domain timeout.
- Collect `{ finalUrl: p.url(), title: await p.title(), status: readNavStatus(nav), snapshotText }` from the page. Never `page.route`.
- Pass that object to `interpretItemOutcome` by returning it from `runItem`.
- On `blocked != null`, do not screenshot, do not pdf, do not retry.
- On process kill (last resort), report `partial` plus leaked URLs (wp2);
  policy will not see those items as successes because `runItem` must throw
  `ECANCELLED` or a non-ok error.

wp5 wait-strategy and wp6 recipes must not bypass `runGuardedBatch`.
