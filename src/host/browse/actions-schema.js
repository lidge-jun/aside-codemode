// Catalog rows for the browse / report / api / recipes namespaces.
//
// These exist because an agent's discovery path is actions.find -> describe -> check, and
// without a row here browse.exec is literally undiscoverable: actions.describe('browse.exec')
// answered 'unknown action' while the function worked, so an agent could see the namespace
// in the tool doc and still have no way to learn the job shape. Measured on a real Aside
// run 2026-09-14: the agent searched the skills tree for 'browse.exec' and got zero rows.

import { validateJob } from './schema.js';
import { validateAttach } from './attach-schema.js';

// Discovery answers with the RUNTIME validator rather than a second opinion. The two used to
// disagree in both directions: check refused a snapshot the job accepted, and accepted a
// waitUntil the job refused with ENOTSUP.
//
// Only these two paths own a whole-object validator. Every other browse action parses its
// arguments inside browse.js, and putting one of those through the job schema reported each
// of its real options - engine, since, urlIncludes, maxBytes - as an unknown job option.
const RUNTIME_VALIDATED = Object.freeze({
  'browse.exec': (args) => validateJob({ timeoutMs: 8000, ...args }),
  'browse.attach': (args) => validateAttach(args),
});

const VALUE_CODES = Object.freeze(['EBADVAL', 'ENOTSUP', 'EBADOPT', 'EINVAL']);

// The whole argument object goes in at once. One option at a time could not see a rule that
// spans two of them, so snapshotAfter: 'diff' came back invalid standing right next to the
// snapshot: 'tree' that makes it legal.
export function checkBrowseArgs(path, args = {}) {
  const run = RUNTIME_VALIDATED[path];
  if (!run) return [];
  try {
    run(args);
    return [];
  } catch (e) {
    if (!e || !VALUE_CODES.includes(e.code)) return [];
    const why = String(e.message).slice(0, 200);
    const name = blame(run, args, e.message);
    return [{ ...(name === null ? {} : { name }), why, code: e.code }];
  }
}

// Which option does the caller have to change? Reading the name out of the message only works
// when the message repeats it, and several do not: networkidle is refused by describing what
// it would do instead. So the option is found by taking one away at a time and seeing which
// removal makes the refusal go. A required option cannot be blamed this way, because removing
// it raises a different refusal rather than none.
function blame(run, args, message) {
  for (const key of Object.keys(args)) {
    const rest = { ...args };
    delete rest[key];
    try {
      run(rest);
      return key;
    } catch (e) {
      if (e && e.message !== message) continue;
    }
  }
  return Object.keys(args).find((k) => message.includes(k)) || null;
}

