// Drive the page by accessibility ref instead of a guessed CSS selector.
//
// Measured on macbookpro-2, Aside CLI 1.26.906.1630, 2026-09-14
// (devlog/_plan/260914_a11y-actions/010_probe_evidence.md): every verb below is present on
// page.locator(target) and absent on the page object, a locator enumerates as [] while all
// of its methods work, and a child frame's element is addressable from the top-level page
// as an f-prefixed ref, so iframe interaction needs no frame API.
//
// STALENESS is the hazard, and two independent audit rounds moved where it lives.
//
//   round 1: comparing this call's url to itself always passed, and a same-url renumbering
//            went straight through.  -> a tree fingerprint was added.
//   round 2: the fingerprint was checked ONCE, so step 1's click could renumber the tree and
//            step 2 got only a url check while still being labelled 'fingerprint'.
//            That is the original silent-wrong-element bug moved to step 2 onward.
//
// So the tree is marked dirty by any step that can change it, and a ref step that follows a
// dirty step is re-fingerprinted before it runs. The label is per step and names what that
// step actually got: 'fingerprint', 'url-only', 'disabled' or 'none'. Never a guarantee we
// did not perform.
//
// Aside has its own error for a ref whose element was REMOVED. It cannot see the dangerous
// case, where the ref still resolves and now names a different element.
//
// The guarantee is POINT IN TIME and nothing can make it otherwise: the fingerprint is
// verified, then a snapshot round trip later the verb runs, and a page that re-renders on
// its own in that window - or, on an attached tab, the user - moves the refs after the
// check passed. So every ref step reports guardAgeMs, the measured width of that window,
// instead of the code implying the check and the click were atomic.

