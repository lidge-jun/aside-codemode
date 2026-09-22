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
import { createApprovals, requireApprovalId } from './approvals.js';
import { createTabJournal } from './tab-journal.js';
import { createDownloadMedia } from './media.js';
import { createSearchMany } from './search.js';
import { ENABLE_BROWSE_COMMAND } from '../../enable-browse.js';
import { createWatch, createRecipes, createPrefetch } from './watch.js';
import { createAttach } from './attach.js';
import os from 'node:os';
import path from 'node:path';
import { listAccountRoots } from '../../register.js';
import { routingReport, buildCacheIdentity, hasCompleteBrowserContext, browserContextDirectory, requireLocalArtifacts } from '../../browser-context.js';
import { APPROVAL_DIR } from './approvals.js';
import { JOURNAL_DIR } from './tab-journal.js';

export function createBrowse({ config = {}, spawnAside, resolveAside, signal, env = process.env, assertInside, browserContext = null } = {}) {
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
  // The directory is configurable so a test can be given its own. Found by dogfooding: the
  // suite was writing every refusal, claim and rejection into the shared one and leaving
  // them there, which is litter in somebody's temp directory and a test that can see
  // another run's records.
  const completeContext = hasCompleteBrowserContext(browserContext);
  const baseApprovalDir = typeof caps.approvalDir === 'string' && caps.approvalDir ? caps.approvalDir : APPROVAL_DIR;
  const approvalDir = completeContext ? browserContextDirectory(baseApprovalDir, browserContext) : null;

  const baseJournalDir = typeof caps.tabJournalDir === 'string' && caps.tabJournalDir ? caps.tabJournalDir : JOURNAL_DIR;
  const journalDir = completeContext ? browserContextDirectory(baseJournalDir, browserContext) : null;

  const approvals = completeContext ? createApprovals({
    ttlMs: Number.isSafeInteger(caps.approvalTtlMs) ? caps.approvalTtlMs : undefined,
    dir: approvalDir,
  }) : null;
  const tabJournal = completeContext ? createTabJournal({
    dir: journalDir,
  }) : null;
  const session = createBrowseSession({ spawnAside: spawner, resolveAside: resolver, signal, breaker, approvals, tabJournal, browserContext });
  const captureManyImpl = createCaptureMany({ session, assertInside });
  // Not u/0. Aside runs as whichever profile accounts.json calls current, and on a machine
  // where that is id 1 a hardcoded u/0 points the cache at a profile nobody is using.
  const asideHome = path.join(env.USERPROFILE || env.HOME || os.homedir() || '', '.aside');
  const baseAccountRoot = resolveAccountRoot(asideHome, browserContext?.account);
  const accountRoot = buildCacheIdentity(baseAccountRoot, browserContext);
  const cache = completeContext ? createCache({ ttlMs: Number.isSafeInteger(caps.cacheTtlMs) ? caps.cacheTtlMs : undefined }) : null;

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
    requireLocalArtifacts(browserContext, 'browse.captureMany');
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
  const attachImpl = createAttach({ config, session, tabJournal, browserContext });

  // Tabs this tool opened, whose run is gone, that are still sitting in the browser. The
  // live list is asked for first: a journal entry for a tab that is no longer open is a
  // record of something already dealt with, and naming it would send someone looking for a
  // tab that is not there. Nothing outside the journal is ever named, which is what keeps a
  // user's own tabs out of this.
  async function leakedTabs() {
    if (caps.enabled !== true) throw disabledError();
    if (!tabJournal) return { ok: false, code: 'EUNRESOLVEDCONTEXT', tabs: [], error: 'tab ownership requires both account and host; inherited identity is unverified' };
    const listed = await attachImpl.tabs();
    if (!listed || listed.ok !== true) {
      return { ok: false, code: listed && listed.code ? listed.code : 'ENOTABS', error: 'could not read the open tabs, so nothing can be called abandoned', tabs: [] };
    }
    // The whole tab objects, not just their ids: the journal matches on the url too, because
    // a reused target id attached to a tab the person opened is exactly the case that must
    // not be claimed.
    const live = (listed.tabs || []).filter((t) => t && t.targetId);
    return { ok: true, tabs: tabJournal.orphans(live), checked: live.length };
  }

  // Named explicitly, always. There is no implicit "the current run": a process can hold
  // several refusals at once, and an approve() with no argument would be a guess about
  // which one the caller meant.
  async function approve(opts = {}) {
    if (caps.enabled !== true) throw disabledError();
    const id = requireApprovalId('browse.approve', opts);
    if (!approvals) throw unresolvedApprovalError();
    const existing = approvals.read(id);
    const selected = routingReport(browserContext);
    if (existing.record?.context && (existing.record.context.account !== selected.account || existing.record.context.host !== selected.host)) {
      return { ok: false, changed: false, approvalId: id, state: 'context-mismatch', error: 'approval was created under a different browser routing context' };
    }
    const claimed = approvals.claim(id);
    // Nothing moved. Whatever state it is in is the answer, and the caller is told which
    // one rather than being left to infer it from a failure.
    if (!claimed.ok) return { ok: false, changed: false, approvalId: id, state: claimed.state, runId: (claimed.record && claimed.record.runId) || null, startedAt: (claimed.record && claimed.record.startedAt) || null };
    const rec = claimed.record;
    const currentRouting = routingReport(browserContext);
    if (rec.context && (rec.context.account !== currentRouting.account || rec.context.host !== currentRouting.host)) {
      return {
        ok: false,
        changed: true,
        approvalId: id,
        state: 'context-mismatch',
        error: 'claimed approval context changed before execution; no browser action was performed',
        runId: null,
        startedAt: null,
      };
    }
    const res = await session.run(rec.job, { approvedBy: id });
    approvals.started(id, res && res.runId ? res.runId : null);
    return { ...res, approvalId: id, changed: true };
  }

  async function reject(opts = {}) {
    if (caps.enabled !== true) throw disabledError();
    const id = requireApprovalId('browse.reject', opts);
    if (!approvals) throw unresolvedApprovalError();
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
    leakedTabs: () => leakedTabs(),
    attach: (o) => attachImpl.attach(o),
    captureMany,
    readText: (url, o) => readTextImpl(url, o),
    downloadMedia: (urls, o) => downloadMediaImpl(urls, o),
    searchMany: (queries, o) => searchManyImpl(queries, o),
    watch: (urls, o) => watchImpl(urls, o),
    prefetch: (urls, o) => prefetchImpl(urls, o),
    routing: Object.freeze(routingReport(browserContext)),
    browserContext: Object.freeze(routingReport(browserContext)),
    context: () => routingReport(browserContext),
    // recipesImpl is exposed as its OWN root, not browse.recipes: hostMethods walks one
    // level only, so a nested object would silently never register.
    _recipes: recipesImpl,
  });
}

export { CAPABILITY_MATRIX };

function unresolvedApprovalError() {
  const error = new Error('persistent approvals require both account and host; inherited identity is unverified');
  error.code = 'EUNRESOLVEDCONTEXT';
  return error;
}

function disabledError() {
  const e = new Error(`browse is turned off on this machine. Turn it back on with: ${ENABLE_BROWSE_COMMAND}`);
  e.code = 'EDISABLED';
  return e;
}

// Exported for the test; a broken accounts.json must never take browsing down with it.
export function resolveAccountRoot(asideHome, account = null) {
  try {
    const accountId = account ? String(account).replace(/^u/, '') : undefined;
    const { roots } = listAccountRoots({ asideHome, only: accountId ? [accountId] : undefined });
    const primary = accountId ? roots[0] : (roots.find((r) => r.current) || roots[0]);
    if (primary && primary.root) return primary.root;
    if (accountId) return path.join(asideHome, 'u', accountId);
  } catch { /* fall through to the historical default */ }
  return path.join(asideHome, 'u', account ? String(account).replace(/^u/, '') : '0');
}
