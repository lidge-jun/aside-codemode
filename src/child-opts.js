// Shared child_process options for rg (issue #5).
// Aside's Windows shell can die with 0xC0000142 when windowsHide is true.
// Default: omit the key. Opt-in only when CODEMODE_WINDOWS_HIDE === '1'.
// Never set shell. Extra is copied, not mutated.

export function rgChildOpts(extra = {}, env = process.env) {
  const opts = { ...extra };
  if (env.CODEMODE_WINDOWS_HIDE === '1') opts.windowsHide = true;
  return opts;
}
