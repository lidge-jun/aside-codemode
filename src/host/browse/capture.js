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

    const items = [];
    for (let i = 0; i < res.items.length; i++) {
      const item = { ...res.items[i] };
      const name = names[i];
      if (item.ok && item.artifactName) {
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
    const status = res.status === 'indeterminate'
      ? 'indeterminate'
      : (done === items.length && items.length > 0 ? res.status : (done > 0 ? 'partial' : 'failed'));
    return {
      ...res, items, partial, status,
      ok: status === 'completed',
      complete: status === 'completed',
      completed: done,
    };
  };
}
