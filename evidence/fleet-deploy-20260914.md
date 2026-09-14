# Fleet deploy, 2026-09-14

Everything below is captured output, not a summary of intent.

## The defect that made one machine work and the other not

    macmini   ~/.aside/accounts.json  currentAccountId: 1
              account 1 = bitkyc07 (google, cloud)   profile ~/.aside/u/1  179M
              account 0 = Local Account (anonymous)  profile ~/.aside/u/0   93M
              registration before the fix: u/0 only

    mbp2      ~/.aside/accounts.json  currentAccountId: 0
              account 0 = bitkyc07 (google, cloud)   profile ~/.aside/u/0  4.5G
              registration before the fix: u/0 -> correct by coincidence

macmini's live profile AGENTS.md was 77 bytes with marker=0, browse=0.

## After

    macmini
    account u/1  CURRENT  agents=5537B  mcp=written
    account u/0  other    agents=6602B  mcp=written
    account u/2..u/6      agents written, mcp=skipped
    CURRENT_ACCOUNT=1
    every root: marker=1 browse=2

    macbookpro-2
    account u/0  CURRENT  agents=5692B  mcp=written
    account u/1, u/2      agents written, mcp=skipped
    CURRENT_ACCOUNT=0
    every root: marker=1 browse=2

## Stale clone retired, recoverably

    macmini   STALE_HEAD=8223264 DIRTY=0  STASH_0=437bytes
              ARCHIVE=/Users/junny/aside-codemode-stale-archive-juniui-Macmini-20260914-181110
              TRASHED=/Users/junny/.Trash/aside-codemode-stale-20260914-181110
    mbp2      STALE_HEAD=8223264 DIRTY=0  STASH_0=433bytes
              ARCHIVE=/Users/jun/aside-codemode-stale-archive-gimbyeongjun-ui-MacBookPro-2-20260914-181110
              TRASHED=/Users/jun/.Trash/aside-codemode-stale-20260914-181110

Nothing referenced the stale path: not the registered AGENTS.md, not .zshrc,
.zprofile or .bashrc, not ~/.config, not ~/Library/LaunchAgents, not crontab.

## PATH is live now, not a frozen copy

npm install -g . had left a package copy in the nvm global root. It was replaced
with npm link, so codemode on PATH follows the checkout instead of drifting:

    macmini  PATH_CODEMODE=/Users/junny/.nvm/versions/node/v22.22.0/bin/codemode
    mbp2     PATH_CODEMODE=/Users/jun/.nvm/versions/node/v24.17.0/bin/codemode

plus a ~/.local/bin/codemode shim that needs no npm prefix at all.

## Browsing was off on one machine and nobody noticed

browseCaps.enabled defaults to false. Right after the morning install:

    macmini  browse.probe() -> enabled: false
    mbp2     browse.probe() -> enabled: true     (an earlier probe had left it on)

After register-aside.mjs --browse:

    macmini  {"enabled":true,"aside":"/Users/junny/.local/bin/aside","cli":"1.26.906.1630"}
    mbp2     {"enabled":true,"aside":"/Users/jun/.local/bin/aside","cli":"1.26.906.1630"}
    windows  {"enabled":true,"aside":"C:\\Users\\super\\AppData\\Local\\Aside\\CLI\\current\\aside.exe","cli":"1.26.906.1630"}

All three at HEAD 830dd36.

## The Threads false-success, retested live on mbp2

Request: two urls, requireContent: true, minTextChars: 200.

    https://www.threads.com/
      ok: true   contentVerified: true
      render.textChars   974
      render.rawChars    497731
      render.scriptChars 523103
      sample: "For you / New thread / Search / Messages / Activity / Profile /
               Insights / Saved / Feeds / Edit / Following / Ghost posts / ..."

    https://example.com/
      ok: false  code: EUNRENDERED
      render.textChars 129
      reasons: ["only 129 visible characters (wanted >= 200)"]

    batch: ok false, partial ["content-unverified"], leakedUrls []

Two things to read from that. The page that used to return half a megabyte of
bootstrap JSON as its body now returns 974 characters of the actual feed, so
innerText replaced textContent and the fix is live on the fleet. And a page that
loaded perfectly still failed, because the caller asked for 200 visible
characters and got 129 - ok and contentVerified really are separate verdicts now.

