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
      page = await attachBrowserTab(picked.targetId);
      attachedVia = "attachBrowserTab(targetId)";
    } else if (via === "active") {
      try {
        page = await attachActiveBrowserTab();
        attachedVia = "attachActiveBrowserTab";
      } catch (e) {
        out.rows.push({ kind: "error", code: "ENOACTIVE", message: String((e && e.message) || e), tabs: tabs });
      }
    } else {
      out.rows.push({ kind: "error", code: "ENOTAB", message: "no open tab matched " + via + "=" + String(REQ.targetId || REQ.urlIncludes || REQ.titleIncludes), tabs: tabs });
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
      };
      row.contentVerified = asked ? reasons.length === 0 : null;
      if (REQ.includeText) row.text = text.slice(0, REQ.maxTextChars || 20000);
      out.rows.push(row);
      out.ok = row.contentVerified !== false;
    }
  }
} catch (e) {
  out.rows.push({ kind: "error", code: "EATTACH", message: String((e && e.message) || e) });
}
console.log(JSON.stringify(out));
`;

export function compileAttach(req) {
  return ATTACH_TEMPLATE.replace('__REQ__', JSON.stringify(req));
}

function disabled(name) {
  const e = new Error(name + ' needs browsing: set browseCaps.enabled = true in codemode config');
  e.code = 'EDISABLED';
  return e;
}

export function createAttach({ config = {}, session }) {
  const caps = config.browseCaps || {};
  const hostMs = () => (Number.isSafeInteger(caps.timeoutMs) ? caps.timeoutMs : 25000) + 1500;

  async function callRepl(req) {
    const res = await session.raw(compileAttach(req), { hostMs: hostMs() });
    if (res && res.error) {
      const e = new Error(res.error);
      e.code = 'EREPL';
      throw e;
    }
    return (res && res.rows) || [];
  }

  return {
    /** Every tab the user currently has open. Read-only; opens and closes nothing. */
    async tabs() {
      if (caps.enabled !== true) throw disabled('browse.tabs');
      const rows = await callRepl({ mode: 'list' });
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
      const rows = await callRepl(req);
      const page = rows.find((r) => r && r.kind === 'page');
      if (!page) {
        const err = rows.find((r) => r && r.kind === 'error') || {};
        return {
          ok: false,
          code: err.code || 'ENOROWS',
          error: err.message || 'the attach script returned no page row',
          tabs: err.tabs || [],
          contentVerified: null,
        };
      }
      return {
        ok: page.contentVerified !== false,
        code: page.contentVerified === false ? 'EUNRENDERED' : null,
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
        note: 'attached to an existing tab; it was not closed',
      };
    },
  };
}

