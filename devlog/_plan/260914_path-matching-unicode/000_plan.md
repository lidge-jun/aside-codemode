# 260914 path-matching-unicode — plan

## Why

A side session tried to find `붙임 … 안내문.pdf` in `~/Downloads` through codemode and got
`ok:true` with an empty array three times in a row. Two independent defects stacked:

1. `search.files({ pattern: '*.pdf' })` — `pattern` is a case-sensitive substring filter
   (`line.includes(pattern)` in `src/rg.js`), not a glob. No path on any filesystem contains
   the literal characters `*.pdf`, so the correct answer was zero. The caller had no way to
   learn that: the schema says "substring" but the guest-facing text in `src/tools.js` shows
   `search.files({ path, pattern?, glob?, ... })` and never says which is which.
2. `files.find(f => f.includes('안내문'))` — macOS stores filenames in NFD, the guest typed
   NFC. `nfd.includes(nfc)` is `false` for the same visible name. The repository contains
   zero `normalize`/NFC/NFD handling.

A third, worse instance of the same class was found by reading: `src/paths.js` compares
`cmp(resolved)` against `cmpRoots` with `toLowerCase()` on Windows and nothing elsewhere. A
normalization-form difference between a configured root and a guest path therefore reads as
"path escapes configured roots" (EROOT) — an access-denied-looking failure rather than an
empty result.

## Scope

This is a separate track from the wp6 browse work; it branches from `dev` (f81f0ca) as
`fix/path-matching-unicode` and touches no browse file.

In:

- `src/unicode.js` (new) — one `nfc()` helper plus `GLOB_METACHARS` detection, so matching
  policy lives in one place instead of three call sites.
- `src/search-schema.js` — `pattern` rejects `*` and `?` with EBADVAL naming `glob`, and its
  description states substring + NFC semantics. Discovery (`actions.check`) inherits it for
  free because the schema is the single owner.
- `src/rg.js` — the `files()` pattern filter compares NFC-normalized text; returned paths
  keep their original bytes so they still open.
- `src/paths.js` — normalization-TOLERANT resolution, not a normalized comparison. See the
  measurement below: normalizing the containment test would widen the allowlist.
- `src/host/fs.js` — `grepFile` retries a failed match against the NFC form of the line, and
  only when the matcher itself contains non-ASCII, so an ASCII pattern pays nothing.
- `src/tools.js` — guest text says `pattern` is a substring filter, not a glob.
- `test/unicode-paths.test.js` (new) — offline, no network.

Out:

- `search.content`/`search.count` normalization. Matching happens inside ripgrep on raw
  bytes; we cannot normalize without re-reading every file ourselves. Documented as a known
  limitation in the guest text instead of silently half-fixed.
- Binary-safe guest reads (base64 `fs.readBytes`), the other finding from that session. It
  needs a decided use case first; a 125 KB PDF pulled into a guest that has no `require` and
  a 64 KiB response budget buys nothing.
- Rejecting `[`, `]`, `{`, `}` in `pattern`. They are legal, non-rare filename characters, so
  rejecting them would break real substring filters. `*` and `?` are illegal in Windows
  filenames and vanishingly rare elsewhere, so they are safe to refuse.

## Behaviour contract

## Measured on Windows before building (2026-09-14, node v24.16.0, NTFS)

A throwaway probe against this branch's `src/rg.js` and `src/paths.js`:

```
forms:        NFC '안내문' len 3, NFD len 8, nfd.includes(nfc) = false
distinctOnDisk: true          <- NTFS keeps the NFC and NFD spellings as two SEPARATE entries
realpathNFC:  throws ENOENT   <- the NFC spelling of an NFD directory does not resolve
search:       pattern '*.pdf' -> 0 rows,  glob '**/*.pdf' -> 1 row
              pattern NFC     -> 0 rows,  pattern NFD     -> 1 row   (file stored NFD)
guardNFC:     threw EROOT     <- misleading: the path is missing, not outside the root
guardNFD:     accepted
tolerantRetryNFD: resolved    <- retrying the other normalization form finds the real file
```

This overturns the root-guard half of the original plan. `distinctOnDisk: true` means that on
NTFS (and on ext4) `<root>/문서` in NFC and `<root>/문서` in NFD are two different directories.
Normalizing the containment comparison would therefore let a path into a directory that was
never configured as a root — a widening of a security-shaped guard to fix a cosmetic error
message. macOS is the opposite case: APFS lookup is normalization-insensitive, so `realpath`
already returns the canonical on-disk bytes and the comparison never sees a mismatch there.

The real defect is upstream of the comparison. `assertInside` walks up on ENOENT and rejoins
the missing tail, so a name typed in the wrong form never resolves, lands next to the root as
an unresolvable tail, and reports EROOT ("escapes configured roots") for a file that simply is
not there under that spelling. The fix is to make RESOLUTION tolerant and leave the comparison
byte-exact:

- in the ENOENT branch, before walking up, retry `real()` on the alternate normalization form
  of that segment, but only when the segment is non-ASCII and its NFC and NFD forms differ;
- if the alternate form resolves, adopt it — the canonical realpath is then compared
  byte-exactly, exactly as before, so the allowlist is not widened by one character;
- if nothing resolves, keep today's behaviour.

