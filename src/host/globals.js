// One per-execution host scope, shared by the CLI and the future MCP transport.
import { createRgResolver, createRgRunner } from '../rg.js';
import { createSearch } from './search.js';
import { createFs } from './fs.js';
import { createApplyPatch } from './patch.js';
import { createActions } from './actions.js';
import { createBrowse } from './browse/browse.js';
import { createReport, createApiNamespace } from './namespaces.js';

export function createHostGlobals(config, assertInside, signal) {
  const rgRunner = createRgRunner(createRgResolver(config, process.env, { signal }), { excludeGlobs: config.excludeGlobs, signal });
  const hostFs = createFs({ assertInside, signal });
  return {
    search: createSearch({ rgRunner, assertInside, caps: config.searchCaps }),
    fs: hostFs,
    read_file: hostFs.read_file,
    write_file: hostFs.write_file,
    edit_file: hostFs.edit_file,
    apply_patch: createApplyPatch({ write_file: hostFs.write_file, edit_file: hostFs.edit_file }),
    actions: createActions(),
    browse: createBrowse({ config, signal, assertInside }),
    report: createReport({ config, signal, assertInside }),
    api: createApiNamespace(),
  };
}
