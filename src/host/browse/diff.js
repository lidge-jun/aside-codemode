// What changed between the observation a call arrived at and the one its actions left
// behind. This runs on the host rather than inside the generated script: it needs no
// browser, and the script travels as a command-line argument with a 30000-character budget
// that the action helper alone spends a third of.
//
// Two independent reasons refuse a comparison. The document moved, or the tree was
// re-minted underneath us. A url check alone misses an SPA re-render that renumbers every
// ref while location.href stays put; a row-overlap check alone misses a navigation to a
// page that happens to look similar. Both are asked, and either one refuses.
//
// The overlap ratio says the two trees are talking about the same page. It does not prove
// that any individual row is the same element, and nothing here claims it does.

// Bracketed markers that are STATE. Everything else bracketed is an attribute: calling a
// placeholder a state is how a diff starts reporting changes that never happened.
const STATE_KEYS = Object.freeze([
  'checked', 'disabled', 'expanded', 'selected', 'pressed',
  'readonly', 'required', 'invalid', 'busy', 'current',
]);

// A secret is a secret wherever it appears. Redacting only inside changed[] left the value
// in added[], in removed[] and in the reset tree, which are the same bytes going to the
// same caller.
const PASSWORD_HINT = /password|passphrase|비밀번호/i;
const isSecretRow = (role, name, attrs) => attrs.type === 'password'
  || PASSWORD_HINT.test(String(role)) || PASSWORD_HINT.test(String(name));
export function scrubLine(line) {
  return String(line).replace(/(\svalue=")[^"]*(")/, '$1[redacted]$2');
}

// A digest kept on the row and never emitted. Hiding the value made every password look
// unchanged, which is the opposite failure: the caller could no longer tell that the field
// had been filled at all.
function digest(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h;
}

export function parseRow(line) {
  const lead = /^[ ]*/.exec(line)[0].length;
  const ref = (/\[ref=([^\]]+)\]/.exec(line) || [])[1] || null;
  const role = (/^[\s-]*([a-zA-Z][a-zA-Z0-9_-]*)/.exec(line) || [])[1] || '';
  // Only the quoted name BEFORE the first bracket is the accessible name. A row with no
  // name would otherwise borrow the text out of [placeholder="…"].
  const head = line.split('[')[0];
  const name = (/"([^"]*)"/.exec(head) || [])[1] || '';
  const state = [];
  const attrs = {};
  for (const m of line.matchAll(/\[([a-zA-Z-]+)(?:=([^\]]*))?\]/g)) {
    const k = m[1].toLowerCase();
    if (k === 'ref') continue;
    if (STATE_KEYS.includes(k)) state.push(k);
    else attrs[k] = m[2] === undefined ? true : m[2].replace(/^"(.*)"$/, '$1');
  }
  // Aside writes an input's current text as a bare value="..." rather than in brackets.
  const val = /\svalue="([^"]*)"/.exec(line);
  if (val) attrs.value = val[1];
  const secret = isSecretRow(role, name, attrs);
  let vhash = null;
  if (secret && 'value' in attrs) { vhash = digest(String(attrs.value)); attrs.value = '[redacted]'; }
  return {
    ref, role, name, depth: Math.floor(lead / 2), state: state.sort(), attrs,
    raw: (secret ? scrubLine(line) : line).trim(), secret, vhash,
  };
}

export function parseRows(tree) {
  return String(tree || '').split(/\r?\n/).filter((l) => l.trim()).map(parseRow);
}

// A ref row is identified by what it is, not by where it sits: ref alone would call a
// renumbered tree unchanged, and depth alone would call every wrapped row different.
const keyRef = (r) => r.ref + '|' + r.role + '|' + r.name;
// A row with no ref has no identity of its own, so the line itself carries it. Option rows
// are the common case: Aside prints them without a ref and marks selection inline, so a
// (selected) move shows up as one static row removed and one added rather than as a state
// change on something that has no state to change.
const keyStatic = (r) => r.depth + '|' + r.raw;

