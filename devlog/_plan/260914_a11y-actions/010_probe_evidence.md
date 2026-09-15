# 010 — Measured interaction surface

Two probes, both on macbookpro-2, Aside CLI 1.26.906.1630, 2026-09-14.
The second one serves its own pages from 127.0.0.1 so it is reproducible and does
not depend on a third-party site staying the same.

## P1 — the user's own dashboard, a tab we opened ourselves

    tree                 3,126 chars, 42 ref rows
    page.locator         function
    page.keyboard        object   (enumerates only ["context","modifierState"])
    page.mouse           object   (same)
    page.frames          function

    locator(ref) methods enumerate as []  <- the object is a proxy

    locator("e5").click()      ok, 2143ms
      before  http://localhost:10100/#dashboard
      after   http://localhost:10100/#models       CHANGED, no CSS selector involved
    tree after click           3,126 -> 23,530 chars, different

    keyboard.press("Escape")   ok, 5ms
    page.click("body")         ok, 457ms

Enumeration lies here. `Object.getOwnPropertyNames` on a locator returns an empty
list while every method on it works, so capability detection must call and catch,
never enumerate.

## P2 — a local parent/child iframe page, served from 127.0.0.1:8731

Tree, in full:

    - textbox "parent input" [ref=e1] [placeholder="parent input"]
    - button "parent button" [ref=e2]
    - iframe [ref=e3]:
    - button "child button" [ref=f1e1]
    - textbox "child input" [ref=f1e2] [placeholder="child input"]
    - combobox "alpha" [ref=f1e3]:

Every locator call, all ok:

    fill("hello-from-ref")        ok   -> read back document.getElementById('pi').value
                                          == "hello-from-ref"
    press("KeyA")                 ok
    hover()                       ok
    type("x")                     ok
    focus()                       ok
    boundingBox()                 ok, object
    textContent()                 ok
    innerText()                   ok
    isVisible()                   ok, boolean
    scrollIntoViewIfNeeded()      ok
    selectOption("b")             ok, object

Cross-frame click, the important one:

    page.locator("f1e1").click()  ok
    frames -> 2
      http://127.0.0.1:8731/parent.html   #out = null
      http://127.0.0.1:8731/child.html    #out = "child button clicked"

The click landed inside the iframe, from the top-level page locator, with no frame
API. `page.frameLocator` also exists but is not needed for this.

## Consequences for the matrix

CAPABILITY_MATRIX currently lists press, focus, hover, selectOption, textContent,
innerText, getAttribute, isVisible and boundingBox under `page.absent`. That is true
and must stay true — they really are missing on the page object. But reporting only
that is misleading, because the same names work on a locator. The matrix grows a
`locator.present` row so `browse.probe()` stops implying the surface cannot type.

## What stays ENOTSUP

Unchanged, re-confirmed by earlier probes: `page.route` does not exist and
`page.on('request')` delivers zero events, so request interception and resource
blocking remain impossible. Viewport is not settable. `networkidle` is downgraded.

