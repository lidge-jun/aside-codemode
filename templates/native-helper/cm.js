// cm - the batch helper that runs INSIDE Aside's REPL.
//
// It does not wrap the native API. openTab, snapshot, page.locator, cua and display stay
// exactly what they are; cm only owns the three things a loop written by hand keeps getting
// wrong: how many tabs are open at once, what happens to a tab when its item throws, and
// what the run is allowed to claim when it did not finish.
//
// The result uses the SAME keys and the same status set as the host batch (browse/2), so one
// reader understands both. Load it by the absolute path the installed skill prints for this
// account:
//
//     const src = await fs.readFile('<accountRoot>/codemode/cm.js', 'utf8');
//     (0, eval)(src);
//
// The absolute form is the one measured to work on both surfaces that read the skill. A
// session-relative '../../codemode/cm.js' works under 'aside repl' only; the in-app agent
// REPL resolves from the account root and refuses it.
globalThis.cm = (function () {
  var VERSION = '__CM_VERSION__';

  function jid(i) { return 'j' + String(i).padStart(3, '0'); }

  // Workers pull from one queue instead of being handed a slice. A slice gives every worker
  // the same number of items regardless of how long each takes, so one slow page idles the
  // rest of the budget.
  async function mapLimit(items, limit, fn) {
    var list = items || [];
    var out = new Array(list.length);
    var next = 0;
    var workers = [];
    var width = Math.max(1, Math.min(limit || 1, list.length || 1));
    for (var w = 0; w < width; w++) {
      workers.push((async function () {
        for (;;) {
          var i = next++;
          if (i >= list.length) return;
          out[i] = await fn(list[i], i);
        }
      })());
    }
    await Promise.all(workers);
    return out;
  }

  // An operation that was started and never confirmed is indeterminate, not failed. The page
  // may have acted on it. Collapsing the two is how a retry double-submits a form.
  function settle(rows) {
    var by = {};
    var order = [];
    rows.forEach(function (e) {
      if (!by[e.operationId]) { by[e.operationId] = { operationId: e.operationId, jobId: e.jobId, state: 'started' }; order.push(e.operationId); }
      if (e.state === 'confirmed') by[e.operationId].state = 'confirmed';
    });
    return order.map(function (k) {
      return by[k].state === 'confirmed' ? by[k] : { operationId: k, jobId: by[k].jobId, state: 'indeterminate' };
    });
  }

  async function run(cfg) {
    var conf = cfg || {};
    if (typeof conf.onItem !== 'function') throw new Error('cm.run needs onItem(tab, item, jobId)');
    var items = conf.items || [];
    var limit = conf.limit || 2;
    var maxTabs = conf.maxTabs || 8;
    var runId = 'cm-' + Date.now().toString(36);
    var deadlineAt = Date.now() + (conf.deadlineMs || 90000);
    var requested = 0, closed = 0, peak = 0;
    var leaked = [], effects = [], done = [];
    function owned() { return requested - closed; }

    var results = await mapLimit(items, limit, async function (item, i) {
      var jobId = jid(i);
      if (Date.now() > deadlineAt) return { jobId: jobId, status: 'indeterminate', code: 'EDEADLINE' };
      for (var k = 0; k < 40 && owned() >= maxTabs && Date.now() < deadlineAt; k++) await sleep(50);
      if (owned() >= maxTabs) return { jobId: jobId, status: 'skipped', code: 'ETABBUDGET' };
      var opId = runId + '-' + jobId;
      effects.push({ operationId: opId, jobId: jobId, state: 'started' });
      // Reserved BEFORE the open, because a tab that is being opened is a tab the budget has
      // already promised. Counting it after the await lets every worker pass the check at once.
      requested += 1;
      if (owned() > peak) peak = owned();
      var tab = null;
      try {
        try {
          tab = await openTab(item && item.url);
        } catch (openErr) {
          // The reservation has to be refunded or owned() never comes back down and every
          // later item dies with ETABBUDGET for a tab that does not exist.
          requested -= 1;
          return { jobId: jobId, status: 'failed', code: 'EOPEN',
            error: String((openErr && openErr.message) || openErr).slice(0, 300) };
        }
        var value = await conf.onItem(tab, item, jobId);
        effects.push({ operationId: opId, jobId: jobId, state: 'confirmed' });
        done.push(jobId);
        return { jobId: jobId, status: 'completed', value: value };
      } catch (e) {
        return { jobId: jobId, status: 'failed',
          error: String((e && e.message) || e).slice(0, 300) };
      } finally {
        if (tab) {
          // A close that rejects, or never answers, must not delete this item's result. It is
          // raced and its outcome is reported as a leak instead of thrown.
          var closer = Promise.resolve().then(function () { return tab.close(); })
            .then(function () { return 'closed'; }, function () { return 'failed'; });
          var how = await Promise.race([closer, sleep(1500).then(function () { return 'capped'; })]);
          if (how === 'closed') closed += 1;
          else leaked.push({ jobId: jobId, url: item && item.url, why: how });
        }
      }
    });

    var rows = results.map(function (r, i) { return r || { jobId: jid(i), status: 'unreturned' }; });
    var settled = settle(effects);
    var completed = rows.filter(function (r) { return r.status === 'completed'; }).length;
    var indeterminate = settled.some(function (e) { return e.state === 'indeterminate'; })
      || rows.some(function (r) { return r.status === 'indeterminate'; });
    var status = 'partial';
    if (completed === rows.length && leaked.length === 0 && !indeterminate) status = 'completed';
    else if (completed === 0) status = indeterminate ? 'indeterminate' : 'failed';

    return {
      schema: 'cm/1',
      version: VERSION,
      runId: runId,
      status: status,
      requested: rows.length,
      completed: completed,
      unreturned: rows.filter(function (r) { return r.status === 'unreturned'; }).length,
      items: rows,
      effects: settled,
      tabs: { requested: requested, closed: closed, peak: peak, leaked: leaked.length, leakedTabs: leaked },
      // What already succeeded, so a rerun can skip it instead of repeating a side effect.
      checkpoint: done,
      complete: status === 'completed',
      truncated: false
    };
  }

  return { version: VERSION, mapLimit: mapLimit, run: run };
})();
