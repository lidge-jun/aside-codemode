# 001 — Aside browser capability evidence (measured)

Unit: `devlog/_plan/260914_browse-batch/`. Research doc (000-range): observations only, no diffs.

Host: Windows 11, Aside CLI `1.26.906.1630` at
`%LOCALAPPDATA%\Aside\CLI\current\aside.exe`. Every row below was produced by
`aside.exe repl <script>` launched argv-only through `Start-Process -ArgumentList @('repl', $js)`
under a `WaitForExit` deadline. Probe scripts are not committed; they are reproduced verbatim
in each row's `how`.

## E1 — Session and process contract

| Fact | Measured |
| --- | --- |
| argv shape | `@('repl', <script>)`, script as ONE argv element, works |
| stdout marker | run ends with `[ok | Nms]` or `[error | Nms]` |
| exit code | `0` even for in-script failures; never a success signal |
| stderr on `repl` | empty; `created new session:` is an `exec`-mode line, NOT available for `repl` |
| process overhead | wall minus in-repl `Nms`: 2.4s and 1.4s on two runs |
| `pwd` | `%USERPROFILE%\.aside\u\0\sessions\<YYYY-MM-DD>_<id>`, fresh per invocation |

Consequence: the host cannot address a running `repl` session by id, so there is no graceful
`aside session stop` path for `repl`. Cancellation is process-level only. See E5.

## E2 — Guest globals present in a CLI repl

`openTab`, `closeTab`, `snapshot`, `attachBrowserTab`, `listBrowserTabs`, `sleep`, `fetch` are
functions. `tabs`, `page`, `fs`, `aside`, `twitter`, `gmail`, `youtube`, `captcha`, `cua`,
`notion`, `slack`, `linkedin`, `googleDocs`, `googleSheets`, `googleSearch`, `imagegen`,
`chrome` are objects. `passwordManager` and `download` are `undefined`.

Service objects are opaque: `Object.getOwnPropertyNames(Object.getPrototypeOf(googleSearch))`
returns only `Object.prototype` members, and `chrome.tabs` / `chrome.runtime` are `undefined`.
Capability detection MUST use `typeof obj.method`, never prototype enumeration. `fs` exposes
`readFile`, `writeFile`, `mkdir`, `stat`, `readdir`, `rm`, `unlink`, `copyFile`; no `exists`,
no `appendFile`.

## E3 — Page surface (`typeof p.<name>`)

Present: `goto`, `title`, `content`, `url`, `screenshot`, `pdf`, `evaluate`, `locator`,
`click`, `fill`, `waitForSelector`, `waitForLoadState`, `close`, `reload`, `goBack`,
`goForward`, `frames`, `mainFrame`, `viewportSize`, `on`, `bringToFront`, `video`;
`keyboard` and `mouse` are objects.

Absent: `route`, `unroute`, `setViewportSize`, `emulateMedia`, `waitForFunction`,
`waitForTimeout`, `waitForNavigation`, `waitForRequest`, `waitForResponse`, `cookies`,
`boundingBox`, `textContent`, `innerText`, `getAttribute`, `isVisible`, `setContent`,
`addStyleTag`, `addScriptTag`, `setDefaultTimeout`, `exposeFunction`, `isClosed`,
`accessibility`, `press`, `focus`, `hover`, `selectOption`.

`p.on('request', fn)` is accepted but delivered **0** events across a full `goto`.
`p.evaluate` can reassign `window.fetch` inside the page.

## E4 — Capture fidelity

| Request | Measured result |
| --- | --- |
| `viewportSize()` | `{width:1440,height:900}`; `devicePixelRatio` 1 |
| `viewportSize({width:800,height:600})` | returns `{1440,900}`; viewport is NOT settable |
| `screenshot({fullPage:true})` | PNG IHDR `1440x900`, 13733 bytes |
| `screenshot({fullPage:true,maxWidth:640})` | PNG IHDR `1440x900`, 13733 bytes — `maxWidth` silently ignored |
| `screenshot({clip:{x:0,y:0,width:320,height:200}})` | PNG IHDR `320x200`, 1676 bytes — `clip` honoured |
| `screenshot({})` with no `path` | returns a Node `Buffer` (13733 bytes) |
| `screenshot({type:'jpeg',quality:20})` | FAILED once after 30013 ms: `browser CDP command timed out ... before the default screenshot timeout` |
| `screenshot({type:'jpeg',quality:90})` | 18387 bytes in 1076 ms |
| `pdf({format:'A4'})` | 19511 bytes, MediaBox **`0 0 612 792`** = US Letter |
| `pdf({paperWidth:210/25.4,paperHeight:297/25.4})` | 19541 bytes, MediaBox **`0 0 595.91998 841.91998`** = A4 |

MediaBox was read host-side in Node from the raw bytes; both PDFs carry `/MediaBox` in
plaintext (no object-stream inflation needed), reproduced identically across 3 separate runs.
An in-repo parser is therefore sufficient for #22 verification.

There is a ~30s default screenshot timeout inside Aside. That is the upper bound any
per-domain timeout (#21) must sit below to be meaningful.

## E5 — Tab ownership and cancellation (the hard constraint)

| Step | Measured |
| --- | --- |
| open N tabs, let the script finish normally | tab count returns to baseline; daemon-side teardown closes them |
| open 3 tabs, `taskkill /T /F` the CLI mid-run | **3 tabs survive permanently** |
| later session: `closeTab(id)` / `closeTab(targetId)` on an orphan | throws `Tab undefined is not tracked in this session.` |
| later session: `attachBrowserTab(targetId)` then `page.close()` | reports success, but `listBrowserTabs()` still lists the tab — attach borrows, close only detaches |
| later session: `chrome.tabs.*` | `undefined` in a CLI repl |

**No programmatic path closes an orphan tab from a later CLI session.** This falsifies the
"process death is tab death" assumption. Design consequences are binding:

1. The compiled script owns cleanup in a `finally`; that is the only reliable close.
2. The host deadline must be set BELOW the in-script deadline so the script always
   self-terminates and exits cleanly. Killing the child is a leak, not a cleanup.
3. When a kill does happen, the envelope must report `partial` and the leaked URLs.
   Silence here would turn a leak into a reported success.

## E6 — Batching payoff

Five URLs (`example.com`, `example.net`, `example.org`, `iana.org`, `rfc-editor.org`) in ONE
repl invocation:

| Strategy | Measured |
| --- | --- |
| sequential `for` + `await openTab` | 3397 ms |
| `Promise.all(urls.map(openTab))` | 908 ms |

3.7x within one process, on top of avoiding the 1.4-2.4s per-invocation overhead that a
one-process-per-URL design would pay five times. Multi-page inside a single repl script is
confirmed working, so the tab pool belongs inside the compiled script, not in the host.

## Open items carried into the phase docs

- Host-side JPEG encode/resize with zero dependencies is unsolved; `clip` is the only
  honoured geometry control. Decided in 030 (wp4).
- Adapter authentication for Play/Slack is out of scope unless a public endpoint exists.
- `googleSearch` is opaque; #19 must be proven against a concrete callable or fall back to
  fetch-first search endpoints.
