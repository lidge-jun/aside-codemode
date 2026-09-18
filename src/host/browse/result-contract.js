// One vocabulary for every batch result, whoever produced it.
//
// The host batch (schema browse/2) and the in-REPL helper (schema cm/1) are written in
// different places and run in different processes, and a caller is expected to read both with
// the same code. That only holds if "the same shape" is something a machine can check, so it
// lives here and both are checked against it.

// needs_input is part of the vocabulary even where a producer cannot currently emit it: a
// login wall is a run outcome, not an error, and the reader has to already handle it.
export const RUN_STATUSES = Object.freeze(['completed', 'partial', 'failed', 'needs_input', 'indeterminate']);

export const ITEM_STATUSES = Object.freeze([
  'completed', 'partial', 'failed', 'needs_input', 'indeterminate', 'unreturned', 'skipped',
]);

// started is what an effect is between the request and its confirmation. A settled result
// never reports it: by the time the run answers, an unconfirmed effect is indeterminate.
export const EFFECT_STATES = Object.freeze(['confirmed', 'indeterminate']);

export const REQUIRED_KEYS = Object.freeze([
  'schema', 'runId', 'status', 'requested', 'completed', 'unreturned', 'items', 'effects', 'complete',
]);

// `partial` has been carrying two different kinds of thing under one name. Most of its
// markers say something the caller asked for did not come back — 'unreturned', 'blocked',
// 'dead-end', 'unparsable-records', 'truncated-items'. One says which document a successful
// observation describes: a run whose actions navigated observed what it was told to observe,
// and reporting that is a qualification, not a loss.
//
// The split is named here rather than inferred, because the rule below turns it into a
// verdict. 'suspect-empty' is deliberately NOT here: browse.searchMany already lowers its
// completeness for that marker (src/host/browse/search.js:202), and the marker exists
// precisely because an empty result may mean "could not read" rather than "nothing is
// there". Two producers disagreeing about one marker was the defect, not the fix.
export const PARTIAL_ADVISORY = Object.freeze(new Set(['navigated-during-actions']));

// The loss markers in a partial array, in order, with the advisory ones removed.
export function lossMarkers(partial) {
  return Array.isArray(partial) ? partial.filter((p) => !PARTIAL_ADVISORY.has(p)) : [];
}

// Returns the problems rather than throwing, so a test can name every mismatch in one run
// instead of one per edit.
export function checkResultEnvelope(value) {
  const problems = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['not an object'];
  for (const key of REQUIRED_KEYS) {
    if (!(key in value)) problems.push('missing key: ' + key);
  }
  if (typeof value.schema !== 'string' || !value.schema.includes('/')) problems.push('schema must name a versioned contract');
  if (typeof value.runId !== 'string' || value.runId.length === 0) problems.push('runId must be a non-empty string');
  if (!RUN_STATUSES.includes(value.status)) problems.push('status not in the vocabulary: ' + String(value.status));
  for (const key of ['requested', 'completed', 'unreturned']) {
    if (!Number.isInteger(value[key]) || value[key] < 0) problems.push(key + ' must be a count');
  }
  if (!Array.isArray(value.items)) problems.push('items must be an array');
  else {
    value.items.forEach((item, i) => {
      if (!item || typeof item !== 'object') { problems.push('items[' + i + '] is not an object'); return; }
      if (typeof item.jobId !== 'string' || !item.jobId) problems.push('items[' + i + '] has no jobId');
      if (!ITEM_STATUSES.includes(item.status)) problems.push('items[' + i + '] status not in the vocabulary: ' + String(item.status));
    });
  }
  if (!Array.isArray(value.effects)) problems.push('effects must be an array');
  else {
    value.effects.forEach((e, i) => {
      if (!e || typeof e !== 'object') { problems.push('effects[' + i + '] is not an object'); return; }
      if (typeof e.operationId !== 'string' || !e.operationId) problems.push('effects[' + i + '] has no operationId');
      if (!EFFECT_STATES.includes(e.state)) problems.push('effects[' + i + '] state not in the vocabulary: ' + String(e.state));
    });
  }
  if (typeof value.complete !== 'boolean') problems.push('complete must be a boolean');
  // The one rule that ties the counts to the verdict. A run that calls itself complete while
  // some of what was asked for never came back is the failure this whole contract exists for.
  if (value.complete === true && value.status !== 'completed') problems.push('complete:true with status ' + String(value.status));
  // Status is about the run; these two are about the result. A run can finish every item it
  // was given and still hand back a tree that was cut at a cap or a snapshot that failed
  // after the actions ran, and until wp9 the host said complete:true over exactly that.
  if (value.complete === true && value.truncated === true) problems.push('complete:true with truncated:true');
  const losses = lossMarkers(value.partial);
  if (value.complete === true && losses.length) {
    problems.push('complete:true with partial ' + JSON.stringify(losses));
  }
  if (value.status === 'completed' && Number.isInteger(value.requested) && value.completed !== value.requested) {
    problems.push('status completed with ' + value.completed + ' of ' + value.requested);
  }
  return problems;
}
