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

// Browsing is on by default, so the account-wide block should not send anyone looking for a
// switch. The command still has to be findable, because a machine CAN turn browsing off and
// the person who meets EDISABLED needs the way back - it just belongs in the reference.
test('the block promises browsing works, and the reference carries the way back', () => {
  const { agents, ref } = rendered();
  assert.equal(/--enable-browse/.test(agents), false, 'the block asks for a step that is no longer needed');
  assert.match(agents, /EDISABLED/);
  assert.match(ref('call-shapes.md'), /--enable-browse/);
});

test('the guest sandbox is described before it refuses, in both the block and the reference', () => {
  const { agents, ref } = rendered();
  const paths = ref('execution-paths.md');
  for (const doc of [agents, paths]) {
    const flat = doc.replace(/\s+/g, ' ');
    assert.match(flat, /EGUESTIMPORT/);
    assert.match(flat, /read_file/);
    assert.match(flat, /apply_patch/);
    // Measured against the worker, not guessed: console is injected, so a list that omits
    // it sends an agent looking for a print that is already there.
    assert.match(flat, /console/);
    assert.match(flat, /setTimeout/);
  }
});

test('readText and attach are in the tool description, with the field readText answers with', () => {
  const doc = TOOL_DEF.description;
  assert.match(doc, /browse\.readText/);
  assert.match(doc, /browse\.attach/);
  assert.match(doc, /treeNodes/);
  assert.match(doc, /no module loader/i);
});

// Four things an agent got wrong in real sessions, each because the block did not say them.
// The line budget itself lives in readme-51x.test.js, which has held it since the split.
test('the block carries the session rule rather than telling an agent to avoid logins', () => {
  const { agents } = rendered();
  const flat = agents.replace(/\s+/g, ' ');
  // Sessions ARE inherited. An earlier block read as though a signed-in site could not be
  // batched at all, which sealed off the strongest thing this tool does.
  assert.match(flat, /sign in natively first/i);
  assert.match(flat, /loggedInMarker/);
  // And the failure mode that makes the rule necessary.
  assert.match(flat, /expires partway|login page/i);
});

test('the block says a successful call is not a correct result', () => {
  const { agents, skill } = rendered();
  const flat = agents.replace(/\s+/g, ' ');
  assert.match(flat, /`ok`, `completed`, HTTP 200 and `contentVerified`/);
  assert.match(flat, /None of them says the page holds what you asked for/i);
  // The skill owns the same rule at length, because the block cannot afford the detail.
  assert.match(skill.replace(/\s+/g, ' '), /completed .*does not mean|success signals/i);
});

test('the block gives the routing test, not just the routing rule', () => {
  const { agents } = rendered();
  const flat = agents.replace(/\s+/g, ' ');
  assert.match(flat, /open API or a server-rendered page is a fetch/i);
  assert.match(flat, /deleting the script tags/i);
});

// The ban existed and the replacement did not, so an agent read a prohibition with no way
// out and reached for the shell anyway. They belong in one sentence.
test('the search ban names its replacement in the same breath', () => {
  const { agents } = rendered();
  const sentence = agents.split(/\n\s*\n/).find((p) => /Do not call `rg`/.test(p));
  assert.ok(sentence, 'the block no longer bans the shell search commands');
  for (const api of ['search.content', 'fs.stat', 'fs.grepFile']) {
    assert.ok(sentence.includes(api), api + ' is not offered where the ban is stated');
  }
});

test('reading describe is a step before the first call, not a recovery from a refusal', () => {
  const { agents } = rendered();
  const flat = agents.replace(/\s+/g, ' ');
  assert.match(flat, /actions\.describe.? before the first call/i);
  assert.match(flat, /actions\.check/);
});
