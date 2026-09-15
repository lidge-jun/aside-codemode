# Rules for `structure/`

This folder inherits the repository rules in [`AGENTS.md`](../AGENTS.md) and adds two of its own.
[`INDEX.md`](INDEX.md) is generated from [`manifest.json`](manifest.json); it is never the file you
edit to record something.

## What belongs here

A document here states **the contract that holds right now**, in the present tense, for one part of
the system. That is the whole job.

- Open work, sequencing and investigation belong in `devlog/`, which is not tracked.
- Reasoning, alternatives and superseded choices belong in `decisions/`, not in a document body.
- A measured number belongs to a note under `evidence/` when the README cites it; the rule in the
  root [`AGENTS.md`](../AGENTS.md) binds this folder without exception.

If you cannot write a sentence in the present tense about how the system behaves today, it is not a
structure document. A roadmap is the clearest example of what does not belong.

## Layout

- File names are kebab-case, start with a letter, and sit at most one directory deep.
- **Ordering lives in `manifest.json`, never in a filename.** Leading digits are rejected.
- A document stays under `sizeBudgetLines`. Over budget, split it along a topic boundary and give
  each half its own manifest entry.

## The source-to-document map

Each entry lists the source areas it describes, in its `documents` array, and `INDEX.md` publishes
the inverse. An area may be described by more than one document, and changing an area obliges the
same change to every document listed for it.

The gate checks the weak form: a `documents` entry is rejected when the document never names the
area or a path under it. That catches an invented claim. It does not prove the document says
anything useful about the area, and it cannot tell you two documents contradict each other. Both
are review.

A source directory that no document claims is either added to a `documents` list or recorded in
`grace.undocumentedSourceAreas` with a reason. The gate rejects one that is neither.

## Decision records

`decisions/ADR-NNNN-<slug>.md` holds the reasoning: intent, the constraints that already existed,
the alternatives weighed, the choice, why it beat the others, and what it costs. Each record names
a contract owner, which is the document in this folder that states the resulting behaviour.

A decision that is still open is not an ADR. It is a question, and questions live in `devlog/`.

## Running the gate

    npm run structure:check     # fails when INDEX.md, the manifest and the folder disagree
    npm run structure:index     # rewrites INDEX.md from the manifest

`test/structure-ssot.test.js` runs the same check, so `npm test` catches a stale index.

