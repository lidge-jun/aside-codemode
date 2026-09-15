// A documentation and install regression, and nothing more. It checks that the guidance an
// installed account receives still tells an agent to stay native for a first look or a single
// click - the sentence, not the behaviour. It is deliberately NOT named after G5: whether a
// model reads that sentence, chooses the right path, keeps the answer correct and avoids a
// detour is a session nobody has run, and a string match must never stand in for it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { plannedFiles, agentsBody } from '../scripts/install-codemode.mjs';
import { TOOL_DEF } from '../src/tools.js';

const ACCOUNT = '/Users/someone/.aside/u/0';
const rendered = () => {
  const files = plannedFiles({ node: '/abs/node', cli: '/repo/bin/codemode.mjs', accountRoot: ACCOUNT });
  return {
    skill: files.find((f) => f.path.endsWith('SKILL.md')).content,
    agents: agentsBody({ node: '/abs/node', cli: '/repo/bin/codemode.mjs', accountRoot: ACCOUNT }),
    files,
    ref: (name) => {
      const hit = files.find((f) => f.path.endsWith('references/' + name));
      assert.ok(hit, name + ' is not one of the files an install writes');
      return hit.content;
    },
  };
};

test('the installed skill still says native first, and when not to batch', () => {
  const { skill } = rendered();
  const flat = skill.replace(/\s+/g, ' ');
  assert.match(flat, /Native first/i);
  assert.match(flat, /single click/i);
  assert.match(flat, /do not depend on each other|do not share/i);
});

test('the managed block routes rather than insists', () => {
  const { agents } = rendered();
  const flat = agents.replace(/\s+/g, ' ');
  assert.match(flat, /Native is the default/i);
  assert.match(flat, /ignore this block/i);
});

test('neither document claims the usability gate was run', () => {
  const { skill, agents } = rendered();
  for (const doc of [skill, agents]) {
    assert.equal(/\bG5\b/.test(doc), false, 'a gate nobody ran must not be advertised to an account');
  }
});

// The friction an agent actually hit in 0.2.0 was never wrong behaviour; it was a first call
// made against a shape nobody had written down. These pin the writing-down, not the reading.
test('an install carries the call-shapes reference, and the skill points at it', () => {
  const { skill, ref } = rendered();
  const shapes = ref('call-shapes.md');
  assert.match(skill, /references\/call-shapes\.md/);
  assert.match(shapes, /EGUESTIMPORT/);
  assert.match(shapes, /search\.files/);
  assert.match(shapes, /skippedSymlinks/);
  assert.match(shapes, /--enable-browse/);
});

test('the guest sandbox is described before it refuses, in both the block and the reference', () => {
  const { agents, ref } = rendered();
  const paths = ref('execution-paths.md');
  for (const doc of [agents, paths]) {
    const flat = doc.replace(/\s+/g, ' ');
    assert.match(flat, /EGUESTIMPORT/);
    assert.match(flat, /read_file/);
    assert.match(flat, /apply_patch/);
  }
  assert.match(agents, /--enable-browse/);
});

test('readText and attach are in the tool description, with the field readText answers with', () => {
  const doc = TOOL_DEF.description;
  assert.match(doc, /browse\.readText/);
  assert.match(doc, /browse\.attach/);
  assert.match(doc, /treeNodes/);
  assert.match(doc, /no module loader/i);
});
