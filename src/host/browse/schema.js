// Option SSOT for the browse namespace. Mirrors src/search-schema.js: unknown keys are
// rejected with the valid list, and an option Aside cannot honour is refused BEFORE a
// process is spawned rather than silently degraded.
//
// Every refusal below is grounded in a measurement recorded in
// devlog/_plan/260914_browse-batch/001_probe_evidence.md and 003_locked_contracts.md E7:
//   page.route            absent; page.on('request') delivered 0 events
//   screenshot.maxWidth   silently ignored (1440x900 returned for maxWidth:640)
//   pdf.format:'A4'       silently produced US Letter (MediaBox 0 0 612 792)
//   waitUntil/waitForLoadState  Aside accepts ANY string, including garbage, so an
//                         unsupported value can never be detected at runtime
import { isLocalOrigin } from './policy.js';

export const ASIDE_REPL_CAP_MS = 120000;
export const DEFAULT_INNER_CAP_MS = 25000;
export const SLACK_MS = 1500;
export const A4_INCHES = { paperWidth: 210 / 25.4, paperHeight: 297 / 25.4 };

export const UNSUPPORTED = Object.freeze({
  route: 'page.route does not exist on this surface and page.on("request") delivers no events, so request interception cannot be implemented or faked',
  maxWidth: 'screenshot maxWidth is accepted and silently ignored; use clip, which is honoured exactly. Host-side resize is deliberately not implemented (image.js RESIZE_UNSUPPORTED)',
  viewport: 'the viewport is not settable; viewportSize() returns the fixed size',
  format: 'pdf format is accepted and silently yields US Letter; pass paperWidth/paperHeight in INCHES instead',
  fileUrl: 'file:// navigation is refused by Aside (Cannot navigate to a file URL without local file access)',
  networkidle: 'networkidle is accepted but downgraded to "stable" with a 5s timeout, so it is not a network-quiet guarantee; wait for a named selector instead',
});

export const WAIT_STATES = Object.freeze(['load', 'domcontentloaded', 'stable']);

// One measured locator click cost 2,143ms against a 25,000ms inner deadline, so a long
// step list cannot finish and advertising one would only produce deadline failures.
export const MAX_ACTION_STEPS = 20;

// target: 'required' means ref or selector; 'selector' means the verb's own value IS the
// selector; 'none' means the verb acts on the page. via records which object answered,
// because page and locator have genuinely different surfaces.
export const ACTION_VERBS = Object.freeze({
  click: { target: 'required', value: 'none', via: 'locator' },
  dblclick: { target: 'required', value: 'none', via: 'locator' },
  fill: { target: 'required', value: 'string', via: 'locator' },
  type: { target: 'required', value: 'string', via: 'locator' },
  press: { target: 'required', value: 'string', via: 'locator' },
  hover: { target: 'required', value: 'none', via: 'locator' },
  focus: { target: 'required', value: 'none', via: 'locator' },
  check: { target: 'required', value: 'none', via: 'locator' },
  uncheck: { target: 'required', value: 'none', via: 'locator' },
  selectOption: { target: 'required', value: 'string', via: 'locator' },
  scrollIntoView: { target: 'required', value: 'none', via: 'locator' },
  waitFor: { target: 'selector', value: 'none', via: 'page' },
  waitForLoadState: { target: 'none', value: 'state', via: 'page' },
  goBack: { target: 'none', value: 'none', via: 'page' },
  goForward: { target: 'none', value: 'none', via: 'page' },
  reload: { target: 'none', value: 'none', via: 'page' },
  scroll: { target: 'none', value: 'scroll', via: 'page' },
  sleepMs: { target: 'none', value: 'int', via: 'none' },
});

export class BrowseOptionError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'BrowseOptionError';
    this.code = code;
  }
}

const JOB_KEYS = Object.freeze(['urls', 'timeoutMs', 'waitUntil', 'waitSelector', 'snapshot', 'maxTreeChars', 'treeNodes', 'screenshot', 'pdf', 'concurrency', 'extract', 'detect', 'requireSelector', 'minTextChars', 'requireContent', 'loggedInMarker', 'stopWhenLoggedOut', 'actions', 'stopOnError', 'allowStaleRefs', 'refsFingerprint', 'snapshotAfter', 'fullText', 'maxTextChars', 'helper', 'actionBudgetMs']);

