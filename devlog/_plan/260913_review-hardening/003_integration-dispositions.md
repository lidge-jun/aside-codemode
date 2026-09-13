# Main integration findings and disposition

Both implementation leaves completed with scoped source changes and test evidence. Main added independent boundary tests rather than accepting leaf pass counts as final proof.

- Search: adjacent matches are physical context for each other; maxFilesize and query flags belong in scope; a cancelled runner must reject before resolver/spawn; active rg must terminate on the per-execution signal. Added test/search-boundary.test.js (4 initially failing tests). Preserve canonical realpath assertions, not /var versus /private/var spelling, on macOS.
- Files: UTF-8 chunk boundaries, actual EOF anchoring, unknown lock owner refusal, and empty-anchor parse-before-write were independently reproduced and repaired by the mutation lane without weakening main's tests.
- Follow-up: check each physical line after splitting, not aggregate carry containing multiple lines. Cap a returned page across small lines, stream-check cancellation, and reject nonregular files before opening. Add tests for these cases before production changes.
- Atomic write: factor the existing staged replacement into src/host/file-write.js to own temporary-file lifecycle. Check cancellation before commit, preserve permissions, use a fixed-length unique temporary basename and exclusive create, and only clean a temporary file actually created by this invocation. This extraction keeps host/fs.js focused and avoids a filename-length regression. No transaction/rollback guarantee for already-committed I/O.
- Formal native HOTL remains unavailable as recorded in 000. These are actual independent test/review dispositions, not a native FSM attestation.

## Final integration disposition

The staged write remains in the existing fs.js owner: exclusive temporary creation, fixed-length UUID basename, mode preservation and a pre-rename cancellation check are already implemented and verified. A separate file-write module is not needed for this scoped repair. Do not add a parallel owner merely to satisfy a line-count preference. Synchronous host callbacks and JavaScript regexp backtracking remain outside the guest-worker watchdog; READMEs state that residual explicitly.

Remote publication is withheld pending the user's separate push approval under DEV-GIT-PUSH-01. The current request explicitly authorizes local commits; a local plan is not independent permission to publish. No npm publication, global installation, parent-repository write or native FSM mutation was performed.

## Verified additional contracts

- Local rg --max-filesize rejects lowercase suffixes, decimals, KB and whitespace. The shared schema now accepts the actual unsigned 64-bit digit+uppercase K/M/G grammar; test/search-boundary.test.js failed for 1k before the repair and passes after it.
- Fire-and-forget host failure could settle before the final pending-call drain and disappear. Runtime now reports hostCallFailures, including deliberately caught errors; callers should await operations. A deterministic ordered-RPC regression was red before this change. This is not a claim that every counted failure makes the user's recovery logic fail.
- Integration test runs must use the final source snapshot. An intermediate 191/191 full suite passed; additional boundary tests were subsequently added. The completed validation artifact will record the final exact count.
- Read follow-up fixtures for long valid lines, total page budget, and already-cancelled reads all passed on the updated source at first execution; despite the private log filename, this run is GREEN, not RED proof.
