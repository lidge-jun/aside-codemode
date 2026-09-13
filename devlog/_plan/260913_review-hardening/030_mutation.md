# Cooperating writes and patch semantics

MODIFY src/host/fs.js: canonical path cross-process exclusive lock covers read->validate->write for edit_file and overwrite helper. Create-only remains wx. NEW host/file-lock.js if no equivalent exists. Do not use an in-memory mutex as cross-process proof. Fail closed on unknown/stale locks; bounded wait and ELOCKED/timeout error; no automatic deletion of someone else's lock. Cancellation stops waiting and releases owned locks in finally; a crash may leave explicit recovery-required lock. Preserve file mode when replacing. Bound file reads at descriptor/stream rather than loading arbitrary full file before applying maxBytes/line limits.

MODIFY host/patch.js: Update has multiple @@ chunks mapped to edits against original, reject malformed patch before writing, support end-of-file marker with explicit semantics, preserve conventional final newline for Add, document unsupported Delete/Move. Application catches errors and attaches applied targets plus failed target; success stays {}. Atomic across one file's edits only; no transaction across files.

NEW test/write-hardening.test.js: independent replacements via Promise.all keep both; cross-process shared-file edits or append tokens all survive; preheld lock gives bounded actionable error; failed edit releases its lock; create-only never overwrites; multi-hunk and repeated oldText with context; Add newline/EOF behavior; later failure reports earlier applied path; paged reads do not require entire large file; no unexpected files outside temp fixtures.

## Implementation and verification

Implemented file-lock.js, file-read.js and the owning fs/patch operations. Cross-process exclusive locks span original read through atomic replacement; one file lock is released before the next patch target. Unknown locks are never stolen or released by a different owner. Replacement files use exclusive creation, preserve mode and recheck cancellation before rename. Reads preserve UTF-8 boundaries, trailing-empty-line pagination, and bound retained paged output at262144 bytes. Paged physical lines are limited to262144 bytes; grep physical lines to1MiB, preserving the existing400KB output-truncation scenario. Larger inputs fail explicitly rather than silently disappear. Edit still reads the full original; no global memory cap is claimed.

Multi-hunk Update and actual EOF anchors are supported. Anchorless/malformed patches reject before any write. Partial application retains original Error code/message plus applied[]/failedFile; no cross-file transaction. Four original patch content assertions add the documented final newline; no assertions removed.

Baseline86/86; original synthetic RED9/9 and regression RED14/28; focused lane29/29. Main boundary tests captured RED for byte seams, unknown-lock release, anchorless partial apply, trailing pagination, output-window limits and cancelled reads, then GREEN. Fresh file commit check passed77 tests with0 failures. Cross-process tests use an IPC barrier for six writers, not sleep. Fixture roots are canonicalized before lock-key comparison so test and runtime hold the same lock.

Residuals: Windows not run; noncooperating editors, hard-link aliases, filesystem errors and crash-left locks are outside the guarantee. Already submitted I/O is not promised to roll back. Formal native loop remains unavailable, not claimed complete.
