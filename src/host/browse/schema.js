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

export const ASIDE_REPL_CAP_MS = 120000;
export const DEFAULT_INNER_CAP_MS = 25000;
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

export class BrowseOptionError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'BrowseOptionError';
    this.code = code;
  }
}

const JOB_KEYS = Object.freeze(['urls', 'timeoutMs', 'waitUntil', 'waitSelector', 'snapshot', 'maxTreeChars', 'screenshot', 'pdf', 'concurrency', 'extract', 'detect', 'requireSelector', 'minTextChars', 'requireContent']);

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

  let extract = null;
  if (raw.extract !== undefined) {
    if (!raw.extract || typeof raw.extract !== 'object' || Array.isArray(raw.extract)) {
      throw new BrowseOptionError('extract must be an object mapping field names to selectors', 'EBADVAL');
    }
    for (const [field, spec] of Object.entries(raw.extract)) {
      const s = typeof spec === 'string' ? { selector: spec } : spec;
      if (!s || typeof s !== 'object' || typeof s.selector !== 'string' || !s.selector) {
        throw new BrowseOptionError(`extract.${field} needs a css selector string or { selector, attr?, all?, trim? }`, 'EBADVAL');
      }
    }
    extract = raw.extract;
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

  return Object.freeze({
    urls,
    timeoutMs,
    waitUntil,
    waitSelector: raw.waitSelector ?? null,
    snapshot: normalizeSnapshot(raw.snapshot),
    maxTreeChars: raw.maxTreeChars === undefined ? 20000 : requirePositiveInt('maxTreeChars', raw.maxTreeChars),
    screenshot,
    pdf,
    concurrency,
    extract,
    // Block detection reads the rendered page, so a document that TALKS about blocking
    // trips it: a report listing an EBLOCKED item rendered the word "blocked" and the
    // detector flagged the report itself. Content we generated is not a remote origin,
    // so the caller can turn detection off for it. Defaults on.
    detect: raw.detect !== false,
    // Rendering checks. requireSelector/minTextChars say what "the content is there" MEANS
    // for this page; requireContent turns a failed check into a failed item instead of a
    // warning, for callers who would rather get nothing than get a bootstrap page.
    requireSelector: raw.requireSelector === undefined ? [] : (Array.isArray(raw.requireSelector) ? raw.requireSelector : [raw.requireSelector]),
    minTextChars: Number.isSafeInteger(raw.minTextChars) ? raw.minTextChars : null,
    requireContent: raw.requireContent === true,
  });
}