// ONE source of truth: injected into the generated REPL scripts and evaluated below, so the
// tests exercise the shipped code rather than a copy.
export const ACTION_STEP_SRC = String.raw`function __actionSleep(ms) {
  return new Promise(function (r) { setTimeout(r, ms); });
}
function __withTimeout(promise, ms, label) {
  if (!(ms > 0)) return promise;
  var timer = null;
  var guard = new Promise(function (_res, rej) {
    timer = setTimeout(function () {
      var e = new Error(label + ' exceeded its ' + ms + 'ms timeout');
      e.__code = 'ESTEPTIMEOUT';
      rej(e);
    }, ms);
  });
  return Promise.race([promise, guard]).then(
    function (v) { if (timer) clearTimeout(timer); return v; },
    function (e) { if (timer) clearTimeout(timer); throw e; }
  );
}
// Steps that cannot change the tree. Everything else marks it dirty, including the page
// level navigations, because a ref minted before them means nothing after.
// Only sleepMs. scroll is how infinite scroll and virtualized lists mount new rows,
// waitFor succeeds BECAUSE the DOM changed, and waitForLoadState waits for content to
// arrive. Calling those inert was harmless only by accident today and becomes a hole the
// moment a read-only ref verb exists.
var __INERT = { sleepMs: 1 };
function __applyStep(page, s, stepMs) {
  var loc = (s.target === null || s.target === undefined) ? null : page.locator(s.target);
  switch (s.verb) {
    case 'click': return loc.click();
    case 'dblclick': return loc.dblclick();
    case 'fill': return loc.fill(s.value);
    case 'type': return loc.type(s.value);
    case 'press': return loc.press(s.value);
    case 'hover': return loc.hover();
    case 'focus': return loc.focus();
    case 'check': return loc.check();
    case 'uncheck': return loc.uncheck();
    case 'selectOption': return loc.selectOption(s.value);
    case 'scrollIntoView': return loc.scrollIntoViewIfNeeded();
    case 'waitFor': return page.waitForSelector(s.target, { timeout: stepMs });
    case 'waitForLoadState': return page.waitForLoadState(s.value);
    case 'goBack': return page.goBack();
    case 'goForward': return page.goForward();
    case 'reload': return page.reload();
    case 'sleepMs': return __actionSleep(s.value);
    case 'scroll':
      if (s.value === 'top') return page.evaluate('window.scrollTo(0,0)');
      if (s.value === 'bottom') return page.evaluate('window.scrollTo(0,document.body.scrollHeight)');
      return page.evaluate('window.scrollTo(0,' + Number(s.value) + ')');
    default: {
      var e = new Error('unknown action verb ' + s.verb);
      e.__code = 'EBADVERB';
      throw e;
    }
  }
}
// The page's own broken script must never be recorded as a missing capability of the
// surface, so a message only counts as ENOTSUP when it names a method this verb calls.
var __VERB_METHODS = {
  click: ['click', 'locator'], dblclick: ['dblclick', 'locator'], fill: ['fill', 'locator'],
  type: ['type', 'locator'], press: ['press', 'locator'], hover: ['hover', 'locator'],
  focus: ['focus', 'locator'], check: ['check', 'locator'], uncheck: ['uncheck', 'locator'],
  selectOption: ['selectOption', 'locator'], scrollIntoView: ['scrollIntoViewIfNeeded', 'locator'],
  waitFor: ['waitForSelector'], waitForLoadState: ['waitForLoadState'],
  goBack: ['goBack'], goForward: ['goForward'], reload: ['reload'],
  scroll: ['evaluate'], sleepMs: []
};
function __classify(err, verb) {
  if (err && err.__code) return err.__code;
  var msg = String((err && err.message) || err);
  var names = __VERB_METHODS[verb] || [];
  for (var i = 0; i < names.length; i++) {
    var n = names[i];
    // The NAME has to be the thing reported missing, not merely present in the string. A
    // driver prefixes its errors ("page.evaluate: window.gtag is not a function"), so a
    // substring test turned the page's own broken script into a missing capability.
    var direct = new RegExp('(^|[^A-Za-z0-9_$])' + n + '\\s*(is not a function|is not implemented|is not supported)', 'i');
    var reading = new RegExp('Cannot read propert(y|ies) of undefined.*' + n, 'i');
    var method = new RegExp('(^|[^A-Za-z0-9_$])' + n + '\\s*:\\s*(Not implemented|Not supported)', 'i');
    if (direct.test(msg) || reading.test(msg) || method.test(msg)) return 'ENOTSUP';
  }
  return 'EACTION';
}
async function runActions(page, steps, ctx) {
  var cfg = ctx || {};
  var results = [];
  var halt = null;
  var haltMessage = null;
  var stopOnError = cfg.stopOnError !== false;
  var deadlineAt = cfg.deadlineAt || (Date.now() + 20000);
  var urlAtSnapshot = cfg.urlAtSnapshot || null;
  var canFingerprint = Boolean(cfg.refsFingerprint) && typeof cfg.fingerprintOf === 'function';
  var wantFp = canFingerprint ? cfg.refsFingerprint : null;
  var probeMs = cfg.guardTimeoutMs || 5000;
  // The tree is clean until something that could change it has run.
  var dirty = false;
  var verifiedClean = false;
  var guardAt = null;
  function budgetLeft() { return deadlineAt - Date.now(); }
  function readUrl() {
    return __withTimeout(Promise.resolve().then(function () { return page.evaluate('location.href'); }),
      Math.min(probeMs, Math.max(1, budgetLeft())), 'location.href');
  }
  async function guardRefStep(rec) {
    if (canFingerprint) {
      rec.refGuard = 'fingerprint';
      // Only pay for a snapshot when something could actually have moved.
      if (verifiedClean && !dirty) return true;
      var got = null;
      try {
        got = await __withTimeout(Promise.resolve().then(function () { return cfg.fingerprintOf(page); }),
          Math.min(probeMs, Math.max(1, budgetLeft())), 'ref fingerprint');
      } catch (e) {
        rec.code = 'EREFUNKNOWN';
        rec.error = 'could not re-fingerprint the tree to validate this ref: ' + String((e && e.message) || e);
        return false;
      }
      var fullFp = got && typeof got === 'object' ? got.full : got;
      var structFp = got && typeof got === 'object' ? got.structure : null;
      if (fullFp !== wantFp && structFp !== wantFp) {
        rec.code = 'EREFSTALE';
        rec.error = 'refs were taken from tree ' + wantFp + ' and the page now fingerprints as '
          + fullFp + (structFp ? ' (structure ' + structFp + ')' : '')
          + '; the tree changed, so a ref may no longer name the element you read. Take a new'
          + ' snapshot. fingerprintStructure exists for pages whose accessible names carry a'
          + ' clock or a badge, but it compares ref and role ONLY: a list that reorders under'
          + ' stable refs is invisible to it, so do not use it to click anything destructive';
        return false;
      }
      verifiedClean = true;
      dirty = false;
      guardAt = Date.now();
      return true;
    }
    if (!urlAtSnapshot) { rec.refGuard = 'none'; guardAt = Date.now(); return true; }
    rec.refGuard = 'url-only';
    var nowUrl;
    try { nowUrl = await readUrl(); }
    catch (e) {
      rec.code = 'EREFUNKNOWN';
      rec.error = 'could not read location.href to validate this ref: ' + String((e && e.message) || e);
      return false;
    }
    if (nowUrl && nowUrl !== urlAtSnapshot) {
      rec.code = 'EREFSTALE';
      rec.error = 'refs belong to the snapshot taken at ' + urlAtSnapshot
        + ' but the page is now ' + nowUrl
        + '; take a new snapshot, pass refsFingerprint, or set allowStaleRefs';
      return false;
    }
    guardAt = Date.now();
    return true;
  }
  for (var i = 0; i < steps.length; i++) {
    var s = steps[i];
    var rec = {
      i: i, verb: s.verb,
      target: (s.target === undefined) ? null : s.target,
      targetKind: s.targetKind || null,
      via: s.via || null, ok: false, ms: 0
    };
    if (halt) {
      rec.code = halt;
      rec.error = haltMessage;
      results.push(rec);
      continue;
    }
    var remaining = budgetLeft();
    if (remaining <= 0) {
      rec.code = 'EDEADLINE';
      rec.error = 'the action budget ran out before this step ran';
      results.push(rec);
      halt = 'EDEADLINE';
      haltMessage = rec.error;
      continue;
    }
    if (rec.targetKind === 'ref') {
      if (cfg.allowStaleRefs) {
        rec.refGuard = 'disabled';
      } else {
        var pass = await guardRefStep(rec);
        if (!pass) {
          results.push(rec);
          if (cfg.onStep) cfg.onStep(rec);
          if (stopOnError) { halt = 'ESKIP'; haltMessage = 'an earlier step was refused and stopOnError was set'; }
          continue;
        }
      }
    }
    // Whether the cut-off came from this step's own timeoutMs or from the shared budget
    // decides which code is honest afterwards. Reporting a step's own timeout as budget
    // exhaustion is the same misattribution as the reverse.
    var ownTimeout = Boolean(s.timeoutMs && s.timeoutMs < budgetLeft());
    var stepMs = ownTimeout ? s.timeoutMs : Math.max(1, budgetLeft());
    var t0 = Date.now();
    // How stale the authorisation already was when the verb finally ran. Zero would be a
    // lie; this is the real window a page had to move underneath the check.
    if (rec.targetKind === 'ref' && guardAt !== null) rec.guardAgeMs = t0 - guardAt;
    try {
      await __withTimeout(__applyStep(page, s, stepMs), stepMs, s.verb);
      rec.ok = true;
    } catch (e) {
      rec.error = String((e && e.message) || e).slice(0, 300);
      rec.code = __classify(e, s.verb);
      if (rec.code === 'ESTEPTIMEOUT' && !ownTimeout) {
        rec.code = 'EDEADLINE';
        rec.error = 'the action budget ran out while this step was running';
      }
    }
    rec.ms = Date.now() - t0;
    rec.timeoutMs = stepMs;
    if (!__INERT[s.verb]) dirty = true;
    results.push(rec);
    // Report the step the moment it has run. A side effect on a live page must leave a
    // record even if everything after this point is killed by a deadline.
    if (cfg.onStep) cfg.onStep(rec);
    if (!rec.ok && stopOnError) {
      if (rec.code === 'EDEADLINE') {
        halt = 'EDEADLINE';
        haltMessage = 'the action budget ran out before this step ran';
      } else if (rec.code === 'ESTEPTIMEOUT') {
        halt = 'ESKIP';
        haltMessage = 'an earlier step hit its own timeoutMs and stopOnError was set; the shared budget was not exhausted';
      } else {
        halt = 'ESKIP';
        haltMessage = 'an earlier step failed and stopOnError was set';
      }
    }
  }
  var endUrl = null;
  try { endUrl = await readUrl(); } catch (e) { endUrl = null; }
  var guards = results.filter(function (r) { return r.targetKind === 'ref'; }).map(function (r) { return r.refGuard; });
  return {
    steps: results,
    ok: results.every(function (r) { return r.ok; }),
    ran: results.filter(function (r) { return r.ok; }).length,
    // Report what the ref steps ACTUALLY got. One label for all of them only when they all
    // got the same one; 'mixed' otherwise, so a strong word never covers a weak step.
    refGuard: guards.length === 0 ? 'n/a' : (guards.every(function (g) { return g === guards[0]; }) ? guards[0] : 'mixed'),
    refGuards: guards,
    navigated: Boolean(urlAtSnapshot && endUrl && endUrl !== urlAtSnapshot),
    urlBefore: urlAtSnapshot,
    urlAfter: endUrl
  };
}`;

export const runActions = new Function(ACTION_STEP_SRC + '; return runActions;')();
