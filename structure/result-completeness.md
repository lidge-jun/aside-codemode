# Result completeness

One question, asked of every public action: **did the implementation do less than the caller
asked, and can the caller tell?**

Six closed issues were the same sentence — the call skipped, capped or could not apply
something, and the field the caller reads said everything was fine. Six fixes, six
symptom tests, and the seventh and eighth instances shipped under a green suite. This
document is the invariant those fixes shared and none of them wrote down.

## The invariant

> If the implementation skipped, capped, filtered out or could not apply something the caller
> requested, the completeness field that action documents MUST NOT report full success.

An action with no such field is a bug by definition. That rule alone is what surfaced
`fs.list`.

## The two questions, kept apart

`complete` and `ok` answer different things and neither substitutes for the other.

| Field | Question | Owner |
| --- | --- | --- |
| `complete` | did the walk that ran lose anything — a cap, an unreadable path, a kill, an unapplied filter? | this document |
| `ok` | action-local. "no query threw", "this body is a usable page", "the run completed" | each action |

`ok: true, complete: false` is legal and expected. `browse.searchMany` returns exactly that
when every query succeeded and a requested `since` filter could not be applied to any
candidate. Redefining `ok` globally as "nothing was skipped" would silently change branching
for every existing caller, so it was rejected.

A positive selector the caller supplied — a `glob`, the query itself, a `depth`, a `since`
that was actually applied — defines the request. It lowers nothing.

## The mechanism

`src/result-envelope.js` is the canonical owner. It attaches non-enumerable `truncated`,
`partial`, `complete`, `scope` and `toJSON` so a result keeps plain ergonomics
(`rows.length`, `.map`, destructuring) while still telling the truth on the wire. A bare
`JSON.stringify` of a decorated array emits `{rows, complete, truncated, partial, scope}`.

Two rules that are easy to get wrong:

**The overflow witness.** A cap is honest only when the implementation reads `max + 1`.
Accepting the extra row and dropping it is what tells "more existed" apart from a complete
answer that happens to be exactly `max` long. `src/rg-stream.js` owns this for search;
`fs.list` follows it. Content/count byte limits are separate from this row witness: an
oversized skipped JSON record adds a `partial` warning and lowers completeness even if no
rows survive. Exhausting the cumulative stdout budget also sets `truncated`. Neither loss
is an exact count or evidence of absence; neither silently narrows the discovery filters.

**The brand, not the name.** Whether metadata crosses the guest wire is decided by a brand
the decorator attaches, never by the action's name. The previous name list — `search.*` plus
exactly `fs.grepFile` — could not know about an action added after it was written, so a
newly decorated action passed every host test and arrived bare in the guest.

## Per-action disclosure

The field a caller reads to detect incomplete work.

| Action | Field |
| --- | --- |
| `search.files`, `search.content`, `search.count` | `complete`, with `truncated`, `partial`, `scope` |
| `fs.grepFile` | `complete` / `truncated` |
| `fs.list` | `complete` / `truncated`; `partial` names unreadable directories |
| `fs.readMany` | per-row `skipped` and `error` |
| `browse.searchMany` | `complete`; `dateFilter` and `suspectEmpty` explain it |
| `browse.exec`, `browse.captureMany` | `complete`, `status`, `partial`, `truncated`, `lostTo`, `contentVerified` |
| `browse.readText` | `complete`, with `ok`, `blockKind`, `degraded` and `contentShape` explaining it |
| `browse.attach` | `complete`, `truncated`, `lostTo` — the same axes a batch item can lose |
| `browse.downloadMedia` | `complete`, with `requested` and `delivered` counting the gap |
| `browse.watch` | `complete`, with `observed`; an unobserved url is `changed:null`, never `false` |
| `browse.prefetch` | `complete`. `ok` stays `true` by design — a warm-up failure is not the caller's failure |
| `recipes.run` | `complete`, `status`, `truncated`, `lostTo`, forwarded from the run it wraps |
| `report.build` | `complete`, with `runStatus` and `lostTo` from the run that printed the page |
| `api.batch` | `complete`; an adapter that hit its own `limit` reports `saturated` |

### What `complete` answers for a browse batch

Three things have to be true, and only the first of them used to be checked:

1. the run finished every job it was given — `status === 'completed'`
2. nothing inside a finished job was cut — `truncated === false`
3. no loss marker was raised — every entry in `partial` is an advisory

The second one is the whole of wp9. A job can report `ok` while the tree it brought back was
sliced at `maxTreeChars`, the post-action snapshot failed, or a ref read came back
`ESTALEREF`. `itemLoss()` in `src/host/browse/session.js` names each of those, and `lostTo`
carries the names out so a caller knows whether to raise a cap or re-mint its refs.

`partial` carries two kinds of thing and always has. `PARTIAL_ADVISORY` in
`src/host/browse/result-contract.js` names the ones that are not losses — currently
`navigated-during-actions`, which says WHICH document a successful observation describes.
Everything else in that array lowers completeness, including `suspect-empty`:
`browse.searchMany` already treated it as a loss, and one marker meaning two things in two
producers was the defect rather than the fix.

## Named exceptions

These cannot carry a field and say so rather than pretending.

**`fs.read` and `read_file` return a primitive string.** The catalog promises
`Promise<string>` and the suite asserts it as one. The `[truncated: ...]` suffix inside the
text is DISPLAY TEXT, not the contract: a caller that needs a completeness bit must use
`fs.grepFile` or `fs.list`. Changing the return shape is a public break and is not taken here.

**`fs.grepFile`'s `maxLineBytes`** truncates returned text through an in-band marker. It
cannot hide a hit — matching happens before truncation — but it can hide the matched
substring from the row.

In-band markers are a distinct defect class from silence: the information exists, but a
caller who checks fields cannot see it. New code does not add them.

## Absence is a stronger claim than emptiness

`complete: true` on an empty result means the walk lost nothing. It does NOT mean the string
is absent from the tree, because a walk can be pruned before it ever sees a match. The
pruning axes and what discloses them are the search surface's own subject; see
[`local-surface.md`](local-surface.md).

Two axes cannot currently be proven at all, and are recorded here rather than papered over:

- **encoding** — no `--encoding` is passed to ripgrep, and the line reader decodes UTF-8
  only. Text in an unsupported legacy encoding is never matched.
- **binary content** — ripgrep skips binary files by default and returns a silent zero. A
  string inside a binary file is invisible to `search.content` while `search.files` still
  lists the file.

A tool that says "I cannot prove this" is more useful than one that guesses.
