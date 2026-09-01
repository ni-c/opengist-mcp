import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';

import { OpengistApiError, type OpengistApi } from '../api.js';
import { READ_ONLY } from './annotations.js';
import { jsonResult, run, ToolInputError } from '../result.js';
import { gistId, gistPath, username } from '../schema.js';
import { shapeUserDetail, type RawUser } from '../shape.js';

/**
 * Checks whether the gist is liked. The API answers 204 for "liked" and 404
 * for both "not liked" and "not visible", so a follow-up read disambiguates.
 */
async function readLikeState(
  api: OpengistApi,
  id: string
): Promise<{ liked: boolean; visible: boolean }> {
  try {
    await api.get(gistPath(id, '/like'));
    return { liked: true, visible: true };
  } catch (error) {
    if (!(error instanceof OpengistApiError) || error.status !== 404)
      throw error;
  }
  try {
    await api.get(gistPath(id));
    return { liked: false, visible: true };
  } catch (error) {
    if (error instanceof OpengistApiError && error.status === 404) {
      return { liked: false, visible: false };
    }
    throw error;
  }
}

export function registerUserTools(server: McpServer, api: OpengistApi): void {
  server.registerTool(
    'get_user',
    {
      title: 'Get a user',
      description:
        'Get an Opengist user account. Without arguments this returns the account the access token belongs to (including its email); ' +
        "with username or userId it returns that user's public profile.",
      inputSchema: z.object({
        username: username
          .optional()
          .describe('Look up this username instead of the token owner'),
        userId: z.coerce
          .number()
          .int()
          .positive()
          .optional()
          .describe('Look up this numeric user ID instead of the token owner'),
      }),
      annotations: READ_ONLY,
    },
    ({ username: name, userId }) =>
      run(async () => {
        if (name !== undefined && userId !== undefined) {
          throw new ToolInputError(
            'Pass either username or userId, not both. Note that a numeric-looking username is a valid username, so the two are not interchangeable.'
          );
        }
        const path =
          name !== undefined
            ? `/users/${encodeURIComponent(name)}`
            : userId !== undefined
              ? `/user/${encodeURIComponent(String(userId))}`
              : '/user';
        const response = await api.get(path);
        // Report a non-object body instead of allowlisting it into an empty
        // object: that shape means the instance answered with HTML or broken
        // JSON (a proxy error page returned with status 200, for example), and
        // silently showing "{}" would hide the actual problem.
        if (
          typeof response !== 'object' ||
          response === null ||
          Array.isArray(response)
        ) {
          const kind =
            response === null
              ? 'an empty body'
              : Array.isArray(response)
                ? 'an array'
                : `a ${typeof response} value`;
          throw new Error(
            `The Opengist API returned ${kind} instead of a user object for ${path}. ` +
              'Check that OPENGIST_URL points at the Opengist instance itself and not at a proxy or login page.'
          );
        }
        return jsonResult({
          self: name === undefined && userId === undefined,
          user: shapeUserDetail(response as RawUser),
        });
      })
  );

  server.registerTool(
    'check_gist_like',
    {
      title: 'Check whether a gist is liked',
      description:
        'Report whether the token owner has liked the given gist. Also distinguishes "not liked" from "not visible to you".',
      inputSchema: z.object({ gistId }),
      annotations: READ_ONLY,
    },
    ({ gistId: id }) =>
      run(async () => {
        const state = await readLikeState(api, id);
        return jsonResult({
          gistId: id,
          ...state,
          ...(state.visible
            ? {}
            : {
                note: 'The gist is not visible to this token: it either does not exist or is private and owned by somebody else.',
              }),
        });
      })
  );
}

export function registerLikeWriteTools(
  server: McpServer,
  api: OpengistApi
): void {
  server.registerTool(
    'set_gist_like',
    {
      title: 'Like or unlike a gist',
      description:
        'Like or unlike a gist. Idempotent: the current state is read first and the gist is only toggled when it differs, ' +
        'so calling this twice with the same value does not undo it. Requires the user:write scope on the access token.',
      inputSchema: z.object({
        gistId,
        liked: z
          .boolean()
          .describe('true to like the gist, false to remove the like'),
      }),
      annotations: {
        // A marker.
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ gistId: id, liked }) =>
      run(async () => {
        const state = await readLikeState(api, id);
        if (!state.visible) {
          throw new ToolInputError(
            `Gist "${id}" is not visible to this token: it either does not exist or is private and owned by somebody else.`
          );
        }
        if (state.liked === liked) {
          return jsonResult({
            gistId: id,
            liked,
            changed: false,
            note: 'Already in the requested state; no change was made.',
          });
        }
        await api.put(gistPath(id, '/like'));
        return jsonResult({ gistId: id, liked, changed: true });
      })
  );
}
