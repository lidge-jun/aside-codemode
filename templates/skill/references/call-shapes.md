# Call shapes that are easy to get wrong

Each of these cost a real agent a failed first call. The rule is the same every time: the
refusal now names what to use, but knowing it in advance is cheaper.

## The guest has no module loader

`--code` runs your script in a vm context. There is no `import`, no `require`, no `process`,
and code cannot be built from a string. Ask for what you need through the injected globals:

    search  fs  actions  browse  report  api  recipes
    read_file  write_file  edit_file  apply_patch  console

A dynamic import is refused with `EGUESTIMPORT` and that list. If you catch the rejection
yourself you will see Node's own words instead, because the translation happens at the edge.

## `actions` describes; the namespaces run

`actions` is discovery and nothing else: `list`, `find`, `describe`, `check`. It is not a
dispatcher and it does not contain the namespaces. The action runs under its own name.

    actions.describe('browse.exec')          // what the call takes and returns
    actions.check('browse.exec', args)       // validate without making the call
    await browse.exec({ urls })              // make it

`actions.fs.search(...)`, `actions.call('browse.exec', ...)` and `actions.describe()` with no
path each answer with the call that would have worked. `actions.list()` is synchronous: it
returns an array, so there is nothing to `.catch()`.

## The guest file names are the short ones

The same agent uses two file APIs in one session and they do not share names. The line that
loads the batch helper runs in the **Aside REPL**, where reading is `fs.readFile`. Inside a
`--code` guest it is `fs.read`:

| you want | the guest call |
|---|---|
| read bytes | `fs.read(path, { offset, maxBytes })` |
| read a line window | `read_file({ path, offset, limit })`, one-indexed |
| read several files | `fs.readMany(paths)` under a shared budget |
| matching lines of one file | `fs.grepFile(path, pattern)` |
| list a directory | `fs.list(path)` — not `readdir` |
| create a file | `write_file({ file_path, content })`, create-only |
| overwrite | `fs.write(path, content)` |
| append | `edit_file({ path, appendText })` |
| delete | nothing: the guest cannot delete |

Reaching for a name that is not there answers with the one that is, so a wrong guess costs a
refusal rather than a wrong conclusion. There is no synchronous variant of any of them.

## search: which name belongs to which method

| method | matches | with |
|---|---|---|
| `search.files` | paths | `pattern` (substring) and/or `glob` |
| `search.content` | file contents | `query` |
| `search.count` | file contents, counted | `query` |

`search.files` and `search.content` return the **array of rows itself**. Read `r.length`,
iterate `r`, or spread it with `[...r]`; there is no `r.matches` and no `r.results`. If you
used `r.matches || r.results || []`, the fallback hid every real row. The search metadata is
on non-enumerable `r.complete`, `r.truncated`, `r.partial` and `r.scope`, so `Object.keys(r)`
shows only the numeric row indices. Returning the result whole, or serializing it as JSON,
emits the envelope `{ rows, complete, truncated, partial, scope }`; a spread or mapped array
is a projection and does not retain that metadata.

`r.complete` answers one question: did the walk lose anything. It does NOT answer whether a
string exists, because a walk can be pruned before it ever sees a match. `r.scope.coverage`
names each pruning mechanism — `ignoreRules`, `hiddenFiles`, `excludeGlobs`, `fileSize`,
`binaryContent`, `symlinks`, `recordParse`, `encoding`, `unicodeForms` — as `off`, `on` or
`unknown`. "This string is not in the project" needs `complete: true` AND every coverage
entry `off`; in practice that means `noIgnore`, `hidden`, `includeExcluded` and `binary` all
true with no `maxFilesize`. `encoding` stays `unknown` because no `--encoding` is passed,
so absence over text in an unsupported encoding cannot be proven here.

`binary` deserves its own sentence: it defaults to false and ripgrep skips binary content
SILENTLY. A `search.content` for a string that really is inside a compiled file returns zero
rows with `complete: true`, while `search.files` still lists the file.

