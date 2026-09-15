// Block detection and the circuit breaker. The clock is injected everywhere, so every
// state transition is driven by an explicit value and nothing here sleeps.
import test from 'node:test';
import assert from 'node:assert/strict';
import { detect, createBreaker, hostOf, detectionPatterns } from '../src/host/browse/policy.js';

test('a CAPTCHA page is named rather than retried', () => {
  const v = detect({ requestedUrl: 'https://x.test/a', finalUrl: 'https://x.test/a', title: 'Verify you are human', tree: '' });
  assert.equal(v.kind, 'captcha');
  assert.equal(v.alternate, 'authenticated-exec');
});

test('a hard block is named and routed to the api alternate', () => {
  const v = detect({ requestedUrl: 'https://x.test/a', finalUrl: 'https://x.test/a', title: '403 Forbidden', tree: '' });
  assert.equal(v.kind, 'blocked');
  assert.equal(v.alternate, 'api');
});

test('a cross-host redirect to a sign-in path is a login wall', () => {
  const v = detect({ requestedUrl: 'https://app.test/dash', finalUrl: 'https://accounts.test/login', title: 'Sign in', tree: '' });
  assert.equal(v.kind, 'login-wall');
});

test('a password field on a login path counts even without a redirect', () => {
  const v = detect({ requestedUrl: 'https://x.test/login', finalUrl: 'https://x.test/login', title: '', tree: 'textbox Password' });
  assert.equal(v.kind, 'login-wall');
});

test('an ordinary page is not falsely accused', () => {
  assert.equal(detect({ requestedUrl: 'https://x.test/a', finalUrl: 'https://x.test/a', title: 'Example Domain', tree: 'heading Example' }), null);
  // A same-host redirect that is not login-shaped must not trip either.
  assert.equal(detect({ requestedUrl: 'https://x.test/a', finalUrl: 'https://x.test/b', title: 'Docs', tree: '' }), null);
});

test('detection patterns travel as plain strings for the compiled script', () => {
  const p = detectionPatterns();
  for (const k of ['captcha', 'hardBlock', 'loginPath', 'password']) {
    assert.equal(typeof p[k], 'string');
    assert.doesNotThrow(() => new RegExp(p[k], 'i'));
  }
});

test('hostOf is total: a bad url yields null instead of throwing', () => {
  assert.equal(hostOf('not a url'), null);
  assert.equal(hostOf('https://A.TEST/x'), 'a.test');
});

test('closed -> open after the configured number of consecutive failures', () => {
  const b = createBreaker({ failures: 3, cooldownMs: 1000, now: () => 1000 });
  const fail = { url: 'https://slow.test/a', ok: false };
  b.record([fail]); b.record([fail]);
  assert.equal(b.state('slow.test'), 'closed', 'two failures must not trip it');
  b.record([fail]);
  assert.equal(b.state('slow.test'), 'open');
  assert.equal(b.plan(['https://slow.test/a'])[0].skip, true, 'an open breaker must skip the domain');
});

test('open -> half-open once the cooldown has elapsed, and only one probe is allowed', () => {
  let clock = 1000;
  const b = createBreaker({ failures: 1, cooldownMs: 500, now: () => clock });
  b.record([{ url: 'https://slow.test/a', ok: false }]);
  assert.equal(b.state('slow.test'), 'open');
  clock = 1500;
  assert.equal(b.state('slow.test'), 'half-open');
  const plan = b.plan(['https://slow.test/a', 'https://slow.test/b']);
  assert.equal(plan[0].skip, false, 'exactly one probe passes');
  assert.equal(plan[1].skip, true, 'the rest stay skipped during half-open');
});

test('half-open -> closed when the probe succeeds', () => {
  let clock = 1000;
  const b = createBreaker({ failures: 1, cooldownMs: 500, now: () => clock });
  b.record([{ url: 'https://slow.test/a', ok: false }]);
  clock = 1500;
  b.plan(['https://slow.test/a']);
  b.record([{ url: 'https://slow.test/a', ok: true }]);
  assert.equal(b.state('slow.test'), 'closed');
  assert.equal(b.plan(['https://slow.test/a'])[0].skip, false);
});

