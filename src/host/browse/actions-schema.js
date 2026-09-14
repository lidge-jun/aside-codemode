// Catalog rows for the browse / report / api / recipes namespaces.
//
// These exist because an agent's discovery path is actions.find -> describe -> check, and
// without a row here browse.exec is literally undiscoverable: actions.describe('browse.exec')
// answered 'unknown action' while the function worked, so an agent could see the namespace
// in the tool doc and still have no way to learn the job shape. Measured on a real Aside
// run 2026-09-14: the agent searched the skills tree for 'browse.exec' and got zero rows.

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
    description: 'Run a batch of urls through ONE Aside REPL session. Opt-in: needs browseCaps.enabled.',
    signature: "browse.exec({ urls, timeoutMs?, waitUntil?, waitSelector?, snapshot?, screenshot?, pdf?, extract?, concurrency?, detect? }) => Promise<{ok,items,timings,partial,leakedUrls}>",
    inputs: {
      urls: { type: 'array', required: true, description: 'Array of http(s) url strings. file: is refused.' },
      timeoutMs: { type: 'number', required: false, description: 'Inner deadline, clamped to browseCaps.timeoutMs (default 25000)' },
      waitUntil: { type: 'string', required: false, description: "One of load | domcontentloaded | stable. networkidle is ENOTSUP." },
      waitSelector: { type: 'string', required: false, description: 'Wait for this css selector instead of a load state' },
      snapshot: { type: 'boolean', required: false, description: 'Include an accessibility snapshot size' },
      screenshot: { type: 'object', required: false, description: '{ clip?, type?, quality?, fullPage? }. maxWidth is ENOTSUP.' },
      pdf: { type: 'object', required: false, description: '{ paperWidth, paperHeight } in INCHES. format is ENOTSUP.' },
      extract: { type: 'object', required: false, description: "{ field: 'css' } or { field: { selector, attr?, all? } }" },
      concurrency: { type: 'number', required: false, description: 'Tabs in flight inside the one session' },
      detect: { type: 'boolean', required: false, description: 'Block detection, default true. Set false for your own generated pages.' },
      requireSelector: { type: 'array', required: false, description: 'Css selectors that MUST exist for the content to count as read. A string is accepted.' },
      minTextChars: { type: 'number', required: false, description: 'Minimum visible (innerText) characters for the content to count as read' },
      requireContent: { type: 'boolean', required: false, description: 'Fail the item when a render check fails, instead of only warning' },
    },
    notes: 'ok means the run completed; contentVerified means the page actually rendered. They are DIFFERENT: Threads returned ok:true with the right title while the body was server bootstrap JSON and no posts. Pass requireSelector/minTextChars to get a real verdict; without them contentVerified is null (nobody asked) rather than true. items[] carries per-url ok/error so one failure never empties the rest. A blocked page returns EBLOCKED with an alternate route; an arrived-but-unrendered page returns EUNRENDERED or partial:[content-unverified].',
  },
  {
    path: 'browse.captureMany',
    description: 'Batch screenshot capture; artifacts are written to outDir and verified against the request.',
    signature: 'browse.captureMany(urls, { outDir, screenshot?, snapshot?, timeoutMs?, concurrency? }) => Promise<{ok,items}>',
    inputs: {
      urls: { type: 'array', required: true, description: 'Array of http(s) url strings' },
      outDir: { type: 'string', required: false, description: 'Directory inside the configured roots; files are host-named' },
      screenshot: { type: 'object', required: false, description: '{ clip?, type?, quality? }. clip is honoured exactly.' },
    },
    notes: 'Each item.artifact reports the REAL width/height read from the file, not the requested size.',
  },
  {
    path: 'browse.readText',
    description: 'Fetch-first page read: html to markdown with no browser unless the page rendered nothing.',
    signature: "browse.readText(url, { timeoutMs? }) => Promise<{source,markdown,chars,fallbackReason}>",
    inputs: { url: { type: 'string', required: true, description: 'http(s) url' } },
    notes: "source is 'fetch' or 'browser'; fallbackReason says why a browser was needed.",
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
    notes: 'The magic bytes gate the write: a page claiming image/png is refused as ENOTIMAGE and nothing is saved.',
  },
  {
    path: 'browse.watch',
    description: 'Hash each url and return a diff only for the ones that changed.',
    signature: 'browse.watch(urls, { timeoutMs?, locale? }) => Promise<{items,changed}>',
    inputs: { urls: { type: 'array', required: true, description: 'Array of urls to watch' } },
    notes: 'An unchanged url returns changed:false with no body. First sight is first:true so it is not mistaken for a change.',
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
