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
import { createDownloadMedia } from './media.js';
import { createSearchMany } from './search.js';
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
  const session = createBrowseSession({ spawnAside: spawner, resolveAside: resolver, signal, breaker });
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
      const e = new Error('browse is opt-in: set browseCaps.enabled = true in codemode config');
      e.code = 'EDISABLED';
      throw e;
    }
    return session.run(job, { browseCaps: caps, signal });
  }

  async function captureMany(urls, opts = {}) {
    if (caps.enabled !== true) {
      const e = new Error('browse is opt-in: set browseCaps.enabled = true in codemode config');
      e.code = 'EDISABLED';
      throw e;
    }
    return captureManyImpl(urls, { ...opts, browseCaps: caps });
  }

  // fetch-first: no browser unless the fetched HTML measurably is not the content.
  const readTextImpl = createReadText({ browse: caps.enabled === true ? { exec } : null });
  const downloadMediaImpl = createDownloadMedia({ assertInside });
  const searchManyImpl = createSearchMany({ session, cache, accountRoot });
  const watchImpl = createWatch({ readText: (u, o) => readTextImpl(u, o), cache, accountRoot });
  const prefetchImpl = createPrefetch({ readText: (u, o) => readTextImpl(u, o), cache, accountRoot });
  const recipesImpl = createRecipes({ registry: (config.recipes || {}), exec });
  const attachImpl = createAttach({ config, session });

  return Object.freeze({
    probe,
    exec,
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

// Exported for the test; a broken accounts.json must never take browsing down with it.
export function resolveAccountRoot(asideHome) {
  try {
    const { roots } = listAccountRoots({ asideHome });
    const primary = roots.find((r) => r.current) || roots[0];
    if (primary && primary.root) return primary.root;
  } catch { /* fall through to the historical default */ }
  return path.join(asideHome, 'u', '0');
}
