// What happens past the envelope.
//
// The suite pins two things about the wire budget elsewhere: that the ordinary jobs fit the
// tightest command line any host has, and that the bigger legal combinations do not. This
// file asserts the consequence - a job that does not fit is refused by name, before a
// process exists, with a message that says what to drop and where the limit came from.
//
// The failure it replaces was a platform error naming nothing: spawn ENAMETOOLONG, found on
// a Windows host rather than in a test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowseSession } from '../src/host/browse/session.js';
import { WIRE_LIMIT, WIRE_LIMIT_PORTABLE } from '../src/host/browse/script.js';

const never = (what) => async () => { throw new Error('the refusal let the run reach ' + what); };
const session = () => createBrowseSession({ resolveAside: never('resolveAside'), spawnAside: never('spawnAside') });

// Enough urls that no reclamation could make it fit: the payload alone is the size of the
// script. Built from a count rather than a fixed list so it scales with the limit.
const tooMany = (n) => Array.from({ length: n }, (_, i) => 'https://example.test/a-fairly-long-path-segment/' + i);

test('a job that cannot fit the command line is refused before anything starts', async () => {
  const run = session().run({ urls: tooMany(400), snapshot: 'interactive' });
  await assert.rejects(run, (e) => {
    assert.equal(e.code, 'ESOURCETOOLONG');
    // The three things a caller needs: how big it was, what the ceiling is, and what to drop.
    assert.match(e.message, /\d{5,} characters/);
    assert.match(e.message, new RegExp(String(WIRE_LIMIT)));
    assert.match(e.message, /drop helper, snapshot, actions or some urls/);
    // And which host decided, since the ceiling is not the same everywhere.
    assert.match(e.message, new RegExp(process.platform));
    const urls = tooMany(400);
    assert.match(e.message, new RegExp(`urls total ${urls.reduce((sum, url) => sum + url.length, 0)} characters`));
    assert.match(e.message, /longest url is \d+ characters with scheme https/);
    return true;
  });
});

test('an oversized data url says the document is on the wire and names the loopback replacement', async () => {
  const url = 'data:text/html,' + 'x'.repeat(WIRE_LIMIT);
  await assert.rejects(session().run({ urls: [url] }), (e) => {
    assert.equal(e.code, 'ESOURCETOOLONG');
    assert.match(e.message, new RegExp(`urls total ${url.length} characters`));
    assert.match(e.message, new RegExp(`longest url is ${url.length} characters with scheme data`));
    assert.match(e.message, /the document itself is on the wire, so serve it over http from loopback instead/);
    return true;
  });
});

test('the same ceiling guards the raw entry point', async () => {
  // browse.search and browse.attach go through session.raw with their own compiled source,
  // and that entry point used to skip the check entirely - a caller who injected a helper
  // found out by way of an error from the operating system.
  const run = session().raw('x'.repeat(WIRE_LIMIT + 1));
  await assert.rejects(run, (e) => {
    assert.equal(e.code, 'ESOURCETOOLONG');
    // The same four things the job path promises. Checking only the code here would have
    // let this message drift into saying less than the contract claims it says.
    assert.match(e.message, new RegExp(String(WIRE_LIMIT + 1) + ' characters'));
    assert.match(e.message, new RegExp(String(WIRE_LIMIT) + ' wire limit'));
    assert.match(e.message, new RegExp(process.platform));
    assert.match(e.message, /send less source or split the work/);
    return true;
  });
});

test('the ceiling is the platform\u2019s, and the portable envelope is not', () => {
  // Two numbers on purpose. WIRE_LIMIT is what this host will actually send; the portable
  // one is what this tool promises everywhere, and the ordinary jobs are pinned against it
  // in browse-tabs so a job that works here works on a Windows host too.
  assert.equal(WIRE_LIMIT, process.platform === 'win32' ? 30000 : 50000);
  assert.equal(WIRE_LIMIT_PORTABLE, 30000);
  assert.ok(WIRE_LIMIT >= WIRE_LIMIT_PORTABLE,
    'the portable envelope has to fit inside whatever this host allows, or the promise is empty here');
});

test('an ordinary job gets past the size check', async () => {
  // The negative control. Without it every assertion above would still pass if run() refused
  // everything, which is a shape this session has already been bitten by twice. It reaches
  // resolveAside and stops there, which is as far as a session with no real binary goes -
  // far enough to show the size check let it through, and no further.
  const run = session().run({ urls: ['https://example.test/1'] });
  await assert.rejects(run, /the refusal let the run reach resolveAside/,
    'an ordinary job must get past the size check');
});
