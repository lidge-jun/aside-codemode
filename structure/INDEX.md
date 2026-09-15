# aside-codemode structure index

This folder is the maintainer source of truth for the shape the system has right now.
Open work and sequencing live in `devlog/`, which is not tracked. The rules for changing
anything here are in [`AGENTS.md`](AGENTS.md).

Generated from [`manifest.json`](manifest.json) by `npm run structure:index`. Do not edit by
hand; `npm run structure:check` fails when this file and the manifest disagree.

## Reading order

### Tier 1 — Foundation

What code mode is, what the guest may reach, and the invariants nothing may break.

| Doc | Scope |
| --- | --- |
| [`overview.md`](overview.md) | The product boundary, the three execution paths, and the guest sandbox surface. |

### Tier 2 — Result contract

The one vocabulary every batch answers in, whoever produced it.

| Doc | Scope |
| --- | --- |
| [`batch-contract.md`](batch-contract.md) | The shared run envelope, the status vocabulary, reconciliation, effects, and tab accounting. |
| [`session-contract.md`](session-contract.md) | How signed-in work divides between native steps and a batch, and why the tool never infers authentication. |

### Tier 3 — Browsing

The batch surface that drives Aside, and how it refuses work that cannot succeed.

| Doc | Scope |
| --- | --- |
| [`browse-surface.md`](browse-surface.md) | The job schema, block detection and the breaker, capture verification, and ref-addressed actions. |
| [`local-surface.md`](local-surface.md) | The guest file tools, ripgrep-backed search, scope reporting, and write coordination. |

### Tier 4 — Delivery

What an install writes into an account, and the budget it spends there.

| Doc | Scope |
| --- | --- |
| [`install-surface.md`](install-surface.md) | The three artifacts an install writes per account, the marker contract, and the always-injected budget. |

## Source to document

| Source area | Described by |
| --- | --- |
| `bin/` | [`overview.md`](overview.md) |
| `scripts/install-codemode.mjs` | [`install-surface.md`](install-surface.md) |
| `src/cli.js` | [`overview.md`](overview.md) |
| `src/execution-output.js` | [`batch-contract.md`](batch-contract.md) |
| `src/host/browse/` | [`browse-surface.md`](browse-surface.md) |
| `src/host/browse/attach.js` | [`session-contract.md`](session-contract.md) |
| `src/host/browse/policy.js` | [`session-contract.md`](session-contract.md) |
| `src/host/browse/result-contract.js` | [`batch-contract.md`](batch-contract.md) |
| `src/host/browse/session.js` | [`batch-contract.md`](batch-contract.md) |
| `src/host/file-lock.js` | [`local-surface.md`](local-surface.md) |
| `src/host/fs.js` | [`local-surface.md`](local-surface.md) |
| `src/host/globals.js` | [`overview.md`](overview.md) |
| `src/host/namespaces.js` | [`overview.md`](overview.md) |
| `src/host/patch.js` | [`local-surface.md`](local-surface.md) |
| `src/host/search.js` | [`local-surface.md`](local-surface.md) |
| `src/paths.js` | [`install-surface.md`](install-surface.md) |
| `src/register.js` | [`install-surface.md`](install-surface.md) |
| `src/rg.js` | [`local-surface.md`](local-surface.md) |
| `src/sandbox.js` | [`overview.md`](overview.md) |
| `src/search-schema.js` | [`local-surface.md`](local-surface.md) |
| `src/tools.js` | [`overview.md`](overview.md) |
| `templates/` | [`install-surface.md`](install-surface.md) |

Not yet described, with the reason recorded in the manifest:

- `src/host/report/` — the report builder and its static server are not yet described by a contract doc; it lands with the local-work cycle

## Decision records

- [`ADR-0001-always-injected-block-budget.md`](decisions/ADR-0001-always-injected-block-budget.md) — ADR-0001 — decision recorded under "Always-injected block budget"
- [`ADR-0002-block-carries-criteria-skill-carries-procedure.md`](decisions/ADR-0002-block-carries-criteria-skill-carries-procedure.md) — ADR-0002 — decision recorded under "The block carries criteria, the skill carries procedure"
- [`ADR-0003-session-proof-comes-from-the-caller.md`](decisions/ADR-0003-session-proof-comes-from-the-caller.md) — ADR-0003 — decision recorded under "Proof of a live session comes from the caller"
- [`ADR-0004-skill-body-stays-out-of-the-system-prompt.md`](decisions/ADR-0004-skill-body-stays-out-of-the-system-prompt.md) — ADR-0004 — decision recorded under "The skill body stays out of the system prompt"
- [`ADR-0005-the-wire-limit-is-the-platforms.md`](decisions/ADR-0005-the-wire-limit-is-the-platforms.md) — ADR-0005 — decision recorded under "Deadlines"
