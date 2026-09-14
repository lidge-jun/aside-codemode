// What Aside will and will not do, as measured rather than as documented.
// Sources: devlog/_plan/260914_browse-batch/001_probe_evidence.md (E1-E6) and
// 003_locked_contracts.md E7. Each row records the observation, not an assumption, so
// `--doctor --browse` can tell an operator why a request is refused before they debug it.
import { UNSUPPORTED, WAIT_STATES, DEFAULT_INNER_CAP_MS, ASIDE_REPL_CAP_MS } from './schema.js';

export const CAPABILITY_MATRIX = Object.freeze({
  measuredOn: '2026-09-14',
  cli: '1.26.906.1630',
  page: {
    present: ['goto', 'title', 'content', 'url', 'screenshot', 'pdf', 'evaluate', 'locator', 'click', 'fill', 'waitForSelector', 'waitForLoadState', 'close', 'reload', 'goBack', 'goForward', 'frames', 'mainFrame', 'viewportSize', 'on', 'bringToFront', 'video'],
    absent: ['route', 'unroute', 'setViewportSize', 'emulateMedia', 'waitForFunction', 'waitForTimeout', 'waitForNavigation', 'waitForRequest', 'waitForResponse', 'cookies', 'boundingBox', 'textContent', 'innerText', 'getAttribute', 'isVisible', 'setContent', 'addStyleTag', 'addScriptTag', 'setDefaultTimeout', 'exposeFunction', 'isClosed', 'accessibility', 'press', 'focus', 'hover', 'selectOption'],
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

export function doctorPayload(config = {}, resolved = null, error = null) {
  const caps = config.browseCaps || {};
  return {
    enabled: caps.enabled === true,
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
}
