# 010 — shared rg child opts

## Locked helper

```js
// src/child-opts.js
export function rgChildOpts(extra = {}, env = process.env) {
  const opts = { ...extra };
  if (env.CODEMODE_WINDOWS_HIDE === '1') opts.windowsHide = true;
  return opts;
}
```

- Do **not** set `windowsHide: true` unless that env is exactly `'1'`.
- Do **not** use `shell: true`.
- `extra` may add `timeout`, `signal`, `killSignal`, `stdio`. Extra `windowsHide: false` stays false unless env forces true — env wins only when `'1'`. If extra already has `windowsHide`, env `'1'` overwrites to true.

Wire:

```js
await execFileP(abs, ['--version'], rgChildOpts({ timeout: 5000, signal, killSignal: 'SIGKILL' }, env));
child = spawn(bin, args, rgChildOpts());
```

Retry-without-hide is OUT of this cycle. Default omit is the #5 local workaround. Opt-in env covers hosts that still want a hidden console.

## Tests

`test/windows-hide.test.js`:

1. `rgChildOpts({}, {})` → no own `windowsHide` property (empty env, never `process.env`)
2. `rgChildOpts({}, { CODEMODE_WINDOWS_HIDE: '1' })` → `windowsHide === true`
3. `rgChildOpts({ timeout: 5 }, {})` → `timeout === 5`, no windowsHide
4. `rgChildOpts({ windowsHide: false }, { CODEMODE_WINDOWS_HIDE: '1' })` → `windowsHide === true` (env wins)
5. Source lock: `readFileSync` `src/rg.js` and `src/rg-stream.js` — no `windowsHide: true` literal
6. `where.exe` stays out: do not hide it; do not fold it into the helper this cycle

## Mini / Aside

After B, copy or patch the three files onto mini if origin is not pushed. Re-run doctor + search.count. If Aside exec is reachable, run the hide-vs-default spawn table inside that shell and attach the JSON to #5.
