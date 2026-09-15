# Local file and search surface

The guest gets Aside-shaped file tools and a ripgrep-backed search, so a question about fifty files
costs one call and returns the answer rather than the files.

## Search

`src/host/search.js` exposes three methods with different subjects: `search.files` matches paths,
`search.content` matches file contents, and `search.count` counts those matches. All three require a
`path` inside a configured root. Passing `pattern` to `search.content` is refused with the correct
name, and when the value itself looks like a glob the refusal offers both, because either could be
what was meant.

`src/search-schema.js` is the option authority and `src/rg.js` runs ripgrep behind it.

**A partial search is not proof that a file is absent.** Results carry `complete`, `truncated`,
`partial` and `scope`, and a projection that drops them throws away the only evidence that the
answer was bounded. `noIgnore`, `hidden` and `includeExcluded` are three different controls.

Symlinks are never followed and what was skipped comes back on `scope.skippedSymlinks`. A skipped
directory also sets `complete: false`, because a subtree can hide behind it and no flag brings it
back; point `path` at the link target instead. A skipped file link is counted without lowering
completeness.

## Files

`src/host/fs.js` carries the compound helpers, and the four Aside-shaped tools keep Aside's own
argument names so guest code reads the same on both surfaces. `read_file` takes 1-indexed lines,
`write_file` is create-only, and `edit_file` applies a list of edits.

`src/host/patch.js` implements `apply_patch` as a guest helper rather than a separate command.
Update hunks match whole lines rather than substrings, deleted lines leave no blank behind, and the
file's original newline is preserved. A failed patch may have applied earlier files, so the result
carries `applied` and `failedFile`.

## Writing safely

A write stages a file next to its target and atomically replaces it, preserving the target's mode.
Only the staging file this invocation exclusively created is ever cleaned up.

`src/host/file-lock.js` coordinates codemode writers across processes. It does not coordinate
arbitrary editors, and nothing here pretends otherwise.

