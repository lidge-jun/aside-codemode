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

function excluded(name, excludeGlobs) {
  for (const glob of excludeGlobs || []) {
    if (!glob) continue;
    // The exclude list is a set of directory names and simple wildcards, matched the way the
    // search applies it: on the entry name, not on the whole path.
    if (glob === name) return true;
    if (glob.endsWith('*') && name.startsWith(glob.slice(0, -1))) return true;
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
  const out = { dirs: 0, files: 0, examples: [], capped: false, scanned: 0 };
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
      if (excluded(name, excludeGlobs)) continue;
      const child = path.join(abs, name);
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
      if (entry.isDirectory() && depth + 1 <= maxDepth) queue.push({ abs: child, depth: depth + 1 });
    }
  }
  return out;
}