`search.count` is the exception: it returns the plain count object `{ matches, files }`,
decorated with the same non-enumerable metadata. On that result, `.matches` is the count.

`path` is required by all three: a directory or file inside a configured root. A relative
path resolves against `--cwd`. Passing `pattern` to `search.content` is refused with the
correct name, and when the value itself looks like a glob the refusal offers both, because
either could be what you meant: `glob` to match the path, `query` to match the contents.

## Symlinks are stepped over, and said so

Links are never followed. What was skipped comes back on the result:

    scope.skippedSymlinks  { dirs, files, examples, capped, scanned }

A skipped **directory** also sets `complete: false` — a subtree can hide behind it, and
`noIgnore`/`hidden` will not bring it back. Point `path` at the link target instead. A skipped
file link is counted without lowering completeness. The count does not read `.gitignore`.

## Where a capture lands, and what a url may be

`browse.exec` and `browse.captureMany` do not return the same things, and the difference is
the reason a pdf sometimes cannot be found afterwards:

| | `browse.exec` | `browse.captureMany` |
|---|---|---|
| per item | `capture.requested` / `capture.actual`, with `actual.pdfBytes` when a pdf was asked for | the same, plus files |
| file on disk | none: nothing is brought back | `item.artifact` and `item.pdf = { path, bytes, pageBox }`, **only when `outDir` was passed** |
| file name | — | issued by the host, not by you |

Both take `http(s)` **or** `data:` urls; `file:` is refused. A `data:` url is the way to print
a document you just built without running a server — but the whole document then travels on
the command line, which is what `ESOURCETOOLONG` is complaining about when one url is large.
Serve it over http from loopback instead: the browser reaches it, and the url stays short.

`captureMany` takes its urls positionally, `browse.captureMany([url], options)`.

## Printing to a page size the stylesheet chose

    pdf: { paperWidth, paperHeight, printBackground, preferCSSPageSize, margin }

Sizes are in inches and default to A4. Without `preferCSSPageSize: true` the content is
scaled onto that sheet and the engine's own margins apply, so a stylesheet's
`@page { size: A5; margin: 20mm }` paginates differently from the same document printed by a
browser. With it, the CSS page wins; `margin` takes `top`, `right`, `bottom` and `left` as
numbers or unit-labelled strings. The returned `pdf.pageBox` says which rule was applied,
`css-page-size` or `requested-paper-size`, and reports the page box it measured either way.

## browse.readText: two shapes in, one field out

    await browse.readText('https://example.com')
    await browse.readText({ url: 'https://example.com', minChars: 500 })

The body comes back as `text`. `format` says what it is: `markdown` when the fetch path
converted the html, `text` when the browser returned its rendered body. There is no
`markdown` field any more: one body, so the budget is not spent twice and the shrinker
cannot drop one copy while you are reading the other. A body too large for the envelope is
still cut - check `chars` against what you got before treating it as the whole page.

## browse.exec / browse.attach: asking for structure

`snapshot: 'tree'` returns the accessibility tree as a string. Add `treeNodes: true` and the
same tree also arrives parsed:

    snapshot.nodes  [{ depth, role, name, ref, attrs, line }]

Group by walking forward while `depth` is greater than the parent's. It is off by default
because it costs payload. Two limits worth knowing: `interactive` mode drops `text` and
`heading` rows, so a grouped read needs `tree`; and a child frame whose rows arrive without
indentation cannot be grouped this way - use the `f`-prefixed refs instead.

## browse is on, unless a machine turned it off

Nothing to switch on: a fresh install browses. If a call comes back `EDISABLED`, someone set
`browseCaps.enabled` to false on this machine. One command puts it back:

    codemode --enable-browse

It writes `browseCaps.enabled` into your user config and changes nothing else. Uninstalling
the account skill does not turn it back off.
