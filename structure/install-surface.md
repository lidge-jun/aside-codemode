# Install surface

An install writes three artifacts into one Aside account and owns exactly one region of one file it
did not create. `scripts/install-codemode.mjs` is the whole of that behaviour.

## What an install writes

| Path | Role | Owner |
|---|---|---|
| `codemode/cm.js` | the REPL batch helper | the installer |
| `skills/user/aside-codemode/SKILL.md` | full usage, failure handling, recovery | the installer |
| a marked region inside `AGENTS.md` | the always-injected summary | the installer owns the region, the user owns the file |

The region is delimited by `<!-- aside-codemode:start -->` and its closing marker. Everything
outside it is left exactly as found, so a user's own `AGENTS.md` survives an upgrade.

`src/register.js` resolves which account roots exist and `src/paths.js` resolves the paths inside
one. The account is whichever profile Aside calls current, not a hardcoded `u/0`.

## Why the paths are absolute

The two surfaces that read the installed skill do not agree on what a relative path is relative to.
Under `aside repl` a path resolves from the session directory, two levels below the account root, so
`../../codemode/cm.js` reaches the helper. The in-app agent REPL resolves from the account root,
where that same line leaves the root and the filesystem guard refuses it. The absolute form is the
only one measured to work on both, and it is written into the templates as a quoted JavaScript
string so it stays valid code when the path contains an apostrophe.

## The division of labour between the two documents

The marked region is injected into every turn, so it carries **criteria**: when to reach for a
batch, when to stay native, what a status word means, and what never to do. Procedures, failure
codes and recovery belong to `SKILL.md`, which is loaded when it is needed.

This mirrors the host. Aside injects routing metadata for its own skills on every turn and loads the
bodies on demand, and instructs its agent to read only as much of a skill as the workflow needs. The
split here is the host's design, not a local invention.

## The budget

**The marked region may be up to 50 lines.** It is always injected, so every line is spent on every
turn whether or not code mode is used; the skill body is not, and can afford to be long.

The budget bounds the runaway-file failure. It is a line count, so a region written as a compact
table carries more than one written as paragraphs, and it does not bound density. Reasoning behind
the number is in `decisions/ADR-0001-always-injected-block-budget.md`.

`test/docs-guidance.test.js` pins what the region must still say. It asserts, inside the region
rather than only in the references, that the region routes instead of insisting, that browsing works
without a setup step while naming the code that means someone turned it off, and that the guest
sandbox is described before it refuses. Compressing the region without checking that list turns the
suite red.

That suite also refuses to let either document advertise a usability gate nobody has run. A string
match is not a session, and `templates/` must not claim otherwise.

