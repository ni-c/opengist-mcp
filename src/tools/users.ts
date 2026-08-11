import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { OpengistApiError, type OpengistApi } from '../api.js';
import { jsonResult, run, ToolInputError } from '../result.js';
import { gistId, gistPath, username } from '../schema.js';

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
      inputSchema: {
        username: username
          .optional()
          .describe('Look up this username instead of the token owner'),
        userId: z.coerce
          .number()
          .int()
          .positive()
          .optional()
          .describe('Look up this numeric user ID instead of the token owner'),
      },
      annotations: { readOnlyHint: true },
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
        return jsonResult({
          self: name === undefined && userId === undefined,
          user: await api.get(path),
        });
      })
  );

  server.registerTool(
    'check_gist_like',
    {
      title: 'Check whether a gist is liked',
      description:
        'Report whether the token owner has liked the given gist. Also distinguishes "not liked" from "not visible to you".',
      inputSchema: { gistId },
      annotations: { readOnlyHint: true },
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
      inputSchema: {
        gistId,
        liked: z
          .boolean()
          .describe('true to like the gist, false to remove the like'),
      },
      annotations: { idempotentHint: true },
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
