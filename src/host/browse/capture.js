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
import { verifyPageBox } from './pagebox.js';
import { A4_INCHES } from './schema.js';
import { lossMarkers } from './result-contract.js';

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

// Same rule as a screenshot name: the host issues it, so nothing from the payload ever
// reaches a path.
export function pdfNameFor(index) {
  return `page-${String(index).padStart(3, '0')}-${randomUUID()}.pdf`;
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

/**
 * Everything captureMany decides before it runs anything, as one pure function.
 *
 * It is separate so discovery can ask the same question the call will: actions.check used to
 * answer from the catalog's types alone and approved `screenshot: true`, `pdf: { format }` and
 * a screenshot: false with nothing to bring back - three calls this function refuses.
 */
export function planCaptureMany(urls, opts = {}) {
  if (!Array.isArray(urls) || urls.length === 0) {
    throw new ArtifactError('captureMany requires urls as the first positional argument: browse.captureMany([url], options)', 'EBADVAL');
  }
    // A pdf had no way out of here. browse.exec produced the bytes and counted them and
    // then dropped them, because the branch that writes a file runs only when the host
    // issued a name for it, and report.build was the only caller that ever issued one. The
    // machinery that brings a screenshot back is the same machinery a printed page needs:
    // a host-issued name, a read jailed under the session, verification against what was
    // asked for, and one write. So it serves both now.
  let paper = null;
  if (opts.pdf !== undefined) {
    if (!opts.pdf || typeof opts.pdf !== 'object' || Array.isArray(opts.pdf)) {
      throw new ArtifactError('pdf must be an object of paper dimensions in inches', 'EBADVAL');
    }
    // Same refusal report.build makes: the format shortcut was measured to produce US
    // Letter while claiming A4, so the only accepted spelling is inches.
    if ('format' in opts.pdf) {
      throw new ArtifactError('pdf format is ENOTSUP: it was measured to yield US Letter. Pass paperWidth/paperHeight in inches', 'ENOTSUP');
    }
    paper = { ...A4_INCHES, ...opts.pdf };
  }
  // Asking for a pdf and saying nothing about a screenshot means a pdf, not both. Saying
  // screenshot: false with nothing to bring back instead is a call that cannot answer.
  const wantShot = opts.screenshot === false ? false : !(paper !== null && opts.screenshot === undefined);
  if (!wantShot && paper === null) {
    throw new ArtifactError('captureMany with screenshot: false has nothing to bring back; add a pdf', 'EBADVAL');
  }
  const screenshot = wantShot ? (opts.screenshot === undefined ? {} : opts.screenshot) : null;
  const names = wantShot ? urls.map((_, i) => artifactNameFor(i, screenshot)) : null;
  const pdfNames = paper === null ? null : urls.map((_, i) => pdfNameFor(i));
  const job = {
    urls,
    screenshot: wantShot ? screenshot : undefined,
    pdf: paper === null ? undefined : paper,
    snapshot: opts.snapshot === true,
    timeoutMs: opts.timeoutMs,
    waitUntil: opts.waitUntil,
    waitSelector: opts.waitSelector,
    concurrency: opts.concurrency,
  };
  for (const k of Object.keys(job)) if (job[k] === undefined) delete job[k];
  return { job, names, pdfNames, paper, screenshot, wantShot };
}

export function createCaptureMany({ session, assertInside, deps = {} } = {}) {
  return async function captureMany(urls, opts = {}) {
    const { job, names, pdfNames, paper, screenshot, wantShot } = planCaptureMany(urls, opts);

    const res = await session.run(job, {
      browseCaps: opts.browseCaps || {},
      artifactNames: names === null ? undefined : names,
      pdfNames: pdfNames === null ? undefined : pdfNames,
    });

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
      || res.ledger.length !== urls.length
      || res.ledger.some((r) => !r || typeof r.jobId !== 'string'
        || !Number.isInteger(r.index) || r.index < 0 || r.index >= urls.length)
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
    const nameByJob = new Map(res.ledger.map((r) => [r.jobId, names === null ? null : names[r.index]]));
    const pdfByJob = new Map(res.ledger.map((r) => [r.jobId, pdfNames === null ? null : pdfNames[r.index]]));

    const items = [];
    for (const source of res.items) {
      const item = { ...source };
      // Held before the screenshot block can lower it. The two artifacts are independent
      // requests and neither answers for the other: a screenshot that failed verification
      // used to withhold a pdf sitting in the session directory that verified perfectly.
      const arrived = item.status === 'completed';
      const name = nameByJob.get(item.jobId);
      // A request nobody answered, or a run we lost track of, has no file to fetch. Reading
      // one anyway would turn a known unknown into an artifact error and hide the cause.
      if (item.status === 'unreturned' || item.status === 'indeterminate') { items.push(item); continue; }
      // The script echoes the name the host issued. If it echoes a different one, the
      // result and the file disagree about whose page this is; say so instead of repairing it.
      if (wantShot && item.status === 'completed' && !name) {
        // A result that claims success under an id we never issued has no file of its own.
        item.ok = false;
        item.status = 'failed';
        item.code = 'EPROVENANCE';
        item.error = 'no artifact name was issued for ' + String(item.jobId);
        items.push(item);
        continue;
      }
      if (wantShot && item.status === 'completed' && item.artifactName !== name) {
        item.ok = false;
        item.status = 'failed';
        item.code = 'EPROVENANCE';
        item.error = 'artifact ' + String(item.artifactName) + ' does not match the name issued for ' + item.jobId;
        items.push(item);
        continue;
      }
      if (wantShot && item.status === 'completed') {
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
      // The printed page follows the same path: the name the host issued, a read jailed
      // under the session, one write, and a check that the page is the size that was asked
      // for. A file that exists is not a page of the requested size — the format shortcut
      // was measured producing US Letter while reporting A4, which is why paper is only
      // ever expressed in inches here.
      if (paper !== null && arrived) {
        const pdfName = pdfByJob.get(item.jobId);
        if (!pdfName || item.pdfName !== pdfName) {
          item.ok = false;
          item.status = 'failed';
          item.code = 'EPROVENANCE';
          item.error = 'pdf ' + String(item.pdfName) + ' does not match the name issued for ' + item.jobId;
        } else {
          try {
            const buf = await containedRead(res.pwd, pdfName, deps);
            const dest = assertInside ? assertInside(path.join(outDir, pdfName)) : path.join(outDir, pdfName);
            await (deps.writeFileImpl || writeFile)(dest, buf);
            const box = verifyPageBox(buf, paper);
            item.pdf = { path: dest, bytes: buf.length, pageBox: box };
            if (!box.matched) {
              item.ok = false;
              item.status = 'failed';
              item.code = 'EPAGEBOX';
              item.error = box.reason;
            }
          } catch (e) {
            item.ok = false;
            item.status = 'failed';
            item.code = e.code || 'EARTIFACT';
            item.error = String(e.message || e);
          }
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
      // Same three conditions the batch answers, because this IS the batch with artifacts
      // joined onto it. Deriving complete from status alone here reintroduced the exact
      // false green the run had just stopped making.
      complete: status === 'completed' && res.truncated !== true && lossMarkers(partial).length === 0,
      completed: done,
    };
  };
}
