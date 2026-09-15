// browse.captureMany: N urls, one Aside session, artifacts brought back to the host.
//
// The containment rules here are the point. `pwd` arrives in the script's own stdout, which
// makes it influenced data rather than a host fact, so it is never trusted as a read root:
// the host names every file, resolves the read under realpath(pwd)/artifacts, and checks the
// FINAL output path with assertInside rather than only the directory.
import { mkdir, readFile, writeFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { verifyCapture } from './image.js';

export class ArtifactError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'ArtifactError';
    this.code = code;
  }
}

export function artifactNameFor(index, screenshot = {}) {
  const ext = screenshot && screenshot.type === 'jpeg' ? 'jpg' : 'png';
  // Host-generated: index plus a uuid, so nothing from the payload reaches a path.
  return `shot-${String(index).padStart(3, '0')}-${randomUUID()}.${ext}`;
}

export async function containedRead(sessionPwd, name, { realpathImpl = realpath, readFileImpl = readFile } = {}) {
  if (typeof sessionPwd !== 'string' || !sessionPwd) throw new ArtifactError('the run reported no session directory', 'ENOPWD');
  if (/[\\/]/.test(name) || name.includes('..')) throw new ArtifactError(`refusing a path-like artifact name: ${name}`, 'EBADNAME');
  const root = await realpathImpl(path.join(sessionPwd, 'artifacts'));
  const target = await realpathImpl(path.join(root, name));
  const rel = path.relative(root, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new ArtifactError(`artifact ${name} resolved outside the session directory`, 'EESCAPE');
  }
  return readFileImpl(target);
}

export function createCaptureMany({ session, assertInside, deps = {} } = {}) {
  return async function captureMany(urls, opts = {}) {
    if (!Array.isArray(urls) || urls.length === 0) {
      throw new ArtifactError('captureMany requires a non-empty array of urls', 'EBADVAL');
    }
    const screenshot = opts.screenshot === undefined ? {} : opts.screenshot;
    const names = urls.map((_, i) => artifactNameFor(i, screenshot));
    const job = {
      urls,
      screenshot,
      snapshot: opts.snapshot === true,
      timeoutMs: opts.timeoutMs,
      waitUntil: opts.waitUntil,
      waitSelector: opts.waitSelector,
      concurrency: opts.concurrency,
    };
    for (const k of Object.keys(job)) if (job[k] === undefined) delete job[k];

    const res = await session.run(job, { browseCaps: opts.browseCaps || {}, artifactNames: names });

    if (!opts.outDir) return res;

    // assertInside is applied per FILE below, not to the directory alone.
    const outDir = assertInside ? assertInside(opts.outDir) : opts.outDir;
    await (deps.mkdirImpl || mkdir)(outDir, { recursive: true });

    // The ledger is the only thing that says which name was issued for which request.
    // Rebuilding it from the order results came back in is exactly the bug this join
    // replaces: workers finish out of order, so items[i] and names[i] are different urls.
    // The ledger has to be a one-to-one map or it is not a ledger. Two rows sharing an
    // index hand the same file to two requests, and an index outside the issued names
    // silently drops one. Both keep the run looking completed, which is the failure this
    // whole phase exists to stop.
    const ledgerBroken = !Array.isArray(res.ledger)
      || res.ledger.length !== names.length
      || res.ledger.some((r) => !r || typeof r.jobId !== 'string'
        || !Number.isInteger(r.index) || r.index < 0 || r.index >= names.length)
      || new Set(res.ledger.map((r) => r.jobId)).size !== res.ledger.length
      || new Set(res.ledger.map((r) => r.index)).size !== res.ledger.length;
    if (ledgerBroken) {
      const refused = res.items.map((it) => ({
        ...it, ok: false, status: 'failed', code: 'ECONTRACT',
        error: 'the run returned no issuing ledger, so artifacts cannot be attributed',
      }));
      return {
        ...res, items: refused, status: 'failed', ok: false, complete: false, completed: 0,
        partial: res.partial.concat(['no-ledger']),
      };
    }
    const nameByJob = new Map(res.ledger.map((r) => [r.jobId, names[r.index]]));

    const items = [];
    for (const source of res.items) {
      const item = { ...source };
      const name = nameByJob.get(item.jobId);
      // A request nobody answered, or a run we lost track of, has no file to fetch. Reading
      // one anyway would turn a known unknown into an artifact error and hide the cause.
      if (item.status === 'unreturned' || item.status === 'indeterminate') { items.push(item); continue; }
      // The script echoes the name the host issued. If it echoes a different one, the
      // result and the file disagree about whose page this is; say so instead of repairing it.
      if (item.status === 'completed' && !name) {
        // A result that claims success under an id we never issued has no file of its own.
        item.ok = false;
        item.status = 'failed';
        item.code = 'EPROVENANCE';
        item.error = 'no artifact name was issued for ' + String(item.jobId);
        items.push(item);
        continue;
      }
      if (item.status === 'completed' && item.artifactName !== name) {
        item.ok = false;
        item.status = 'failed';
        item.code = 'EPROVENANCE';
        item.error = 'artifact ' + String(item.artifactName) + ' does not match the name issued for ' + item.jobId;
        items.push(item);
        continue;
      }
      if (item.status === 'completed') {
        try {
          const buf = await containedRead(res.pwd, name, deps);
          const dest = assertInside ? assertInside(path.join(outDir, name)) : path.join(outDir, name);
          await (deps.writeFileImpl || writeFile)(dest, buf);
          const verified = verifyCapture(buf, screenshot);
          item.artifact = { path: dest, ...verified };
          if (!verified.matched) {
            item.ok = false;
            item.status = 'failed';
            item.code = 'ECAPTURE';
            item.error = verified.reason;
          }
        } catch (e) {
          item.ok = false;
          item.status = 'failed';
          item.code = e.code || 'EARTIFACT';
          item.error = String(e.message || e);
        }
      }
      items.push(item);
    }
    const partial = res.partial.slice();
    if (items.some((i) => !i.ok) && !partial.includes('item-failure')) partial.push('item-failure');
    // An artifact that failed verification has to move the RUN status too. Lowering only
    // item.ok left a batch reporting status:'completed' next to an item that did not.
    // wp3 replaces this index join with a jobId join; the status arithmetic stays.
    const done = items.filter((i) => i.status === 'completed').length;
    // This arithmetic only knows how to count completions, so every run with none of them
    // used to land on 'failed'. That erased a run which stopped because someone has to sign
    // in: a request became a failure on the way back through the artifact join. Statuses
    // that describe the RUN rather than its artifacts pass through untouched, and there is
    // nothing this step could learn that would improve on them.
    const PRESERVED = new Set(['indeterminate', 'needs_input']);
    const status = PRESERVED.has(res.status)
      ? res.status
      : (done === items.length && items.length > 0 ? res.status : (done > 0 ? 'partial' : 'failed'));
    return {
      ...res, items, partial, status,
      ok: status === 'completed',
      complete: status === 'completed',
      completed: done,
    };
  };
}