// A ref names a row in one specific observation. Reading by ref is therefore only meaningful
// against the fingerprint of that observation, and only in a call that does not also mutate
// the page — a successful action guarantees the fingerprint will not match any more, so the
// combination could never return anything but a refusal. The way to read after acting is a
// second call on the same tab: browse.attach with the fingerprint snapshotAfter returned.
// e12 addresses a row in the top-level document; f2e7 addresses row 7 inside frame 2.
const REF_SHAPE = /^(f\d+)?e\d+$/;
export function validateExtract(rawExtract, { actions = null, refsFingerprint = null } = {}) {
  if (rawExtract === undefined) return null;
  if (!rawExtract || typeof rawExtract !== 'object' || Array.isArray(rawExtract)) {
    throw new BrowseOptionError('extract must be an object mapping field names to selectors', 'EBADVAL');
  }
  for (const [field, spec] of Object.entries(rawExtract)) {
    if (spec && typeof spec === 'object' && !Array.isArray(spec) && 'ref' in spec) {
      if (typeof spec.ref !== 'string' || !REF_SHAPE.test(spec.ref)) {
        throw new BrowseOptionError(`extract.${field}.ref must look like e12 or f2e7`, 'EBADVAL');
      }
      if (!refsFingerprint) {
        throw new BrowseOptionError(
          `extract.${field} reads by ref, which requires refsFingerprint: the snapshotId or fingerprint of the observation that produced it. browse.attach returns one through snapshotAfter`,
          'EBADVAL',
        );
      }
      if (actions && actions.length) {
        throw new BrowseOptionError(
          `extract.${field} reads by ref and cannot share a call with actions: any successful step invalidates the fingerprint it was authorised against. Act first, then read with browse.attach using the fingerprint snapshotAfter returns`,
          'EBADVAL',
        );
      }
      continue;
    }
    const s = typeof spec === 'string' ? { selector: spec } : spec;
    if (!s || typeof s !== 'object' || typeof s.selector !== 'string' || !s.selector) {
      throw new BrowseOptionError(`extract.${field} needs a css selector string, { selector, attr?, all?, trim? } or { ref, attr?, text? }`, 'EBADVAL');
    }
  }
  return rawExtract;
}

// The accessibility tree is already fetched for EVERY page, because block detection reads
// it. Until now only its length survived. These modes decide how much of it comes back:
//   bytes       - length only, the historical behaviour
//   tree        - the whole tree, refs and child frames included
//   interactive - only the rows you can act on, which is what a ref click needs
export const SNAPSHOT_MODES = Object.freeze(['bytes', 'tree', 'interactive']);

export function normalizeSnapshot(value) {
  if (value === undefined || value === null || value === false) return false;
  if (value === true) return 'bytes';
  if (typeof value === 'string' && SNAPSHOT_MODES.includes(value)) return value;
  throw new BrowseOptionError(
    'snapshot must be true, false, or one of ' + SNAPSHOT_MODES.join(' | '),
    'EBADOPT',
  );
}
const SHOT_KEYS = Object.freeze(['clip', 'type', 'quality', 'fullPage']);
const PDF_KEYS = Object.freeze(['paperWidth', 'paperHeight', 'printBackground']);

function rejectUnknown(obj, allowed, where) {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) {
      throw new BrowseOptionError(`unknown ${where} option "${key}"; valid: ${allowed.join(', ')}`, 'EBADOPT');
    }
  }
}

function notSupported(key) {
  throw new BrowseOptionError(UNSUPPORTED[key], 'ENOTSUP');
}

function requirePositiveInt(name, value) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new BrowseOptionError(`${name} must be a positive integer`, 'EBADVAL');
  }
  return value;
}

/**
 * An ordered action list. Each step carries exactly one verb and, when the verb needs a
 * target, exactly one of ref or selector. A ref addresses the accessibility tree, which is
 * what makes iframe content reachable: a child frame's button arrives as f1e1 and
 * page.locator('f1e1') resolves it with no frame API.
 */
