// Drive the page by accessibility ref instead of a guessed CSS selector.
//
// Measured on macbookpro-2, Aside CLI 1.26.906.1630, 2026-09-14
// (devlog/_plan/260914_a11y-actions/010_probe_evidence.md):
//
//   page.locator("e5").click()      moved the url from #dashboard to #models
//   locator.fill("hello-from-ref")  read back as the input's value
//   press, type, hover, focus, check, selectOption, scrollIntoViewIfNeeded,
//   boundingBox, textContent, innerText, isVisible  -- ALL present on the locator
//   even though every one of them is absent on the page object
//   page.locator("f1e1").click()    clicked a button INSIDE an iframe
//
// Nothing needs emulating, and a locator enumerates as [] while all of its methods work,
// so a capability is decided by calling and catching, never by a property check.
//
// STALENESS is the real hazard, and a url comparison is not enough for it. An independent
// audit demonstrated three holes in the url-only version: refs are minted by a PREVIOUS
// call so comparing this call's url to itself always passes; a modal, a client-side tab
// switch or an SPA re-render renumbers refs with location.href unchanged; and a failed url
// read disabled the guard silently. So:
//
//   - the caller may pass refsFingerprint, taken from snapshot.fingerprint of the read that
//     produced the refs. Before the first ref step the tree is re-fingerprinted and a
//     mismatch is EREFSTALE. This is the only check that catches same-url renumbering.
//   - without a fingerprint the guard degrades to the url comparison and SAYS SO, per step,
//     in refGuard. It never claims a guarantee it does not have.
//   - both checks fail CLOSED. If the page cannot be read, a ref step is refused with
//     EREFUNKNOWN rather than run against an unknown document.
//
// Aside has its own staleness error for a ref whose element was REMOVED
// ("Ref \"e1\" is stale - the element was removed or the page changed"). That one is caught
// downstream as EACTION. It cannot catch the dangerous case, where the ref still resolves
// and now names a different element.

