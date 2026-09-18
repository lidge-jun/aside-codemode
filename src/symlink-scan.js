// Issue #24: a search that steps over symlinks has to say so.
//
// ripgrep does not follow links by default and this tool refuses followSymlinks:true, because
// following one can read outside the configured roots before results are filtered. That part
// is a policy and it stays. What was wrong is that the skip was invisible: a directory whose
// entries are 35 links out of 37 answered with 2 rows, complete: true and an empty partial,
// and no option the caller could set would reveal the difference.
//
// rg cannot tell us this. Its stderr is silent for skipped links and --debug only mentions
// file links, never directory ones. Running it a second time with --follow would produce the
// list and re-open the hole the policy exists to close. So the entries are enumerated here,
// under the same filters the search itself used, with hard bounds: a signal that costs an
// unbounded walk is not a signal anyone will keep.
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

export const SYMLINK_SCAN_DEFAULTS = Object.freeze({ maxDepth: 3, maxEntries: 4000, maxExamples: 5 });

// The search hands these globs to ripgrep as '-g !<glob>', so the same string has to mean the
// same thing here. A name check missed '*.log' and counted a file the search had already
// excluded, which is a skip report for something nobody skipped.
function globToRegExp(glob) {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') { out += '.*'; i++; if (glob[i + 1] === '/') i++; }
      else out += '[^/]*';
    } else if (c === '?') out += '[^/]';
    else if ('\\^$+.()|{}[]'.includes(c)) out += '\\' + c;
    else out += c;
  }
  return new RegExp('^' + out + '$');
}

function excluded(name, relPath, excludeGlobs) {
  for (const glob of excludeGlobs || []) {
    if (!glob) continue;
    const re = globToRegExp(glob);
    if (re.test(name) || re.test(relPath)) return true;
  }
  return false;
}

/**
 * Count the symlinks a non-following search would have stepped over.
 *
 * @returns {{dirs:number, files:number, examples:string[], capped:boolean, scanned:number}}
 */
export async function scanSkippedSymlinks(dir, {
  excludeGlobs = [],
  hidden = false,
  maxDepth = SYMLINK_SCAN_DEFAULTS.maxDepth,
  maxEntries = SYMLINK_SCAN_DEFAULTS.maxEntries,
  maxExamples = SYMLINK_SCAN_DEFAULTS.maxExamples,
} = {}) {
  const out = { dirs: 0, files: 0, examples: [], capped: false, depthCapped: false, scanned: 0 };
  if (!dir) return out;

  const queue = [{ abs: dir, depth: 0 }];
  while (queue.length) {
    const { abs, depth } = queue.shift();
    let entries;
    try {
      entries = await readdir(abs, { withFileTypes: true });
    } catch {
      // Unreadable directories are already reported through the existing partial warning.
      continue;
    }
    for (const entry of entries) {
      if (out.scanned >= maxEntries) { out.capped = true; return out; }
      out.scanned += 1;
      const name = entry.name;
      if (!hidden && name.startsWith('.')) continue;
      const child = path.join(abs, name);
      const rel = path.relative(dir, child).split(path.sep).join('/');
      if (excluded(name, rel, excludeGlobs)) continue;
      if (entry.isSymbolicLink()) {
        // A link's own type needs a stat to resolve, and a broken link would throw. The
        // distinction that matters to a caller is how much could be behind it, so a link is
        // counted as a directory only when it resolves to one.
        let isDir = false;
        try { isDir = (await stat(child)).isDirectory(); } catch { isDir = false; }
        if (isDir) out.dirs += 1; else out.files += 1;
        if (out.examples.length < maxExamples) out.examples.push(child);
        continue;
      }
      if (entry.isDirectory()) {
        if (depth + 1 <= maxDepth) queue.push({ abs: child, depth: depth + 1 });
        // The census stopped at its depth bound rather than because there was nothing
        // further. `capped` only ever covered the ENTRY bound, so depth exhaustion was
        // invisible: a symlink at depth four left dirs:0, files:0 and nothing saying the
        // scan had not looked. This does not lower `complete` (see below); it is what
        // scope.coverage.symlinks reads to answer "unknown" instead of "off".
        else out.depthCapped = true;
      }
    }
  }
  return out;
}

// What the count means, in one place, because two callers and a document have to agree.
//
// Only a skipped DIRECTORY lowers completeness. A skipped file link cannot hide a subtree: the
// file it points at is either inside the search already or outside the roots entirely, and
// flipping the flag for it was measured to mark ordinary repositories incomplete because of
// three bin stubs. File links are still reported, because "why is this file missing" is a
// question the count answers.
//
// A capped scan does not lower it either. Capping means the census stopped early, not that
// something was skipped, and a result that called itself incomplete on every large tree would
// be ignored within a day.
export function symlinkSkipLowersCompleteness(skipped) {
  return Boolean(skipped) && skipped.dirs > 0;
}
