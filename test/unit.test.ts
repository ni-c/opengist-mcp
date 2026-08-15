import { describe, expect, it, vi } from 'vitest';

import { ConfirmationStore } from '../src/confirm.js';
import { parsePagination } from '../src/pagination.js';
import { buildFilesPayload, looksBinary, Notes } from '../src/shape.js';

function headers(values: Record<string, string>): {
  get(name: string): string | null;
} {
  return { get: (name) => values[name.toLowerCase()] ?? null };
}

describe('parsePagination', () => {
  it('prefers the X-* headers', () => {
    expect(
      parsePagination(
        headers({
          'x-page': '2',
          'x-per-page': '30',
          'x-total': '137',
          'x-total-pages': '5',
        }),
        1,
        30
      )
    ).toEqual({
      page: 2,
      perPage: 30,
      total: 137,
      totalPages: 5,
      nextPage: 3,
      prevPage: 1,
    });
  });

  it('derives the next page from the Link header when totals are missing', () => {
    const pagination = parsePagination(
      headers({
        'x-page': '1',
        'x-per-page': '30',
        link: '<http://x/api/gists?page=2&per_page=30>; rel="next"',
      }),
      1,
      30
    );
    expect(pagination.total).toBeNull();
    expect(pagination.totalPages).toBeNull();
    expect(pagination.nextPage).toBe(2);
    expect(pagination.prevPage).toBeNull();
  });

  it('falls back to the requested values when headers are absent', () => {
    expect(parsePagination(headers({}), 3, 50)).toEqual({
      page: 3,
      perPage: 50,
      total: null,
      totalPages: null,
      nextPage: null,
      prevPage: 2,
    });
  });

  it('ignores malformed header values', () => {
    const pagination = parsePagination(
      headers({ 'x-page': 'nope', 'x-total': '-5', 'x-total-pages': 'x' }),
      1,
      30
    );
    expect(pagination.page).toBe(1);
    expect(pagination.total).toBeNull();
    expect(pagination.totalPages).toBeNull();
  });

  it('reports no next page on the last page', () => {
    const pagination = parsePagination(
      headers({ 'x-page': '5', 'x-per-page': '30', 'x-total-pages': '5' }),
      5,
      30
    );
    expect(pagination.nextPage).toBeNull();
  });
});

describe('looksBinary', () => {
  it('detects a NUL byte', () => {
    expect(looksBinary('PK\u0000\u0000')).toBe(true);
  });

  it('accepts text with newlines and tabs', () => {
    expect(looksBinary('line one\n\tindented\r\n')).toBe(false);
  });

  it('accepts empty content', () => {
    expect(looksBinary('')).toBe(false);
  });

  it('detects a high share of control characters', () => {
    expect(looksBinary('\u0001\u0002\u0003\u0004abc')).toBe(true);
  });
});

describe('Notes', () => {
  it('deduplicates', () => {
    const notes = new Notes();
    notes.add('a');
    notes.add('a');
    notes.addAll(['b', 'a']);
    expect(notes.list()).toEqual(['a', 'b']);
  });
});

