// What Aside will and will not do, as measured rather than as documented.
// Sources: devlog/_plan/260914_browse-batch/001_probe_evidence.md (E1-E6) and
// 003_locked_contracts.md E7. Each row records the observation, not an assumption, so
// `--doctor --browse` can tell an operator why a request is refused before they debug it.
import { UNSUPPORTED, WAIT_STATES, DEFAULT_INNER_CAP_MS, ASIDE_REPL_CAP_MS } from './schema.js';
import { ENABLE_BROWSE_COMMAND } from '../../enable-browse.js';
import { routingReport } from '../../browser-context.js';

export const CAPABILITY_MATRIX = Object.freeze({
  measuredOn: '2026-09-14',
  cli: '1.26.906.1630',
  page: {
    present: ['goto', 'title', 'content', 'url', 'screenshot', 'pdf', 'evaluate', 'locator', 'click', 'fill', 'waitForSelector', 'waitForLoadState', 'close', 'reload', 'goBack', 'goForward', 'frames', 'mainFrame', 'viewportSize', 'on', 'bringToFront', 'video'],
    absent: ['route', 'unroute', 'setViewportSize', 'emulateMedia', 'waitForFunction', 'waitForTimeout', 'waitForNavigation', 'waitForRequest', 'waitForResponse', 'cookies', 'boundingBox', 'textContent', 'innerText', 'getAttribute', 'isVisible', 'setContent', 'addStyleTag', 'addScriptTag', 'setDefaultTimeout', 'exposeFunction', 'isClosed', 'accessibility', 'press', 'focus', 'hover', 'selectOption'],
  },
  // page.absent is NOT surface-absent. Every name below is missing on the page object and
  // present on page.locator(target), measured 2026-09-14 by calling each one on a real
  // locator and reading the result back. Reporting only the page row implied this build
  // cannot type or select, which is false and was the reason codemode had no action layer.
  locator: {
    present: ['click', 'dblclick', 'fill', 'type', 'press', 'hover', 'focus', 'check', 'uncheck', 'selectOption', 'scrollIntoViewIfNeeded', 'boundingBox', 'textContent', 'innerText', 'isVisible'],
    note: 'a locator enumerates as [] via getOwnPropertyNames while every method on it works, so detect capability by calling and catching, never by property check',
    refs: 'locator accepts an accessibility ref from the snapshot tree. A child frame element arrives as an f-prefixed ref (f1e1) and resolves from the top-level page, so iframe interaction needs no frame API',
    staleness: 'a ref belongs to the snapshot that produced it; one measured click grew a tree from 3126 to 23530 chars and renumbered it. Pass snapshot.fingerprint as refsFingerprint and every ref step is re-validated against the live tree; without it the guard can only compare urls and says so per step in refGuard. The check is point-in-time and each step reports guardAgeMs, the window between the check passing and the verb running. fingerprintStructure compares ref and role only, so a list that reorders under stable refs is invisible to it - do not use it to click anything destructive.',
  },
  refused: UNSUPPORTED,
  waitStates: WAIT_STATES,
  facts: Object.freeze([
    'openTab returns the page object itself; tab.page and tab.id are undefined and identity is page.targetId',
    'snapshot requires the page object and rejects a string target id',
    'screenshot clip is honoured exactly; maxWidth is accepted and ignored',
    'pdf format is accepted and silently yields US Letter; only paperWidth/paperHeight in inches give A4',
    'the CLI exits 0 on failure, so the trailing [ok | Nms] marker plus file inspection is the only success signal',
    'a killed CLI leaks its tabs permanently and no later session can close them',
    'one repl invocation is one session with roughly 1.4-2.4s of process overhead, so batching is the point',
  ]),
  deadlines: Object.freeze({ defaultInnerCapMs: DEFAULT_INNER_CAP_MS, asideReplCapMs: ASIDE_REPL_CAP_MS, note: 'inner deadline always below the host deadline' }),
});

export function doctorPayload(config = {}, resolved = null, error = null, browserContext = null) {
  const caps = config.browseCaps || {};
  const rep = {
    enabled: caps.enabled === true,
    // A report that says "off" and stops is the reason someone went looking for the file by
    // hand. When it is off, the next step goes in the report.
    ...(caps.enabled === true ? {} : { enableWith: ENABLE_BROWSE_COMMAND }),
    asidePath: config.asidePath ?? null,
    asideResolved: resolved,
    asideError: error,
    caps: {
      timeoutMs: caps.timeoutMs ?? DEFAULT_INNER_CAP_MS,
      maxTabs: caps.maxTabs ?? 8,
      concurrency: caps.concurrency ?? 4,
    },
    capabilities: CAPABILITY_MATRIX,
  };
  if (browserContext) {
    rep.routing = routingReport(browserContext);
    rep.browserContext = routingReport(browserContext);
  }
  return rep;
}
