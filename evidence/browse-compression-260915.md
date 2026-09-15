# Browsing: what reaches the model, measured

Date: 2026-09-15. One machine (macOS 27, arm64), one network, aside-codemode at `7a63e84`,
Aside CLI 1.26.906.1630. Three runs of the same script; the byte counts were identical in all
three, so the spread below is timing only.

## The question

Five pages, and one thing to know about each: its title and its first link. That is a question
you can write as a schema, which is the class of work this measures. A question that needs the
whole page is not this class, and the numbers below do not apply to it.

    https://nodejs.org/en/blog
    https://github.com/BurntSushi/ripgrep
    https://www.rust-lang.org/
    https://docs.npmjs.com/cli/v11/commands/npm-publish
    https://go.dev/doc/

## What each path puts in front of the model

| path | what it is | bytes |
| --- | --- | --- |
| raw HTML | what a fetch-based tool hands you (`curl -sL`, summed) | **1,865,043** |
| accessibility tree | what an agent reads natively, `snapshot: 'tree'` | **71,983** |
| readText markdown | the fetch-first reader, `browse.readText` | **63,825** |
| extract rows | `browse.exec({ extract })`, five typed rows | **4,430** |

Per page, for the record:

| url | raw HTML | tree | markdown |
| --- | --- | --- | --- |
| nodejs.org/en/blog | 829,032 | 4,692 | 3,286 |
| github.com/BurntSushi/ripgrep | 415,605 | 20,000 (capped) | 27,442 |
| www.rust-lang.org | 18,594 | 7,291 | 4,361 |
| docs.npmjs.com/cli/v11/commands/npm-publish | 553,941 | 20,000 (capped) | 14,431 |
| go.dev/doc | 47,871 | 20,000 (capped) | 14,305 |

## Ratios, and which baseline each one is against

| against | ratio |
| --- | --- |
| raw HTML | **421x** |
| accessibility tree | **16.3x** |
| readText markdown | **14.4x** |

The 421x is against what a fetch-based tool would hand a model. The 16.3x is against what an
Aside agent actually reads when it opens the page itself. Both are real, and they answer
different questions, so neither one stands alone.

Three of the five trees hit the 20,000-character cap and came back `truncated: true`. That is not
a footnote: on those three pages the native path did not contain the whole page either, so the
16.3x comparison is against an answer that was already incomplete.

## Timing

| phase | five pages |
| --- | --- |
| `snapshot: 'tree'` | 2,890 / 2,592 / 2,568 ms |
| `extract` | 2,372 / 2,508 / 2,515 ms |
| `readText`, cold | 451 ms |
| `readText`, warm | 6 ms, 4 ms |

About 500 ms per page for the extract path, in one session, with no model turn between pages.
The readText drop from 451 ms to single digits is the cache; it is not a second measurement of
the network.

## What was dropped, and why

Two pages were in an earlier trial and are not in the set: `news.ycombinator.com` and
`vitejs.dev/guide/`. Both answered `EBLOCKED` with `blockKind: captcha`. That is the refusal
path working correctly - a challenge page is reported as a block rather than returned as if it
were the article - but a row whose content is a challenge measures nothing, so they are out.
The run above is `status: completed`, 5 of 5 items ok, no `partial` entries.

## Reproducing it

The script is `/tmp/cm-bench4.js` in the run that produced this, and it is short enough to
restate:

```js
const tree = await browse.exec({ urls, snapshot: "tree" });
const ex = await browse.exec({ urls, extract: { title: "title", firstLink: { selector: "a", attr: "href" } } });
for (const u of urls) await browse.readText(u);
```

Raw HTML was measured outside the guest, with `curl -sL "$u" | wc -c`, because the guest has no
`fetch` and should not have one.

## What this does not claim

Page sizes change, and these are five pages on one day. Nothing here says a model answers
better with less context, only that less of it was spent. And the compression is of the
ANSWER: ask for the whole page and you get the whole page.
