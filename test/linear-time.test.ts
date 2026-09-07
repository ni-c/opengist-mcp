import { describe, expect, it, vi } from 'vitest';

import { readGists, stringOf } from '../src/boundary.js';
import { loadConfig } from '../src/config.js';
import { parsePagination } from '../src/pagination.js';
import { cleanText, redactUrl, upstreamText } from '../src/text.js';

/**
 * Every function that walks text the instance or the operator chose, timed at
 * its ceiling. The limit is a band between two answers, not a budget: the
 * quadratic forms cost seconds here, the linear ones milliseconds, and the
 * measurement is the fastest of three runs so noise can only add.
 */

const LIMIT_MS = 1000;
const ESC = String.fromCharCode(27);

function fastestOf(work: () => void, runs = 3): number {
  let best = Number.POSITIVE_INFINITY;
  for (let run = 0; run < runs; run++) {
    const start = process.hrtime.bigint();
    work();
    const took = Number(process.hrtime.bigint() - start) / 1e6;
    best = Math.min(best, took);
  }
  return best;
}

describe('linear at the ceiling', () => {
  it('OPENGIST_URL with 80 000 slashes that are not at the end', () => {
    // `/\/+$/` was tried from every position of the run: 1.6 s here.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const url = `https://g.test/${'/'.repeat(80_000)}api`;
    expect(
      fastestOf(() => {
        loadConfig({ OPENGIST_URL: url, OPENGIST_TOKEN: 'og_x' });
      })
    ).toBeLessThan(LIMIT_MS);
    vi.restoreAllMocks();
  });

  it('cleanText on an 8 MiB body, with and without control characters', () => {
    const clean = 'a'.repeat(8 * 1024 * 1024);
    const dirty = `${'a'.repeat(999)}${ESC}`.repeat(8 * 1024);
    expect(fastestOf(() => cleanText(clean))).toBeLessThan(LIMIT_MS);
    expect(fastestOf(() => cleanText(dirty))).toBeLessThan(LIMIT_MS);
    expect(cleanText(dirty)).not.toContain(ESC);
  });

  it('upstreamText on an 8 MiB error body', () => {
    const body = `${ESC}x`.repeat(4 * 1024 * 1024);
    expect(fastestOf(() => upstreamText(body))).toBeLessThan(LIMIT_MS);
  });

  it('redactUrl on a 100 000-character authority', () => {
    const noAt = `https://${'a'.repeat(100_000)}/`;
    const allAt = `https://${'@'.repeat(100_000)}/`;
    expect(fastestOf(() => redactUrl(noAt))).toBeLessThan(LIMIT_MS);
    expect(fastestOf(() => redactUrl(allAt))).toBeLessThan(LIMIT_MS);
  });

  it('a 100 000-character Link header', () => {
    const link = `<http://x/?${'&'.repeat(100_000)}>; rel="next"`;
    const headers = { get: (name: string) => (name === 'link' ? link : null) };
    expect(fastestOf(() => parsePagination(headers, 1, 30))).toBeLessThan(
      LIMIT_MS
    );
  });

  it('stringOf on an 8 MiB description', () => {
    const text = 'd'.repeat(8 * 1024 * 1024);
    expect(fastestOf(() => stringOf(text))).toBeLessThan(LIMIT_MS);
  });

  it('readGists over 100 000 entries', () => {
    const entries = Array.from({ length: 100_000 }, (_, i) => ({
      id: `g${i}`,
      title: 't',
      topics: ['a'],
      files: { 'a.txt': { filename: 'a.txt' } },
    }));
    expect(fastestOf(() => readGists(entries), 1)).toBeLessThan(LIMIT_MS);
  });
});
