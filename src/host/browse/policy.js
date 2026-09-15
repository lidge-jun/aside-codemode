// Two jobs, both about not wasting a budget on a page that was never going to work.
//
// detect(): a login wall, a CAPTCHA and a hard block all look like 'the page loaded' to a
// naive caller. Retrying them burns the deadline and still fails, so they are named and
// returned immediately with the route that could actually work.
//
// createBreaker(): a slow or hostile domain must not be allowed to spend the whole batch.
// State lives on the host across calls; enforcement happens inside the compiled script,
// which is why plan() emits plain data and record() takes the outcomes back.

const CAPTCHA = /captcha|are you a robot|verify you are human|cf-challenge|cloudflare/i;
const HARD_BLOCK = /access denied|403 forbidden|rate limit|too many requests|blocked|forbidden/i;
const LOGIN_PATH = /(login|signin|sign-in|auth|account|sso)/i;
// A string match on the snapshot tree, NOT an accessibility role query: no role API was ever
// measured on this surface, and assuming one is how unmeasured behaviour gets baked in.
const PASSWORD_HINT = /password|비밀번호|passphrase/i;

export function hostOf(url) {
  try { return new URL(url).host.toLowerCase(); } catch (_) { return null; }
}

// The compiled REPL script cannot import this module, so the patterns travel as DATA and
// the script rebuilds them. That keeps one source of truth for the signals while still
// letting detection happen inside the script, BEFORE a screenshot is paid for.
export function detectionPatterns() {
  return {
    captcha: CAPTCHA.source,
    hardBlock: HARD_BLOCK.source,
    loginPath: LOGIN_PATH.source,
    password: PASSWORD_HINT.source,
  };
}

export function detect({ requestedUrl, finalUrl, title = '', tree = '' }) {
  const hay = `${title}\n${tree}`;
  if (CAPTCHA.test(hay)) {
    return { kind: 'captcha', alternate: 'authenticated-exec', why: 'a challenge page was served' };
  }
  if (HARD_BLOCK.test(hay)) {
    return { kind: 'blocked', alternate: 'api', why: 'the origin refused or rate-limited this client' };
  }
  const from = hostOf(requestedUrl);
  const to = hostOf(finalUrl);
  const redirected = Boolean(from && to && from !== to);
  const looksLikeLogin = Boolean(finalUrl && LOGIN_PATH.test(finalUrl));
  if ((redirected && looksLikeLogin) || (looksLikeLogin && PASSWORD_HINT.test(hay)) || (redirected && PASSWORD_HINT.test(hay))) {
    return { kind: 'login-wall', alternate: 'authenticated-exec', why: 'the request landed on a sign-in page' };
  }
  return null;
}

export function createBreaker({ failures = 3, cooldownMs = 30000, now = Date.now } = {}) {
  // host -> { fails, openedAt, probing }
  const hosts = new Map();

  function entry(host) {
    let e = hosts.get(host);
    if (!e) { e = { fails: 0, openedAt: null, probing: false }; hosts.set(host, e); }
    return e;
  }

  function state(host) {
    const e = hosts.get(host);
    if (!e || e.openedAt === null) return 'closed';
    return now() - e.openedAt >= cooldownMs ? 'half-open' : 'open';
  }

  function plan(urls, { domainTimeouts = {}, defaultTimeoutMs = 25000, innerCapMs = 25000, waitSelector = null } = {}) {
    const probedThisPlan = new Set();
    return urls.map((url) => {
      const host = hostOf(url);
      const s = host ? state(host) : 'closed';
      // A per-domain timeout at or above Aside's own ~30s screenshot ceiling would never
      // fire first, so it is clamped to the inner cap to stay meaningful.
      const wanted = host && Number.isSafeInteger(domainTimeouts[host]) ? domainTimeouts[host] : defaultTimeoutMs;
      const timeoutMs = Math.max(1, Math.min(wanted, innerCapMs));
      let skip = false;
      if (s === 'open') skip = true;
      else if (s === 'half-open') {
        // exactly one probe per cooldown window
        if (probedThisPlan.has(host)) skip = true;
        else { probedThisPlan.add(host); entry(host).probing = true; }
      }
      return { url, timeoutMs, waitSelector, skip, breaker: s };
    });
  }

  function record(items = []) {
    for (const item of items) {
      const host = hostOf(item && item.url);
      if (!host) continue;
      if (item.code === 'ESKIP') continue;
      const e = entry(host);
      if (item.ok) {
        e.fails = 0;
        e.openedAt = null;
        e.probing = false;
      } else {
        e.fails += 1;
        if (e.probing) { e.openedAt = now(); e.probing = false; }
        else if (e.fails >= failures) e.openedAt = now();
      }
    }
  }

  function snapshot() {
    const out = {};
    for (const host of hosts.keys()) out[host] = { state: state(host), fails: hosts.get(host).fails };
    return out;
  }

  return Object.freeze({ plan, record, state, snapshot });
}
