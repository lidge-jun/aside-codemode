// Input contract for browse.attach. Kept separate from the browse job schema so the two
// evolve independently: attach has no urls, no navigation and no artifacts.

import { validateActions } from './schema.js';

function bad(message) {
  const e = new Error(message);
  e.code = 'EINVAL';
  return e;
}

export function validateAttach(input = {}) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw bad('browse.attach takes an options object');
  }
  const known = new Set([
    'targetId', 'urlIncludes', 'titleIncludes',
    'requireSelector', 'minTextChars', 'includeText', 'maxTextChars', 'sampleChars',
    'snapshot', 'maxTreeChars',
    'actions', 'stopOnError', 'allowStaleRefs', 'actionBudgetMs',
    'refsFingerprint',
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
    actions: validateActions(input.actions),
    stopOnError: input.stopOnError !== false,
    allowStaleRefs: input.allowStaleRefs === true,
    // Capped so the host deadline can always outlast it; the REPL cap is 120000ms and the
    // report has to be printed before the process is killed.
    actionBudgetMs: num('actionBudgetMs', 1, 90000, 20000),
    refsFingerprint: str('refsFingerprint'),
  };
}
