// Work on the tab the USER already has open, instead of opening a private one.
//
// Every browse job so far starts a fresh Aside REPL session and opens its own tab, so it
// can reuse the account's cookies but never the page the user is actually looking at: not
// their scroll position, not a half-filled form, not a modal they just opened. That was a
// real limitation, but it was never a hard one - the Aside REPL already exposes the live
// browser. Measured on macbookpro-2, CLI 1.26.906.1630, 2026-09-14:
//
//   listBrowserTabs()            -> 7 live tabs, each { active, faviconUrl, id, targetId,
//                                   title, url, windowId, focusedWindow }
//   attachBrowserTab(t.id)       -> THROWS "No open browser tab found for targetId
//                                   tab:53727F5F..." because t.id carries a "tab:" prefix
//   attachBrowserTab(t.targetId) -> ok, returns a page
//   attachActiveBrowserTab()     -> THROWS "No active browser tab is available to attach."
//                                   when no browser window is focused, which is the normal
//                                   state for a run driven over ssh
//
// The attached page is a proxy: getOwnPropertyNames lists only
// [cdp, frameManager, targetId, modifierState, mouse, keyboard, events, browser] and its
// prototype is bare, yet page.url() and page.evaluate() both work. So capability probing by
// property enumeration lies here; call the method and catch instead.
//
// Two rules this module will not break:
//   1. An attached tab is NEVER closed. It belongs to the user. The generated script has no
//      closeTab call at all, and a test asserts that.
//   2. The address is read with location.href, not page.url(). Measured on the same run:
//      page.url() returned "http://localhost:10100/" while location.href returned
//      "http://localhost:10100/#providers". The fragment is part of which screen was read.
import { validateAttach } from './attach-schema.js';
import { settleEffects, parseEffects } from './session.js';
import { randomUUID } from 'node:crypto';
import { gatedVerbs } from './schema.js';
import { TREE_SUMMARY_SRC, TREE_NODES_SRC, jsonForScript, stripForWire, stripFragment } from './script.js';
import { ASIDE_REPL_CAP_MS } from './schema.js';
import { ACTION_STEP_SRC } from './actions-run.js';
import { REF_READ_SRC } from './script.js';
import { ENABLE_BROWSE_COMMAND } from '../../enable-browse.js';

