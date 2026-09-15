// A documentation and install regression, and nothing more. It checks that the guidance an
// installed account receives still tells an agent to stay native for a first look or a single
// click - the sentence, not the behaviour. It is deliberately NOT named after G5: whether a
// model reads that sentence, chooses the right path, keeps the answer correct and avoids a
// detour is a session nobody has run, and a string match must never stand in for it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { plannedFiles, agentsBody } from '../scripts/install-codemode.mjs';

const ACCOUNT = '/Users/someone/.aside/u/0';
const rendered = () => {
  const files = plannedFiles({ node: '/abs/node', cli: '/repo/bin/codemode.mjs', accountRoot: ACCOUNT });
  return {
    skill: files.find((f) => f.path.endsWith('SKILL.md')).content,
    agents: agentsBody({ node: '/abs/node', cli: '/repo/bin/codemode.mjs', accountRoot: ACCOUNT }),
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
