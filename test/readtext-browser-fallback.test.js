// Issue #39: readText trusted the browser item while discarding the enclosing run's
// completeness. A capped fullText read therefore became complete:true at the consumer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createActions } from '../src/host/actions.js';
import { BROWSE_ACTIONS } from '../src/host/browse/actions-schema.js';
import { createReadText, SHELL_ELEMENT_FLOOR } from '../src/host/browse/read-text.js';

const URL = 'https://example.test/app';

test('browser fallback preserves an incomplete truncated run', async () => {
  const shell = '<main>' + '<div></div>'.repeat(SHELL_ELEMENT_FLOOR) + '</main>';
  const fetchImpl = async () => ({
    status: 200,
    headers: { get: () => 'text/html' },
    text: async () => shell,
    url: URL,
  });
  const browse = {
    exec: async () => ({
      complete: false,
      truncated: true,
      lostTo: ['text-truncated'],
      items: [{ ok: true, text: 'rendered browser text' }],
    }),
  };

  const out = await createReadText({ fetchImpl, browse })(URL, { fresh: true });

  assert.equal(out.source, 'browser');
  assert.equal(out.ok, true);
  assert.equal(out.text, 'rendered browser text');
  assert.equal(out.complete, false);
  assert.deepEqual(out.lostTo, ['text-truncated']);
});

test('both readText discovery signatures declare completeness and content shape', () => {
  const canonical = BROWSE_ACTIONS.find((entry) => entry.path === 'browse.readText');
  const projected = createActions().describe('browse.readText');

  for (const [name, entry] of [['canonical', canonical], ['projected', projected]]) {
    assert.match(entry.signature, /\bcomplete\b/, name + ' signature omitted complete');
    assert.match(entry.signature, /\bcontentShape\?/, name + ' signature omitted contentShape');
  }
});
