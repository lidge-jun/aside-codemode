import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { makeRootGuard } from '../src/paths.js';
import { createFs } from '../src/host/fs.js';

test('fs.read discloses bytes skipped from an unaligned UTF-8 offset', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'codemode-read-offset-'));
  const target = path.join(root, 'utf8.txt');
  writeFileSync(target, 'A🧪B한C');
  const fs = createFs({ assertInside: makeRootGuard([root]) });

  const text = await fs.read(target, { offset: 2, maxBytes: 100 });

  assert.equal(text, 'B한C\n[range began mid-character: skipped 3 bytes]');
  assert.ok(!text.includes('\uFFFD'), 'an unaligned offset must not silently invent replacement characters');
});