That turns the measured `guardNFC: threw EROOT` into "accepted, and the file opens", which is
strictly more capability with strictly the same containment rule.

| Call | Before | After |
|---|---|---|
| `search.files({path, pattern:'*.pdf'})` | `ok:true`, `[]` | throws EBADVAL: pattern is a substring filter, use `glob:'**/*.pdf'` |
| `search.files({path, pattern:'안내문'})` over an NFD file | `[]` | the file, with its on-disk NFD bytes intact |
| `assertInside` with NFC input over an NFD directory | EROOT (measured) | resolved real path, byte-exact containment unchanged |
| `fs.grepFile(p, /안내문/)` over NFD content | no hits | hits, with the raw line text returned |
| `search.content` with a non-ASCII query | byte match | unchanged (documented) |

## Risks

- The discarded design (normalizing the comparison) would have accepted a sibling directory
  whose name differs only by normalization form. Measured `distinctOnDisk: true` shows those
  are different directories on NTFS, so that risk was real, not theoretical. The shipped design
  never normalizes the comparison; it only retries a filesystem lookup, and an adopted path is
  a real path that the OS itself resolved.
- `grepFile` normalization cost on large files. Gated on a non-ASCII matcher and only after a
  raw match misses, so ASCII greps over 2 GB logs are unchanged.
- Rejecting `*` is a breaking change for anyone who passed a glob and accepted zero rows. That
  is the defect, and the project's stated policy is refusing silent degradation.

## Check plan

`test/unicode-paths.test.js`, written to fail on the current code:

1. NFD filename on disk + NFC pattern returns the file, and the returned path opens.
2. `validateSearchOptions` and `actions.check('search.files', ...)` both reject `'*.pdf'` with
   EBADVAL and a message naming `glob`.
3. `makeRootGuard` over an NFD directory accepts the NFC spelling and returns the real (NFD)
   path; a sibling directory outside the roots is still rejected with EROOT even when its name
   differs from a root only by normalization form.
4. `grepFile` finds an NFD line from an NFC regex and returns the original bytes.
5. Full `npm test` stays green (327 tests at f81f0ca).

## Done means

Committed on `fix/path-matching-unicode`, pushed to `origin/dev` as a fast-forward, and the
dev CI matrix (Ubuntu 18/20/22, macOS 22, Windows 22) green.

## Second review, folded at C

A second independent review arrived after the build, with its own reproductions on macOS and
an isolated Linux filesystem. Four of its findings land on this change.

**Accepted — bracket patterns must keep working.** It built `report[final].pdf` and showed that
`pattern: "[final]"` is a legitimate literal search that a blanket `* ? [` ban would break. This
change never banned `[`; the rule is `*` and `?` only, which are illegal in Windows filenames.
`test/unicode-paths.test.js` now creates that exact file and asserts the search still returns it,
so the narrower rule is pinned rather than merely intended.

**Accepted — content search is a separate contract from filename matching.** Its counterexample:
one decomposed Hangul syllable matches `/^.{3}$/u` and stops matching once composed, because
normalization changes character counts. That specific regex is ASCII-sourced and was never
folded here, but the objection holds in principle, so `fs.grepFile` folding is now disclosed and
reversible: `.scope.normalize` reports the policy actually in force, `normalize: false` restores
byte-exact matching, and folding can only ever ADD a match — line numbers, returned text and
`boundLine` byte bounds always describe the raw file. Filename matching stays folded by default,
because a silent zero is the defect being fixed.

**Already satisfied — do not NFC the root guard comparison.** Its Linux counterexample (two
sibling directories, same visible name, different inodes; a folded comparison wrongly admits the
one that was never configured) is the same conclusion the Windows probe forced before the build.
Containment is compared on realpath’d bytes; normalization only retries a filesystem LOOKUP.
`normalization tolerance does not widen the root allowlist` is that counterexample as a test.
Its macOS measurement (8 of 8 combinations already allowed) is consistent: APFS resolves either
spelling, so the retry is a no-op there and a repair on Windows/Linux, where the probe measured
`guard(NFC spelling of an NFD dir) -> EROOT`.

**Accepted — documentation has to reach the path that is actually called.** The failing session
went through the registered AGENTS block and bash, never the MCP tool description, so
`templates/AGENTS.codemode.md` now carries the pattern-vs-glob distinction, the NFC comparison
rule with "open the original path", the advice to return candidates and a status instead of a
bare `.find()`, and the fact that directory listing is `fs.list` and not `fs.readdir`.

**Deliberate contract change, stated as one.** Refusing `*` and `?` removes the ability to
substring-match a POSIX filename that genuinely contains them. The refusal message names the
route that still works (list with `glob`, filter the rows). The trade is taken knowingly: those
two characters cannot occur in a Windows filename at all, and the alternative is the measured
failure mode where three correct-looking calls return an empty array with no error.

**Out of this track.** The same review reports three defects in the wp6 browse work that is being
pushed to `dev` in parallel: a search cache keyed without `since` returning stale rows as a hit,
`prefetch` warming a cache that `readText` never consults, and `compactTree` returning empty for
the real `- heading ...` Aside output because its fixtures use a format Aside does not emit.
They belong to the wp6 owner, not to this branch, and are reported rather than silently adopted.
