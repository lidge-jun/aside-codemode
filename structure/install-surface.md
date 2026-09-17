# Install surface

aside-codemode has two supported install paths. Neither is the default, legacy, or deprecated. The
CLI route writes three artifact groups into one Aside account and owns exactly one region of one
file it did not create; `scripts/install-codemode.mjs` is the whole of that behaviour. The native
MCP route adds one project-owned server entry to the account settings, while Aside owns the tool
inventory that makes the registered tool attachable.

## What an install writes

| Route | Path | Role | Owner |
|---|---|---|---|
| CLI | `codemode/` | the REPL helper, catalogue, and install manifest | the installer |
| CLI | `skills/user/aside-codemode/` | full usage, failure handling, recovery, and references | the installer |
| CLI | a marked region inside `AGENTS.md` | the always-injected summary | the installer owns the region, the user owns the file |
| MCP | `settings.json` -> `mcp.servers.aside-codemode` | command, server arguments, and configuration path | this project owns only this entry; the user and Aside own the file |
| MCP | `settings.json` -> `mcp.inventories` | Aside's cached discovery result used for tool attachment | Aside; this project must not write or synthesize it |

The region is delimited by `<!-- aside-codemode:start -->` and its closing marker. Everything
outside it is left exactly as found, so a user's own `AGENTS.md` survives an upgrade.

`src/register.js` resolves which account roots exist and `src/paths.js` resolves the paths inside
one. The account is whichever profile Aside calls current, not a hardcoded `u/0`. Its MCP work ends
after merging the `mcp.servers.aside-codemode` entry. A hand-written entry remains at zero cached
tools until Aside fills `mcp.inventories` through Settings > Plugins & MCPs > MCPs, using Add or
Refresh tools. Start a new session after refresh; whether an already running session hot-attaches
the tool has not been measured.

The MCP child is launched by the Aside daemon with a minimal environment and a working directory
inside the daemon's bundle, unlike the CLI route's normal shell environment. Its server
configuration therefore needs an absolute `rgPath`; finding `rg` on the invoking shell's `PATH`
does not prove that the MCP route can find it.

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

**The marked region may be up to 56 lines, and `test/readme-51x.test.js` enforces it.** That is
the one place the number lives; a second copy elsewhere would be a second number waiting to
disagree. The region is always injected, so every line is spent on every turn whether or not code
mode is used; the skill body is not, and can afford to be long.

The budget bounds the runaway-file failure. It is a line count, so a region written as a compact
table carries more than one written as paragraphs, and it does not bound density. Reasoning behind
the number is in `decisions/ADR-0001-always-injected-block-budget.md`, and the move from 50 to 56
in `decisions/ADR-0011-the-block-carries-what-an-error-cannot-say.md`. The question that admits a
new line is there: without it, does an agent reach a **wrong conclusion**, or merely earn one
refusal that names the right call? Only the first belongs here.

What the region currently spends its lines on: when to stay native, when a batch is justified and
why a signed-in site is the exception that looks like the rule, the three-step session order, that
a successful call is not a correct result and that an incomplete search says so in its own fields,
the fetch-or-batch test, that local file work is this
path whether or not it repeats, the invocation pair, reading `actions.describe` before the first
call rather than after a refusal, that `actions` describes while the namespaces run, the guest's
surface and how its file names differ from the REPL's, and the things never to do. Everything else
is the skill's.

`test/docs-guidance.test.js` pins what the region must still say. It asserts, inside the region
rather than only in the references, that the region routes instead of insisting, that browsing works
without a setup step while naming the code that means someone turned it off, and that the guest
sandbox is described before it refuses. Compressing the region without checking that list turns the
suite red.

That suite also refuses to let either document advertise a usability gate nobody has run. A string
match is not a session, and `templates/` must not claim otherwise.

## Three tiers and the prompt cache

The three artifacts are three tiers of disclosure, and the boundary between them is set by cache
behaviour rather than taste.

| Tier | Content | Loaded |
|---|---|---|
| Catalogue | name, purpose, and when to reach for it | every turn |
| Instruction | the skill body: procedure, failure codes, recovery | when the work matches |
| Resource | references and the helper source | when the instruction points at them |

The skill body is carried as a tool result inside the conversation, not placed in the system
prompt. A prompt cache survives only while the system prompt prefix is stable, so moving a document
that changes with every release into that prefix costs more than the tokens it was meant to save.

This reframes the budget question. It is not how many lines the region deserves; it is whether a
given sentence has to be in the stable prefix to do its job. A criterion does. A procedure does
not, and the region is only useful if it always names the path to the skill that owns it.

Reasoning is in `decisions/ADR-0004-skill-body-stays-out-of-the-system-prompt.md`.
