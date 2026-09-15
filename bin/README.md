# vendored ripgrep

`rg.exe` here is ripgrep 15.2.0 (x86_64-pc-windows-msvc), vendored so the
server works in environments whose PATH has no rg (aside exec's bash env is
one, measured 2026-09-13). Replace it with your platform's binary or point
`rgPath` / `CODEMODE_RG` at a system install. On macOS a Homebrew `rg` on PATH
or at /opt/homebrew/bin/rg is picked up automatically, so no vendored binary
is needed there; on Windows this copy is the last candidate the resolver tries,
which is what makes an npm install work without a register step.

ripgrep is MIT and its Windows build links PCRE2. Both notices are reproduced
in THIRD-PARTY-NOTICES.md next to this file, and both ship inside the package:
a redistributed copy has to carry them, and the repository LICENSE at the root
covers this project's own code only.