export const ATTACH_TEMPLATE = `"use strict";
const REQ = __REQ__;
const out = { type: "final", rows: [], ok: false };
function norm(t) {
  return {
    targetId: String((t && t.targetId) || "").replace(/^tab:/, ""),
    id: (t && t.id) || null,
    url: (t && t.url) || null,
    title: (t && t.title) || null,
    active: !!(t && t.active),
    windowId: (t && t.windowId) !== undefined ? t.windowId : null,
    focusedWindow: !!(t && t.focusedWindow),
  };
}
try {
  const raw = await listBrowserTabs();
  const tabs = (Array.isArray(raw) ? raw : []).map(norm);
  if (REQ.mode === "list") {
    out.rows.push({ kind: "tabs", tabs: tabs });
    out.ok = true;
  } else {
    let picked = null;
    let via = null;
    if (REQ.targetId) {
      const want = String(REQ.targetId).replace(/^tab:/, "");
      picked = tabs.find(function (t) { return t.targetId === want; }) || null;
      via = "targetId";
    } else if (REQ.urlIncludes) {
      picked = tabs.find(function (t) { return t.url && t.url.indexOf(REQ.urlIncludes) !== -1; }) || null;
      via = "urlIncludes";
    } else if (REQ.titleIncludes) {
      picked = tabs.find(function (t) { return t.title && t.title.indexOf(REQ.titleIncludes) !== -1; }) || null;
      via = "titleIncludes";
    } else {
      picked = tabs.find(function (t) { return t.active; }) || null;
      via = "active";
    }
    let page = null;
    let attachedVia = null;
    if (picked) {
      try {
        page = await attachBrowserTab(picked.targetId);
        attachedVia = "attachBrowserTab(targetId)";
      } catch (e) {
        // It was in the list a moment ago. Between the list and the attach it went, which
        // is the same story as never having been there and must read as the same code.
        out.rows.push({ kind: "error", code: "ETABGONE", targetId: picked.targetId, message: "the tab was listed and then gone before it could be attached: " + String((e && e.message) || e), tabs: tabs });
      }
    } else if (via === "active") {
      try {
        page = await attachActiveBrowserTab();
        attachedVia = "attachActiveBrowserTab";
      } catch (e) {
        out.rows.push({ kind: "error", code: "ENOACTIVE", message: String((e && e.message) || e), tabs: tabs });
      }
    } else {
      out.rows.push({ kind: "error", code: via === "targetId" ? "ETABGONE" : "ENOTAB", targetId: REQ.targetId || null, message: "no open tab matched " + via + "=" + String(REQ.targetId || REQ.urlIncludes || REQ.titleIncludes), tabs: tabs });
    }
    if (page) {
      const row = { kind: "page", tab: picked, attachedVia: attachedVia, selectedBy: via };
      try { row.pageUrl = await page.url(); } catch (e) { row.pageUrlError = String((e && e.message) || e); }
      try { row.href = await page.evaluate("location.href"); } catch (e) { row.hrefError = String((e && e.message) || e); }
      try { row.hash = await page.evaluate("location.hash"); } catch (e) { row.hashError = String((e && e.message) || e); }
      try { row.title = await page.evaluate("document.title"); } catch (e) { row.titleError = String((e && e.message) || e); }
      try { row.scrollY = await page.evaluate("window.scrollY"); } catch (e) { row.scrollYError = String((e && e.message) || e); }
      let text = "";
      try { text = await page.evaluate("document.body ? document.body.innerText : ''"); } catch (e) { row.textError = String((e && e.message) || e); }
      text = String(text || "");
      const matched = [];
      const missing = [];
      for (const sel of (REQ.requireSelector || [])) {
        let hit = false;
        try { hit = await page.evaluate("!!document.querySelector(" + JSON.stringify(sel) + ")"); } catch (e) { hit = false; }
        (hit ? matched : missing).push(sel);
      }
      const reasons = [];
      if (REQ.minTextChars && text.length < REQ.minTextChars) {
        reasons.push("only " + text.length + " visible characters (wanted >= " + REQ.minTextChars + ")");
      }
      if (missing.length) reasons.push("missing selector(s): " + missing.join(", "));
      const asked = Boolean(REQ.minTextChars) || (REQ.requireSelector || []).length > 0;
      row.render = {
        textChars: text.length,
        requiredSelectorsMatched: matched,
        requiredSelectorsMissing: missing,
        reasons: reasons,
        sample: text.slice(0, REQ.sampleChars || 400),
        stage: "pre-actions",
      };
      row.contentVerified = asked ? reasons.length === 0 : null;
      if (REQ.includeText) row.text = text.slice(0, REQ.maxTextChars || 20000);
      if (REQ.snapshot) {
        try {
          const snap = await snapshot(page);
          const tree = (snap && snap.tree) || "";
          row.snapshotBytes = tree.length;
          if (REQ.snapshot !== "bytes") {
            row.snapshot = summarizeTree(tree, REQ.snapshot, REQ.maxTreeChars || 20000);
            if (REQ.treeNodes === true && typeof summarizeNodes === "function") {
              var __n = summarizeNodes(tree, REQ.snapshot, { maxNodeChars: 8000 });
              row.snapshot.nodes = __n.nodes;
              row.snapshot.nodesTruncated = __n.nodesTruncated;
              row.snapshot.nodesUnparsed = __n.nodesUnparsed;
            }
          }
        } catch (e) { row.snapshotError = String((e && e.message) || e); }
      }
      if (REQ.actions && REQ.actions.length) {
        // These act on a tab the user owns. We still never close it, and a ref step
        // refuses once the url has moved, because the refs came from the read above.
        const ran = await runActions(page, REQ.actions, {
          deadlineAt: Date.now() + (REQ.actionBudgetMs || 20000),
          urlAtSnapshot: row.href || null,
          refsFingerprint: REQ.refsFingerprint || null,
          guardTimeoutMs: 5000,
          runId: REQ.runId || null,
          jobId: "attach",
          onEffect: function (rec, state) {
            // Printed immediately, exactly as the batch does it. A click on the tab the
            // person is signed into has to leave a record before the process that made it
            // can take the record with it.
            try { console.log(JSON.stringify({ type: "effect", effect: { operationId: rec.operationId, runId: REQ.runId || null, jobId: "attach", i: rec.i, verb: rec.verb, state: state, at: Date.now() } })); } catch (e) {}
          },
          fingerprintOf: function (p) {
            return snapshot(p).then(function (s) {
              var sum = summarizeTree((s && s.tree) || "", "interactive", 200000);
              return { full: sum.fingerprint, structure: sum.fingerprintStructure };
            });
          },
          allowStaleRefs: REQ.allowStaleRefs,
          stopOnError: REQ.stopOnError
        });
        row.actions = ran.steps;
        row.actionsOk = ran.ok;
        row.refGuard = ran.refGuard;
        row.navigatedDuringActions = ran.navigated;
        row.urlBeforeActions = ran.urlBefore;
        if (ran.urlAfter) row.hrefAfterActions = ran.urlAfter;
      }
      // attach is the surface where act -> observe -> read by ref is coherent, because the
      // tab is the same one. snapshotAfter returns the fingerprint that authorises the next
      // call's ref read; without it the caller would have to guess.
      if (REQ.snapshotAfter) {
        try {
          const sa = summarizeTree(((await snapshot(page)) || {}).tree || "", "interactive", 200000);
          const saUrl = row.hrefAfterActions || row.href || null;
          row.snapshotAfter = { snapshotId: sa.fingerprint + "|" + saUrl, fingerprint: sa.fingerprint, refCount: sa.refCount, url: saUrl };
        } catch (e) {
          row.snapshotAfter = { ok: false, code: "ESNAPSHOT", error: String((e && e.message) || e) };
        }
      }
      if (REQ.extract) {
        // The authorisation is the fingerprint of the observation the refs came from.
        const nowTree = ((await snapshot(page)) || {}).tree || "";
        const nowSum = summarizeTree(nowTree, "interactive", 200000);
        const nowUrl = row.hrefAfterActions || row.href || null;
        const wantId = String(REQ.refsFingerprint || "");
        const atPos = wantId.indexOf("|");
        const wantFp = atPos > 0 ? wantId.slice(0, atPos) : wantId;
        const wantUrl = atPos > 0 ? wantId.slice(atPos + 1) : null;
        const fresh = wantFp === nowSum.fingerprint && (wantUrl === null || wantUrl === nowUrl);
        row.refsFingerprintNow = nowSum.fingerprint;
        row.snapshotIdNow = nowSum.fingerprint + "|" + nowUrl;
        const data = {};
        const missing = [];
        for (const field of Object.keys(REQ.extract)) {
          const spec = REQ.extract[field];
          if (!spec || typeof spec !== "object" || !("ref" in spec)) continue;
          if (!fresh) {
            data[field] = { ok: false, code: "ESTALEREF", guard: "fingerprint", ref: spec.ref };
            missing.push(field);
            continue;
          }
          const read = await readRefField(page, spec, nowSum.refs, nowTree);
          data[field] = read;
          if (!read.ok) missing.push(field);
        }
        row.data = { data: data, missing: missing };
      }
      out.rows.push(row);
      // A run whose every action failed is not ok. exec already refuses that; attach was
      // carrying actionsOk and never consulting it.
      out.ok = row.contentVerified !== false && row.actionsOk !== false;
    }
  }
} catch (e) {
  out.rows.push({ kind: "error", code: "EATTACH", message: String((e && e.message) || e) });
}
console.log(JSON.stringify(out));
`;

