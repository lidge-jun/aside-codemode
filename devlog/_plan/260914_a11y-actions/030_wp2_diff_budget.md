# 030 — wp2, diff, ref extract, tab budget

## Post-action snapshot diff

Measured: one click grew the dashboard tree from 3,126 to 23,530 characters.
Returning a second full tree after every action is the token problem again.

`snapshotAfter: 'diff' | 'tree' | 'interactive' | false`. In `diff` mode the script
compares the before and after ref sets and returns
`{ added: [...], removed: [...], changed: [...], beforeRefs, afterRefs, urlChanged }`
where a changed row is a ref whose role or name moved. Rows, not characters: a
line diff of an indented tree is noise.

## Ref-addressed extraction

`extract` currently takes CSS only. Allow `{ field: { ref: 'f1e2', attr?: 'value' } }`
so a value discovered in the tree can be read back without inventing a selector for
it. Implemented with `locator(ref).innerText()` / `.getAttribute()`, both measured present.

## Tab budget

A killed CLI leaks its tabs permanently and no later session can close them. The
9-course parallel run already tripped Aside's own "10 tabs are open" warning, and
ref actions make longer runs normal. Per A3 the budget counts **currently owned**
tabs, not cumulative ones: `browse.exec` already accepts more urls than maxTabs and
closes each tab as it finishes, so a cumulative counter would turn a working 20-url
batch into 8 results and 12 refusals. Report `tabsOpened`, `tabsClosed` and
`tabsPeak` on every run, and raise `ETABBUDGET` only when the pool genuinely cannot
release one.
