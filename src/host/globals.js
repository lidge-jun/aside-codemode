// One per-execution host scope, shared by the CLI and the future MCP transport.
import { createRgResolver, createRgRunner } from '../rg.js';
import { createSearch } from './search.js';
import { createFs } from './fs.js';
import { createApplyPatch } from './patch.js';
import { createActions } from './actions.js';
import { createBrowse } from './browse/browse.js';
import { createReport, createApiNamespace } from './namespaces.js';
import { resolveBrowserContext } from '../browser-context.js';
import { createDesktop } from './desktop/desktop.js';

// One broker session per server process, not per execution: get_app_state element indexes
// are only valid inside the signed session that produced them, and a guest that reads the tree
// in one execute_code and clicks in the next must hit the same session. The broker idle-closes
// it after desktop.idleMs.
let desktopSingleton = null;
let desktopKey = null;
function sharedDesktop(config) {
  const key = JSON.stringify(config.desktop || {});
  if (!desktopSingleton || desktopKey !== key) {
    if (desktopSingleton) void desktopSingleton._close();
    desktopSingleton = createDesktop({ config });
    desktopKey = key;
  }
  return desktopSingleton;
}

// The CLI is one-shot: close the broker so the process exits now, not after idleMs.
export async function closeSharedDesktop() {
  const d = desktopSingleton;
  desktopSingleton = null;
  desktopKey = null;
  if (d) await d._close();
}

export function createHostGlobals(config, assertInside, signal, { browserContext } = {}) {
  const rgRunner = createRgRunner(createRgResolver(config, process.env, { signal }), { excludeGlobs: config.excludeGlobs, signal });
  const hostFs = createFs({ assertInside, signal });
  const resolvedContext = browserContext || resolveBrowserContext({ config });
  const browse = createBrowse({ config, signal, assertInside, browserContext: resolvedContext });
  return {
    search: createSearch({ rgRunner, assertInside, caps: config.searchCaps }),
    fs: hostFs,
    read_file: hostFs.read_file,
    write_file: hostFs.write_file,
    edit_file: hostFs.edit_file,
    apply_patch: createApplyPatch({ write_file: hostFs.write_file, edit_file: hostFs.edit_file }),
    // The recipe registry goes in so actions.check can refuse an unknown recipe the same way
    // recipes.run does; it is this instance's data, not something the catalog can know.
    actions: createActions({ recipes: (config && config.recipes) || {} }),
    browse,
    report: createReport({ config, signal, assertInside, browserContext: resolvedContext }),
    api: createApiNamespace(),
    desktop: sharedDesktop(config)._view(signal),
    recipes: browse._recipes,
  };
}