export const BROWSE_ACTIONS = [
  {
    path: 'browse.probe',
    description: 'What the installed Aside build will and will not do, measured rather than documented. Start here.',
    signature: 'browse.probe() => Promise<{enabled,asideResolved,caps,capabilities}>',
    inputs: {},
    notes: 'capabilities.refused explains WHY an option is rejected. capabilities.page.absent lists methods this surface does not have.',
  },
  {
    path: 'browse.exec',
    description: 'Run a batch of urls through ONE Aside REPL session. On by default; refused when browseCaps.enabled is false.',
    signature: "browse.exec({ urls, timeoutMs?, waitUntil?, waitSelector?, snapshot?, screenshot?, pdf?, extract?, concurrency?, detect? }) => Promise<{ok,items,timings,partial,leakedUrls}>",
    inputs: {
      urls: { type: 'array', required: true, description: 'Array of http(s) url strings. file: is refused.' },
      timeoutMs: { type: 'number', required: false, description: 'Inner deadline, clamped to browseCaps.timeoutMs (default 25000)' },
      waitUntil: { type: 'string', required: false, description: "One of load | domcontentloaded | stable. networkidle is ENOTSUP." },
      waitSelector: { type: 'string', required: false, description: 'Wait for this css selector instead of a load state' },
      snapshot: { type: 'boolean|string', required: false, description: "false | true ('bytes', length only) | 'tree' (the whole a11y tree, child frames included) | 'interactive' (only actionable rows plus their refs)" },
      maxTreeChars: { type: 'number', required: false, description: 'Cap on the returned tree, default 20000; truncation is reported, not hidden' },
      treeNodes: { type: 'boolean', required: false, description: 'Also return snapshot.nodes: [{depth, role, name, ref, attrs, line}] parsed from the same tree, so a grouped read is a depth comparison instead of a regex. Off by default because it costs payload; depth follows indentation, so a child frame whose rows are not indented cannot be grouped this way.' },
      actions: { type: 'array', required: false, description: "Ordered steps run after navigation and before extract. Each step: one verb plus one of { ref } or { selector }. Verbs: click, dblclick, fill, type, press, hover, focus, check, uncheck, selectOption, scrollIntoView, waitFor, waitForLoadState, goBack, goForward, reload, scroll, sleepMs. Max 20." },
      approveWrites: { type: 'boolean', required: false, description: "Say that this job may change things. Required whenever actions contains any verb except waitFor, waitForLoadState and sleepMs - that is the same set the run issues an operationId for, so the line you approve is the line it reports. Without it the job runs nothing, opens no tab and comes back status needs_input with code EWRITEAPPROVAL and wants[] naming the verbs it wanted. The batch cannot ask a person mid-run, so this is the caller saying it up front. Setting it on a job with no such verb is refused, so it cannot become a habit." },
      stopOnError: { type: 'boolean', required: false, description: 'Default true. False keeps going and still reports every failure.' },
      allowStaleRefs: { type: 'boolean', required: false, description: 'Default false. Lets a ref step run without validation, at the cost of possibly hitting a renumbered element.' },
      refsFingerprint: { type: 'string', required: false, description: "snapshot.fingerprint from the read that produced the refs. Without it a ref step can only be checked against the url, which does not see a same-url renumbering; each step reports which guard it got in refGuard, plus guardAgeMs, the window between the check and the verb. snapshot.fingerprintStructure is also accepted for pages whose accessible names carry a clock, but it compares ref and role ONLY - a reordered list is invisible to it." },
      actionBudgetMs: { type: 'number', required: false, description: 'Deadline for the step list, per item. Part of timeoutMs is reserved so the result still survives; timeoutMs under 4000 with actions is refused up front.' },
      snapshotAfter: { type: 'boolean|string', required: false, description: "true returns the observation the call leaves behind, as snapshotId plus fingerprint; 'diff' also compares it against the observation the call arrived at and needs snapshot: 'tree' or 'interactive'. A refused comparison returns reset instead of a diff." },
      fullText: { type: 'boolean', required: false, description: "The page's rendered body on item.text, capped by maxTextChars. Without it the only text a run returns is the 160-character render sample." },
      maxTextChars: { type: 'number', required: false, description: 'Cap for fullText, default 200000.' },
      helper: { type: 'boolean', required: false, description: 'Inline the cm batch helper into the generated script, so the run can call cm.run / cm.mapLimit. Costs about 4500 characters of the 30000 wire budget; the result reports which build answered in helper.{version,sha256}.' },
      screenshot: { type: 'object', required: false, description: '{ clip?, type?, quality?, fullPage? }. maxWidth is ENOTSUP.' },
      pdf: { type: 'object', required: false, description: '{ paperWidth, paperHeight } in INCHES. format is ENOTSUP.' },
      extract: { type: 'object', required: false, description: "{ field: 'css' } or { field: { selector, attr?, all? } }" },
      concurrency: { type: 'number', required: false, description: 'Tabs in flight inside the one session' },
      detect: { type: 'boolean', required: false, description: 'Block detection, default true. Set false for your own generated pages.' },
      requireSelector: { type: 'array|string', required: false, description: 'Css selectors that MUST exist for the content to count as read. A string is accepted.' },
      minTextChars: { type: 'number', required: false, description: 'Minimum visible (innerText) characters for the content to count as read' },
      requireContent: { type: 'boolean|string', required: false, description: 'A string is a regular expression the page must contain, and is itself the check: an item without it fails. true instead enforces whatever checks apply, including the render heuristics that always run, and is legal on its own. contentVerified reads true only when a selector, a minimum length or a pattern was asked for, so a bare true never claims verification' },
      loggedInMarker: { type: 'string', required: false, description: 'A regular expression matching text that only appears when you are signed in. An item without it is needs_input rather than failed, because a person can sign in again. Sign in natively first; the batch never attempts a login. The tool cannot infer this: a signed-out page need not contain the word for signing in, and a JSON api answering with your account data contains no sign-out wording at all' },
      stopWhenLoggedOut: { type: 'boolean', required: false, description: 'Default true beside loggedInMarker. Once one item proves the session is gone the rest are skipped with logged-out as the reason, because they share that session and can only open tabs that cannot succeed' },
    },
    notes: 'ok means the run completed; contentVerified means the page actually rendered. They are DIFFERENT: Threads returned ok:true with the right title while the body was server bootstrap JSON and no posts. Pass requireSelector/minTextChars to get a real verdict; without them contentVerified is null (nobody asked) rather than true. items[] carries per-url ok/error so one failure never empties the rest. A blocked page returns EBLOCKED with an alternate route; an arrived-but-unrendered page returns EUNRENDERED or partial:[content-unverified]. A navigation that ended on the browser own error page is EDEADEND. If the same extract field came back empty on every page that answered, the run carries suspectEmpty naming it and counting the frames on those pages, because a frame is the usual reason a selector finds nothing.',
  },
  {
    path: 'browse.leakedTabs',
    description: "Tabs THIS TOOL opened that are still sitting in the browser with the run that opened them gone. Reports; never closes.",
    signature: 'browse.leakedTabs() => Promise<{ok,tabs:[{targetId,url,jobId,runId,pid,leftAt}],checked}>',
    inputs: {},
    notes: "A killed run cannot close its own tabs, and before this there was no way to tell which ones were ours. A tab is named only if it is in the journal, was never reported closed, belongs to a run that is no longer running, and is open right now - so a tab this tool did not open is never named, which is how the user's own tabs stay out of it. It cannot see a tab opened by a run that died before the host recorded anything, and it does not promise the tabs can be closed: the same measurement that found the leak found that a known targetId could not be closed either. Hand the list to a person.",
  },
  {
    path: 'browse.approve',
    description: "Run a batch that browse.exec refused for want of approval. It was never started, so this runs it for the first time, under its own runId.",
    signature: 'browse.approve({ approvalId }) => Promise<result | {ok:false,changed:false,state,runId,startedAt}>',
    inputs: {
      approvalId: { type: 'string', required: true, description: 'The id the refusal returned. There is no implicit current run: a process can be holding several refusals, and approving without naming one would be a guess.' },
    },
    notes: "Safe to call twice. Only one caller can claim an id, so a second call runs nothing and answers {changed:false, state} with the runId of the attempt that did happen. state is pending, claimed, rejected, expired or unknown. A claimed record with runId null means the claim won and the process stopped before starting - neither ran nor did not run. Approvals expire; an expired one is refused rather than quietly run late.",
  },
  {
    path: 'browse.reject',
    description: "Settle a refused batch without running it.",
    signature: 'browse.reject({ approvalId }) => Promise<{ok,changed,state,runId,startedAt}>',
    inputs: {
      approvalId: { type: 'string', required: true, description: 'The id the refusal returned.' },
    },
    notes: "Only a pending approval can be rejected. If it was already claimed this answers {changed:false, state:'claimed'} and NEVER says rejected, because by then the steps may have run - check state before telling anyone the run was stopped.",
  },
  {
    path: 'browse.tabs',
    description: "List the tabs the USER already has open in their browser. Read-only: opens nothing, closes nothing.",
    signature: 'browse.tabs() => Promise<{ok,tabs:[{targetId,id,url,title,active,windowId,focusedWindow}]}>',
    inputs: {},
    notes: 'This is the live browser, not a private session. t.id carries a "tab:" prefix and attaching by it FAILS; attach by t.targetId. Measured 2026-09-14 on CLI 1.26.906.1630.',
  },
  {
    path: 'browse.attach',
    description: "Read the tab the user already has open, with their session, scroll position and current screen. Never opens or closes a tab.",
    signature: 'browse.attach({ targetId?, urlIncludes?, titleIncludes?, requireSelector?, minTextChars?, includeText?, maxTextChars?, sampleChars? }) => Promise<{ok,tab,href,hash,title,scrollY,render,contentVerified}>',
    inputs: {
      targetId: { type: 'string', required: false, description: 'Exact tab targetId from browse.tabs. A leading "tab:" is stripped for you.' },
      urlIncludes: { type: 'string', required: false, description: 'Substring match against the tab url' },
      titleIncludes: { type: 'string', required: false, description: 'Substring match against the tab title' },
      requireSelector: { type: 'array|string', required: false, description: 'Css selectors that MUST exist for the read to count. A string is accepted.' },
      minTextChars: { type: 'number', required: false, description: 'Minimum visible (innerText) characters for the read to count' },
      includeText: { type: 'boolean', required: false, description: 'Return the full visible text, not only a sample' },
      maxTextChars: { type: 'number', required: false, description: 'Cap on the returned text, default 20000' },
      sampleChars: { type: 'number', required: false, description: 'Length of render.sample, default 400' },
      snapshot: { type: 'boolean|string', required: false, description: "'tree' or 'interactive' to get the a11y tree and refs from the live tab" },
      maxTreeChars: { type: 'number', required: false, description: 'Cap on the returned tree, default 20000' },
      treeNodes: { type: 'boolean', required: false, description: 'Also return snapshot.nodes parsed from the same tree (depth, role, name, ref, attrs). Off by default; see browse.exec for the shape and its limits.' },
      actions: { type: 'array', required: false, description: 'Same step shape as browse.exec, run against the live tab. The tab is still never closed.' },
      stopOnError: { type: 'boolean', required: false, description: 'Default true' },
      allowStaleRefs: { type: 'boolean', required: false, description: 'Default false' },
      actionBudgetMs: { type: 'number', required: false, description: 'Shared deadline for the whole step list, default 20000' },
    },
    notes: 'Pick exactly one selector; with none it takes the active tab, and that is the ONLY branch that chooses for you - a targetId that is not there never becomes the tab beside it. It answers ETABGONE, separately from ENOTAB for a urlIncludes or titleIncludes that matched nothing, and separately again from ENOACTIVE. ETABGONE carries the targetId you asked for, the tabs that ARE open so you can choose without a second call, lastUrl and boundAt when this tool is what opened that tab (null when it did not, and null when the same id was seen at two different pages, because a wrong page given confidently is worse than none), and effectsUnknown - if your actions went out before the tab vanished, their outcome is not known and ok:false does not mean nothing happened. attachActiveBrowserTab fails with ENOACTIVE when no browser window is focused, which is normal over ssh, so pass targetId or urlIncludes from a headless run. The address is read with location.href because page.url() drops the fragment: the same tab answered "http://localhost:10100/" and "http://localhost:10100/#providers" on one run, and fragmentDropped reports that. contentVerified is null unless you asked for minTextChars or requireSelector. The tab is NEVER closed - it is the user\'s.',
  },
  {
    path: 'browse.captureMany',
    description: 'Batch screenshot or pdf capture; artifacts are written to outDir and verified against the request.',
    signature: 'browse.captureMany(urls, { outDir, screenshot?, pdf?, snapshot?, timeoutMs?, concurrency? }) => Promise<{ok,items}>',
    inputs: {
      urls: { type: 'array', required: true, description: 'Array of http(s) url strings' },
      outDir: { type: 'string', required: false, description: 'Directory inside the configured roots; files are host-named' },
      screenshot: { type: 'object', required: false, description: '{ clip?, type?, quality? }. clip is honoured exactly.' },
      pdf: { type: 'object', required: false, description: '{ paperWidth?, paperHeight?, printBackground? } in INCHES, defaulting to A4. Prints the url to a file in outDir. A format name is refused: it was measured producing US Letter while reporting A4. Passing pdf without naming screenshot means a pdf and no screenshot; screenshot: false with no pdf is refused because nothing would come back.' },
    },
    notes: 'Each item.artifact reports the REAL width/height read from the file, not the requested size, and item.pdf.pageBox reports the real MediaBox. A page that came back the wrong size is EPAGEBOX and fails the item; a file that exists is not a page of the size you asked for.',
  },
  {
    path: 'browse.readText',
    description: 'Fetch-first page read: html to markdown-shaped text, with no browser unless the page rendered nothing. Takes a url string or { url, ...options }.',
    signature: "browse.readText(url | { url, ... }, { timeoutMs?, minChars?, fresh?, locale? }) => Promise<{ok,source,text,format,chars,blockKind,fallbackReason}>",
    // treeNodes is documented on the job that carries it, below.
    inputs: {
      url: { type: 'string', required: true, description: 'http(s) url' },
      timeoutMs: { type: 'number', required: false, description: 'Deadline for the fetch and, if one is needed, the browser read' },
      minChars: { type: 'number', required: false, description: 'Shortest body that counts as a read. A warm entry below it is re-read rather than returned.' },
      fresh: { type: 'boolean', required: false, description: 'Skip the cache and read the page now. watch always sets this.' },
      locale: { type: 'string', required: false, description: 'Separates cache entries for pages that answer differently per locale' },
    },
    notes: "source is 'fetch' or 'browser'; fallbackReason says why a browser was needed. ok is false for an http refusal (blockKind auth | rate-limited | upstream), for a login wall (blockKind login-wall), and for a browser fallback that came back empty (degraded, with degradedReason). Only an ok read is cached.",
  },
  {
    path: 'browse.searchMany',
    description: 'Run several queries in parallel with url dedupe and an optional date filter.',
    signature: "browse.searchMany(queries, { engine?, since? }) => Promise<{engine,items,ok}>",
    inputs: {
      queries: { type: 'array', required: true, description: 'Array of query strings' },
      engine: { type: 'string', required: false, description: 'duckduckgo (default) | youtube | google' },
      since: { type: 'string', required: false, description: 'ISO date; rows older than this are dropped and counted' },
    },
    notes: 'google is callable but answers with a bot challenge, so it returns EBLOCKED with the url to open rather than an empty result set.',
  },
  {
    path: 'browse.downloadMedia',
    description: 'Download original images directly instead of screenshotting the page around them.',
    signature: 'browse.downloadMedia(urls, { outDir, maxBytes? }) => Promise<{ok,items}>',
    inputs: {
      urls: { type: 'array', required: true, description: 'Array of image urls' },
      outDir: { type: 'string', required: true, description: 'Directory inside the configured roots' },
      maxBytes: { type: 'number', required: false, description: 'Per-image cap, default 8 MiB' },
    },
    notes: 'The magic bytes gate the write: a page claiming image/png is refused as ENOTIMAGE and nothing is saved. maxBytes stops the download at the cap instead of measuring what already arrived, so a declared or actual oversize body is ETOOBIG without being held in memory.',
  },
  {
    path: 'browse.watch',
    description: 'Hash each url and return a diff only for the ones that changed.',
    signature: 'browse.watch(urls, { timeoutMs?, locale? }) => Promise<{items,changed}>',
    inputs: { urls: { type: 'array', required: true, description: 'Array of urls to watch' } },
    notes: "An unchanged url returns changed:false with no body. First sight is first:true so it is not mistaken for a change. Every round reads the page itself rather than the shared cache, and a url that could not be observed returns code EOBSERVE with changed:null, leaving the baseline alone so the outage is not recorded as the page's new content.",
  },
  {
    path: 'browse.prefetch',
    description: 'Warm the shared cache for a watch list. Best effort; failures are reported, never thrown.',
    signature: 'browse.prefetch(urls, { timeoutMs? }) => Promise<{items,warmed}>',
    inputs: { urls: { type: 'array', required: true, description: 'Array of urls to warm' } },
  },
];

