// Input contract for browse.attach. Kept separate from the browse job schema so the two
// evolve independently: attach has no urls, no navigation and no artifacts.

import { validateActions, validateExtract, requireWriteFingerprint } from './schema.js';

function bad(message) {
  const e = new Error(message);
  e.code = 'EINVAL';
  return e;
}

// Thrown by the shared fingerprint rule so it lands on this surface with this surface's
// code, rather than arriving as something the batch path would have produced.
class AttachOptionError extends Error {
  constructor(message) { super(message); this.name = 'AttachOptionError'; this.code = 'EINVAL'; }
}

export function validateAttach(input = {}) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw bad('browse.attach takes an options object');
  }
  const known = new Set([
    'targetId', 'urlIncludes', 'titleIncludes',
    'requireSelector', 'minTextChars', 'includeText', 'maxTextChars', 'sampleChars',
    'snapshot', 'maxTreeChars', 'treeNodes',
    'actions', 'stopOnError', 'allowStaleRefs', 'actionBudgetMs',
    'refsFingerprint', 'extract', 'snapshotAfter',
  ]);
  for (const k of Object.keys(input)) {
    if (!known.has(k)) throw bad('unknown browse.attach option: ' + k);
  }
  const str = (k) => {
    if (input[k] === undefined) return null;
    if (typeof input[k] !== 'string' || !input[k].length) throw bad(k + ' must be a non-empty string');
    return input[k];
  };
  const num = (k, min, max, dflt) => {
    if (input[k] === undefined) return dflt;
    if (!Number.isSafeInteger(input[k]) || input[k] < min || input[k] > max) {
      throw bad(k + ' must be an integer between ' + min + ' and ' + max);
    }
    return input[k];
  };
  let requireSelector = [];
  if (input.requireSelector !== undefined) {
    const raw = Array.isArray(input.requireSelector) ? input.requireSelector : [input.requireSelector];
    for (const s of raw) {
      if (typeof s !== 'string' || !s.length) throw bad('requireSelector entries must be non-empty strings');
    }
    requireSelector = raw;
  }
  const selectors = ['targetId', 'urlIncludes', 'titleIncludes'].filter((k) => input[k] !== undefined);
  if (selectors.length > 1) {
    throw bad('pick one of targetId, urlIncludes, titleIncludes (got ' + selectors.join(', ') + ')');
  }
  let snapshot = false;
  if (input.snapshot !== undefined) {
    if (input.snapshot === true) snapshot = 'tree';
    else if (input.snapshot === false) snapshot = false;
    else if (input.snapshot === 'tree' || input.snapshot === 'interactive' || input.snapshot === 'bytes') snapshot = input.snapshot;
    else throw bad('snapshot must be true, false, or one of bytes | tree | interactive');
  }
  return {
    mode: 'attach',
    targetId: str('targetId'),
    urlIncludes: str('urlIncludes'),
    titleIncludes: str('titleIncludes'),
    requireSelector,
    minTextChars: num('minTextChars', 1, 5000000, null),
    includeText: input.includeText === true,
    maxTextChars: num('maxTextChars', 1, 5000000, 20000),
    sampleChars: num('sampleChars', 1, 20000, 400),
    snapshot,
    maxTreeChars: num('maxTreeChars', 1, 5000000, 20000),
    treeNodes: input.treeNodes === true,
    actions: (() => {
      const steps = validateActions(input.actions);
      // The same rule as the batch path. attach reaches these verbs on the tab the person
      // is signed into, so a rule that held on one path and not the other would not be one.
      requireWriteFingerprint(steps, str('refsFingerprint'), input.allowStaleRefs === true, AttachOptionError);
      return steps;
    })(),
    stopOnError: input.stopOnError !== false,
    allowStaleRefs: input.allowStaleRefs === true,
    // Capped so the host deadline can always outlast it; the REPL cap is 120000ms and the
    // report has to be printed before the process is killed.
    actionBudgetMs: num('actionBudgetMs', 1, 90000, 20000),
    refsFingerprint: str('refsFingerprint'),
    // attach reuses the tab, so it is the one surface where act -> observe -> read by ref
    // is coherent. The same rules apply: a ref needs the fingerprint of the observation it
    // came from, and it cannot travel with the steps that would invalidate it.
    //
    // Only ref reads. attach has no css extraction engine, and accepting a selector we
    // silently drop is exactly the failure this layer exists to stop.
    extract: (() => {
      const parsed = validateExtract(input.extract, {
        actions: validateActions(input.actions),
        refsFingerprint: str('refsFingerprint'),
      });
      if (!parsed) return null;
      for (const [field, spec] of Object.entries(parsed)) {
        if (!spec || typeof spec !== 'object' || !('ref' in spec)) {
          throw bad('browse.attach extract reads by ref only; ' + field + ' is a css selector. Use browse.exec for selector extraction');
        }
      }
      return parsed;
    })(),
    // Same refusal as the job schema: silently folding a non-boolean to false is how an
    // option gets accepted and then ignored.
    snapshotAfter: (() => {
      if (input.snapshotAfter === undefined) return false;
      if (typeof input.snapshotAfter !== 'boolean') throw bad('snapshotAfter must be a boolean');
      return input.snapshotAfter;
    })(),
  };
}