export function validateActions(raw) {
  if (raw === undefined || raw === null) return null;
  if (!Array.isArray(raw)) throw new BrowseOptionError('actions must be an array of steps', 'EBADVAL');
  if (raw.length === 0) return null;
  if (raw.length > MAX_ACTION_STEPS) {
    throw new BrowseOptionError(
      `actions is capped at ${MAX_ACTION_STEPS} steps; a measured locator click cost 2143ms against a ${DEFAULT_INNER_CAP_MS}ms inner deadline, so a longer list cannot finish`,
      'EBADVAL',
    );
  }
  return raw.map((step, i) => {
    const where = `actions[${i}]`;
    if (!step || typeof step !== 'object' || Array.isArray(step)) {
      throw new BrowseOptionError(`${where} must be an object`, 'EBADVAL');
    }
    const keys = Object.keys(step);
    for (const k of keys) {
      if (k !== 'ref' && k !== 'selector' && k !== 'timeoutMs' && !(k in ACTION_VERBS)) {
        throw new BrowseOptionError(`unknown ${where} key "${k}"; valid: ref, selector, timeoutMs, ${Object.keys(ACTION_VERBS).join(', ')}`, 'EBADOPT');
      }
    }
    const verbs = keys.filter((k) => k in ACTION_VERBS);
    if (verbs.length !== 1) {
      throw new BrowseOptionError(`${where} needs exactly one verb, got ${verbs.length ? verbs.join(' and ') : 'none'}`, 'EBADVAL');
    }
    const verb = verbs[0];
    const spec = ACTION_VERBS[verb];
    const named = keys.filter((k) => k === 'ref' || k === 'selector');
    if (named.length > 1) throw new BrowseOptionError(`${where} must name only one of ref or selector`, 'EBADVAL');

    let target = null;
    let targetKind = null;
    if (spec.target === 'selector') {
      target = step[verb];
      targetKind = 'selector';
      if (typeof target !== 'string' || !target.length) {
        throw new BrowseOptionError(`${where}.${verb} must be a non-empty css selector`, 'EBADVAL');
      }
    } else if (spec.target === 'required') {
      if (named.length !== 1) throw new BrowseOptionError(`${where}.${verb} needs a ref or a selector`, 'EBADVAL');
      target = step[named[0]];
      targetKind = named[0] === 'ref' ? 'ref' : 'selector';
      if (typeof target !== 'string' || !target.length) {
        throw new BrowseOptionError(`${where}.${named[0]} must be a non-empty string`, 'EBADVAL');
      }
    } else if (named.length) {
      throw new BrowseOptionError(`${where}.${verb} acts on the page and takes no ref or selector`, 'EBADVAL');
    }

    let value = null;
    if (spec.value === 'string') {
      value = step[verb];
      if (typeof value !== 'string') throw new BrowseOptionError(`${where}.${verb} must be a string`, 'EBADVAL');
    } else if (spec.value === 'int') {
      value = requirePositiveInt(`${where}.${verb}`, step[verb]);
      if (value > 10000) throw new BrowseOptionError(`${where}.${verb} must be at most 10000ms; the inner deadline is shared`, 'EBADVAL');
    } else if (spec.value === 'state') {
      value = step[verb];
      if (!WAIT_STATES.includes(value)) {
        throw new BrowseOptionError(`${where}.${verb} must be one of ${WAIT_STATES.join(', ')}`, 'EBADVAL');
      }
    } else if (spec.value === 'scroll') {
      value = step[verb];
      const okScroll = value === 'top' || value === 'bottom' || (Number.isSafeInteger(value) && value >= 0);
      if (!okScroll) throw new BrowseOptionError(`${where}.scroll must be 'top', 'bottom' or a non-negative integer`, 'EBADVAL');
    } else if (spec.value === 'none' && spec.target !== 'selector') {
      // A value-less verb took any value at all, so { click: false } and { click: null }
      // both validated and then clicked. Require the affirmative.
      if (step[verb] !== true) {
        throw new BrowseOptionError(`${where}.${verb} takes no value; write ${verb}: true`, 'EBADVAL');
      }
    }

    const timeoutMs = step.timeoutMs === undefined
      ? null
      : requirePositiveInt(`${where}.timeoutMs`, step.timeoutMs);
    return Object.freeze({ verb, target, targetKind, value, via: spec.via, timeoutMs });
  });
}

