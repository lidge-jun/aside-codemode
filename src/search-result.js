// Canonical owner of search result metadata (plan 020, disposition 002 #2).
//
// Two conflicting requirements meet here:
//  1. Guest code must keep plain ergonomics: `hits.length`, `.map`, `.filter`,
//     destructuring, and the historical non-enumerable `.truncated`/`.partial`.
//  2. The same value must tell the truth on the wire. Measured 2026-09-13:
//     JSON.stringify(hits) emitted a bare array, so `truncated`/`partial` were
//     silently dropped and a capped search read as a complete answer — the
//     exact false-negative this tool exists to prevent.
//
// Resolution: non-enumerable live fields (ergonomics, backwards compatible) plus
// an explicit non-enumerable `toJSON` (truth on the wire). `decorateSearchResult`
// is the only place that attaches them; `restoreSearchResult` is the only place
// that reads an envelope back, so a worker RPC cannot mistake ordinary user data
// shaped like `{rows: [...]}` for search metadata.
//
// Projection responsibility is explicit and documented: returning `hits.length`
// or `hits.map(...)` is a DELIBERATE reduction that drops the envelope. It is not
// an assertion that the search was complete. Return the result itself (or its
// `.toJSON()`) when completeness must survive.

const META_KEYS = ['truncated', 'partial', 'complete', 'scope', 'toJSON'];

// A BRAND, not a shape test. The worker RPC has to know whether a value carries transferable
// metadata, and it used to decide that from the ACTION NAME (src/sandbox.js). That list
// silently dropped the envelope for every action added after it was written, so a decorated
// fs.list passed its host test and lost its metadata on the guest wire. Branding the value
// itself cannot go stale. Ordinary guest data shaped like {rows:[...]} is still never
// mistaken for an envelope, because only this module attaches the brand and the wire side
// continues to validate with isSearchEnvelope.
const DECORATED = Symbol.for('codemode.resultEnvelope');

export function isDecoratedResult(value) {
  return value !== null
    && (typeof value === 'object' || typeof value === 'function')
    && value[DECORATED] === true
    && typeof value.toJSON === 'function';
}

export class SearchEnvelopeError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SearchEnvelopeError';
    this.code = 'EBADENVELOPE';
  }
}

function normalizePartial(partial) {
  if (!Array.isArray(partial)) return [];
  return partial.filter((p) => typeof p === 'string');
}

function hide(target, key, value) {
  Object.defineProperty(target, key, { value, enumerable: false, configurable: true, writable: false });
}

function isCountShape(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Number.isFinite(value.matches)
    && Number.isFinite(value.files);
}

/**
 * Attach serializable search metadata to an array of rows or a count object.
 *
 * @param {Array|{matches:number,files:number}} value rows or a count
 * @param {{truncated?:boolean, partial?:string[], scope?:object, complete?:boolean}} metadata
 * @returns the same reference, decorated in place
 */
export function decorateSearchResult(value, metadata = {}) {
  const truncated = metadata.truncated === true;
  const partial = normalizePartial(metadata.partial);
  const scope = metadata.scope && typeof metadata.scope === 'object' ? metadata.scope : {};
  // A search is complete only when nothing was cut and nothing was unreadable.
  // An honest empty result IS complete; an externally killed or partially
  // traversed one is not, even when it returned rows.
  const complete = typeof metadata.complete === 'boolean'
    ? metadata.complete
    : !truncated && partial.length === 0;

  hide(value, DECORATED, true);

  if (Array.isArray(value)) {
    hide(value, 'truncated', truncated);
    hide(value, 'partial', partial);
    hide(value, 'complete', complete);
    hide(value, 'scope', scope);
    // rows is a snapshot of the accepted rows at decoration time; search results
    // are not mutated after the runner returns them.
    hide(value, 'toJSON', function toJSON() {
      return { rows: [...this], complete, truncated, partial, scope };
    });
    return value;
  }

  if (isCountShape(value)) {
    // The original contract was a plain {matches, files} and tests assert it
    // with deepEqual. Everything added here stays non-enumerable so that
    // assertion keeps passing while the wire form gains the state.
    hide(value, 'truncated', truncated);
    hide(value, 'partial', partial);
    hide(value, 'complete', complete);
    hide(value, 'scope', scope);
    hide(value, 'toJSON', function toJSON() {
      return { matches: this.matches, files: this.files, complete, truncated, partial, scope };
    });
    return value;
  }

  throw new SearchEnvelopeError(
    'decorateSearchResult: value must be an array of rows or a {matches,files} count',
  );
}

/**
 * True only for the two envelopes decorateSearchResult produces. Deliberately
 * strict: a guest returning `{rows: [...]}` of its own data must NOT be turned
 * into a search result by the transport layer.
 */
export function isSearchEnvelope(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  if (typeof value.complete !== 'boolean') return false;
  if (typeof value.truncated !== 'boolean') return false;
  if (!Array.isArray(value.partial)) return false;
  if (value.scope === null || typeof value.scope !== 'object' || Array.isArray(value.scope)) return false;
  if (Array.isArray(value.rows)) return true;
  return Number.isFinite(value.matches) && Number.isFinite(value.files);
}

/**
 * Rebuild guest-facing ergonomics from a wire envelope (worker -> guest).
 * Only the two known envelope shapes are accepted; anything else throws
 * EBADENVELOPE rather than being guessed at.
 */
export function restoreSearchResult(envelope) {
  if (!isSearchEnvelope(envelope)) {
    throw new SearchEnvelopeError(
      'restoreSearchResult: not a search envelope ({rows|matches+files, complete, truncated, partial, scope})',
    );
  }
  const metadata = {
    truncated: envelope.truncated,
    partial: envelope.partial,
    scope: envelope.scope,
    complete: envelope.complete,
  };
  if (Array.isArray(envelope.rows)) {
    return decorateSearchResult([...envelope.rows], metadata);
  }
  return decorateSearchResult({ matches: envelope.matches, files: envelope.files }, metadata);
}

export { META_KEYS };
