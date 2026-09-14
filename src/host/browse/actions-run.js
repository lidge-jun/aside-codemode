// Drive the page by accessibility ref instead of a guessed CSS selector.
//
// Measured on macbookpro-2, Aside CLI 1.26.906.1630, 2026-09-14
// (devlog/_plan/260914_a11y-actions/010_probe_evidence.md):
//
//   page.locator("e5").click()   moved the url from #dashboard to #models
//   locator.fill("hello-from-ref") read back as the input's value
//   press, type, hover, focus, check, selectOption, scrollIntoViewIfNeeded,
//   boundingBox, textContent, innerText, isVisible  -- ALL present on the locator
//   even though every one of them is absent on the page object
//   page.locator("f1e1").click() clicked a button INSIDE an iframe, confirmed by
//   reading the child document afterwards
//
// Two consequences shape this module. Nothing needs emulating, so every verb is a
// direct call. And a locator enumerates as [] while all of its methods work, so a
// capability is decided by calling and catching, never by checking for a property.
//
// The hazard is refs, not verbs. A ref belongs to the snapshot that produced it; the
// same click above grew the tree from 3,126 to 23,530 characters, which renumbers
// everything. Acting on a stale ref would click the wrong element and report success,
// so a ref step refuses once the url has moved.

// ONE source of truth: this text is injected into the generated REPL scripts and is
// also evaluated below, so tests exercise the shipped code rather than a copy.
export const ACTION_STEP_SRC = String.raw`function __actionSleep(ms) {
  return new Promise(function (r) { setTimeout(r, ms); });
}
function __applyStep(page, s) {
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
    case 'waitFor': return page.waitForSelector(s.target);
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
async function runActions(page, steps, ctx) {
  var cfg = ctx || {};
  var results = [];
  var stopped = false;
  var stopOnError = cfg.stopOnError !== false;
  var deadlineAt = cfg.deadlineAt || (Date.now() + 20000);
  var urlAtSnapshot = cfg.urlAtSnapshot || null;
  var navigated = false;
  async function readUrl() {
    try { return await page.evaluate('location.href'); } catch (e) { return null; }
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
    if (stopped) {
      rec.code = 'ESKIP';
      rec.error = 'an earlier step failed and stopOnError was set';
      results.push(rec);
      continue;
    }
    if (Date.now() >= deadlineAt) {
      rec.code = 'EDEADLINE';
      rec.error = 'the action budget ran out before this step ran';
      results.push(rec);
      if (stopOnError) stopped = true;
      continue;
    }
    if (rec.targetKind === 'ref' && !cfg.allowStaleRefs && urlAtSnapshot) {
      var nowUrl = await readUrl();
      if (nowUrl && nowUrl !== urlAtSnapshot) {
        rec.code = 'EREFSTALE';
        rec.error = 'refs belong to the snapshot taken at ' + urlAtSnapshot
          + ' but the page is now ' + nowUrl
          + '; take a new snapshot or pass allowStaleRefs';
        results.push(rec);
        if (stopOnError) stopped = true;
        continue;
      }
    }
    var t0 = Date.now();
    try {
      await __applyStep(page, s);
      rec.ok = true;
    } catch (e) {
      var msg = String((e && e.message) || e);
      rec.error = msg.slice(0, 300);
      // The surface genuinely not having the method reads differently from the call
      // failing, and the caller needs to tell those apart.
      if (e && e.__code) rec.code = e.__code;
      else if (/is not a function|undefined is not|has no method/i.test(msg)) rec.code = 'ENOTSUP';
      else rec.code = 'EACTION';
    }
    rec.ms = Date.now() - t0;
    results.push(rec);
    if (!rec.ok && stopOnError) stopped = true;
  }
  var endUrl = await readUrl();
  if (urlAtSnapshot && endUrl && endUrl !== urlAtSnapshot) navigated = true;
  return {
    steps: results,
    ok: results.every(function (r) { return r.ok; }),
    ran: results.filter(function (r) { return r.ok; }).length,
    navigated: navigated,
    urlBefore: urlAtSnapshot,
    urlAfter: endUrl
  };
}`;

export const runActions = new Function(ACTION_STEP_SRC + '; return runActions;')();