test('half-open -> open when the probe fails, restarting the cooldown', () => {
  let clock = 1000;
  const b = createBreaker({ failures: 1, cooldownMs: 500, now: () => clock });
  b.record([{ url: 'https://slow.test/a', ok: false }]);
  clock = 1500;
  b.plan(['https://slow.test/a']);
  b.record([{ url: 'https://slow.test/a', ok: false }]);
  assert.equal(b.state('slow.test'), 'open', 'a failed probe reopens');
  clock = 1900;
  assert.equal(b.state('slow.test'), 'open', 'and the cooldown restarts from the probe');
  clock = 2000;
  assert.equal(b.state('slow.test'), 'half-open');
});

test('a skipped item does not count as a failure against the domain', () => {
  const b = createBreaker({ failures: 2, cooldownMs: 1000, now: () => 1 });
  b.record([{ url: 'https://x.test/a', ok: false, code: 'ESKIP' }]);
  b.record([{ url: 'https://x.test/a', ok: false, code: 'ESKIP' }]);
  assert.equal(b.state('x.test'), 'closed');
});

test('a per-domain timeout is clamped below the inner cap so it can still fire first', () => {
  // Aside has its own ~30s screenshot timeout; a per-domain value above the inner cap
  // would never fire first and would be decorative.
  const b = createBreaker({ now: () => 1 });
  const plan = b.plan(['https://slow.test/a'], { domainTimeouts: { 'slow.test': 999999 }, innerCapMs: 25000 });
  assert.equal(plan[0].timeoutMs, 25000);
});

test('breakers are per domain, not global', () => {
  const b = createBreaker({ failures: 1, cooldownMs: 1000, now: () => 1 });
  b.record([{ url: 'https://bad.test/a', ok: false }]);
  assert.equal(b.state('bad.test'), 'open');
  assert.equal(b.state('good.test'), 'closed');
  assert.equal(b.plan(['https://good.test/a'])[0].skip, false);
});

// These two patterns were merely noisy while a detected block produced a status the
// contract rejected. They now produce needs_input, which a reader is taught to hand to a
// person and not retry, so a false positive reads as a correct answer. Each case below is
// a page that was being accused of something.
const page = (o) => detect({
  requestedUrl: o.from || 'https://a.test/x',
  finalUrl: o.to || o.from || 'https://a.test/x',
  title: o.title || '',
  tree: o.tree || '',
});

test('a page that merely mentions cloudflare is not a challenge', () => {
  assert.equal(page({ title: 'Pricing', tree: 'Protected by Cloudflare' }), null);
  assert.equal(page({ title: 'Cloudflare Workers docs', tree: 'cloudflare workers runtime apis' }), null);
});

test('an actual challenge page is still a challenge', () => {
  assert.equal(page({ title: 'Just a moment...', tree: 'Checking your browser before accessing' }).kind, 'captcha');
  assert.equal(page({ title: 'Attention Required! | Cloudflare', tree: '' }).kind, 'captcha');
  assert.equal(page({ tree: 'Please complete the captcha' }).kind, 'captcha');
  assert.equal(page({ tree: 'verify you are human' }).kind, 'captcha');
});

// The signed-in case the bare word `account` was accusing.
test('a settings page you are already signed in to is not a sign-in wall', () => {
  const settings = page({
    from: 'https://app.test/account/settings',
    tree: 'Change password  Current password  New password',
  });
  assert.equal(settings, null, 'a password field on your own settings page is not a login wall');
});

test('a path segment is a segment, not a substring', () => {
  // `auth` inside `author`, and `sso` inside `lesson`.
  assert.equal(page({ from: 'https://blog.test/author/jane', tree: 'password' }), null);
  assert.equal(page({ from: 'https://lms.test/lesson/3', tree: 'password reset help' }), null);
});

test('a real sign-in wall is still a sign-in wall', () => {
  // Redirected to another host, landing on a sign-in path.
  const wall = page({ from: 'https://app.test/dashboard', to: 'https://id.test/login?next=/dashboard' });
  assert.equal(wall.kind, 'login-wall');
  // Same host, a sign-in path and a password field.
  assert.equal(page({ from: 'https://app.test/auth/callback', tree: 'Password' }).kind, 'login-wall');
  assert.equal(page({ from: 'https://app.test/sso', tree: 'Password' }).kind, 'login-wall');
});