export function compileAttach(req) {
  // Function replacer: see the note in script.js compile(). A $& in a fill value or a
  // selector would otherwise be substituted into the generated source after escaping.
  // Same Windows command-line ceiling as compile(): ship only what the request reaches.
  const hasRefExtract = Boolean(req.extract) && Object.keys(req.extract)
    .some((k) => req.extract[k] && typeof req.extract[k] === 'object' && 'ref' in req.extract[k]);
  // The fragments are dedented individually; the template around them is not, because
  // stripForWire's rule about leading spaces inside a string applies to it and not to them.
  const head = (req.snapshot || req.refsFingerprint || req.snapshotAfter || hasRefExtract ? stripFragment(TREE_SUMMARY_SRC) + '\n' : '')
    + (req.snapshot && req.treeNodes === true ? stripFragment(TREE_NODES_SRC) + '\n' : '')
    + (hasRefExtract ? stripFragment(REF_READ_SRC) + '\n' : '')
    + (req.actions && req.actions.length ? stripFragment(ACTION_STEP_SRC) + '\n' : '');
  return stripForWire(head + ATTACH_TEMPLATE.replace('__REQ__', () => jsonForScript(req)));
}

// The last thing this tool saw at that id, if this tool is what opened it.
//
// Ambiguity answers null. An id that appears in two records with two different urls has
// been reused, and picking the newer one would report a page that has nothing to do with
// the tab the caller lost — which is the failure mode this whole return exists to avoid.
// Nothing is a worse answer than the wrong page confidently given.
function lastKnown(journal, targetId) {
  if (!targetId) return null;
  const want = String(targetId).replace(/^tab:/, '');
  const seen = [];
  for (const rec of journal.all()) {
    for (const tab of rec.tabs || []) {
      if (String(tab.targetId).replace(/^tab:/, '') !== want) continue;
      seen.push({ url: tab.url ?? null, at: rec.writtenAt ?? null });
    }
  }
  if (!seen.length) return null;
  const urls = new Set(seen.map((s) => String(s.url)));
  if (urls.size > 1) return null;
  return seen.reduce((a, b) => ((b.at || 0) > (a.at || 0) ? b : a));
}

