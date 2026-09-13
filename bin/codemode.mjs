#!/usr/bin/env node
// Global entry point: `codemode --code '<js>'` / `codemode --doctor`.
// Resolves the CLI relative to this file so a globally linked bin keeps
// working regardless of the caller's cwd.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
await import(pathToFileURL(path.join(here, '..', 'src', 'cli.js')).href);
