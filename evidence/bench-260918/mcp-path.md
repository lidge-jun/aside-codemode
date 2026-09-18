# Local search on the MCP path

Primary numbers. Protocol and environment: [PROTOCOL.md](PROTOCOL.md).
The CLI-path tables in [local-search.md](local-search.md) are superseded for product claims
and retained only as a statement about the CLI.

## Why the transport changed the answer

The CLI spawns a node process per call. The MCP server is resident and spawns a worker
thread per call. Measured on this machine:

| | median |
|---|---:|
| empty `node -e ""` | 40 ms |
| minimal `codemode --code 'return 1'` | 80 ms |
| CLI, full search | 100 ms |
| guest-side timer inside that same CLI run | 34-39 ms |

So 60-70 ms of every CLI measurement was process startup. On the MCP path that cost is paid
once at server start, not per call.

## C1. Single grep

`search.content({query:'export', path:<repo>, glob:'**/*.js', max:100000})`
against `rg export -g '**/*.js' <repo>`. Same tree, same 287 results.

| side | transport | round trips | results | median | min | max |
|---|---|---:|---:|---:|---:|---:|
| ripgrep | process | 1 | 287 | 16.7 ms | 16.1 | 20.1 |
| codemode | **MCP** | 1 | 287 | **13 ms** | 12 | 15 |
| codemode | CLI | 1 | 287 | 93.8 ms | 92.2 | 97.4 |

N=7 after one discarded warm-up. Raw MCP timings: 13, 12, 15, 13, 13, 14, 13.

**C1 did not hold as stated.** The claim was that `rg` wins a single grep. On the MCP path
codemode is level with it, within run-to-run noise. The 5.6x gap reported earlier was the
CLI harness, not the tool.

Bytes are a different story: codemode returns 44,071 bytes of structured rows against
ripgrep's 34,828 bytes of text. For a single grep where you want the lines, codemode
returns **more**, because it returns typed rows plus a completeness envelope.

## C2 and C3. Search, then read, then filter

The unit this tool exists for. Find `.js` files containing the literal `throw new`, take the
first three by path, return their names and total character count.

Both sides resolve to the same three files (`src/activate.js`, `src/config.js`,
`src/execution-output.js`) and the same content size.

| side | round trips | wall time | bytes into model |
|---|---:|---:|---:|
| ripgrep + cat | 2 | 40 ms + 28 ms = **68 ms** | 2,643 + 36,511 = **39,154** |
| codemode (MCP) | **1** | **15 ms** | **93** |

N=7 each. codemode: 23, 19, 17, 13, 15, 13, 13 (median 15, min 13, max 23).
ripgrep step 1: 40, 40, 39, 40, 40, 42, 41. step 2: 28, 28, 29, 28, 27, 27, 28.

**C2 holds.** One round trip against two, and faster in wall time rather than merely
comparable.

**C3 holds, and this is the largest effect measured.** 93 bytes against 39,154, a factor of
**421**. The mechanism is not compression. The shell pipeline puts both the file list and the
full contents of three files into the transcript, because that is how an agent reads a file.
Codemode does the same reads inside the sandbox and returns only the answer. The filtering
happens outside the model's context instead of inside it.

## What these numbers do not say

- One machine, warm cache, one repository. Different trees will differ.
- The MCP server must already be running. Server start is not amortized in these numbers;
  it is paid once per session.
- C1 shows no speed advantage for single greps. Reach for `rg` when one line answers the
  question; the round-trip and byte savings in C2/C3 only exist when there are several steps.
- Round trips are counted as agent tool calls. A human writing one shell pipeline pays one
  round trip too; the comparison is about agent-mediated work.