export function validateJob(raw, browseCaps = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new BrowseOptionError('job must be an object', 'EBADVAL');
  }
  // Known-but-unsupported keys are checked BEFORE the unknown-key sweep. Otherwise
  // `route` comes back as "unknown option", which tells the caller nothing about WHY
  // it cannot work — and the whole point of this module is that the reason is measured.
  if (raw.route !== undefined) notSupported('route');
  // #11's own spelling. page.on IS present and will happily accept a 'request' listener
  // that never fires, so refusing only 'route' would leave that trap open.
  if (raw.block !== undefined) notSupported('route');
  rejectUnknown(raw, JOB_KEYS, 'job');

  if (!Array.isArray(raw.urls) || raw.urls.length === 0) {
    throw new BrowseOptionError('urls must be a non-empty array', 'EBADVAL');
  }
  const urls = raw.urls.map((u) => {
    if (typeof u !== 'string' || u.length === 0) throw new BrowseOptionError('each url must be a non-empty string', 'EBADVAL');
    if (/^file:/i.test(u)) notSupported('fileUrl');
    return u;
  });

  const cap = Math.min(
    Number.isSafeInteger(browseCaps.timeoutMs) ? browseCaps.timeoutMs : DEFAULT_INNER_CAP_MS,
    ASIDE_REPL_CAP_MS,
  );
  const timeoutMs = raw.timeoutMs === undefined ? cap : Math.min(requirePositiveInt('timeoutMs', raw.timeoutMs), cap);

  let waitUntil = 'domcontentloaded';
  if (raw.waitUntil !== undefined) {
    if (raw.waitUntil === 'networkidle') notSupported('networkidle');
    if (!WAIT_STATES.includes(raw.waitUntil)) {
      throw new BrowseOptionError(`waitUntil must be one of ${WAIT_STATES.join(', ')}; Aside accepts any string silently, so this is checked here`, 'EBADVAL');
    }
    waitUntil = raw.waitUntil;
  }

  if (raw.waitSelector !== undefined && typeof raw.waitSelector !== 'string') {
    throw new BrowseOptionError('waitSelector must be a string', 'EBADVAL');
  }

  let screenshot = null;
  if (raw.screenshot !== undefined) {
    if (!raw.screenshot || typeof raw.screenshot !== 'object') throw new BrowseOptionError('screenshot must be an object', 'EBADVAL');
    if ('maxWidth' in raw.screenshot) notSupported('maxWidth');
    if ('viewport' in raw.screenshot) notSupported('viewport');
    rejectUnknown(raw.screenshot, SHOT_KEYS, 'screenshot');
    screenshot = { ...raw.screenshot };
  }

  let pdf = null;
  if (raw.pdf !== undefined) {
    if (!raw.pdf || typeof raw.pdf !== 'object') throw new BrowseOptionError('pdf must be an object', 'EBADVAL');
    if ('format' in raw.pdf) notSupported('format');
    rejectUnknown(raw.pdf, PDF_KEYS, 'pdf');
    pdf = { ...raw.pdf };
  }

  const concurrency = raw.concurrency === undefined
    ? (Number.isSafeInteger(browseCaps.concurrency) ? browseCaps.concurrency : 4)
    : requirePositiveInt('concurrency', raw.concurrency);

  const actions = validateActions(raw.actions);
  // A reserve is held back so the item still gets reported after the steps run. Below this
  // the action window is empty and every step would report EDEADLINE before anything moved,
  // which reads as a runtime failure when it is really an impossible configuration.
  if (actions && timeoutMs < 4000) {
    throw new BrowseOptionError(
      `timeoutMs ${timeoutMs} cannot fit an action list: part of the budget is reserved so the result survives the deadline, and one measured click cost 2143ms. Use at least 4000`,
      'EBADVAL',
    );
  }

  // snapshot.fingerprint from the read that produced the refs. Without it the staleness
  // guard can only compare urls, which does not see a same-url renumbering.
  const refsFingerprint = typeof raw.refsFingerprint === 'string' && raw.refsFingerprint.length ? raw.refsFingerprint : null;
  // true returns the observation's id. 'diff' also says what changed since arrival, which
  // costs a second tree parse and a helper on the wire, so it is asked for by name.
  if (raw.snapshotAfter !== undefined && raw.snapshotAfter !== true && raw.snapshotAfter !== false && raw.snapshotAfter !== 'diff') {
    throw new BrowseOptionError("snapshotAfter must be true, false or 'diff'", 'EBADVAL');
  }
  const snapshotAfter = raw.snapshotAfter === 'diff' ? 'diff' : raw.snapshotAfter === true;
  // The rendered body, asked for by name. Without it the only text a batch returns is the
  // 160-character sample the render check keeps, and a summary is not an article.
  if (raw.fullText !== undefined && typeof raw.fullText !== 'boolean') {
    throw new BrowseOptionError('fullText must be a boolean', 'EBADVAL');
  }
  // The native batch helper, inlined into the generated script. Opt-in because it is about
  // 6KB of a 30000-character wire budget, and a job that does not call cm gains nothing.
  if (raw.helper !== undefined && typeof raw.helper !== 'boolean') {
    throw new BrowseOptionError('helper must be a boolean', 'EBADVAL');
  }
  // A diff needs both sides, and both sides have to be the same kind of thing. The before
  // side is the arrival snapshot, so a mode that ships no tree ('bytes') leaves nothing to
  // compare against and would report the whole page as new.
  const snapMode = normalizeSnapshot(raw.snapshot);
  if (snapshotAfter === 'diff' && (snapMode === false || snapMode === 'bytes')) {
    throw new BrowseOptionError(
      "snapshotAfter: 'diff' compares against the observation this call arrived at, so it needs snapshot: 'tree' or 'interactive'",
      'EBADVAL',
    );
  }
  // Parsed AFTER actions and the fingerprint, because a ref read is only legal in relation
  // to both: it needs the observation that minted the ref, and it cannot share a call with
  // the steps that would invalidate it.
  const extract = validateExtract(raw.extract, { actions, refsFingerprint });

  // requireContent carries two shapes, and the difference is whether it brings its own
  // check. A PATTERN is the check: this text has to be on the page, and an item without it
  // is a failure. `true` is only a modifier on the checks declared beside it, so it needs
  // one — enforcing a check nobody described would leave contentVerified asserting that
  // content was verified when nothing verified it, which is the false success this whole
  // layer exists to stop, moved one field over.
  const requireSelector = raw.requireSelector === undefined
    ? []
    : (Array.isArray(raw.requireSelector) ? raw.requireSelector : [raw.requireSelector]);
  const minTextChars = Number.isSafeInteger(raw.minTextChars) ? raw.minTextChars : null;
  let requireContentPattern = null;
  if (typeof raw.requireContent === 'string') {
    if (!raw.requireContent.length) {
      throw new BrowseOptionError('requireContent cannot be an empty pattern; pass the text the page must contain', 'EBADVAL');
    }
    // Compiled here so a bad pattern is a refusal rather than a check that silently never
    // matches. The source travels to the script as data and is rebuilt there, the same way
    // the block-detection patterns do.
    try { new RegExp(raw.requireContent); }
    catch (e) {
      throw new BrowseOptionError('requireContent is not a valid regular expression: ' + String(e && e.message || e), 'EBADVAL');
    }
    requireContentPattern = raw.requireContent;
  } else if (raw.requireContent !== undefined && typeof raw.requireContent !== 'boolean') {
    throw new BrowseOptionError('requireContent must be true, or a regular expression source naming the text the page must contain', 'EBADVAL');
  }
  // There is deliberately no refusal for a bare `true` with no check beside it. An earlier
  // revision added one, on the grounds that enforcing a check nobody described would report
  // verified with nothing verified. That was wrong twice over. It could not close the hole,
  // because minTextChars: 1 satisfies the refusal and then a single character reads as
  // verified. And the hole was never open: `asked` in the script counts requireSelector,
  // minTextChars and the pattern, never the bare boolean, so `true` alone already left
  // contentVerified null. What the refusal did instead was break a caller who wants the
  // skeleton heuristic to fail an item without describing a check of their own.

  // Separate from requireContent on purpose, because the two failures ask different things
  // of the caller. Content that is missing is a failure: the page did not hold what was
  // wanted. A session that is gone is needs_input: a person can sign in again, and telling
  // those apart is the difference between a caller who retries forever and one who opens a
  // tab. Nothing here tries to infer the state — a signed-out portal page need not contain
  // the word for signing in, and a JSON api answering with your own account data contains
  // no sign-out wording at all, so the heuristic fails in both directions and the caller
  // holds the knowledge instead.
  let loggedInMarker = null;
  if (raw.loggedInMarker !== undefined) {
    if (typeof raw.loggedInMarker !== 'string' || !raw.loggedInMarker.length) {
      throw new BrowseOptionError('loggedInMarker must be a non-empty regular expression source naming text that only appears when signed in', 'EBADVAL');
    }
    try { new RegExp(raw.loggedInMarker); }
    catch (e) {
      throw new BrowseOptionError('loggedInMarker is not a valid regular expression: ' + String(e && e.message || e), 'EBADVAL');
    }
    loggedInMarker = raw.loggedInMarker;
  }
  if (raw.stopWhenLoggedOut !== undefined) {
    if (typeof raw.stopWhenLoggedOut !== 'boolean') throw new BrowseOptionError('stopWhenLoggedOut must be a boolean', 'EBADVAL');
    if (loggedInMarker === null) throw new BrowseOptionError('stopWhenLoggedOut only means something beside loggedInMarker; without a marker nothing can detect the logout', 'EBADVAL');
  }

  return Object.freeze({
    urls,
    timeoutMs,
    waitUntil,
    waitSelector: raw.waitSelector ?? null,
    snapshot: normalizeSnapshot(raw.snapshot),
    maxTreeChars: raw.maxTreeChars === undefined ? 20000 : requirePositiveInt('maxTreeChars', raw.maxTreeChars),
    // Off by default: a structured view is worth its bytes only to a caller that walks it,
    // and paying for it on every snapshot cost middle-sized pages their whole envelope.
    treeNodes: raw.treeNodes === true,
    actions,
    stopOnError: raw.stopOnError !== false,
    allowStaleRefs: raw.allowStaleRefs === true,
    refsFingerprint,
    // Ask for the observation the actions left behind. Its fingerprint is what makes a
    // follow-up ref read on the same tab legal.
    snapshotAfter,
    fullText: raw.fullText === true,
    maxTextChars: raw.maxTextChars === undefined ? 200000 : requirePositiveInt('maxTextChars', raw.maxTextChars),
    helper: raw.helper === true,
    actionBudgetMs: raw.actionBudgetMs === undefined ? null : requirePositiveInt('actionBudgetMs', raw.actionBudgetMs),
    // Concurrent owned tabs. The pool bounds workers, not tabs: a close that throws leaves
    // the tab open and the worker opens another, so the ceiling has to be counted.
    maxTabs: Number.isSafeInteger(browseCaps.maxTabs) && browseCaps.maxTabs > 0 ? browseCaps.maxTabs : 8,
    slackMs: SLACK_MS,
    screenshot,
    pdf,
    concurrency,
    extract,
    // Block detection reads the rendered page, so a document that TALKS about blocking
    // trips it: a report listing an EBLOCKED item rendered the word "blocked" and the
    // detector flagged the report itself. Content we generated is not a remote origin,
    // so the caller can turn detection off for it. Defaults on.
    // Defaults on, except for a page this machine generated and served to itself. Opening
    // our own document used to answer EBLOCKED while reading its title perfectly well,
    // because the detector reads the rendered page and a document that TALKS about being
    // blocked trips it. A caller can still ask for detection on a local url by name; what
    // changes is only what happens when nobody said.
    detect: raw.detect === undefined ? !urls.every(isLocalOrigin) : raw.detect !== false,
    // Rendering checks. requireSelector/minTextChars say what "the content is there" MEANS
    // for this page; requireContent turns a failed check into a failed item instead of a
    // warning, for callers who would rather get nothing than get a bootstrap page.
    requireSelector,
    minTextChars,
    // Either shape enforces; the pattern additionally says what to look for.
    requireContent: raw.requireContent === true || requireContentPattern !== null,
    requireContentPattern,
    loggedInMarker,
    // Every item shares the session that just proved gone, so the rest can only open tabs
    // that cannot succeed. Defaults on, and only exists at all when a marker was supplied.
    stopWhenLoggedOut: loggedInMarker === null ? false : raw.stopWhenLoggedOut !== false,
  });
}
