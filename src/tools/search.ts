import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import {
  gistScope,
  since,
  username,
  visibility,
  withQuery,
} from '../schema.js';
import {
  hasUntrustedMetadata,
  shapeGistSummary,
  UNTRUSTED_METADATA_NOTE,
  type RawGist,
} from '../shape.js';

import type { OpengistApi } from '../api.js';
import { parsePagination } from '../pagination.js';
import { jsonResult, run } from '../result.js';
import { listPath } from './gists.js';

/** Pages are 100 items each; scanning more than this is never worth the wait. */
const MAX_PAGES = 20;
const SCAN_PER_PAGE = 100;
/** Wall-clock budget for a whole scan, independent of the page cap. */
const SCAN_BUDGET_MS = 20_000;

type MatchField = 'title' | 'description' | 'topics' | 'owner';

function haystack(gist: RawGist, field: MatchField): string {
  switch (field) {
    case 'title':
      return gist.title ?? '';
    case 'description':
      return gist.description ?? '';
    case 'topics':
      return (gist.topics ?? []).join(' ');
    case 'owner':
      return gist.owner?.username ?? '';
  }
}

export function registerSearchTools(server: McpServer, api: OpengistApi): void {
  server.registerTool(
    'search_gists',
    {
      title: 'Search gists',
      description:
        'Find gists by title, description, topics or owner. ' +
        'Opengist has no search API, so this pages through the list endpoints and filters client-side — it is therefore bounded and can be incomplete; ' +
        'the result always says how much was scanned and whether it was cut short. ' +
        'Searching inside file contents is not supported (it would mean downloading every file of every gist): narrow the field here, then read candidates with get_gist.',
      inputSchema: z.object({
        query: z
          .string()
          .min(1)
          .max(200)
          .describe(
            'Whitespace-separated terms. All terms must match (case-insensitive substring); this is not a regular expression.'
          ),
        in: z
          .array(z.enum(['title', 'description', 'topics', 'owner']))
          .min(1)
          .default(['title', 'description', 'topics'])
          .describe('Which fields to match against'),
        scope: gistScope.default('mine'),
        username: username
          .optional()
          .describe("Search this user's gists instead of your own"),
        visibility: visibility
          .optional()
          .describe('Only return gists with this visibility'),
        archived: z
          .boolean()
          .optional()
          .describe(
            'Only return archived (true) or non-archived (false) gists'
          ),
        since,
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .default(20)
          .describe('Maximum number of matches to return'),
        maxPages: z
          .number()
          .int()
          .min(1)
          .max(MAX_PAGES)
          .default(5)
          .describe(
            `Pages of ${SCAN_PER_PAGE} gists to scan at most (1-${MAX_PAGES})`
          ),
      }),
      annotations: { readOnlyHint: true },
    },
    ({
      query,
      in: fields,
      scope,
      username: user,
      visibility: wantedVisibility,
      archived,
      since,
      limit,
      maxPages,
    }) =>
      run(async () => {
        const terms = query
          .toLowerCase()
          .split(/\s+/)
          .filter((term) => term !== '');
        const matches: Record<string, unknown>[] = [];
        const notes: string[] = [];
        const startedAt = Date.now();

        let scannedPages = 0;
        let scannedGists = 0;
        let total: number | null = null;
        let stopped: string | null = null;
        let matchedUntrustedMetadata = false;
        let nextPage: number | null = 1;

        while (nextPage !== null) {
          if (scannedPages >= maxPages) {
            stopped = 'pageCap';
            break;
          }
          if (Date.now() - startedAt > SCAN_BUDGET_MS) {
            stopped = 'timeBudget';
            break;
          }

          const response = await api.getWithHeaders(
            withQuery(listPath(scope, user), {
              page: nextPage,
              per_page: SCAN_PER_PAGE,
              since,
            })
          );
          const gists = (response.data ?? []) as RawGist[];
          const pagination = parsePagination(
            response.headers,
            nextPage,
            SCAN_PER_PAGE
          );
          total = pagination.total;
          scannedPages++;
          scannedGists += gists.length;

          for (const gist of gists) {
            if (
              wantedVisibility !== undefined &&
              gist.visibility !== wantedVisibility
            ) {
              continue;
            }
            if (
              archived !== undefined &&
              (gist.archived ?? false) !== archived
            ) {
              continue;
            }
            const matchedOn = fields.filter((field) => {
              const value = haystack(gist, field).toLowerCase();
              return terms.every((term) => value.includes(term));
            });
            if (matchedOn.length === 0) continue;
            if (hasUntrustedMetadata(gist)) matchedUntrustedMetadata = true;
            matches.push({ ...shapeGistSummary(gist), matchedOn });
            if (matches.length >= limit) break;
          }

          if (matches.length >= limit) {
            stopped = 'limit';
            break;
          }
          nextPage = pagination.nextPage;
        }

        const truncated = stopped !== null;
        if (stopped === 'pageCap') {
          notes.push(
            `INCOMPLETE RESULT: stopped after the page cap of ${maxPages} page(s), having scanned ${scannedGists}` +
              `${total !== null ? ` of ${total}` : ''} gist(s). Narrow the search with username/since/visibility or raise maxPages (max ${MAX_PAGES}).`
          );
        } else if (stopped === 'timeBudget') {
          notes.push(
            `INCOMPLETE RESULT: the scan hit its time budget of ${SCAN_BUDGET_MS / 1000}s after ${scannedGists} gist(s). Narrow the search.`
          );
        } else if (stopped === 'limit') {
          notes.push(
            `INCOMPLETE RESULT: stopped at the limit of ${limit} match(es) after scanning ${scannedGists} gist(s); more may exist. Raise limit or narrow the query.`
          );
        } else {
          notes.push(
            `Complete scan: all ${scannedGists} gist(s) in this scope were checked.`
          );
        }
        notes.push(
          'Opengist has no search API — this was a client-side scan of the list endpoints, and file contents were not searched.'
        );
        if (matchedUntrustedMetadata) notes.push(UNTRUSTED_METADATA_NOTE);

        return jsonResult({
          query,
          in: fields,
          scope,
          username: user,
          matches,
          scanned: {
            pages: scannedPages,
            gists: scannedGists,
            totalAvailable: total,
          },
          truncated,
          notes,
        });
      })
  );
}
