# 050 — wp2, diff / ref extraction / tab budget

## What wp1 changed about this plan

030 planned "frame-scoped refs" as a unit. It no longer exists: a child frame's
element is already addressable from the top-level page as an f-prefixed ref, proven
live. Nothing to build. wp2 is the three remaining items.

## 1. Post-action snapshot diff  (criterion c-4)

Measured: one click grew the dashboard tree from 3,126 to 23,530 characters.
Returning a second full tree after every action is the token problem wp1's
'interactive' mode existed to avoid.

NEW in the injected tree source: `diffRefs(beforeRefs, afterRefs)` returning
`{ added, removed, changed, sameCount }`. Rows, not characters: a line diff of an
indented tree is noise. `changed` is a ref present in both whose role or name moved,
reported as `{ ref, from: {role,name}, to: {role,name} }`.

Job option `snapshotAfter: false | 'bytes' | 'tree' | 'interactive' | 'diff'`.
Only meaningful with `actions`; refused otherwise so it cannot silently do nothing.
The result carries `snapshotAfter` with the new fingerprint, so the caller can chain a
second call without a separate read.

## 2. Ref-addressed extraction  (part of the objective)

`extract: { name: { ref: 'f1e2', attr?: 'value' } }` alongside today's css form.
Implemented with `locator(ref).innerText()` and `.getAttribute()`, both measured present.

THE HAZARD wp1 left behind: this is the first READ-ONLY ref verb. Until now every
ref-targeted verb mutated, which is the only reason `__INERT` was unreachable and
harmless. A ref extract that runs after a mutating action list is reading refs from
a tree that no longer exists, and it would look like a clean value.

So ref extraction is guarded exactly like a ref action: when `refsFingerprint` is
given and the tree is dirty, it is re-validated, and a field whose refs are stale
returns `null` with the field name in `data.stale` rather than a wrong value.

## 3. Tab budget  (criterion c-6)

A killed CLI leaks its tabs permanently. Per the wp8 audit the budget counts
CURRENTLY OWNED tabs, never cumulative: `browse.exec` already accepts more urls than
maxTabs and closes each as it finishes, so a cumulative counter would turn a working
20-url batch into 8 results and 12 refusals.

Every run reports `tabs: { opened, closed, peak, max }`. A worker that would exceed
`browseCaps.maxTabs` waits for a release instead of opening, and only raises
`ETABBUDGET` when the wait itself hits the deadline. `leakedUrls` stays as it is; the
counters make a leak visible in the result rather than only in Aside's console.

## Done means

c-4 and c-6 met with captured output, suite green, an independent audit round, the
head pushed to dev and deployed to the three machines with a live probe that
exercises a diff and a ref extraction.

