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

## search: which name belongs to which method

| method | matches | with |
|---|---|---|
| `search.files` | paths | `pattern` (substring) and/or `glob` |
| `search.content` | file contents | `query` |
| `search.count` | file contents, counted | `query` |

`path` is required by all three: a directory or file inside a configured root. A relative
path resolves against `--cwd`. Passing `pattern` to `search.content` is refused with the
correct name, and a glob-shaped value is pointed at `glob` rather than at `query`.

## Symlinks are stepped over, and said so

Links are never followed. What was skipped comes back on the result:

    scope.skippedSymlinks  { dirs, files, examples, capped }

A skipped **directory** also sets `complete: false` — a subtree can hide behind it, and
`noIgnore`/`hidden` will not bring it back. Point `path` at the link target instead. A skipped
file link is counted without lowering completeness. The count does not read `.gitignore`.

## browse.readText: two shapes in, one field out

    await browse.readText('https://example.com')
    await browse.readText({ url: 'https://example.com', minChars: 500 })

The body comes back as `text`. `format` says what it is: `markdown` when the fetch path
converted the html, `text` when the browser returned its rendered body. There is no
`markdown` field any more — one field, so the byte budget never drops the copy you read.

## browse.exec / browse.attach: asking for structure

`snapshot: 'tree'` returns the accessibility tree as a string. Add `treeNodes: true` and the
same tree also arrives parsed:

    snapshot.nodes  [{ depth, role, name, ref, attrs, line }]

Group by walking forward while `depth` is greater than the parent's. It is off by default
because it costs payload. Two limits worth knowing: `interactive` mode drops `text` and
`heading` rows, so a grouped read needs `tree`; and a child frame whose rows arrive without
indentation cannot be grouped this way - use the `f`-prefixed refs instead.

## browse is opt-in

If a browse call is refused with `EDISABLED`, turn it on once:

    codemode --enable-browse

It writes `browseCaps.enabled` into your user config and changes nothing else. Uninstalling
the account skill does not turn it back off.