describe('buildFilesPayload', () => {
  const existing = ['README.md', 'main.go'];

  it('writes an existing file', () => {
    const payload = buildFilesPayload(
      [{ op: 'write', filename: 'main.go', content: 'x' }],
      existing,
      false
    );
    expect(payload.files).toEqual({ 'main.go': { content: 'x' } });
    expect(payload.written).toEqual(['main.go']);
    expect(payload.created).toEqual([]);
  });

  it('renames without content', () => {
    const payload = buildFilesPayload(
      [{ op: 'rename', filename: 'main.go', newFilename: 'app.go' }],
      existing,
      false
    );
    expect(payload.files).toEqual({ 'main.go': { filename: 'app.go' } });
    expect(payload.renamed).toEqual([{ from: 'main.go', to: 'app.go' }]);
  });

  it('never produces an entry that the API would read as a deletion', () => {
    const payload = buildFilesPayload(
      [
        { op: 'rename', filename: 'main.go', newFilename: 'app.go' },
        { op: 'write', filename: 'README.md', content: 'x' },
      ],
      existing,
      false
    );
    for (const entry of Object.values(payload.files)) {
      expect(entry).not.toBeNull();
      expect(Object.keys(entry).length).toBeGreaterThan(0);
    }
  });

  it('passes empty content through as a blanked file, not a deletion', () => {
    // Verified against Opengist 2026-08-15: an update entry with content:""
    // keeps the file and empties it. Only an entry that is null or carries
    // neither content nor filename deletes — that is what the invariant blocks.
    const payload = buildFilesPayload(
      [{ op: 'write', filename: 'README.md', content: '' }],
      existing,
      false
    );
    expect(payload.files['README.md']).toEqual({ content: '' });
  });

  it('refuses an unknown filename and names the case-insensitive near match', () => {
    expect(() =>
      buildFilesPayload(
        [{ op: 'write', filename: 'readme.md', content: 'x' }],
        existing,
        false
      )
    ).toThrow(/README\.md/);
  });

  it('lists the existing files when there is no near match', () => {
    expect(() =>
      buildFilesPayload(
        [{ op: 'write', filename: 'nope.txt', content: 'x' }],
        existing,
        false
      )
    ).toThrow(/"README\.md", "main\.go"/);
  });

  it('creates a new file when allowCreate is set', () => {
    const payload = buildFilesPayload(
      [{ op: 'write', filename: 'new.txt', content: 'x' }],
      existing,
      true
    );
    expect(payload.created).toEqual(['new.txt']);
  });

  it('refuses two operations on the same file', () => {
    expect(() =>
      buildFilesPayload(
        [
          { op: 'write', filename: 'main.go', content: 'a' },
          { op: 'write', filename: 'main.go', content: 'b' },
        ],
        existing,
        false
      )
    ).toThrow(/Two operations/);
  });

  it('refuses renaming a file that does not exist', () => {
    expect(() =>
      buildFilesPayload(
        [{ op: 'rename', filename: 'nope.txt', newFilename: 'x.txt' }],
        existing,
        false
      )
    ).toThrow(/no such file/);
  });

  it('refuses a rename to the same name', () => {
    expect(() =>
      buildFilesPayload(
        [{ op: 'rename', filename: 'main.go', newFilename: 'main.go' }],
        existing,
        false
      )
    ).toThrow(/identical newFilename/);
  });

  it('refuses a rename onto an existing file', () => {
    expect(() =>
      buildFilesPayload(
        [{ op: 'rename', filename: 'main.go', newFilename: 'README.md' }],
        existing,
        false
      )
    ).toThrow(/collide/);
  });

  it('allows a swap where the collision target is renamed away too', () => {
    const payload = buildFilesPayload(
      [
        { op: 'rename', filename: 'main.go', newFilename: 'README.md' },
        { op: 'rename', filename: 'README.md', newFilename: 'old.md' },
      ],
      existing,
      false
    );
    expect(Object.keys(payload.files).sort()).toEqual(['README.md', 'main.go']);
  });

  it('refuses two operations producing the same target name', () => {
    expect(() =>
      buildFilesPayload(
        [
          { op: 'rename', filename: 'main.go', newFilename: 'same.txt' },
          { op: 'rename', filename: 'README.md', newFilename: 'same.txt' },
        ],
        existing,
        false
      )
    ).toThrow(/same\.txt/);
  });
});

describe('ConfirmationStore', () => {
  it('accepts the issued token exactly once', () => {
    const store = new ConfirmationStore();
    const token = store.issue('a');
    expect(store.consume('a', token)).toBe(true);
    expect(store.consume('a', token)).toBe(false);
  });

  it('rejects a wrong or missing token', () => {
    const store = new ConfirmationStore();
    const token = store.issue('a');
    expect(store.consume('a', undefined)).toBe(false);
    expect(store.consume('a', 'nope')).toBe(false);
    expect(store.consume('b', token)).toBe(false);
  });

  it('expires tokens', () => {
    vi.useFakeTimers();
    const store = new ConfirmationStore(1000);
    const token = store.issue('a');
    vi.advanceTimersByTime(1001);
    expect(store.consume('a', token)).toBe(false);
    vi.useRealTimers();
  });

  it('reports the TTL in minutes', () => {
    expect(new ConfirmationStore(5 * 60 * 1000).ttlMinutes).toBe(5);
  });

  it('bounds the number of pending tokens', () => {
    const store = new ConfirmationStore();
    const first = store.issue('resource-0');
    for (let i = 1; i <= 100; i++) store.issue(`resource-${i}`);
    expect(store.consume('resource-0', first)).toBe(false);
    expect(store.consume('resource-100', store.issue('resource-100'))).toBe(
      true
    );
  });
});