// ONE source of truth: this text is injected into the generated REPL scripts and is also
// evaluated below, so tests exercise the shipped code rather than a copy.
export const ACTION_STEP_SRC = String.raw`function __actionSleep(ms) {
  return new Promise(function (r) { setTimeout(r, ms); });
}
function __withTimeout(promise, ms, label) {
  if (!(ms > 0)) return promise;
  var timer = null;
  var guard = new Promise(function (_res, rej) {
    timer = setTimeout(function () {
      var e = new Error(label + ' exceeded its ' + ms + 'ms step timeout');
      e.__code = 'ESTEPTIMEOUT';
      rej(e);
    }, ms);
  });
  return Promise.race([promise, guard]).then(
    function (v) { if (timer) clearTimeout(timer); return v; },
    function (e) { if (timer) clearTimeout(timer); throw e; }
  );
}
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
// A missing method and a failed call are different answers and the caller needs both.
// The page's own broken script must never be recorded as a missing capability of the
// surface, so the thrown name has to match the verb we actually called.
function __classify(err, verb) {
  if (err && err.__code) return err.__code;
  var msg = String((err && err.message) || err);
  var missing = /is not a function|is not implemented|not implemented|not supported|has no method|Cannot read propert(y|ies) of undefined/i.test(msg);
  if (!missing) return 'EACTION';
  var names = {
    click: 'click', dblclick: 'dblclick', fill: 'fill', type: 'type', press: 'press',
    hover: 'hover', focus: 'focus', check: 'check', uncheck: 'uncheck',
    selectOption: 'selectOption', scrollIntoView: 'scrollIntoViewIfNeeded',
    waitFor: 'waitForSelector', waitForLoadState: 'waitForLoadState',
    goBack: 'goBack', goForward: 'goForward', reload: 'reload'
  };
  var want = names[verb];
  if (!want) return 'EACTION';
  return msg.indexOf(want) === -1 ? 'EACTION' : 'ENOTSUP';
}
async function runActions(page, steps, ctx) {
  var cfg = ctx || {};
  var results = [];
  var halt = null;
  var stopOnError = cfg.stopOnError !== false;
  var deadlineAt = cfg.deadlineAt || (Date.now() + 20000);
  var urlAtSnapshot = cfg.urlAtSnapshot || null;
  var wantFp = cfg.refsFingerprint || null;
  var fpChecked = false;
  var guardKind = wantFp ? 'fingerprint' : (urlAtSnapshot ? 'url-only' : 'none');
  async function readUrl() {
    return page.evaluate('location.href');
  }
  async function refGuard(rec) {
    // Fingerprint first: it is the only check that sees a same-url renumbering.
    if (wantFp && !fpChecked && typeof cfg.fingerprintOf === 'function') {
      var got = null;
      try { got = await cfg.fingerprintOf(page); }
      catch (e) {
        rec.code = 'EREFUNKNOWN';
        rec.error = 'could not re-fingerprint the tree to validate the refs: ' + String((e && e.message) || e);
        return false;
      }
      fpChecked = true;
      if (got !== wantFp) {
        rec.code = 'EREFSTALE';
        rec.error = 'refs were taken from tree ' + wantFp + ' and the page now fingerprints as '
          + got + '; the tree was renumbered, so a ref no longer names the element you read';
        return false;
      }
      return true;
    }
    if (!urlAtSnapshot) return true;
    var nowUrl;
    try { nowUrl = await readUrl(); }
    catch (e) {
      // Fail closed. The url-only guard used to disable itself here.
      rec.code = 'EREFUNKNOWN';
      rec.error = 'could not read location.href to validate the ref: ' + String((e && e.message) || e);
      return false;
    }
    if (nowUrl && nowUrl !== urlAtSnapshot) {
      rec.code = 'EREFSTALE';
      rec.error = 'refs belong to the snapshot taken at ' + urlAtSnapshot
        + ' but the page is now ' + nowUrl
        + '; take a new snapshot or pass allowStaleRefs';
      return false;
    }
    return true;
  }
  for (var i = 0; i < steps.length; i++) {
    var s = steps[i];
    var rec = {
      i: i,
      verb: s.verb,
      target: (s.target === undefined) ? null : s.target,
      targetKind: s.targetKind || null,
      via: s.via || null,
      ok: false,
      ms: 0
    };
    if (halt) {
      rec.code = halt;
      rec.error = halt === 'EDEADLINE'
        ? 'the action budget ran out before this step ran'
        : 'an earlier step failed and stopOnError was set';
      results.push(rec);
      continue;
    }
    var remaining = deadlineAt - Date.now();
    if (remaining <= 0) {
      rec.code = 'EDEADLINE';
      rec.error = 'the action budget ran out before this step ran';
      results.push(rec);
      halt = 'EDEADLINE';
      continue;
    }
    if (rec.targetKind === 'ref' && !cfg.allowStaleRefs) {
      rec.refGuard = guardKind;
      var pass = await refGuard(rec);
      if (!pass) {
        results.push(rec);
        if (stopOnError) halt = 'ESKIP';
        continue;
      }
    } else if (rec.targetKind === 'ref') {
      rec.refGuard = 'disabled';
    }
    // A step gets what is left of the budget, capped by its own timeoutMs when given.
    var stepMs = s.timeoutMs && s.timeoutMs < remaining ? s.timeoutMs : remaining;
    var t0 = Date.now();
    try {
      await __withTimeout(__applyStep(page, s, stepMs), stepMs, s.verb);
      rec.ok = true;
    } catch (e) {
      rec.error = String((e && e.message) || e).slice(0, 300);
      rec.code = __classify(e, s.verb);
    }
    rec.ms = Date.now() - t0;
    rec.timeoutMs = stepMs;
    results.push(rec);
    if (!rec.ok && stopOnError) halt = rec.code === 'ESTEPTIMEOUT' ? 'EDEADLINE' : 'ESKIP';
  }
  var endUrl = null;
  try { endUrl = await readUrl(); } catch (e) { endUrl = null; }
  return {
    steps: results,
    ok: results.every(function (r) { return r.ok; }),
    ran: results.filter(function (r) { return r.ok; }).length,
    refGuard: guardKind,
    navigated: Boolean(urlAtSnapshot && endUrl && endUrl !== urlAtSnapshot),
    urlBefore: urlAtSnapshot,
    urlAfter: endUrl
  };
}`;

export const runActions = new Function(ACTION_STEP_SRC + '; return runActions;')();

