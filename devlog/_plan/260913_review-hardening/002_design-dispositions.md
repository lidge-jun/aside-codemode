# Independent design review dispositions

Aside read-only design reviewer returned PASS with three named risks. Native architect routing and formal FSM remain unavailable as documented in 000; this is independent design feedback, not a fabricated native audit.

1. ACCEPT: worker cannot structuredClone injected functions. Main will implement explicit allowlisted host RPC and keep discovery local/synchronous. Existing closure-based runCode tests must still pass.
2. ACCEPT: search metadata cannot rely on ordinary structuredClone. Search lane owns src/search-result.js with `decorateSearchResult(value, metadata)` and `restoreSearchResult(envelope)`. Both export arrays/count objects with non-enumerable fields and toJSON. Wire envelope uses rows for arrays; count keeps matches/files, plus complete/truncated/partial/scope. Runtime explicitly transports envelope then restores it for guest ergonomic use. Final nested serialization preserves the envelope.
3. REBUT multi-file deadlock: apply_patch awaits edit_file one target at a time and each call releases its own lock before returning. No call holds A while acquiring B; therefore AB-BA is unreachable in this chosen design. Never acquire all locks or nest file locks. Bounded lock wait remains mandatory and unknown locks are not stolen.
4. ACCEPT: patch failure is an Error retaining the original message/code, with applied[] and failedFile attached. Supervisor carries these fields into error responses.
5. ACCEPT: exact headline must be immediately qualified, not footnoted. No claimed end-to-end 50x measurement.

Verification before production edits: fresh `npm test` baseline exit 0 on local Node 24.17.0; full log outside checkout. Existing tests unchanged. Logical slice implementation follows this locked roadmap; main owns commits and all public integration.
