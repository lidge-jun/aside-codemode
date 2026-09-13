// Stage one cooperating write next to its target, then atomically replace it.
// The caller holds the canonical file lock across read/validate/commit. Only
// this invocation's exclusively-created staging file is ever cleaned up.
import { stat, open, chmod, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

export async function replaceAtomically(target, content, { signal } = {}) {
  signal?.throwIfAborted();
  let mode;
  try { mode = (await stat(target)).mode & 0o777; }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  const tmp = path.join(path.dirname(target), `.codemode-${randomUUID()}.tmp`);
  let owned = false;
  try {
    signal?.throwIfAborted();
    const handle = await open(tmp, 'wx', mode ?? 0o666);
    owned = true;
    try { await handle.writeFile(content, { encoding: 'utf8', signal }); }
    finally { await handle.close(); }
    if (mode !== undefined) await chmod(tmp, mode);
    signal?.throwIfAborted();
    await rename(tmp, target);
    owned = false;
  } finally {
    if (owned) await unlink(tmp).catch(e => { if (e.code !== 'ENOENT') throw e; });
  }
  return { bytes: Buffer.byteLength(content) };
}

