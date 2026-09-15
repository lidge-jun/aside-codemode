# Working in this repository

Two rules, both enforced by the suite rather than by memory.

## This repository does not publish the machines that built it

It is public. A hostname, an account name, a home directory, a node path or a session id is
about somebody's laptop, not about this project, and once it is in a commit it is in a public
history with forks.

Three trees are where that happens, and all three are ignored:

    devlog/        planning notes, written against real paths
    .codexclaw/    session ledgers, goalplans, per-session evidence
    evidence/      probe dumps and per-host install records

They stay on disk, where they are useful. `evidence/` is ignored by default and opened file by
file, because the next probe writes a name nobody remembers to add to a list. The exceptions
are the measurement notes the README cites, and adding one is a decision: put it in the
`.gitignore` negations AND in the allow-list in `test/no-machine-identity.test.js`, which fails if
the two disagree.

When a document needs a home directory in an example, invent one. `/Users/someone` is the form
this repository already uses; the guard accepts `someone`, `me`, `you`, `user`, `alice`, `bob` and a
few single letters, and rejects everything else by name so the failure says which one leaked.

This was not a hypothetical. 156 tracked files described four hosts and three usernames before
the rule existed, including a fleet note that listed all of them and called itself a release
artifact. The ignore rules stopped the next one; the test stops the one after that.

## Do not write down what was not measured

Every number in the README belongs to a note under `evidence/` that says how it was produced,
which run it came from, and what it does not claim. Tests compare the two and recompute the
ratios from the stated inputs, so a figure cannot drift in one place only.

The same rule applies to gates: `test/docs-guidance.test.js` fails if an installed document
advertises the usability gate, because nobody has run it. A string match is not a session.

## Running the suite

    npm test          # node scripts/run-tests.mjs, zero dependencies

CI runs it on Ubuntu 18/20/22, macOS 22 and Windows 22. There is no lockfile and nothing to
install; `npm ci` has no place here and a test says so.
