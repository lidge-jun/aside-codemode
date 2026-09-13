# Baseline evidence and competing causes

Reviewed base: d1fa63804871d7f72685d7542fa7fedd12bdab4f. Previous review ran 86 original tests successfully on Linux/Node 22.22.2/rg 14.1.1; this is historical evidence, not a substitute for fresh tests.

Observed: async continuation loop outlives 25ms deadline; followSymlinks reads a synthetic outside-root sentinel; concurrent same-file distinct replacements lose updates in 20/20 trials; truncated/partial array metadata is absent from JSON; 1024-byte Unicode budget returns 2880 bytes; context events discarded; count throws on partial; includeExcluded missing from catalog; '/' root prefix fails; second @@ rejected.

Hypothesis discrimination: timeout = event-loop starvation vs bad timeout configuration vs subprocess hang (pure async JS removes subprocesses, sync-vs-await isolates scheduling); lost writes = unlocked read-modify-write vs overlapping edits vs wrong path (distinct edits and canonical same file exclude latter two); metadata = JSON array representation vs missing rg signals vs CLI parser loss (host metadata exists and direct stringify drops it); byte cap = UTF-16 slicing vs configuration precedence vs JSON overhead (direct runCode controlled cap and ASCII/Unicode toggle isolates slicing). New regression tests must reproduce each repaired symptom before/against the base where feasible; no green-by-deleted-assertion changes.

Private raw logs live outside the checkout. Committed evidence contains commands, counts, source anchors and synthetic fixtures only, not Aside conversations or credentials.
