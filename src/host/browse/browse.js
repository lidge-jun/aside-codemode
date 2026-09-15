// Guest-facing browse namespace. wp2 ships the two methods that make the surface
// inspectable and provable; the batch/report features land in later work-phases.
import { CAPABILITY_MATRIX, doctorPayload } from './probe.js';
import { createBrowseSession } from './session.js';
import { createAsideResolver, verifyAside } from './resolve.js';
import { createAsideSpawner } from './spawn.js';
import { createBreaker } from './policy.js';
import { createCaptureMany } from './capture.js';
import { createReadText } from './read-text.js';
import { createCache } from './cache.js';
import { createApprovals } from './approvals.js';
import { createDownloadMedia } from './media.js';
import { createSearchMany } from './search.js';
import { ENABLE_BROWSE_COMMAND } from '../../enable-browse.js';
import { createWatch, createRecipes, createPrefetch } from './watch.js';
import { createAttach } from './attach.js';
import os from 'node:os';
import path from 'node:path';
import { listAccountRoots } from '../../register.js';

export function createBrowse({ config = {}, spawnAside, resolveAside, signal, env = process.env, assertInside } = {}) {
  const caps = config.browseCaps || {};
  // Injectable for tests; a real install gets the portable resolver and spawner so the
  // namespace works on a machine nobody developed on.
  const resolver = resolveAside || createAsideResolver(config, env, { verify: (bin) => verifyAside(bin) });
  const spawner = spawnAside || createAsideSpawner();
  // One breaker per host-globals instance: state has to outlive a single call to be worth
  // anything, and it must never cross into the guest.
  const breaker = createBreaker({
    failures: Number.isSafeInteger(caps.breakerFailures) ? caps.breakerFailures : 3,
    cooldownMs: Number.isSafeInteger(caps.breakerCooldownMs) ? caps.breakerCooldownMs : 30000,
  });
  // One store per host-globals instance, but backed by the filesystem rather than memory:
  // a batch is refused in one tool call and approved in another, and the host scope does
  // not survive between them.
  const approvals = createApprovals({ ttlMs: Number.isSafeInteger(caps.approvalTtlMs) ? caps.approvalTtlMs : undefined });
  const session = createBrowseSession({ spawnAside: spawner, resolveAside: resolver, signal, breaker, approvals });
  const captureManyImpl = createCaptureMany({ session, assertInside });
  // Not u/0. Aside runs as whichever profile accounts.json calls current, and on a machine
  // where that is id 1 a hardcoded u/0 points the cache at a profile nobody is using.
  const asideHome = path.join(env.USERPROFILE || env.HOME || os.homedir() || '', '.aside');
  const accountRoot = resolveAccountRoot(asideHome);
  const cache = createCache({ ttlMs: Number.isSafeInteger(caps.cacheTtlMs) ? caps.cacheTtlMs : undefined });

  async function probe() {
    let resolved = null;
    let error = null;
    try { resolved = await resolver(); } catch (e) { error = { code: e.code, message: e.message, candidates: e.candidates || [] }; }
    return doctorPayload(config, resolved, error);
  }

  async function exec(job) {
    if (caps.enabled !== true) {
      const e = new Error(`browse is turned off on this machine. Turn it back on with: ${ENABLE_BROWSE_COMMAND} (writes browseCaps.enabled into your user config)`);
      e.code = 'EDISABLED';
      throw e;
    }
    return session.run(job, { browseCaps: caps, signal });
  }

  async function captureMany(urls, opts = {}) {
    if (caps.enabled !== true) {
      const e = new Error(`browse is turned off on this machine. Turn it back on with: ${ENABLE_BROWSE_COMMAND} (writes browseCaps.enabled into your user config)`);
      e.code = 'EDISABLED';
      throw e;
    }
    return captureManyImpl(urls, { ...opts, browseCaps: caps });
  }

  // fetch-first: no browser unless the fetched HTML measurably is not the content.
  // The cache has to be handed in, or prefetch warms an entry nothing ever reads.
  const readTextImpl = createReadText({ browse: caps.enabled === true ? { exec } : null, cache, accountRoot });
  const downloadMediaImpl = createDownloadMedia({ assertInside });
  const searchManyImpl = createSearchMany({ session, cache, accountRoot });
  const watchImpl = createWatch({ readText: (u, o) => readTextImpl(u, o), cache, accountRoot });
  const prefetchImpl = createPrefetch({ readText: (u, o) => readTextImpl(u, o), cache, accountRoot });
  const recipesImpl = createRecipes({ registry: (config.recipes || {}), exec });
  const attachImpl = createAttach({ config, session });

  // Named explicitly, always. There is no implicit "the current run": a process can hold
  // several refusals at once, and an approve() with no argument would be a guess about
  // which one the caller meant.
  async function approve(opts = {}) {
    if (caps.enabled !== true) throw disabledError();
    const id = opts && typeof opts.approvalId === 'string' ? opts.approvalId : null;
    if (!id) { const e = new Error('browse.approve needs the approvalId the refusal returned'); e.code = 'EBADVAL'; throw e; }
    const claimed = approvals.claim(id);
    // Nothing moved. Whatever state it is in is the answer, and the caller is told which
    // one rather than being left to infer it from a failure.
    if (!claimed.ok) return { ok: false, changed: false, approvalId: id, state: claimed.state, runId: (claimed.record && claimed.record.runId) || null, startedAt: (claimed.record && claimed.record.startedAt) || null };
    const rec = claimed.record;
    const res = await session.run(rec.job, { approvedBy: id });
    approvals.started(id, res && res.runId ? res.runId : null);
    return { ...res, approvalId: id, changed: true };
  }

  async function reject(opts = {}) {
    if (caps.enabled !== true) throw disabledError();
    const id = opts && typeof opts.approvalId === 'string' ? opts.approvalId : null;
    if (!id) { const e = new Error('browse.reject needs the approvalId the refusal returned'); e.code = 'EBADVAL'; throw e; }
    const done = approvals.reject(id);
    // A claimed record is never reported as rejected. By then the steps may have run, and
    // saying otherwise is the one wrong answer this surface can give.
    return {
      ok: done.ok, changed: done.changed, approvalId: id, state: done.state,
      runId: (done.record && done.record.runId) || null,
      startedAt: (done.record && done.record.startedAt) || null,
    };
  }

  return Object.freeze({
    probe,
    exec,
    approve,
    reject,
    tabs: () => attachImpl.tabs(),
    attach: (o) => attachImpl.attach(o),
    captureMany,
    readText: (url, o) => readTextImpl(url, o),
    downloadMedia: (urls, o) => downloadMediaImpl(urls, o),
    searchMany: (queries, o) => searchManyImpl(queries, o),
    watch: (urls, o) => watchImpl(urls, o),
    prefetch: (urls, o) => prefetchImpl(urls, o),
    // recipesImpl is exposed as its OWN root, not browse.recipes: hostMethods walks one
    // level only, so a nested object would silently never register.
    _recipes: recipesImpl,
  });
}

export { CAPABILITY_MATRIX };

function disabledError() {
  const e = new Error(`browse is turned off on this machine. Turn it back on with: ${ENABLE_BROWSE_COMMAND}`);
  e.code = 'EDISABLED';
  return e;
}

// Exported for the test; a broken accounts.json must never take browsing down with it.
export function resolveAccountRoot(asideHome) {
  try {
    const { roots } = listAccountRoots({ asideHome });
    const primary = roots.find((r) => r.current) || roots[0];
    if (primary && primary.root) return primary.root;
  } catch { /* fall through to the historical default */ }
  return path.join(asideHome, 'u', '0');
}
