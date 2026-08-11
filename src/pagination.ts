import type { ResponseHeaders } from './api.js';

export interface Pagination {
  page: number;
  perPage: number;
  /** null when the endpoint does not report totals (e.g. the commits endpoint). */
  total: number | null;
  totalPages: number | null;
  nextPage: number | null;
  prevPage: number | null;
}

function parseInteger(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

/**
 * Extracts the `page` query value of a `rel` link out of an RFC 5988 Link
 * header. Only the page number is used: the link URL itself is built by the
 * instance and may carry a different origin than the configured one, and
 * re-emitting it into the model context buys nothing over `nextPage: 3`.
 */
function pageFromLink(link: string | null, rel: string): number | null {
  if (!link) return null;
  for (const part of link.split(',')) {
    if (!new RegExp(`rel="${rel}"`).test(part)) continue;
    const match = /[?&]page=(\d+)/.exec(part);
    if (match?.[1] !== undefined) return Number(match[1]);
  }
  return null;
}

/**
 * Builds the pagination block from the `X-*` and `Link` response headers,
 * degrading gracefully when they are missing or malformed instead of throwing.
 */
export function parsePagination(
  headers: ResponseHeaders,
  requestedPage: number,
  requestedPerPage: number
): Pagination {
  const link = headers.get('link');
  const page = parseInteger(headers.get('x-page')) ?? requestedPage;
  const perPage = parseInteger(headers.get('x-per-page')) ?? requestedPerPage;
  const total = parseInteger(headers.get('x-total'));
  const totalPages = parseInteger(headers.get('x-total-pages'));

  const nextFromLink = pageFromLink(link, 'next');
  const nextPage =
    nextFromLink ??
    (totalPages !== null && page < totalPages ? page + 1 : null);
  const prevFromLink = pageFromLink(link, 'prev');
  const prevPage = prevFromLink ?? (page > 1 ? page - 1 : null);

  return { page, perPage, total, totalPages, nextPage, prevPage };
}

/** Human-readable hints about what else is available. */
export function paginationNotes(
  pagination: Pagination,
  itemCount: number,
  toolName: string
): string[] {
  const notes: string[] = [];
  if (pagination.total !== null) {
    const first = (pagination.page - 1) * pagination.perPage + 1;
    notes.push(
      `${pagination.total} item(s) in total; this page shows ${itemCount} of them (starting at #${first}).`
    );
  } else {
    notes.push(
      'This endpoint does not report a total count, so the number of items overall is unknown.'
    );
  }
  if (pagination.nextPage !== null) {
    notes.push(
      `More items exist: call ${toolName} again with page=${pagination.nextPage}.`
    );
  }
  return notes;
}