function disabled(name) {
  const e = new Error(name + ' needs browsing, which is currently off. Turn it on with: ' + ENABLE_BROWSE_COMMAND);
  e.code = 'EDISABLED';
  return e;
}

export function createAttach({ config = {}, session, tabJournal = null }) {
  const caps = config.browseCaps || {};
  // The host deadline has to outlast whatever the step list is allowed to take. A 20s
  // action budget under a fixed 26.5s host deadline left ~6.5s for a snapshot and seven
  // evaluate round trips against a measured 2143ms per click, and anything above 26.5s
  // guaranteed the REPL was killed before it could print its report - on the user's own tab.
  const hostMs = (req) => {
    const base = (Number.isSafeInteger(caps.timeoutMs) ? caps.timeoutMs : 25000) + 1500;
    const needed = (req && req.actionBudgetMs ? req.actionBudgetMs : 0) + 8000;
    return Math.min(Math.max(base, needed), ASIDE_REPL_CAP_MS);
  };

  async function callRepl(req) {
    const res = await session.raw(compileAttach(req), { hostMs: hostMs(req) });
    if (res && res.error) {
      const e = new Error(res.error);
      e.code = 'EREPL';
      // The transcript is what the run printed before it stopped, and an effect line is
      // printed the moment a step is requested. Throwing it away is how a click that went
      // out on a live tab disappears when the process afterwards did not survive.
      e.effects = settleEffects(parseEffects((res.raw && res.raw.stdout) || ''), { killed: true });
      // And the run it belonged to. settleEffects keeps the operation id and not the run,
      // so without this the surviving record of a click could not be tied back to the call
      // that sent it - which is most of what a record is for.
      e.runId = req.runId || null;
      throw e;
    }
    // The rows and the transcript together. The rows say what the run found; the transcript
    // is where the effect lines are, and an effect that only exists in the final payload is
    // an effect that vanishes when the final payload does.
    return { rows: (res && res.rows) || [], stdout: (res && res.raw && res.raw.stdout) || '' };
  }

  return {
    /** Every tab the user currently has open. Read-only; opens and closes nothing. */
    async tabs() {
      if (caps.enabled !== true) throw disabled('browse.tabs');
      const { rows } = await callRepl({ mode: 'list' });
      const row = rows.find((r) => r && r.kind === 'tabs');
      if (!row) {
        const err = rows.find((r) => r && r.kind === 'error');
        return { ok: false, tabs: [], code: (err && err.code) || 'ENOROWS', error: err && err.message };
      }
      return { ok: true, tabs: row.tabs || [] };
    },

    /**
     * Read the tab the user already has open. Never opens one, never closes one.
     * Selection: targetId, else urlIncludes, else titleIncludes, else the active tab.
     */
    async attach(opts = {}) {
      if (caps.enabled !== true) throw disabled('browse.attach');
      const req = validateAttach(opts);
      // Before compileAttach, before session.raw, before anything exists. The batch gate
      // guards a tab this tool opened; this one guards the tab the person is signed into
      // and looking at, which is the more dangerous of the two, and it was the path that
      // had no gate at all.
      //
      // The refusal is attach's own flat shape rather than the batch envelope. The two
      // surfaces answer differently and a caller reading this one should not have to learn
      // the other to understand being turned down.
      const wants = req.approveWrites ? [] : gatedVerbs(req.actions);
      if (wants.length) {
        return {
          ok: false,
          code: 'EWRITEAPPROVAL',
          error: 'this call would ' + wants.join(', ') + " on the tab you are signed into; set approveWrites: true to say you mean it",
          wants,
          tabs: [],
          tab: null,
          contentVerified: null,
          targetId: req.targetId ?? null,
          lastUrl: null,
          boundAt: null,
          effectsUnknown: false,
          effects: [],
        };
      }
      // attach is not a batch and the host issues no run id for it, so one is made here:
      // an effect without a run to belong to cannot be traced back to anything.
      const runId = 'attach-' + randomUUID();
      const replied = await callRepl({ ...req, runId });
      const rows = replied.rows;
      // Settled the same way the batch settles them: a step that was requested and never
      // confirmed is indeterminate, not absent.
      const effects = settleEffects(parseEffects(replied.stdout), { killed: false });
      const page = rows.find((r) => r && r.kind === 'page');
      if (!page) {
        const err = rows.find((r) => r && r.kind === 'error') || {};
        const gone = err.code === 'ETABGONE';
        // A caller who named a tab is never handed a different one, and the failure says
        // which kind it was. playwright-mcp #1588 is the case for the distinction: an
        // undifferentiated "target closed" makes a model retry a navigation that cannot
        // work, because the state it would have branched on was never reported.
        //
        // Recovery metadata where we have it, null where we do not. The journal knows the
        // last url only for a tab this tool opened; a tab the user opened and handed us by
        // id leaves lastUrl null rather than a guess, and a guess is what would send the
        // caller to the wrong page.
        const known = gone && tabJournal ? lastKnown(tabJournal, err.targetId) : null;
        return {
          ok: false,
          code: err.code || 'ENOROWS',
          error: err.message || 'the attach script returned no page row',
          tabs: err.tabs || [],
          contentVerified: null,
          targetId: gone ? (err.targetId ?? null) : null,
          lastUrl: known ? known.url : null,
          boundAt: known ? known.at : null,
          runId,
          effects,
          // Said out loud because it is the thing a caller is about to get wrong. Nothing
          // here is a verdict on an action: if a write was sent before the tab vanished, its
          // outcome is unknown, and the tab being gone is an observation about the tab.
          effectsUnknown: gone,
        };
      }
      return {
        ok: page.contentVerified !== false && page.actionsOk !== false,
        code: page.contentVerified === false
          ? 'EUNRENDERED'
          : (page.actionsOk === false ? 'EACTION' : null),
        runId,
        // Requested and confirmed, the same vocabulary the batch answers in. A step whose
        // confirmation never arrived is indeterminate here too.
        effects,
        tab: page.tab,
        selectedBy: page.selectedBy,
        attachedVia: page.attachedVia,
        // Both are reported on purpose: page.url() drops the fragment and location.href
        // keeps it, and a caller reproducing a read needs to see which screen it was.
        href: page.href ?? null,
        hash: page.hash ?? null,
        pageUrl: page.pageUrl ?? null,
        fragmentDropped: Boolean(page.href && page.pageUrl && page.href !== page.pageUrl),
        title: page.title ?? null,
        scrollY: page.scrollY ?? null,
        render: page.render || null,
        contentVerified: page.contentVerified ?? null,
        text: page.text,
        snapshotBytes: page.snapshotBytes ?? null,
        snapshot: page.snapshot ?? null,
        snapshotError: page.snapshotError ?? null,
        actions: page.actions ?? null,
        actionsOk: page.actionsOk ?? null,
        snapshotAfter: page.snapshotAfter ?? null,
        data: page.data ?? null,
        refsFingerprintNow: page.refsFingerprintNow ?? null,
        snapshotIdNow: page.snapshotIdNow ?? null,
        refGuard: page.refGuard ?? null,
        navigatedDuringActions: page.navigatedDuringActions ?? null,
        hrefAfterActions: page.hrefAfterActions ?? null,
        note: 'attached to an existing tab; it was not closed',
      };
    },
  };
}
