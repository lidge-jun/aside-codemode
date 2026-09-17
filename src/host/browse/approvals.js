// Pending write approvals, and the one rule that makes them safe to act on twice.
//
// requireApprovalId lives here rather than inside browse.js so discovery can ask the same
// question the call asks: actions.check typed approvalId as a string and approved an empty
// one, which every real approve() and reject() refuses.
//
// A batch that could change something is refused before it runs (session.js), and the
// caller is handed an approvalId. Approving it is not resuming anything: nothing was
// started, because the whole point of refusing before compile is that nothing was started.
// Approve runs the stored job for the FIRST time, under a fresh runId.
//
// The hazard is that approval surfaces are racy. The same id can be approved in one place
// and rejected in another, or approved twice, or approved after it expired. Cloudflare's
// own note on this is blunt: approve() must be a safe no-op on a run that is no longer
// pending, and reject() is worse, because by the time you say "rejected" the action may
// already have run. So every answer here says what the record IS, not what the caller hoped.
//
// Single consumption comes from rename(), which is atomic on both platforms this ships to:
// exactly one caller can move pending/<id> to claimed/<id>. What rename cannot do is carry
// the new runId with it, so a winner that dies immediately after leaves a claimed record
// with no runId and no startedAt. That is not a bug to paper over — it is a real state, and
// it is reported as itself. "Claimed, never started" is the honest answer to "did it run".
//
// Cooperating processes, not a security boundary. Same standing as cache.js and the file
// locks: a caller with write access to the directory can move records around, and the
// defence against that is the filesystem's, not ours.
import { mkdirSync, renameSync, writeFileSync, readFileSync, existsSync, readdirSync, unlinkSync, statSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

export const APPROVAL_DIR = path.join(os.tmpdir(), 'codemode-browse-approvals');
// Ten minutes. An approval is a judgement about a page as it was when the batch was built,
// and a page an hour old is a different page. Short enough that a stale yes cannot be acted
// on long after the fact, long enough that a person can read what they are approving.
export const DEFAULT_TTL_MS = 10 * 60 * 1000;

const STATES = ['pending', 'claimed', 'rejected'];

// Ids are ours, so they have exactly one shape and anything else is not an id.
//
// This is not tidiness. An unchecked id walks straight out of the directory: given
// "../pending/<real-id>", the source and destination of the claim rename resolve to the
// SAME file, and a rename onto itself succeeds. Every caller would then win, which is the
// one thing this module exists to prevent, and it would look like success from the inside.
const ID_SHAPE = /^approval-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isApprovalId(value) {
  return typeof value === 'string' && ID_SHAPE.test(value);
}

// The one pre-flight both approve() and reject() run, shared so discovery runs it too.
// actions.check typed approvalId as a string and approved an empty one, which every real
// call refuses: there is no implicit "the current run" to fall back on.
export function requireApprovalId(verb, opts = {}) {
  const id = opts && typeof opts.approvalId === 'string' ? opts.approvalId : null;
  if (!id) {
    const e = new Error(verb + ' needs the approvalId the refusal returned');
    e.code = 'EBADVAL';
    throw e;
  }
  return id;
}

export function createApprovals({ dir = APPROVAL_DIR, ttlMs = DEFAULT_TTL_MS, now = Date.now } = {}) {
  const at = (state, id) => {
    if (!isApprovalId(id)) {
      const e = new Error('not an approval id: ' + String(id));
      e.code = 'EBADVAL';
      throw e;
    }
    return path.join(dir, state, id + '.json');
  };
  const ensure = () => { for (const s of STATES) mkdirSync(path.join(dir, s), { recursive: true }); };

  function readAt(state, id) {
    try { return JSON.parse(readFileSync(at(state, id), 'utf8')); }
    catch { return null; }
  }

  // Where the record is now, whatever a caller believed. Checked in the order a record
  // moves, so a claim that is mid-rename reads as one state or the other, never as both.
  function locate(id) {
    for (const state of STATES) {
      const rec = readAt(state, id);
      if (rec) return { state, record: rec };
    }
    return { state: 'unknown', record: null };
  }

  function expired(rec) {
    return Boolean(rec && Number.isFinite(rec.expiresAt) && now() >= rec.expiresAt);
  }

  // Records do not accumulate. A day past its expiry a record is gone, whatever state it
  // reached — a claimed record is evidence for as long as anyone would look at it.
  //
  // The age comes from the record's own expiresAt, not from the file's mtime. Those are two
  // different clocks: expiresAt is written by now(), which a caller can inject, and mtime is
  // the filesystem's. An earlier version compared one against the other and swept nothing,
  // because a test clock starting at 1000 is thirty years behind every mtime on disk.
  const KEEP_AFTER_EXPIRY_MS = 24 * 60 * 60 * 1000;
  function sweep() {
    if (!existsSync(dir)) return 0;
    let removed = 0;
    for (const state of STATES) {
      const d = path.join(dir, state);
      if (!existsSync(d)) continue;
      for (const name of readdirSync(d)) {
        const p = path.join(d, name);
        try {
          let deadline = null;
          try {
            const rec = JSON.parse(readFileSync(p, 'utf8'));
            if (Number.isFinite(rec.expiresAt)) deadline = rec.expiresAt + KEEP_AFTER_EXPIRY_MS;
          } catch { /* unreadable or not ours: fall back to the filesystem's own clock */ }
          const gone = deadline === null
            ? Date.now() - statSync(p).mtimeMs > ttlMs + KEEP_AFTER_EXPIRY_MS
            : now() >= deadline;
          if (gone) { unlinkSync(p); removed += 1; }
        } catch { /* a record that vanished while we looked is a record we wanted gone */ }
      }
    }
    return removed;
  }

  return {
    dir,
    sweep,

    // Called by the gate. The job stored here is the validated, normalized one, so approving
    // cannot smuggle in options the refusal never saw.
    open({ job, wants, urls }) {
      ensure();
      // Swept here rather than on a timer, because there is no process that outlives a tool
      // call to hold one. Opening an approval is the only moment this directory is certainly
      // in use, so it is the only moment that can pay for tidying it.
      try { sweep(); } catch { /* a sweep that fails must never stop an approval being offered */ }
      const approvalId = 'approval-' + randomUUID();
      const rec = {
        approvalId, wants, urls, job,
        createdAt: now(), expiresAt: now() + ttlMs,
        runId: null, startedAt: null,
      };
      // 0600. A stored job carries the urls it will visit and the values it will type, and
      // a fill value can be a password. This is a shared temp directory.
      writeFileSync(at('pending', approvalId), JSON.stringify(rec), { encoding: 'utf8', mode: 0o600 });
      return rec;
    },

    read(id) {
      if (!isApprovalId(id)) return { state: 'unknown', approvalId: String(id), record: null };
      const found = locate(id);
      if (found.state === 'unknown') return { state: 'unknown', approvalId: id, record: null };
      return { ...found, approvalId: id, expired: found.state === 'pending' && expired(found.record) };
    },

    // Exactly one caller wins. A failure to move is NOT proof that somebody else took it:
    // only ENOENT means the record left pending, and anything else is this process failing
    // to claim, which is a different sentence and gets a different answer.
    claim(id) {
      // A thing that is not an id names no record, so the answer is the same one an id
      // nobody issued gets. It never reaches the filesystem.
      if (!isApprovalId(id)) return { ok: false, changed: false, state: 'unknown', approvalId: String(id), record: null };
      ensure();
      const before = readAt('pending', id);
      if (before && expired(before)) {
        return { ok: false, changed: false, state: 'expired', approvalId: id, record: before };
      }
      try {
        renameSync(at('pending', id), at('claimed', id));
      } catch (e) {
        if (e && e.code === 'ENOENT') {
          const found = locate(id);
          return { ok: false, changed: false, state: found.state, approvalId: id, record: found.record };
        }
        const err = new Error('could not claim ' + id + ': ' + String(e && e.message || e));
        err.code = 'ECLAIM';
        throw err;
      }
      return { ok: true, changed: true, state: 'claimed', approvalId: id, record: readAt('claimed', id) };
    },

    // Written after the claim, not with it, because rename carries no payload. The window
    // between them is real and is why "claimed with a null runId" is a state this reports.
    started(id, runId) {
      const rec = readAt('claimed', id);
      if (!rec) return null;
      const next = { ...rec, runId, startedAt: now() };
      writeFileSync(at('claimed', id), JSON.stringify(next), { encoding: 'utf8', mode: 0o600 });
      return next;
    },

    // Only a pending record can be rejected. Refusing to reject a claimed one is the whole
    // point: telling someone their run was rejected when the clicks already went out is the
    // one answer this module must never give.
    reject(id) {
      if (!isApprovalId(id)) return { ok: false, changed: false, state: 'unknown', approvalId: String(id), record: null };
      ensure();
      try {
        renameSync(at('pending', id), at('rejected', id));
      } catch (e) {
        if (e && e.code === 'ENOENT') {
          const found = locate(id);
          return { ok: false, changed: false, state: found.state, approvalId: id, record: found.record };
        }
        const err = new Error('could not reject ' + id + ': ' + String(e && e.message || e));
        err.code = 'ECLAIM';
        throw err;
      }
      return { ok: true, changed: true, state: 'rejected', approvalId: id, record: readAt('rejected', id) };
    },

  };
}