export const REPORT_ACTIONS = [
  {
    path: 'report.build',
    description: 'Assemble a paged HTML report and print it to PDF, verifying the real page size.',
    signature: 'report.build({ items, outFile, title?, paper?, timeoutMs? }) => Promise<{ok,path,bytes,pageBox}>',
    inputs: {
      items: { type: 'array', required: true, description: 'Rows: { url, title?, ok, data?, error?, figure? }' },
      outFile: { type: 'string', required: true, description: 'Destination pdf path inside the configured roots' },
      paper: { type: 'object', required: false, description: '{ paperWidth, paperHeight } in INCHES; defaults to A4. format is ENOTSUP.' },
    },
    notes: 'pageBox.matched is false when the produced MediaBox is not the requested size, and the item fails. A file that exists is not a report of the size you asked for.',
  },
];

export const API_ACTIONS = [
  {
    path: 'api.batch',
    description: 'Parallel API-first lookups with per-item isolation.',
    signature: "api.batch([{ adapter, ...args }]) => Promise<{ok,items}>",
    inputs: { requests: { type: 'array', required: true, description: "[{ adapter: 'youtube', url }] or [{ adapter: 'itunes', term | id }]" } },
    notes: 'youtube and itunes are public no-key endpoints. play and slack return ENOTSUP because neither has an honest public path.',
  },
  { path: 'api.adapters', description: 'List the adapters and whether each has a public endpoint.', signature: 'api.adapters() => Promise<object>', inputs: {} },
];

export const RECIPE_ACTIONS = [
  { path: 'recipes.list', description: 'Names of the configured site recipes.', signature: 'recipes.list() => Promise<string[]>', inputs: {} },
  { path: 'recipes.describe', description: 'The stored definition of one recipe.', signature: 'recipes.describe(name) => Promise<object|null>', inputs: { name: { type: 'string', required: true, description: 'Recipe name' } } },
  {
    path: 'recipes.run',
    description: 'Execute a stored site recipe with no model turn.',
    signature: 'recipes.run(name, args?) => Promise<{recipe,url,ok,items}>',
    inputs: { name: { type: 'string', required: true, description: 'Recipe name' }, args: { type: 'object', required: false, description: 'Values interpolated into the recipe url' } },
    notes: 'A recipe is DATA ({ url, waitSelector, extract }). A .js recipe is refused: host-loaded code would bypass the guest sandbox.',
  },
];
