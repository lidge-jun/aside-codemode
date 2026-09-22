// Which tabs this tool opened, so a later session can name the ones a dead run left.
//
// The tool measured this about itself before anything was built on it: a killed CLI leaks
// its tabs permanently and no later session can close them. The reason is not that closing
// is hard — it is that nothing recorded which tabs were ours. A browser full of tabs, some
// the user's and some abandoned by a run that died, with no way to tell them apart.
//
// The accessibility REPL has nowhere to stamp an owner. There is no per-tab metadata field
// and no setter for one; the only identity a tab has is the targetId the browser assigns.
// So ownership lives here, on the host, written from the lifecycle lines the script prints
// as it opens and closes tabs.
//
// What this promises is NAMING, not closing. The same probe that found the leak found that
// a known targetId could not be closed either, so a later session can say "these are ours
// and the run that opened them is gone" and stop there. Reporting and letting a person
// decide is also the right shape for tabs sitting in somebody's own browser.
//
// A tab absent from this journal is never a candidate for anything. That is the whole of
// the guarantee that a user's tab is left alone, and it is deliberately the conservative
// direction: a tab we lost track of stays open, which is a mess, while a tab we wrongly
// claimed would be someone's work disappearing.
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, unlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const JOURNAL_DIR = path.join(os.tmpdir(), 'codemode-browse-tabs');
// A run that has not written for this long is not running. The host writes the journal once
// per run, at the end, so the lease is really "this run finished or died a while ago".
export const STALE_AFTER_MS = 5 * 60 * 1000;

// The script prints one of these the moment a tab exists and the moment it stops existing.
// Parsed out of the transcript rather than the final payload on purpose: a CLI killed on a
// hung close never writes a final payload, and that is exactly the run whose tabs are left.
export function parseTabEvents(stdout) {
  const out = [];
  for (const line of String(stdout || '').split('\n')) {
    const at = line.indexOf('{"type":"tab"');
    if (at === -1) continue;
    try {
      const rec = JSON.parse(line.slice(at));
      if (rec && rec.type === 'tab' && (rec.ev === 'open' || rec.ev === 'close')) out.push(rec);
    } catch { /* a truncated line is a line we did not get, not a line to guess at */ }
  }
  return out;
}

// Open minus closed, by targetId. A tab with no id could not be named later even if it
// leaked, so it is not carried: claiming to have found something unidentifiable would be
// worse than saying nothing.
export function stillOpen(events) {
  const byId = new Map();
  for (const e of events) {
    if (!e.targetId) continue;
    if (e.ev === 'open') byId.set(e.targetId, { targetId: e.targetId, url: e.url, jobId: e.jobId });
    else byId.delete(e.targetId);
  }
  return [...byId.values()];
}

export function createTabJournal({ dir = JOURNAL_DIR, now = Date.now, pid = process.pid, staleAfterMs = STALE_AFTER_MS, isAlive = defaultIsAlive } = {}) {
  const file = (runId) => path.join(dir, String(runId).replace(/[^a-zA-Z0-9-]/g, '_') + '.json');

  return {
    dir,

    // One record per run, written when the run settles, including when it was killed. There
    // is no streaming seam to write from: the spawner hands back the whole transcript at
    // once, so the earliest this can be written is here. That bounds what it can cover —
    // see the note on record() in the surface doc.
    record({ runId, stdout, urls = [], context = null }) {
      const open = stillOpen(parseTabEvents(stdout));
      if (!open.length) { this.forget(runId); return null; }
      mkdirSync(dir, { recursive: true });
      const rec = { runId, pid, writtenAt: now(), tabs: open, urls, context };
      writeFileSync(file(runId), JSON.stringify(rec), { encoding: 'utf8', mode: 0o600 });
      return rec;
    },

    forget(runId) {
      try { unlinkSync(file(runId)); return true; } catch { return false; }
    },

    all() {
      if (!existsSync(dir)) return [];
      const out = [];
      for (const name of readdirSync(dir)) {
        try { out.push(JSON.parse(readFileSync(path.join(dir, name), 'utf8'))); }
        catch { /* not ours, or half written */ }
      }
      return out;
    },

    // The conditions, in one place. A candidate is in the journal, was never closed, belongs
    // to a run that is not running, and is open in the browser right now AT THE SAME URL.
    //
    // The url is not decoration. Browsers reuse target ids, so an id we recorded can come
    // back attached to a tab the person opened themselves, and naming that one would break
    // the only promise this module makes. Matching both is what keeps a reused id from
    // borrowing our claim; the cost is that a tab of ours the person navigated away from
    // stops being recognised, which is the direction to be wrong in.
    //
    // liveTabs comes from browse.tabs(). Plain ids are accepted for callers that only have
    // those, and they are matched on the id alone — the caller has then chosen how much
    // certainty to hand in.
    orphans(liveTabs) {
      if (!Array.isArray(liveTabs)) return [];
      const bare = (t) => String(t == null ? '' : t).replace(/^tab:/, '');
      const live = new Map();
      for (const t of liveTabs) {
        if (t && typeof t === 'object') live.set(bare(t.targetId), { url: t.url, known: true });
        else live.set(bare(t), { url: null, known: false });
      }
      const out = [];
      for (const rec of this.all()) {
        const ownRun = rec.pid === pid;
        const stale = now() - (rec.writtenAt || 0) > staleAfterMs;
        // Our own pid is alive by definition, so a record we wrote ourselves can only be
        // judged by age. For another process the pid is asked directly.
        if (ownRun ? !stale : isAlive(rec.pid)) continue;
        for (const tab of rec.tabs || []) {
          const seen = live.get(bare(tab.targetId));
          if (!seen) continue;
          if (seen.known && seen.url !== undefined && seen.url !== null && String(seen.url) !== String(tab.url)) continue;
          out.push({ ...tab, runId: rec.runId, pid: rec.pid, leftAt: rec.writtenAt });
        }
      }
      return out;
    },
  };
}

// Signal 0 asks whether we could signal it, which is the portable way to ask whether a pid
// is there at all. EPERM means it exists and belongs to someone else, which still counts.
function defaultIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (e) { return Boolean(e && e.code === 'EPERM'); }
}
