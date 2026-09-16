// A wrong first call is the most common failure this tool has, and it is not a bug in the
// guest: it is a guess about a name. Measured over 371 real runs, the two most frequent
// were `actions` used as a dispatcher (actions.fs.search, actions.call) and the Aside REPL
// or Node file names (fs.readFile, fs.readdir). Both arrived as a blind JavaScript error
// that named nothing.
//
// This table lives on the GUEST side on purpose. The host hands the worker a manifest of
// method names, not its objects, so a proxy or a stub added to the host is rebuilt away
// before guest code can reach it. Anything meant to teach the author of the script has to
// be attached where the script runs.

// Namespaces the guest can call directly. Reading one of these off `actions` means the
// author took the discovery API for a dispatcher.
const NAMESPACE_CALLS = {
  fs: ['fs.read(path)', 'fs.read'],
  search: ['search.content({ path, query })', 'search.content'],
  browse: ['browse.exec({ urls })', 'browse.exec'],
  api: ['api.batch(requests)', 'api.batch'],
  report: ['report.build(options)', 'report.build'],
  recipes: ['recipes.run(name, input)', 'recipes.run'],
  read_file: ['read_file({ path })', 'read_file'],
  write_file: ['write_file({ file_path, content })', 'write_file'],
  edit_file: ['edit_file({ path, edits })', 'edit_file'],
  apply_patch: ['apply_patch(text)', 'apply_patch'],
};

// Names for a generic "run this action" entry point, which does not exist: an action is
// called by its own name.
const DISPATCHER_GUESSES = ['call', 'run', 'invoke', 'exec', 'execute', 'dispatch', 'get', 'describeAll'];

// Names from the two neighbouring file APIs the same agent uses in the same session: the
// Aside REPL's `fs` and Node's. Each answer names the guest call that does the job.
const FILE_NAMES = {
  readFile: 'use fs.read(path) for bytes, or read_file({ path, offset, limit }) for a one-indexed line window',
  readFileSync: 'the guest file API is async: await fs.read(path)',
  writeFile: 'use write_file({ file_path, content }) to create, or fs.write(path, content) to overwrite',
  writeFileSync: 'the guest file API is async: await fs.write(path, content)',
  appendFile: 'use edit_file({ path, appendText })',
  readdir: 'use fs.list(path)',
  readdirSync: 'the guest file API is async: await fs.list(path)',
  statSync: 'the guest file API is async: await fs.stat(path)',
  existsSync: 'the guest file API is async: await fs.exists(path)',
  unlink: 'the guest cannot delete files',
  rm: 'the guest cannot delete files',
  rmdir: 'the guest cannot delete directories',
  copyFile: 'read it with fs.read(path) and write the copy with write_file({ file_path, content })',
  createReadStream: 'there are no streams: fs.read(path, { offset, maxBytes }) reads a window',
};

const REPL_FILE_NAMES = new Set(['readFile', 'writeFile']);

// Names borrowed from the neighbouring surfaces for the other two namespaces. The Aside REPL
// opens a tab with openTab and clicks through page, so those names arrive here too.
const OTHER_NAMES = {
  browse: {
    open: 'browse.exec({ urls }) opens the tab and drives it',
    openTab: 'openTab is the Aside REPL name; here a batch is browse.exec({ urls })',
    goto: 'browse.exec({ urls }) navigates',
    navigate: 'browse.exec({ urls }) navigates',
    screenshot: 'browse.captureMany([url], { outDir, screenshot: true })',
    pdf: 'browse.captureMany([url], { outDir, pdf: { preferCSSPageSize: true } })',
    click: 'a click is a step: browse.exec({ urls, actions: [{ ref, click: true }], approveWrites: true })',
  },
  search: {
    grep: 'search.content({ path, query })',
    find: 'search.files({ path, glob })',
    glob: 'search.files({ path, glob })',
    ripgrep: 'search.content({ path, query })',
  },
};

// Property reads that must stay silent. A trap that throws on these turns an ordinary
// await, a JSON serialization or an inspection into a failure that has nothing to do with
// the script. Function names like `call` and `bind` are deliberately NOT here: every
// namespace is a plain object, so reading `actions.call` is a dispatcher guess, not
// reflection.
const RESERVED = new Set([
  'then', 'catch', 'finally', 'constructor', 'prototype', 'toJSON', 'toString', 'valueOf',
  'inspect', 'nodeType',
]);

function guidanceError(message, code = 'EGUESTNAME') {
  const error = new Error(message);
  error.code = code;
  return error;
}

// The sentence a wrong name gets, or null when the name is not one this table knows.
export function adviseName(namespace, property, members) {
  if (namespace === 'actions') {
    const call = NAMESPACE_CALLS[property];
    if (call) {
      return `actions is discovery only; call ${call[0]} directly, and use actions.describe('${call[1]}') to look it up first`;
    }
    if (DISPATCHER_GUESSES.includes(property)) {
      return "actions has no generic caller; run the action by its own name, for example browse.exec({ urls }), and use actions.check(path, args) to validate the call without making it";
    }
  }
  if (namespace === 'fs' && Object.hasOwn(FILE_NAMES, property)) {
    const origin = REPL_FILE_NAMES.has(property)
      ? `fs.${property} is the Aside REPL name, not the guest's`
      : `fs.${property} does not exist in the guest`;
    return `${origin}; ${FILE_NAMES[property]}`;
  }
  const borrowed = OTHER_NAMES[namespace]?.[property];
  if (borrowed) {
    const has = members.length ? `; ${namespace} has ${members.join(', ')}` : '';
    return `${namespace}.${property} does not exist; use ${borrowed}${has}`;
  }
  return null;
}

// `actions.list()` is synchronous and returns an array. Awaiting it is harmless, but
// `.catch()` on it is a TypeError that reads like the call failed.
function teachSynchronous(rows, call) {
  if (!Array.isArray(rows)) return rows;
  const refuse = () => {
    throw guidanceError(`${call} is synchronous and returns an array; drop the await and the .catch()`, 'EGUESTNAME');
  };
  for (const name of ['catch', 'finally']) {
    Object.defineProperty(rows, name, { value: refuse, enumerable: false, configurable: true });
  }
  return rows;
}

// Wrap each injected namespace so a name this table knows about says what to call instead.
//
// Only names in the table throw. An unknown property that nobody is known to reach for still
// reads as `undefined`, because guest scripts legitimately probe for a capability
// (`if (browse.watch)`, `browse.watch?.()`) and a version-tolerant script would otherwise
// crash on the check rather than take its fallback. A listing of the real members is worth
// less than not breaking correct code, and a wrong name outside the table still fails on the
// line that calls it, naming itself.
export function teachNamespaces(injected) {
  for (const namespace of Object.keys(injected)) {
    const target = injected[namespace];
    if (!target || typeof target !== 'object') continue;
    const members = Object.keys(target).sort();
    if (namespace === 'actions' && typeof target.list === 'function') {
      const list = target.list;
      target.list = (...args) => teachSynchronous(list(...args), 'actions.list()');
      const find = target.find;
      if (typeof find === 'function') target.find = (...args) => teachSynchronous(find(...args), 'actions.find()');
    }
    injected[namespace] = new Proxy(Object.freeze(target), {
      get(object, property, receiver) {
        if (typeof property !== 'string' || Reflect.has(object, property) || RESERVED.has(property)) {
          return Reflect.get(object, property, receiver);
        }
        const advice = adviseName(namespace, property, members);
        if (advice === null) return undefined;
        throw guidanceError(advice);
      },
    });
  }
  return injected;
}
