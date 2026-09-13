# vendored ripgrep

`rg.exe` here is ripgrep 15.2.0 (x86_64-pc-windows-msvc), vendored so the
server works in environments whose PATH has no rg (aside exec's bash env is
one, measured 2026-09-13). ripgrep is MIT-licensed;
https://github.com/BurntSushi/ripgrep — replace with your platform's binary
or point `rgPath` / `CODEMODE_RG` at a system install. On macOS a Homebrew
`rg` on PATH or at /opt/homebrew/bin/rg is picked up automatically, so no
vendored binary is needed there.