export function diffRefs(before, after) {
  const bRef = new Map();
  const aRef = new Map();
  for (const r of before.rows) if (r.ref) bRef.set(keyRef(r), r);
  for (const r of after.rows) if (r.ref) aRef.set(keyRef(r), r);
  let hit = 0;
  for (const k of bRef.keys()) if (aRef.has(k)) hit += 1;
  const overlap = Math.round((hit / Math.max(1, bRef.size)) * 100) / 100;
  const base = { overlap, beforeCount: bRef.size, afterCount: aRef.size };
  if (before.url !== after.url) return { comparable: false, reason: 'navigated', ...base };
  if (overlap < 0.5) return { comparable: false, reason: 're-minted', ...base };

  const added = [];
  const removed = [];
  const changed = [];
  const depthChanged = [];
  let same = 0;
  for (const [k, r] of aRef) if (!bRef.has(k)) added.push(r.raw);
  for (const [k, r] of bRef) if (!aRef.has(k)) removed.push(r.raw);
  for (const [k, b] of bRef) {
    const a = aRef.get(k);
    if (!a) continue;
    // Depth is its own report. Wrapping a dialog around existing content moves every row,
    // and mixing that into changed[] buries the one row that actually changed.
    if (b.depth !== a.depth) depthChanged.push({ ref: a.ref, from: b.depth, to: a.depth });
    const stateMoved = b.state.join(',') !== a.state.join(',');
    const attrsMoved = JSON.stringify(b.attrs) !== JSON.stringify(a.attrs);
    // For a secret row the values are both '[redacted]', so the comparison that matters is
    // the digest neither side ever emits.
    const secretMoved = (b.secret || a.secret) && b.vhash !== a.vhash;
    if (stateMoved || attrsMoved || secretMoved) {
      changed.push({
        ref: a.ref, role: a.role, name: a.name,
        state: { from: b.state, to: a.state },
        attrs: { from: b.attrs, to: a.attrs },
      });
    } else if (b.depth === a.depth) same += 1;
  }

  const bStatic = new Map();
  const aStatic = new Map();
  for (const r of before.rows) if (!r.ref) bStatic.set(keyStatic(r), r);
  for (const r of after.rows) if (!r.ref) aStatic.set(keyStatic(r), r);
  const staticRows = { added: [], removed: [] };
  for (const [k, r] of aStatic) if (!bStatic.has(k)) staticRows.added.push(r.raw);
  for (const [k, r] of bStatic) if (!aStatic.has(k)) staticRows.removed.push(r.raw);

  return { comparable: true, ...base, added, removed, changed, depthChanged, staticRows, same };
}

// Attach the comparison to an item that asked for one. A refused comparison returns the new
// observation instead, so the caller starts from what is on the page rather than from a
// diff nobody can trust.
export function attachDiff(item) {
  const after = item && item.snapshotAfter;
  if (!after || typeof after.tree !== 'string') return item;
  const beforeTree = (item.snapshot && item.snapshot.tree) || '';
  const beforeUrl = item.urlBeforeActions || item.finalUrl || item.url;
  const afterUrl = after.url || item.finalUrl || item.url;
  const diff = diffRefs(
    { url: beforeUrl, rows: parseRows(beforeTree) },
    { url: afterUrl, rows: parseRows(after.tree) },
  );
  after.baseSnapshotId = item.snapshot && item.snapshot.fingerprint
    ? item.snapshot.fingerprint + '|' + beforeUrl
    : null;
  after.diff = diff;
  if (!diff.comparable) {
    // The tree we hand back to restart from goes through the same scrub: it is the same
    // page, and the caller reading it is the same caller.
    after.reset = {
      snapshotId: after.snapshotId,
      fingerprint: after.fingerprint,
      tree: String(after.tree).split(/\r?\n/).map((l) => (PASSWORD_HINT.test(l) || /\[type=password\]/.test(l) ? scrubLine(l) : l)).join('\n'),
    };
  }
  return item;
}
