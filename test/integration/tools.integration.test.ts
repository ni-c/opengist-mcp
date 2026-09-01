import {
  expectEveryToolExercised,
  startServer,
  toolCoverage,
  tokenOf,
  type LiveHarness,
} from 'mcp-integration-harness';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ALL_TOOLS } from '../../src/tools/catalogue.js';
import { bootstrap, USERNAME, type Sandbox } from './bootstrap.js';

/**
 * Every tool in the catalogue, against a real Opengist in Docker.
 *
 * Opengist stores each gist as a git repository, which is the part a stubbed
 * `fetch` cannot represent: a commit exists, a fork is a real clone, a file
 * rename is a tree change. All three are asserted here against the thing that
 * did them.
 *
 * Order matters and state is shared — a gist created at the top is edited,
 * forked, liked and finally deleted further down.
 */

let sandbox: Sandbox;
/** Declares elicitation, so guarded tools go through the real dialog. */
let asking: LiveHarness;
/** Declares none, so the same tools fall back to the two-call token. */
let plain: LiveHarness;
/** The second account. Opengist refuses to fork a gist to its own owner. */
let other: LiveHarness;

let gistId: string;
let forkId: string;

function parse<T>(text: string): T {
  const start = text.search(/[[{]/);
  if (start === -1) throw new Error(`no JSON in result: ${text.slice(0, 300)}`);
  return JSON.parse(text.slice(start)) as T;
}

interface Gist {
  uuid?: string;
  id?: string;
  title?: string;
  visibility?: string;
  files?: { filename: string }[];
}

beforeAll(async () => {
  sandbox = await bootstrap();
  asking = await startServer({ env: sandbox.env, elicit: 'accept' });
  plain = await startServer({ env: sandbox.env });
  other = await startServer({ env: sandbox.other.env, elicit: 'accept' });
}, 600_000);

afterAll(async () => {
  await asking?.close();
  await plain?.close();
  await other?.close();
});

describe('the account', () => {
  it('reports the user the token belongs to', async () => {
    const user = await asking.call('get_user', { username: USERNAME });
    expect(user).toContain(USERNAME);
  });
});

describe('a gist through its whole life', () => {
  it('creates one, and the files come back as a keyed map', async () => {
    // The tools take an array of files; Opengist's API wants a map keyed by
    // filename. The translation only matters against the real thing.
    const created = parse<Gist>(
      await asking.call('create_gist', {
        title: 'Integration gist',
        description: 'Created by the integration suite.',
        visibility: 'public',
        files: [
          { filename: 'first.txt', content: 'first content\n' },
          { filename: 'second.txt', content: 'second content\n' },
        ],
      })
    );
    gistId = created.id ?? '';
    expect(gistId).not.toBe('');

    const fetched = parse<Gist>(await asking.call('get_gist', { gistId }));
    expect(fetched.files?.map((f) => f.filename).sort()).toEqual([
      'first.txt',
      'second.txt',
    ]);
  });

  it('lists it under the account that owns it', async () => {
    const mine = await asking.call('list_gists', { scope: 'mine' });
    expect(mine).toContain('Integration gist');
  });

  it('reads one file back, byte for byte', async () => {
    const file = await asking.call('get_gist_file', {
      gistId,
      filename: 'first.txt',
    });
    expect(file).toContain('first content');
  });

  it('has a commit, because a gist is a git repository', async () => {
    // Nothing about this is visible through a stub: Opengist committed the
    // files, so there is history from the first write onwards.
    const commits = await asking.call('list_gist_commits', { gistId });
    expect(commits).toContain('"commits"');
    const parsed = parse<{ commits: unknown[] }>(commits);
    expect(parsed.commits.length).toBeGreaterThan(0);
  });

  it('edits a file and renames another', async () => {
    // `fileOps`, not `files` — `create_gist` takes `files` and `update_gist`
    // takes `fileOps`, and passing the wrong one is not an error. The unknown
    // key is dropped, the other fields apply, and the file changes silently
    // do not happen.
    await asking.call('update_gist', {
      gistId,
      description: 'Edited by the integration suite.',
      fileOps: [
        { op: 'write', filename: 'first.txt', content: 'rewritten\n' },
        {
          op: 'rename',
          filename: 'second.txt',
          newFilename: 'renamed.txt',
        },
      ],
    });
    const after = parse<Gist>(await asking.call('get_gist', { gistId }));
    expect(after.files?.map((f) => f.filename).sort()).toEqual([
      'first.txt',
      'renamed.txt',
    ]);
    expect(
      await asking.call('get_gist_file', { gistId, filename: 'first.txt' })
    ).toContain('rewritten');
  });

  it('deletes one of its files', async () => {
    await asking.call('delete_gist_files', {
      gistId,
      filenames: ['renamed.txt'],
    });
    const after = parse<Gist>(await asking.call('get_gist', { gistId }));
    expect(after.files?.map((f) => f.filename)).toEqual(['first.txt']);
  });
});

describe('forks and likes', () => {
  it('refuses to fork a gist to its own owner', async () => {
    // Opengist answers 422 "cannot fork your own gist". Which is why the
    // second account exists: without it, `fork_gist` and `list_gist_forks`
    // could not be exercised at all.
    const refused = await asking.call(
      'fork_gist',
      { gistId },
      { expectError: true }
    );
    expect(refused).toContain('cannot fork your own gist');
  });

  it('forks it as another user, which is a real clone', async () => {
    const fork = parse<Gist>(await other.call('fork_gist', { gistId }));
    forkId = fork.id ?? '';
    expect(forkId).not.toBe('');
    expect(forkId).not.toBe(gistId);
    // The fork carries the files, because Opengist cloned the repository.
    const cloned = parse<Gist>(
      await other.call('get_gist', { gistId: forkId })
    );
    expect(cloned.files?.map((f) => f.filename)).toContain('first.txt');

    const forks = parse<{ forks: unknown[] }>(
      await asking.call('list_gist_forks', { gistId })
    );
    expect(forks.forks.length).toBeGreaterThan(0);
  });

  it('likes and unlikes, and says which state it is in', async () => {
    // The like tools are a pair, and the interesting half is `check` — a stub
    // can only ever agree with whatever `set` claimed to do.
    expect(await asking.call('check_gist_like', { gistId })).toContain('false');
    await asking.call('set_gist_like', { gistId, liked: true });
    expect(await asking.call('check_gist_like', { gistId })).toContain('true');
    await asking.call('set_gist_like', { gistId, liked: false });
    expect(await asking.call('check_gist_like', { gistId })).toContain('false');
  });
});

describe('search', () => {
  it('finds the gist by its title, and says it never looked in the files', async () => {
    // Opengist has **no search API**. This tool scans the list endpoints
    // client-side over title, description and topics, and says so in its own
    // result — so a query matching only file content finds nothing, and that
    // is the behaviour rather than a bug.
    const found = parse<{ matches: { id?: string }[]; notes: string[] }>(
      await asking.call('search_gists', { query: 'Integration gist' })
    );
    expect(found.matches.map((m) => m.id)).toContain(gistId);
    expect(found.notes.join(' ')).toContain('no search API');

    const byContent = parse<{ matches: unknown[] }>(
      await asking.call('search_gists', { query: 'rewritten' })
    );
    expect(byContent.matches).toHaveLength(0);
  });
});

describe('the fallback path for a client with no dialog', () => {
  it('deletes only after the token comes back', async () => {
    const refusal = await plain.call('delete_gist', { gistId });
    expect(refusal).toContain('confirm_token');
    expect(plain.prompts).toHaveLength(0);
    // Still there: the first call is a question.
    await plain.call('get_gist', { gistId });

    await plain.call('delete_gist', {
      gistId,
      confirm_token: tokenOf(refusal),
    });
    await plain.call('get_gist', { gistId }, { expectError: true });
  });

  it('asked a person on one harness and nobody on the other', () => {
    expect(asking.prompts.length).toBeGreaterThan(0);
    expect(plain.prompts).toHaveLength(0);
  });
});

describe('cleaning up', () => {
  it('deletes the fork, from the account that owns it', async () => {
    await other.call('delete_gist', { gistId: forkId });
  });
});

it('exercises every tool in the catalogue', () => {
  const called = new Set([...asking.called, ...plain.called, ...other.called]);
  const report = toolCoverage({ called }, ALL_TOOLS, {});
  console.log(
    `opengist-mcp: ${report.called.length}/${ALL_TOOLS.length} tools against a real Opengist`
  );
  expectEveryToolExercised({ called }, ALL_TOOLS, {});
});
